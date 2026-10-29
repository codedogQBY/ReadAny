import type { ExtractorRef } from "@/components/rag/ExtractorWebView";
import { inspectMobileBookForVectorize } from "@/lib/rag/auto-vectorize-book";
import { waitUnlessBackground } from "@/lib/rag/background-timers";
import {
  type BackgroundVectorizeHandle,
  acquireBackgroundVectorize,
} from "@/lib/rag/vectorize-background";
import { triggerVectorizeBook } from "@/lib/rag/vectorize-trigger";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useVectorModelStore } from "@/stores/vector-model-store";
import { checkpointPercent, useVectorStatusStore } from "@/stores/vector-status-store";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Book, VectorizeProgress } from "@readany/core/types";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AppState } from "react-native";

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface UseVectorizationQueueOptions {
  extractorRef: React.RefObject<ExtractorRef | null>;
  nav: Nav;
}

export function useVectorizationQueue({ extractorRef, nav }: UseVectorizationQueueOptions) {
  const { t } = useTranslation();
  const [vectorQueue, setVectorQueue] = useState<Book[]>([]);
  const vectorQueueRef = useRef<Book[]>([]);
  const [vectorizingBookId, setVectorizingBookId] = useState<string | null>(null);
  const [vectorizingBookTitle, setVectorizingBookTitle] = useState("");
  const [vectorProgress, setVectorProgress] = useState<VectorizeProgress | null>(null);
  const isProcessingRef = useRef(false);

  const processOneBook = useCallback(
    async (book: Book, background: BackgroundVectorizeHandle, index: number, total: number) => {
      console.log(
        `[Vectorize] Starting "${book.meta.title}" (${index + 1}/${total}), app ${AppState.currentState}`,
      );
      background.bookStarted(book.meta.title, index, total);
      setVectorizingBookId(book.id);
      setVectorizingBookTitle(book.meta.title);
      setVectorProgress({
        bookId: book.id,
        status: "chunking",
        processedChunks: 0,
        totalChunks: 0,
      });

      try {
        if (!extractorRef.current) {
          throw new Error("Extractor WebView not ready");
        }

        const info = await inspectMobileBookForVectorize(book);
        if (!info.canVectorize || !info.mimeType) {
          throw new Error(`Book cannot be vectorized on mobile: ${info.reason ?? "unknown"}`);
        }

        const base64 = await FileSystem.readAsStringAsync(info.absPath, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const chapters = await extractorRef.current.extractChapters(base64, info.mimeType);
        if (!chapters || chapters.length === 0) {
          throw new Error("No chapters extracted from book");
        }
        console.log(`[Vectorize] Extracted ${chapters.length} chapters from "${book.meta.title}"`);

        await triggerVectorizeBook(book.id, book.filePath, chapters, (progress) => {
          setVectorProgress({ ...progress });
          if (progress.status === "embedding" && progress.totalChunks > 0) {
            background.bookProgress(progress.processedChunks / progress.totalChunks);
          }
        });
        background.bookFinished(true);
        console.log(`[Vectorize] Finished "${book.meta.title}"`);

        setVectorProgress({
          bookId: book.id,
          status: "completed",
          processedChunks: 1,
          totalChunks: 1,
        });
        await waitUnlessBackground(800);
      } catch (err) {
        console.error(
          `[useVectorizationQueue] Vectorization failed for "${book.meta.title}":`,
          err,
        );
        background.bookFinished(false);
        setVectorProgress({
          bookId: book.id,
          status: "error",
          processedChunks: 0,
          totalChunks: 0,
        });
        const savedPct = checkpointPercent(useVectorStatusStore.getState().checkpoints[book.id]);
        const reason = err instanceof Error ? err.message : String(err);
        Alert.alert(
          t("vectorize.stoppedTitle", "Vectorization stopped"),
          savedPct > 0
            ? t("vectorize.stoppedResumable", {
                title: book.meta.title,
                percent: savedPct,
                reason,
                defaultValue:
                  "{{title}}\n\n{{reason}}\n\n{{percent}}% is saved. Vectorize the book again to continue from there.",
              })
            : t("vectorize.stoppedNoProgress", {
                title: book.meta.title,
                reason,
                defaultValue: "{{title}}\n\n{{reason}}",
              }),
        );
        await waitUnlessBackground(1500);
      }
    },
    [extractorRef, t],
  );

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    // Keeps the run alive with the screen off and shows progress in the notification shade.
    const background = await acquireBackgroundVectorize();
    let processed = 0;
    try {
      while (vectorQueueRef.current.length > 0) {
        const [nextBook, ...remainingBooks] = vectorQueueRef.current;
        if (!nextBook) break;
        vectorQueueRef.current = remainingBooks;
        setVectorQueue([...vectorQueueRef.current]);
        await processOneBook(
          nextBook,
          background,
          processed,
          processed + 1 + vectorQueueRef.current.length,
        );
        processed++;
      }
    } finally {
      await background.release();
      isProcessingRef.current = false;
      setVectorizingBookId(null);
      setVectorProgress(null);
    }
  }, [processOneBook]);

  const handleVectorize = useCallback(
    (book: Book) => {
      const prepareAndQueue = async () => {
        const info = await inspectMobileBookForVectorize(book);
        if (info.reason === "unsupported-format") {
          Alert.alert(
            t("vectorize.unsupportedFormatTitle", "Unsupported format"),
            t(
              "vectorize.unsupportedFormatDesc",
              "Mobile vectorization currently supports EPUB, PDF, FB2, FBZ, TXT, and UMD books.",
            ),
          );
          return;
        }
        if (info.reason === "missing-file") {
          Alert.alert(
            t("common.error", "Error"),
            t(
              "vectorize.missingFileDesc",
              "The local book file is missing. Please download or re-import it.",
            ),
          );
          return;
        }
        const alreadyQueued = vectorQueueRef.current.some((b) => b.id === book.id);
        if (alreadyQueued || vectorizingBookId === book.id) return;

        vectorQueueRef.current = [...vectorQueueRef.current, book];
        setVectorQueue([...vectorQueueRef.current]);

        if (!isProcessingRef.current) {
          processQueue();
        }
      };

      const hasCapability = useVectorModelStore.getState().hasVectorCapability();
      if (!hasCapability) {
        Alert.alert(t("settings.vectorModel"), t("vectorize.notConfiguredDesc"), [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("vectorize.goSettings"),
            onPress: () => nav.navigate("VectorModelSettings"),
          },
        ]);
        return;
      }

      prepareAndQueue().catch((err) => {
        console.error(`[useVectorizationQueue] Failed to prepare "${book.meta.title}":`, err);
        Alert.alert(
          t("common.error", "Error"),
          t("vectorize.prepareFailed", "Failed to prepare vectorization."),
        );
      });
    },
    [nav, t, vectorizingBookId, processQueue],
  );

  return {
    vectorQueue,
    vectorizingBookId,
    vectorizingBookTitle,
    vectorProgress,
    handleVectorize,
  };
}
