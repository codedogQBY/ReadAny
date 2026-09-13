import { createMobileFallbackContentProvider } from "@/lib/rag/mobile-fallback-content-provider";
import { setFallbackContentProvider } from "@readany/core/ai";
import { getPlatformService } from "@readany/core/services";
import { useEffect, useRef } from "react";
import { type ExtractorRef, ExtractorWebView } from "./ExtractorWebView";

export function MobileFallbackExtractorHost() {
  const extractorRef = useRef<ExtractorRef>(null);

  useEffect(() => {
    setFallbackContentProvider(
      createMobileFallbackContentProvider({
        getExtractor: () => extractorRef.current,
        platform: getPlatformService(),
      }),
    );

    return () => setFallbackContentProvider(null);
  }, []);

  return <ExtractorWebView ref={extractorRef} />;
}
