/**
 * Reading Context Service
 * 
 * Tracks user's current reading state including:
 * - Current chapter and position
 * - Text selection
 * - Recent highlights
 * - Reading progress
 * 
 * Provides real-time context for AI tools.
 */
import { getHighlights } from "@/lib/db/database";
import type { ReadingContext } from "@/types/chat";

type ReadingContextListener = (context: ReadingContext | null) => void;

class ReadingContextService {
  private context: ReadingContext | null = null;
  private listeners: Set<ReadingContextListener> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(listener: ReadingContextListener): () => void {
    this.listeners.add(listener);
    listener(this.context);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((listener) => listener(this.context));
  }

  private debouncedNotify() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.notify();
      this.debounceTimer = null;
    }, 50);
  }

  getContext(): ReadingContext | null {
    return this.context;
  }

  async updateContext(partial: Partial<ReadingContext>): Promise<void> {
    if (!partial.bookId) {
      this.context = null;
      this.notify();
      return;
    }

    const now = Date.now();

    if (!this.context || this.context.bookId !== partial.bookId) {
      const highlights = await getHighlights(partial.bookId);
      const recentHighlights = highlights.slice(0, 5).map((h) => ({
        text: h.text,
        cfi: h.cfi,
        note: h.note,
      }));

      this.context = {
        bookId: partial.bookId,
        bookTitle: partial.bookTitle || "",
        currentChapter: partial.currentChapter || { index: 0, title: "", href: "" },
        currentPosition: partial.currentPosition || { cfi: "", percentage: 0 },
        surroundingText: partial.surroundingText || "",
        recentHighlights,
        operationType: partial.operationType || "reading",
        timestamp: now,
      };
    } else {
      this.context = {
        ...this.context,
        ...partial,
        timestamp: now,
      };
    }

    this.debouncedNotify();
  }

  updateSelection(selection: ReadingContext["selection"]): void {
    if (!this.context) return;

    this.context = {
      ...this.context,
      selection,
      operationType: selection ? "selecting" : "reading",
      timestamp: Date.now(),
    };

    this.debouncedNotify();
  }

  clearSelection(): void {
    if (!this.context) return;

    this.context = {
      ...this.context,
      selection: undefined,
      operationType: "reading",
      timestamp: Date.now(),
    };

    this.debouncedNotify();
  }

  updatePosition(position: Partial<ReadingContext["currentPosition"]>): void {
    if (!this.context) return;

    this.context = {
      ...this.context,
      currentPosition: {
        ...this.context.currentPosition,
        ...position,
      },
      timestamp: Date.now(),
    };

    this.debouncedNotify();
  }

  updateChapter(chapter: Partial<ReadingContext["currentChapter"]>): void {
    if (!this.context) return;

    this.context = {
      ...this.context,
      currentChapter: {
        ...this.context.currentChapter,
        ...chapter,
      },
      timestamp: Date.now(),
    };

    this.debouncedNotify();
  }

  setOperationType(type: ReadingContext["operationType"]): void {
    if (!this.context) return;

    this.context = {
      ...this.context,
      operationType: type,
      timestamp: Date.now(),
    };

    this.debouncedNotify();
  }

  clearContext(): void {
    this.context = null;
    this.notify();
  }
}

export const readingContextService = new ReadingContextService();

export function useReadingContext(): ReadingContext | null {
  return null;
}

export function getReadingContextSnapshot(): ReadingContext | null {
  return readingContextService.getContext();
}
