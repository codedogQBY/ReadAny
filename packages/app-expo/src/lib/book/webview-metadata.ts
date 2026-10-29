/**
 * Metadata + cover extraction for formats the lightweight JS parsers can't read
 * (FB2/FBZ, CBZ, PDF).
 *
 * Hermes has no DOMParser/canvas/pdf.js, so the work is delegated to the hidden
 * reader WebView (foliate-js) that LibraryScreen already mounts for vectorization.
 */
import type { Book } from "@readany/core/types";
import type { ExtractedMeta } from "./metadata-extractor";

/** Subset of ExtractorRef used here, so this module doesn't depend on the component. */
export interface WebViewMetadataExtractor {
  extractMetadata: (
    base64BookData: string,
    mimeType: string,
  ) => Promise<{
    title: string;
    author: string;
    publisher: string;
    language: string;
    description: string;
    subjects: string[];
    coverBase64: string;
    coverMimeType: string;
  }>;
}

// The whole file crosses the RN bridge as base64 (same as vectorization), so keep
// it well under the size that triggered OOM crashes on Android (see issue #829).
export const WEBVIEW_METADATA_MAX_BYTES = 32 * 1024 * 1024;

const WEBVIEW_METADATA_MIME_TYPES: Partial<Record<Book["format"], string>> = {
  pdf: "application/pdf",
  cbz: "application/vnd.comicbook+zip",
  fb2: "application/x-fictionbook+xml",
  fbz: "application/x-zip-compressed-fb2",
};

let extractor: WebViewMetadataExtractor | null = null;

export function setWebViewMetadataExtractor(ref: WebViewMetadataExtractor | null) {
  extractor = ref;
}

export function supportsWebViewMetadata(format: Book["format"]): boolean {
  return format in WEBVIEW_METADATA_MIME_TYPES;
}

export async function extractMetadataViaWebView(params: {
  filePath: string;
  format: Book["format"];
  fileName: string;
  fileSize: number;
}): Promise<ExtractedMeta | null> {
  const { filePath, format, fileName, fileSize } = params;
  const mimeType = WEBVIEW_METADATA_MIME_TYPES[format];
  if (!mimeType || !extractor) return null;

  if (fileSize > WEBVIEW_METADATA_MAX_BYTES) {
    console.warn(
      `[WebViewMetadata] Skip ${fileName}: ${fileSize} bytes exceeds ${WEBVIEW_METADATA_MAX_BYTES}`,
    );
    return null;
  }

  const LegacyFileSystem = await import("expo-file-system/legacy");
  const base64 = await LegacyFileSystem.readAsStringAsync(filePath, {
    encoding: LegacyFileSystem.EncodingType.Base64,
  });
  const meta = await extractor.extractMetadata(base64, mimeType);

  let coverBytes: Uint8Array | null = null;
  if (meta.coverBase64) {
    const { toByteArray } = await import("base64-js");
    const bytes = toByteArray(meta.coverBase64);
    if (bytes.length > 0) coverBytes = Uint8Array.from(bytes);
  }

  // foliate-js reports comic archives' title as the file name itself (with extension).
  const title = meta.title === fileName ? meta.title.replace(/\.\w+$/i, "") : meta.title;

  return {
    title: title.trim(),
    author: meta.author.trim(),
    publisher: meta.publisher,
    language: meta.language,
    description: meta.description,
    subjects: meta.subjects,
    coverBytes,
    coverMimeType: coverBytes ? meta.coverMimeType || "image/jpeg" : null,
  };
}
