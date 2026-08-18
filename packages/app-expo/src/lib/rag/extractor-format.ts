import type { Book } from "@readany/core/types";

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

const SUPPORTED_FORMATS = new Set<Book["format"]>([
  "epub",
  "pdf",
  "txt",
  "umd",
  "mobi",
  "azw",
  "azw3",
]);

const FORMAT_BY_MIME_TYPE: Partial<Record<string, Book["format"]>> = {
  "application/epub+zip": "epub",
  "application/pdf": "pdf",
  "application/vnd.amazon.ebook": "azw3",
  "application/x-mobipocket-ebook": "mobi",
  "text/plain": "txt",
};

function asSupportedFormat(value: string | undefined): Book["format"] | null {
  const normalized = value?.trim().toLowerCase() as Book["format"] | undefined;
  return normalized && SUPPORTED_FORMATS.has(normalized) ? normalized : null;
}

export function resolveExtractorFormat(input: {
  bookFormat?: string;
  mimeType?: string;
  fileName?: string;
}): Book["format"] | null {
  const storedFormat = asSupportedFormat(input.bookFormat);
  if (storedFormat) return storedFormat;

  const cleanFileName = input.fileName?.split(/[?#]/, 1)[0];
  const extension = cleanFileName?.split(".").pop();
  const fileFormat = asSupportedFormat(extension);
  if (fileFormat) return fileFormat;

  const normalizedMimeType = input.mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  return normalizedMimeType ? FORMAT_BY_MIME_TYPE[normalizedMimeType] || null : null;
}

function getExtractorFileName(
  mimeType: string,
  bookFormat: Book["format"] | null,
  fileName?: string,
) {
  const cleanFileName = fileName?.split(/[?#]/, 1)[0]?.split(/[\\/]/).pop();
  if (bookFormat) {
    const baseName = cleanFileName?.replace(/\.[^.]*$/, "") || "book";
    return `${baseName}.${bookFormat}`;
  }
  if (cleanFileName) return cleanFileName;

  const normalizedMimeType = mimeType.split(";")[0]?.trim().toLowerCase() || "application/epub+zip";
  return `book.${EXTRACTOR_EXTENSIONS_BY_MIME[normalizedMimeType] || "epub"}`;
}

export function createExtractorCommand(input: {
  base64BookData: string;
  mimeType: string;
  bookFormat?: string;
  fileName?: string;
}) {
  const resolvedFormat = resolveExtractorFormat(input);
  return {
    type: resolvedFormat === "pdf" ? "extractBookChapters" : "openBook",
    base64: input.base64BookData,
    mimeType: input.mimeType,
    bookFormat: resolvedFormat,
    fileName: getExtractorFileName(input.mimeType, resolvedFormat, input.fileName),
  };
}
