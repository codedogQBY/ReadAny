import type { ChapterData } from "@readany/core/rag";
import type { Book } from "@readany/core/types";
import { Asset } from "expo-asset";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { toBookExtractionError } from "../../lib/rag/extractor-error";
import { createExtractorCommand } from "../../lib/rag/extractor-format";
import { ExtractorRequestBoundary } from "../../lib/rag/extractor-request-boundary";

const READER_HTML_ASSET = Asset.fromModule(require("../../../assets/reader/reader.html"));
const EXTRACTION_TIMEOUT_MS = 45_000;

export interface ExtractorRef {
  extractChapters: (
    base64BookData: string,
    mimeType?: string,
    bookFormat?: Book["format"],
    fileName?: string,
    signal?: AbortSignal,
  ) => Promise<ChapterData[]>;
}

function getAbortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) {
    if (reason.name !== "AbortError") reason.name = "AbortError";
    return reason;
  }
  const error = new Error("Vectorization cancelled");
  error.name = "AbortError";
  return error;
}

export const ExtractorWebView = forwardRef<ExtractorRef>((_, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [requestBoundary] = useState(
    () =>
      new ExtractorRequestBoundary<ChapterData[], Book["format"] | undefined>({
        timeoutMs: EXTRACTION_TIMEOUT_MS,
        sendCancel: (requestId) => {
          webViewRef.current?.injectJavaScript(`
            window.postMessage(${JSON.stringify(
              JSON.stringify({ type: "cancelExtraction", requestId }),
            )}, "*");
            true;
          `);
        },
        onCancelError: (requestId, error) => {
          console.warn(`[ExtractorWebView] Failed to cancel request ${requestId}:`, error);
        },
      }),
  );

  useEffect(() => {
    return () => {
      requestBoundary.rejectAll();
    };
  }, [requestBoundary]);

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
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === "ready") {
          setReady(true);
        } else if (msg.type === "loaded") {
          if (!requestBoundary.has(msg.requestId)) return;
          // Trigger extraction once the book is fully loaded
          webViewRef.current?.injectJavaScript(`
          if (window.handleExtractChapters) {
             window.handleExtractChapters(${JSON.stringify(msg.requestId)});
          } else {
             window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chaptersExtracted', requestId: ${JSON.stringify(msg.requestId)}, error: 'Extraction not supported' }));
          }
          true;
        `);
        } else if (msg.type === "chaptersExtracted") {
          const classificationFormat = requestBoundary.getContext(msg.requestId);
          if (msg.error) {
            requestBoundary.reject(
              msg.requestId,
              toBookExtractionError(new Error(String(msg.error)), classificationFormat),
            );
          } else if (msg.chapters) {
            requestBoundary.resolve(msg.requestId, msg.chapters);
          }
        } else if (msg.type === "debug") {
          console.log("[ExtractorWebView]", msg.message);
        } else if (msg.type === "error") {
          if (!requestBoundary.has(msg.requestId)) return;
          console.error("[ExtractorWebView] WebView error:", msg.message);
          const classificationFormat = requestBoundary.getContext(msg.requestId);
          requestBoundary.reject(
            msg.requestId,
            toBookExtractionError(new Error(String(msg.message)), classificationFormat),
          );
        }
      } catch (err) {
        console.warn("[ExtractorWebView] Failed to parse message:", err);
      }
    },
    [requestBoundary],
  );

  useImperativeHandle(ref, () => ({
    extractChapters: (
      base64BookData: string,
      mimeType = "application/epub+zip",
      bookFormat?: Book["format"],
      fileName?: string,
      signal?: AbortSignal,
    ) => {
      const requestId = `extract-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const baseCommand = createExtractorCommand({
        base64BookData,
        mimeType,
        bookFormat,
        fileName,
      });
      const command = { ...baseCommand, requestId };
      const classificationFormat = command.bookFormat ?? undefined;
      return new Promise<ChapterData[]>((resolve, reject) => {
        if (signal?.aborted) return reject(getAbortError(signal));
        if (!ready || !webViewRef.current) {
          return reject(
            toBookExtractionError(new Error("Extractor WebView not ready"), classificationFormat),
          );
        }

        requestBoundary.add({
          requestId,
          resolve,
          reject,
          context: classificationFormat,
          signal,
          abortError: () => getAbortError(signal as AbortSignal),
          timeoutError: () =>
            toBookExtractionError(
              new Error("Timed out extracting book content"),
              classificationFormat,
            ),
          disposeError: () =>
            toBookExtractionError(new Error("Extractor WebView unmounted"), classificationFormat),
        });

        // Command the webview to open the book first.
        // It will reply with "loaded" when it finishes rendering.
        try {
          webViewRef.current.injectJavaScript(`
            window.postMessage(${JSON.stringify(JSON.stringify(command))}, "*");
            true;
          `);
        } catch (error) {
          requestBoundary.reject(requestId, toBookExtractionError(error, classificationFormat));
        }
      });
    },
  }));

  if (!htmlUri) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
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
