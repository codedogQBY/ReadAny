import { describe, expect, it, vi } from "vitest";
import { createMobileFallbackContentProvider } from "./mobile-fallback-content-provider";

const book = {
  id: "book-1",
  filePath: "books/book-1.epub",
  format: "epub",
  meta: { title: "Book 1" },
} as const;

function makeDependencies(overrides: Record<string, unknown> = {}) {
  const extractChapters = vi.fn(async () => [
    { index: 0, title: "Chapter 1", content: "Text", segments: [] },
  ]);
  return {
    dependencies: {
      getExtractor: () => ({ extractChapters }),
      platform: {
        getAppDataDir: vi.fn(async () => "/app-data"),
        joinPath: vi.fn(async (...parts: string[]) => parts.join("/")),
        exists: vi.fn(async () => true),
        readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
      },
      ...overrides,
    },
    extractChapters,
  };
}

describe("mobile fallback content provider", () => {
  it("resolves a relative local book and extracts it with the matching MIME type", async () => {
    const { dependencies, extractChapters } = makeDependencies();
    const provider = createMobileFallbackContentProvider(dependencies);

    await expect(provider.getChapters(book as never)).resolves.toEqual([
      { index: 0, title: "Chapter 1", content: "Text", segments: [] },
    ]);
    expect(dependencies.platform.joinPath).toHaveBeenCalledWith("/app-data", "books/book-1.epub");
    expect(dependencies.platform.exists).toHaveBeenCalledWith("/app-data/books/book-1.epub");
    expect(extractChapters).toHaveBeenCalledWith("AQID", "application/epub+zip");
  });

  it("rejects remote files before trying to read them", async () => {
    const { dependencies } = makeDependencies();
    const provider = createMobileFallbackContentProvider(dependencies);

    await expect(
      provider.getChapters({ ...book, filePath: "https://example.com/book.epub" } as never),
    ).rejects.toThrow("requires a local book file");
    expect(dependencies.platform.readFile).not.toHaveBeenCalled();
  });

  it("reports a missing local file without invoking the extractor", async () => {
    const { dependencies, extractChapters } = makeDependencies({
      platform: {
        getAppDataDir: vi.fn(async () => "/app-data"),
        joinPath: vi.fn(async (...parts: string[]) => parts.join("/")),
        exists: vi.fn(async () => false),
        readFile: vi.fn(async () => new Uint8Array()),
      },
    });
    const provider = createMobileFallbackContentProvider(dependencies);

    await expect(provider.getChapters(book as never)).rejects.toThrow(
      "Book file is not available on this device",
    );
    expect(extractChapters).not.toHaveBeenCalled();
  });
});
