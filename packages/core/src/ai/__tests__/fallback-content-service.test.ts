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

  it("shares one provider request between concurrent reads of the same book", async () => {
    let resolveProvider:
      | ((chapters: Array<{ index: number; title: string; content: string }>) => void)
      | undefined;
    const providerRequest = new Promise<Array<{ index: number; title: string; content: string }>>(
      (resolve) => {
        resolveProvider = resolve;
      },
    );
    const getChapters = vi.fn(() => providerRequest);
    setFallbackContentProvider({ getChapters });

    const first = fallbackContentService.getChapters(book);
    const second = fallbackContentService.getChapters(book);
    const chapters = [{ index: 0, title: "Chapter 1", content: "Text" }];
    resolveProvider?.(chapters);

    await expect(first).resolves.toBe(chapters);
    await expect(second).resolves.toBe(chapters);
    expect(getChapters).toHaveBeenCalledTimes(1);
  });

  it("clears a failed in-flight request so a later read can retry", async () => {
    const chapters = [{ index: 0, title: "Chapter 1", content: "Text" }];
    const getChapters = vi
      .fn()
      .mockRejectedValueOnce(new Error("Extractor failed"))
      .mockResolvedValueOnce(chapters);
    setFallbackContentProvider({ getChapters });

    await expect(fallbackContentService.getChapters(book)).rejects.toThrow("Extractor failed");
    await expect(fallbackContentService.getChapters(book)).resolves.toBe(chapters);
    expect(getChapters).toHaveBeenCalledTimes(2);
  });

  it("does not let an old provider completion replace the new provider cache", async () => {
    let resolveOldProvider:
      | ((chapters: Array<{ index: number; title: string; content: string }>) => void)
      | undefined;
    setFallbackContentProvider({
      getChapters: () =>
        new Promise((resolve) => {
          resolveOldProvider = resolve;
        }),
    });
    const oldRequest = fallbackContentService.getChapters(book);

    const newChapters = [{ index: 0, title: "New chapter", content: "New text" }];
    const newProvider = vi.fn(async () => newChapters);
    setFallbackContentProvider({ getChapters: newProvider });
    await expect(fallbackContentService.getChapters(book)).resolves.toBe(newChapters);

    const oldChapters = [{ index: 0, title: "Old chapter", content: "Old text" }];
    resolveOldProvider?.(oldChapters);
    await expect(oldRequest).resolves.toBe(oldChapters);
    await expect(fallbackContentService.getChapters(book)).resolves.toBe(newChapters);
    expect(newProvider).toHaveBeenCalledTimes(1);
  });
});
