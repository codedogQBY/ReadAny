import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  coreTriggerVectorizeBook: vi.fn(),
  updateBook: vi.fn(),
  updateBookStrict: vi.fn(),
}));

vi.mock("@readany/core/rag", () => ({
  resetBookVectorization: vi.fn(),
  triggerVectorizeBook: mocks.coreTriggerVectorizeBook,
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

describe("triggerVectorizeBook persistence boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateBook.mockResolvedValue(undefined);
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

  it("propagates a failed durable vectorized-state write", async () => {
    await expect(
      triggerVectorizeBook("book-1", "book.mobi", [
        { index: 0, title: "Chapter", content: "text", segments: [] },
      ]),
    ).rejects.toThrow("database write failed");

    expect(mocks.updateBookStrict).toHaveBeenCalledWith("book-1", {
      isVectorized: true,
      vectorizeProgress: 1,
    });
    expect(mocks.updateBook).not.toHaveBeenCalled();
  });
});
