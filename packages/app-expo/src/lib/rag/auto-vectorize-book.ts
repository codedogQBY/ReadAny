import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
import * as FileSystem from "expo-file-system/legacy";
import { queueBook as queueAutoVectorize } from "./auto-vectorize-service";

export const MOBILE_AUTO_VECTORIZE_MAX_BYTES = 32 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  txt: "text/plain",
  // Mobile UMD imports are converted and stored as EPUB before vectorization.
  umd: "application/epub+zip",
};

export function getMobileVectorizeMimeType(format: string | undefined): string | null {
  const normalized = String(format || "").toLowerCase();
  return MIME_TYPES[normalized] ?? null;
}

export async function resolveMobileBookPath(filePath: string): Promise<string> {
  if (
    filePath.startsWith("/") ||
    filePath.startsWith("file://") ||
    filePath.startsWith("asset://") ||
    filePath.startsWith("http")
  ) {
    return filePath;
  }

  const platform = getPlatformService();
  const appData = await platform.getAppDataDir();
  return platform.joinPath(appData, filePath);
}

export async function getMobileBookFileSize(filePath: string): Promise<number | null> {
  const info = await FileSystem.getInfoAsync(filePath);
  if (!info.exists || info.isDirectory) return null;
  return typeof info.size === "number" ? info.size : null;
}

export async function inspectMobileBookForVectorize(
  book: Book,
  options?: { maxBytes?: number },
): Promise<{
  absPath: string;
  mimeType: string | null;
  size: number | null;
  canVectorize: boolean;
  reason?: "unsupported-format" | "missing-file" | "file-too-large";
}> {
  const absPath = await resolveMobileBookPath(book.filePath);
  const mimeType = getMobileVectorizeMimeType(book.format);
  if (!mimeType) {
    return { absPath, mimeType, size: null, canVectorize: false, reason: "unsupported-format" };
  }

  const size = await getMobileBookFileSize(absPath);
  if (size == null) {
    return { absPath, mimeType, size, canVectorize: false, reason: "missing-file" };
  }
  if (options?.maxBytes != null && size > options.maxBytes) {
    return { absPath, mimeType, size, canVectorize: false, reason: "file-too-large" };
  }

  return { absPath, mimeType, size, canVectorize: true };
}

export async function queueBookForAutoVectorize(book: Book): Promise<boolean> {
  const info = await inspectMobileBookForVectorize(book, {
    maxBytes: MOBILE_AUTO_VECTORIZE_MAX_BYTES,
  });
  if (!info.canVectorize || !info.mimeType) {
    console.warn(
      `[AutoVectorize] Skip mobile book: ${book.meta.title} (${info.reason}, size=${info.size ?? "unknown"}, format=${book.format})`,
    );
    return false;
  }

  queueAutoVectorize(
    book,
    () =>
      FileSystem.readAsStringAsync(info.absPath, {
        encoding: FileSystem.EncodingType.Base64,
      }),
    info.mimeType,
  );
  return true;
}
