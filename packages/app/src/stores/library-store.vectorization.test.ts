import type { Book } from "@readany/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateBook: vi.fn(),
  debouncedSave: vi.fn(),
}));

vi.mock("@/lib/db/database", () => ({ updateBook: mocks.updateBook }));
vi.mock("@/lib/rag/vectorize-trigger", () => ({ triggerVectorizeBook: vi.fn() }));
vi.mock("@/lib/storage/desktop-library-root", () => ({
  getDesktopLibraryRoot: vi.fn(),
  isDesktopManagedRelativePath: vi.fn(),
  resolveDesktopDataPath: vi.fn(),
}));
vi.mock("@readany/core/stores/persist", () => ({
  debouncedSave: mocks.debouncedSave,
  loadFromFS: vi.fn(),
}));
vi.mock("@readany/core/stores/vector-model-store", () => ({
  useVectorModelStore: { getState: vi.fn() },
}));

import { useLibraryStore } from "./library-store";

const book: Book = {
  id: "book-1",
  filePath: "books/book.epub",
  format: "epub",
  meta: { title: "Book", author: "Author" },
  addedAt: 1,
  updatedAt: 1,
  progress: 0,
  isVectorized: false,
  vectorizeProgress: 0,
  tags: [],
  syncStatus: "local",
};

describe("desktop library strict vectorization updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLibraryStore.getState().setBooks([{ ...book }]);
  });

  afterEach(() => useLibraryStore.getState().setBooks([]));

  it("does not expose or cache completion when the database rejects", async () => {
    mocks.updateBook.mockRejectedValue(new Error("database write failed"));

    await expect(
      useLibraryStore.getState().updateBookStrict("book-1", {
        isVectorized: true,
        vectorizeProgress: 1,
      }),
    ).rejects.toThrow("database write failed");

    expect(useLibraryStore.getState().books[0]?.isVectorized).toBe(false);
    expect(mocks.debouncedSave).not.toHaveBeenCalled();
  });
});
