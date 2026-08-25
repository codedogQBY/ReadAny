import { resolveDesktopDataPath } from "@/lib/storage/desktop-library-root";
import type { Book } from "@readany/core/types";
import type { ExtractedBookMetadata } from "@readany/core/utils";
import { type FoliateDocumentMetadata, fromDocumentMetadata } from "./imported-book-meta";

export type DesktopExtractedBookMetadata = ExtractedBookMetadata & { coverBlob?: Blob | null };

export async function extractLocalBookMetadata(
  book: Book,
): Promise<DesktopExtractedBookMetadata | null> {
  if (book.syncStatus === "remote" || !isRepairableFormat(book.format) || !book.filePath) {
    return null;
  }

  try {
    const filePath = await resolveDesktopDataPath(book.filePath);
    const { exists, readFile } = await import("@tauri-apps/plugin-fs");
    if (!(await exists(filePath))) return null;
    const bytes = await readFile(filePath);
    const fileName = book.filePath.split(/[\\/]/).pop() || `${book.id}.${book.format}`;
    const file = new File([bytes], fileName, { type: "application/octet-stream" });
    const { DocumentLoader } = await import("@/lib/reader/document-loader");
    const { book: document } = await new DocumentLoader(file).open();
    const metadata = fromDocumentMetadata(document.metadata as unknown as FoliateDocumentMetadata);
    if (book.meta.coverUrl?.trim()) return metadata;

    try {
      const coverBlob = await document.getCover?.();
      if (!coverBlob) return metadata;
      return { ...metadata, coverBlob };
    } catch (error) {
      console.warn("[BookMetadata] Failed to extract local cover:", error);
      return metadata;
    }
  } catch (error) {
    console.warn("[BookMetadata] Failed to extract local metadata:", error);
    return null;
  }
}

function isRepairableFormat(format: Book["format"]): boolean {
  return format === "epub" || format === "mobi" || format === "azw" || format === "azw3";
}
