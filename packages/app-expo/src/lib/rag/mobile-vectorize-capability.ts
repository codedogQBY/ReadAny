const MOBILE_VECTORIZE_MIME = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  txt: "text/plain",
  umd: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  azw: "application/vnd.amazon.ebook",
  azw3: "application/vnd.amazon.ebook",
} as const;

export const MOBILE_VECTORIZE_UNSUPPORTED_FORMAT_DESCRIPTION =
  "Mobile vectorization supports EPUB, PDF, TXT, UMD, and DRM-free MOBI, AZW, and AZW3 books.";

export function getMobileVectorizeCapability(format: string | undefined) {
  const normalized = String(format || "").toLowerCase() as keyof typeof MOBILE_VECTORIZE_MIME;
  const mimeType = MOBILE_VECTORIZE_MIME[normalized];
  return mimeType
    ? { supported: true as const, mimeType }
    : { supported: false as const, mimeType: null };
}
