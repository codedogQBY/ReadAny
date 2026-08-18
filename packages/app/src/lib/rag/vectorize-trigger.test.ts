import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  coreTriggerVectorizeBook: vi.fn(),
  updateBook: vi.fn(),
  updateBookStrict: vi.fn(),
}));

vi.mock("@readany/core/rag", () => ({
  triggerVectorizeBook: mocks.coreTriggerVectorizeBook,
}));
vi.mock("@/lib/storage/desktop-library-root", () => ({
  resolveDesktopDataPath: vi.fn(async (path: string) => path),
}));
vi.mock("@/lib/reader/document-loader", () => ({}));
vi.mock("./book-extractor", () => ({
  extractBookChapters: vi.fn(async () => [
    { index: 0, title: "Chapter", content: "text", segments: [] },
  ]),
}));
vi.mock("@/stores/library-store", () => ({
  useLibraryStore: {
    getState: () => ({
      updateBook: mocks.updateBook,
      updateBookStrict: mocks.updateBookStrict,
    }),
  },
}));
vi.mock("@/stores/vector-model-store", () => ({
  useVectorModelStore: {
    getState: () => ({
      vectorModelEnabled: true,
      vectorModelMode: "builtin",
      selectedBuiltinModelId: "test-model",
      getSelectedVectorModel: () => null,
    }),
  },
}));

import { triggerVectorizeBook } from "./vectorize-trigger";

describe("desktop vectorization persistence adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateBookStrict.mockRejectedValue(new Error("database write failed"));
    mocks.coreTriggerVectorizeBook.mockImplementation(
      async (_bookId, _chapters, _config, callbacks) => {
        await callbacks.onBookUpdate("book-1", {
          isVectorized: true,
          vectorizeProgress: 1,
        });
      },
    );
  });

  it("propagates a rejected strict state write from the core boundary", async () => {
    await expect(triggerVectorizeBook("book-1", "book.epub")).rejects.toThrow(
      "database write failed",
    );

    expect(mocks.updateBookStrict).toHaveBeenCalledWith("book-1", {
      isVectorized: true,
      vectorizeProgress: 1,
    });
    expect(mocks.updateBook).not.toHaveBeenCalled();
  });
});
