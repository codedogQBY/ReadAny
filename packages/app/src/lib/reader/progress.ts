/**
 * Progress tracking and auto-save
 */
import type { Book } from "@/types";

export interface ProgressData {
  bookId: string;
  cfi: string;
  progress: number; // 0-1
  chapterIndex: number;
  timestamp: number;
}

/** Debounced progress save — prevents excessive writes */
export function createProgressTracker(
  saveInterval = 30000,
  onSave: (data: ProgressData) => Promise<void>,
) {
  let pendingData: ProgressData | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  function update(data: ProgressData) {
    pendingData = data;
  }

  function start() {
    timer = setInterval(async () => {
      if (pendingData) {
        await onSave(pendingData);
        pendingData = null;
      }
    }, saveInterval);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    // Flush any pending data
    if (pendingData) {
      onSave(pendingData);
      pendingData = null;
    }
  }

  return { update, start, stop };
}

/** Calculate estimated time to finish */
export function estimateTimeToFinish(book: Book, averagePagesPerMinute: number): number | null {
  if (!book.meta.totalPages || averagePagesPerMinute <= 0) return null;
  const remainingPages = book.meta.totalPages * (1 - book.progress);
  return Math.ceil(remainingPages / averagePagesPerMinute); // minutes
}
