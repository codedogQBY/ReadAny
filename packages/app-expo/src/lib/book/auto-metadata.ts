import {
  createRangeReadableFile,
  extractBookMetadataFromFile,
} from "@/lib/book/metadata-extractor";
import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
import type { ExtractedBookMetadata } from "@readany/core/utils";
import type { ExtractedMeta } from "./metadata-extractor";

export type MobileExtractedBookMetadata = ExtractedBookMetadata &
  Pick<ExtractedMeta, "coverBytes" | "coverMimeType">;

export async function extractLocalBookMetadata(
  book: Book,
): Promise<MobileExtractedBookMetadata | null> {
  if (book.syncStatus === "remote" || !isRepairableFormat(book.format) || !book.filePath) {
    return null;
  }

  try {
    const platform = getPlatformService();
    const appData = await platform.getAppDataDir();
    const filePath = isRelativeAppPath(book.filePath)
      ? await platform.joinPath(appData, book.filePath)
      : book.filePath;
    const fileSize = await getMobileFileSize(filePath);
    if (fileSize == null) return null;

    const fileName = book.filePath.split(/[\\/]/).pop() || `${book.id}.${book.format}`;
    const rangeReadable = await createRangeReadableFile(filePath, fileSize);
    return extractBookMetadataFromFile(rangeReadable, book.format, fileName);
  } catch (error) {
    console.warn("[BookMetadata] Failed to extract local metadata:", error);
    return null;
  }
}

function isRepairableFormat(format: Book["format"]): boolean {
  return format === "epub" || format === "mobi" || format === "azw" || format === "azw3";
}

function isRelativeAppPath(path: string): boolean {
  return (
    !path.startsWith("/") &&
    !path.startsWith("file://") &&
    !path.startsWith("asset://") &&
    !path.startsWith("http")
  );
}

async function getMobileFileSize(path: string): Promise<number | null> {
  const LegacyFileSystem = await import("expo-file-system/legacy");
  const info = await LegacyFileSystem.getInfoAsync(path);
  return info.exists && !info.isDirectory ? (info.size ?? 0) : null;
}
