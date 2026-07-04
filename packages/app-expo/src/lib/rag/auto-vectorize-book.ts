import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
import * as FileSystem from "expo-file-system/legacy";
import { queueBook as queueAutoVectorize } from "./auto-vectorize-service";

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

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
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

export async function inspectMobileBookForVectorize(book: Book): Promise<{
  absPath: string;
  mimeType: string | null;
  size: number | null;
  canVectorize: boolean;
  reason?: "unsupported-format" | "missing-file";
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

  return { absPath, mimeType, size, canVectorize: true };
}

export async function queueBookForAutoVectorize(book: Book): Promise<boolean> {
  const platform = getPlatformService();
  const info = await inspectMobileBookForVectorize(book);
  if (!info.canVectorize || !info.mimeType) {
    console.warn(
      `[AutoVectorize] Skip mobile book: ${book.meta.title} (${info.reason}, size=${info.size ?? "unknown"}, format=${book.format})`,
    );
    return false;
  }

  const bytes = await platform.readFile(info.absPath);
  queueAutoVectorize(book, bytesToBase64(bytes), info.mimeType);
  return true;
}
