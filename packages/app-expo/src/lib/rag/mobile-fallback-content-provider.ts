import type { ExtractorRef } from "@/components/rag/ExtractorWebView";
import type { FallbackContentProvider } from "@readany/core/ai";
import type { IPlatformService } from "@readany/core/services";

type MobileFallbackPlatform = Pick<
  IPlatformService,
  "exists" | "getAppDataDir" | "joinPath" | "readFile"
>;

interface MobileFallbackContentProviderDependencies {
  getExtractor: () => ExtractorRef | null;
  platform: MobileFallbackPlatform;
}

const MIME_TYPES: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  mobi: "application/x-mobipocket-ebook",
  azw: "application/vnd.amazon.ebook",
  azw3: "application/vnd.amazon.ebook",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook+zip",
  fb2: "application/x-fictionbook+xml",
  fbz: "application/x-zip-compressed-fb2",
  txt: "text/plain",
};

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function isAbsoluteBookPath(filePath: string): boolean {
  return /^(?:\/|file:\/\/|asset:\/\/|https?:\/\/)/i.test(filePath);
}

export function createMobileFallbackContentProvider(
  dependencies: MobileFallbackContentProviderDependencies,
): FallbackContentProvider {
  return {
    async getChapters(book) {
      const extractor = dependencies.getExtractor();
      if (!extractor) throw new Error("Mobile fallback extractor is not ready");

      const { platform } = dependencies;
      const filePath = isAbsoluteBookPath(book.filePath)
        ? book.filePath
        : await platform.joinPath(await platform.getAppDataDir(), book.filePath);
      if (/^https?:\/\//i.test(filePath)) {
        throw new Error("Mobile original-file search requires a local book file");
      }
      if (!(await platform.exists(filePath))) {
        throw new Error("Book file is not available on this device");
      }

      const bytes = await platform.readFile(filePath);
      const format = String(book.format || "").toLowerCase();
      return extractor.extractChapters(
        bytesToBase64(bytes),
        MIME_TYPES[format] || "application/epub+zip",
      );
    },
  };
}
