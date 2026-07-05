import { afterEach, describe, expect, it, vi } from "vitest";
import type { Book } from "../../types";
import { fallbackContentService, setFallbackContentProvider } from "../fallback-content-service";

const book = {
  id: "book-1",
  filePath: "books/book-1.epub",
  format: "epub",
  meta: { title: "Book 1" },
} as Book;

afterEach(() => {
  vi.useRealTimers();
  setFallbackContentProvider(null);
  fallbackContentService.clear();
});

describe("fallbackContentService", () => {
  it("rejects stalled providers instead of leaving tool calls pending forever", async () => {
    vi.useFakeTimers();
    setFallbackContentProvider({
      getChapters: () => new Promise(() => {}),
    });

    const pending = expect(fallbackContentService.getChapters(book)).rejects.toThrow(
      "Timed out reading original book content",
    );
    await vi.advanceTimersByTimeAsync(45_000);

    await pending;
  });
});
