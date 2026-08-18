import type { Book } from "@readany/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateBook: vi.fn(),
  debouncedSave: vi.fn(),
}));

vi.mock("@/lib/book/metadata-extractor", () => ({
  createRangeReadableFile: vi.fn(),
  extractBookMetadata: vi.fn(),
  extractBookMetadataFromFile: vi.fn(),
}));

vi.mock("@/lib/rag/auto-vectorize-service", () => ({ queueBook: vi.fn() }));
vi.mock("@/lib/rag/mobile-vectorize-capability", () => ({
  getMobileVectorizeCapability: vi.fn(),
}));
vi.mock("./vector-model-store", () => ({
  useVectorModelStore: { getState: vi.fn() },
}));

vi.mock("@readany/core/db/database", () => ({
  updateBook: mocks.updateBook,
}));

vi.mock("@readany/core/db/write-retry", () => ({
  runWithDbRetry: <T>(operation: () => Promise<T>) => operation(),
}));

vi.mock("./persist", () => ({
  debouncedSave: mocks.debouncedSave,
  loadFromFS: vi.fn(),
}));

import { useLibraryStore } from "./library-store";

const book: Book = {
  id: "book-1",
  filePath: "books/book.mobi",
  format: "mobi",
  meta: { title: "Book", author: "Author" },
  addedAt: 1,
  updatedAt: 1,
  progress: 0,
  isVectorized: false,
  vectorizeProgress: 0,
  tags: [],
  syncStatus: "local",
};

describe("library store strict vectorization updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLibraryStore.getState().setBooks([{ ...book }]);
  });

  afterEach(() => {
    useLibraryStore.getState().setBooks([]);
  });

  it("keeps completion invisible until the database write resolves", async () => {
    let resolveWrite: (() => void) | undefined;
    mocks.updateBook.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const visibleVectorizedStates: boolean[] = [];
    const unsubscribe = useLibraryStore.subscribe((state) => {
      if (state.books[0]?.isVectorized) visibleVectorizedStates.push(true);
    });

    const update = useLibraryStore.getState().updateBookStrict("book-1", {
      isVectorized: true,
      vectorizeProgress: 1,
    });

    expect(useLibraryStore.getState().books[0]?.isVectorized).toBe(false);
    expect(mocks.debouncedSave).not.toHaveBeenCalled();
    expect(visibleVectorizedStates).toEqual([]);

    resolveWrite?.();
    await update;

    expect(useLibraryStore.getState().books[0]?.isVectorized).toBe(true);
    expect(visibleVectorizedStates).toEqual([true]);
    expect(mocks.debouncedSave).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("does not expose or cache completion when the database write rejects", async () => {
    mocks.updateBook.mockRejectedValue(new Error("database write failed"));
    const visibleVectorizedStates: boolean[] = [];
    const unsubscribe = useLibraryStore.subscribe((state) => {
      if (state.books[0]?.isVectorized) visibleVectorizedStates.push(true);
    });

    await expect(
      useLibraryStore.getState().updateBookStrict("book-1", {
        isVectorized: true,
        vectorizeProgress: 1,
      }),
    ).rejects.toThrow("database write failed");

    expect(useLibraryStore.getState().books[0]?.isVectorized).toBe(false);
    expect(useLibraryStore.getState().books[0]?.vectorizeProgress).toBe(0);
    expect(visibleVectorizedStates).toEqual([]);
    expect(mocks.debouncedSave).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("clears visible and cached indexed state when the durable cleanup write rejects", async () => {
    useLibraryStore.getState().setBooks([{ ...book, isVectorized: true, vectorizeProgress: 1 }]);
    mocks.updateBook.mockRejectedValue(new Error("database write failed"));

    await expect(useLibraryStore.getState().resetBookVectorizationState("book-1")).rejects.toThrow(
      "database write failed",
    );

    expect(useLibraryStore.getState().books[0]).toMatchObject({
      isVectorized: false,
      vectorizeProgress: 0,
    });
    expect(mocks.debouncedSave).toHaveBeenCalledWith(
      "library-books",
      expect.arrayContaining([
        expect.objectContaining({ id: "book-1", isVectorized: false, vectorizeProgress: 0 }),
      ]),
    );
  });
});
