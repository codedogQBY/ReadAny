import type { ChapterData } from "@readany/core/rag";
import { Asset } from "expo-asset";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

const READER_HTML_ASSET = Asset.fromModule(require("../../../assets/reader/reader.html"));

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

function isPDFMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() === "application/pdf";
}

export interface ExtractorRef {
  extractChapters: (base64BookData: string, mimeType?: string) => Promise<ChapterData[]>;
}

export const ExtractorWebView = forwardRef<ExtractorRef>((_, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Pending extraction requests
  const pendingRequests = useRef<((chapters: ChapterData[]) => void)[]>([]);
  const pendingErrors = useRef<((err: Error) => void)[]>([]);

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

  // biome-ignore lint/suspicious/noExplicitAny: Required for React Native WebView events
  const handleMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "ready") {
        setReady(true);
      } else if (msg.type === "loaded") {
        // Trigger extraction once the book is fully loaded
        webViewRef.current?.injectJavaScript(`
          if (window.handleExtractChapters) {
             window.handleExtractChapters();
          } else {
             window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chaptersExtracted', error: 'Extraction not supported' }));
          }
          true;
        `);
      } else if (msg.type === "chaptersExtracted") {
        const resolve = pendingRequests.current.shift();
        const reject = pendingErrors.current.shift();

        if (msg.error && reject) {
          reject(new Error(msg.error));
        } else if (msg.chapters && resolve) {
          resolve(msg.chapters);
        }
      } else if (msg.type === "debug") {
        console.log("[ExtractorWebView]", msg.message);
      } else if (msg.type === "error") {
        console.error("[ExtractorWebView] WebView error:", msg.message);
        // Only reject if we were waiting for it
        if (pendingErrors.current.length > 0) {
          const reject = pendingErrors.current.shift();
          pendingRequests.current.shift(); // remove corresponding resolve
          reject?.(new Error(msg.message));
        }
      }
    } catch (err) {
      console.warn("[ExtractorWebView] Failed to parse message:", err);
    }
  }, []);

  useImperativeHandle(ref, () => ({
    extractChapters: (base64BookData: string, mimeType = "application/epub+zip") => {
      return new Promise<ChapterData[]>((resolve, reject) => {
        if (!ready || !webViewRef.current) {
          return reject(new Error("Extractor WebView not ready"));
        }

        pendingRequests.current.push(resolve);
        pendingErrors.current.push(reject);

        // Command the webview to open the book first.
        // It will reply with "loaded" when it finishes rendering.
        const cmd = {
          type: isPDFMimeType(mimeType) ? "extractBookChapters" : "openBook",
          base64: base64BookData,
          mimeType,
          fileName: getExtractorFileName(mimeType),
        };

        webViewRef.current.injectJavaScript(`
          window.postMessage(${JSON.stringify(JSON.stringify(cmd))}, "*");
          true;
        `);
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
