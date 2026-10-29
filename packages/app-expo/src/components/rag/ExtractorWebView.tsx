import {
  type RequestTracker,
  createRequestTracker,
  sendScript,
} from "@/lib/rag/extractor-requests-core";
import type { ChapterData } from "@readany/core/rag";
import { Asset } from "expo-asset";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AppState, StyleSheet, View, findNodeHandle } from "react-native";
import { WebView } from "react-native-webview";
import { evaluateInWebView } from "../../../modules/webview-eval";

const READER_HTML_ASSET = Asset.fromModule(require("../../../assets/reader/reader.html"));
const EXTRACTION_TIMEOUT_MS = 45_000;

const EXTRACTOR_EXTENSIONS_BY_MIME: Record<string, string> = {
  "application/epub+zip": "epub",
  "application/pdf": "pdf",
  "application/x-mobipocket-ebook": "mobi",
  "application/vnd.amazon.ebook": "azw3",
  "application/vnd.comicbook+zip": "cbz",
  "application/x-fictionbook+xml": "fb2",
  "application/x-zip-compressed-fb2": "fbz",
  "text/plain": "txt",
};

function getExtractorFileName(mimeType: string) {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() || "application/epub+zip";
  return `book.${EXTRACTOR_EXTENSIONS_BY_MIME[normalized] || "epub"}`;
}

export interface ExtractorRef {
  extractChapters: (base64BookData: string, mimeType?: string) => Promise<ChapterData[]>;
}

export const ExtractorWebView = forwardRef<ExtractorRef>((_, ref) => {
  const webViewRef = useRef<WebView>(null);
  const containerRef = useRef<View>(null);
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const trackerRef = useRef<RequestTracker<ChapterData[]> | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = createRequestTracker<ChapterData[]>({
      timeoutMs: EXTRACTION_TIMEOUT_MS,
      timeoutMessage: "Timed out extracting book content",
    });
  }
  const tracker = trackerRef.current;

  useEffect(() => {
    return () => {
      tracker.rejectAll(new Error("Extractor WebView unmounted"));
    };
  }, [tracker]);

  useEffect(() => {
    const loadAsset = async () => {
      try {
        const asset = READER_HTML_ASSET;
        await asset.downloadAsync();
        const uri = asset.localUri || asset.uri;
        setHtmlUri(uri);
      } catch (err) {
        console.error("[ExtractorWebView] Failed to load HTML asset:", err);
      }
    };
    loadAsset();
  }, []);

  const handleMessage = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: Required for React Native WebView events
    (event: any) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === "ready") {
          setReady(true);
        } else if (msg.type === "chaptersExtracted") {
          const requestId: string | undefined = msg.requestId;
          const settled = msg.error
            ? tracker.reject(requestId, new Error(msg.error))
            : tracker.resolve(requestId, msg.chapters ?? []);
          if (!settled) {
            console.warn(`[ExtractorWebView] Ignored an answer nobody waits for (${requestId})`);
          }
        } else if (msg.type === "debug") {
          console.log("[ExtractorWebView]", msg.message);
        } else if (msg.type === "error") {
          console.error("[ExtractorWebView] WebView error:", msg.message);
          tracker.reject(undefined, new Error(msg.message));
        }
      } catch (err) {
        console.warn("[ExtractorWebView] Failed to parse message:", err);
      }
    },
    [tracker],
  );

  useImperativeHandle(ref, () => ({
    extractChapters: (base64BookData: string, mimeType = "application/epub+zip") => {
      if (!ready || !webViewRef.current) {
        return Promise.reject(new Error("Extractor WebView not ready"));
      }

      const { id, promise } = tracker.begin();
      const startedAt = Date.now();
      const appState = AppState.currentState;

      // The book is parsed without being rendered; see `extractBookChapters` in the reader.
      const cmd = {
        type: "extractBookChapters",
        requestId: id,
        base64: base64BookData,
        mimeType,
        fileName: getExtractorFileName(mimeType),
      };
      const script = `
        window.postMessage(${JSON.stringify(JSON.stringify(cmd))}, "*");
        true;
      `;

      const viewTag = findNodeHandle(containerRef.current);
      const evaluate = evaluateInWebView;
      sendScript(
        {
          native: evaluate && viewTag != null ? (source) => evaluate(viewTag, source) : null,
          command: (source) => webViewRef.current?.injectJavaScript(source),
          isAppActive: () => AppState.currentState === "active",
          warn: (message, error) => console.warn(`[ExtractorWebView] ${message}:`, error),
        },
        script,
      )
        .then((transport) => {
          console.log(
            `[ExtractorWebView] ${id} sent via ${transport} (app ${appState}, ${base64BookData.length} base64 chars)`,
          );
        })
        .catch((err) => {
          tracker.reject(id, err instanceof Error ? err : new Error(String(err)));
        });

      return promise.then(
        (chapters) => {
          console.log(
            `[ExtractorWebView] ${id} answered in ${Date.now() - startedAt} ms (${chapters.length} chapters)`,
          );
          return chapters;
        },
        (err) => {
          console.warn(`[ExtractorWebView] ${id} failed after ${Date.now() - startedAt} ms:`, err);
          throw err;
        },
      );
    },
  }));

  if (!htmlUri) return null;

  return (
    <View
      ref={containerRef}
      collapsable={false}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <WebView
        ref={webViewRef}
        source={{ uri: htmlUri }}
        style={{ width: 0, height: 0, opacity: 0 }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        onMessage={handleMessage}
      />
    </View>
  );
});
