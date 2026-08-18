import type { ChapterData } from "@readany/core/rag";
import type { Book } from "@readany/core/types";
import type { BookExtractionErrorCategory } from "./extractor-error";
import { runVectorizeQueueJob, throwIfQueueJobAborted } from "./vectorize-queue-job";

export type AutoVectorizeCallback = (
  bookId: string,
  progress: {
    status: string;
    progress: number;
    error?: unknown;
    errorCategory?: BookExtractionErrorCategory;
    cleanupError?: unknown;
  },
) => void;

interface ExtractorRef {
  extractChapters: (
    base64BookData: string,
    mimeType?: string,
    bookFormat?: Book["format"],
    fileName?: string,
    signal?: AbortSignal,
  ) => Promise<ChapterData[]>;
}

interface QueueItem {
  book: Book;
  base64Data: string;
  mimeType: string;
}

let extractorRef: ExtractorRef | null = null;
let callback: AutoVectorizeCallback | null = null;
const queue: QueueItem[] = [];
let processing = false;

export function setExtractorRef(ref: ExtractorRef | null) {
  extractorRef = ref;
}

export function setCallback(cb: AutoVectorizeCallback | null) {
  callback = cb;
}

export function isProcessing() {
  return processing;
}

export function getQueueLength() {
  return queue.length;
}

export async function queueBook(book: Book, base64Data: string, mimeType: string) {
  queue.push({ book, base64Data, mimeType });
  if (!processing) {
    processQueue();
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    const { resetBookVectorization, triggerVectorizeBook } = await import("./vectorize-trigger");

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const { book, base64Data, mimeType } = item;

      await runVectorizeQueueJob<number>({
        format: book.format,
        extract: async (signal) => {
          throwIfQueueJobAborted(signal);
          if (!extractorRef) throw new Error("Extractor WebView not ready");
          return extractorRef.extractChapters(
            base64Data,
            mimeType,
            book.format,
            book.filePath,
            signal,
          );
        },
        vectorize: async (chapters, onProgress, signal) => {
          await triggerVectorizeBook(
            book.id,
            book.filePath,
            chapters,
            (progress) => {
              const pct =
                progress.totalChunks > 0 ? progress.processedChunks / progress.totalChunks : 0;
              onProgress?.(pct);
            },
            signal,
          );
        },
        cleanup: () => resetBookVectorization(book.id),
        onEvent: (event) => {
          if (event.status === "extracting") {
            callback?.(book.id, { status: "extracting", progress: 0 });
          } else if (event.status === "vectorizing") {
            callback?.(book.id, { status: "vectorizing", progress: event.progress ?? 0 });
          } else if (event.status === "completed") {
            callback?.(book.id, { status: "completed", progress: 1 });
          } else if (event.status === "cancelled") {
            callback?.(book.id, { status: "cancelled", progress: 0 });
          } else {
            console.error(`[AutoVectorize] Failed for ${book.meta.title}:`, event.error);
            if (event.cleanupError) {
              console.error(
                `[AutoVectorize] Failed to clean up ${book.meta.title}:`,
                event.cleanupError,
              );
            }
            callback?.(book.id, {
              status: "error",
              progress: 0,
              error: event.error,
              errorCategory: event.errorCategory,
              cleanupError: event.cleanupError,
            });
          }
        },
      });
    }
  } finally {
    processing = false;
  }
}
