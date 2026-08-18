import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  deleteChunks: vi.fn(),
  deleteVectorIndexProvenance: vi.fn(),
  insertChunks: vi.fn(),
  setVectorIndexProvenance: vi.fn(),
}));

const vectorDatabaseMocks = vi.hoisted(() => ({
  deleteByBookId: vi.fn(),
  getStats: vi.fn(),
  insert: vi.fn(),
  isReady: vi.fn(),
}));

const remoteEmbeddingMocks = vi.hoisted(() => ({
  requestRemoteEmbeddingBatch: vi.fn(),
}));

const chunkerMocks = vi.hoisted(() => ({
  chunkContent: vi.fn(),
}));

const eventBusMocks = vi.hoisted(() => ({
  emit: vi.fn(),
}));

vi.mock("../db/database", () => databaseMocks);
vi.mock("./chunker", () => chunkerMocks);
vi.mock("./remote-embedding", () => remoteEmbeddingMocks);
vi.mock("./vector-db", () => ({
  getVectorDB: () => vectorDatabaseMocks,
  hasVectorDB: () => true,
}));
vi.mock("../utils/event-bus", () => ({ eventBus: eventBusMocks }));

import {
  VectorizationCleanupError,
  canStoreInSharedVectorDB,
  resetBookVectorization,
  triggerVectorizeBook,
} from "./vectorize-trigger";

beforeEach(() => {
  vi.clearAllMocks();
  databaseMocks.deleteChunks.mockResolvedValue(undefined);
  databaseMocks.deleteVectorIndexProvenance.mockResolvedValue(undefined);
  databaseMocks.insertChunks.mockResolvedValue(undefined);
  databaseMocks.setVectorIndexProvenance.mockResolvedValue(undefined);
  chunkerMocks.chunkContent.mockReturnValue([
    {
      id: "book-1-0-0",
      bookId: "book-1",
      chapterIndex: 0,
      chapterTitle: "Chapter",
      content: "content",
      tokenCount: 1,
      startCfi: "",
      endCfi: "",
    },
  ]);
  vectorDatabaseMocks.deleteByBookId.mockResolvedValue(undefined);
  vectorDatabaseMocks.getStats.mockResolvedValue({ totalVectors: 0, dimension: 2 });
  vectorDatabaseMocks.insert.mockResolvedValue(undefined);
  vectorDatabaseMocks.isReady.mockResolvedValue(true);
  remoteEmbeddingMocks.requestRemoteEmbeddingBatch.mockImplementation(
    async (_model, texts: string[]) => ({
      ok: true,
      embeddings: texts.map(() => [0.1, 0.2]),
    }),
  );
});

describe("shared sqlite-vec dimension guard", () => {
  it("preserves a 384d book's acceleration index when a 1024d book is indexed", () => {
    expect(canStoreInSharedVectorDB({ totalVectors: 120, dimension: 384 }, 1024)).toBe(false);
  });

  it("allows both books to remain searchable through their persisted chunk embeddings", () => {
    expect(canStoreInSharedVectorDB({ totalVectors: 120, dimension: 384 }, 384)).toBe(true);
    expect(canStoreInSharedVectorDB({ totalVectors: 120, dimension: 1024 }, 384)).toBe(false);
    expect(canStoreInSharedVectorDB({ totalVectors: 120, dimension: 1024 }, 1024)).toBe(true);
  });
});

describe("failed vectorization cleanup", () => {
  it("clears partial indexes and leaves the book unvectorized before rejecting", async () => {
    const updates: Array<{ isVectorized: boolean; vectorizeProgress: number }> = [];
    databaseMocks.setVectorIndexProvenance.mockRejectedValueOnce(
      new Error("failed to save provenance"),
    );

    await expect(
      triggerVectorizeBook(
        "book-1",
        [
          {
            index: 0,
            title: "Chapter",
            content: "word ".repeat(400),
          },
        ],
        {
          vectorModelEnabled: true,
          vectorModelMode: "remote",
          selectedBuiltinModelId: null,
          remoteModel: {
            url: "https://example.com/v1/embeddings",
            apiKey: "test",
            modelId: "test-model",
          },
        },
        {
          onBookUpdate: (_bookId, update) => updates.push(update),
        },
      ),
    ).rejects.toThrow("failed to save provenance");

    expect(databaseMocks.deleteChunks).toHaveBeenCalledTimes(2);
    expect(databaseMocks.deleteVectorIndexProvenance).toHaveBeenCalledTimes(2);
    expect(vectorDatabaseMocks.deleteByBookId).toHaveBeenCalledTimes(2);
    expect(updates.at(-1)).toEqual({ isVectorized: false, vectorizeProgress: 0 });
    expect(updates).not.toContainEqual({ isVectorized: true, vectorizeProgress: 1 });
  });

  it("attempts every cleanup and resets the book flag when one store rejects", async () => {
    const updates: Array<{ isVectorized: boolean; vectorizeProgress: number }> = [];
    databaseMocks.deleteChunks.mockRejectedValueOnce(new Error("chunk cleanup failed"));

    await expect(
      resetBookVectorization("book-1", {
        onBookUpdate: (_bookId, update) => updates.push(update),
      }),
    ).rejects.toThrow("chunk cleanup failed");

    expect(databaseMocks.deleteVectorIndexProvenance).toHaveBeenCalledWith("book-1");
    expect(vectorDatabaseMocks.deleteByBookId).toHaveBeenCalledWith("book-1");
    expect(updates).toEqual([{ isVectorized: false, vectorizeProgress: 0 }]);
  });

  it("waits for the unvectorized state write before cleanup resolves", async () => {
    let releaseUpdate: (() => void) | undefined;
    const updateReleased = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });

    const cleanup = resetBookVectorization("book-1", {
      onBookUpdate: async () => {
        await updateReleased;
      },
    });

    const stateBeforeRelease = await Promise.race([
      cleanup.then(() => "resolved" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 10)),
    ]);
    expect(stateBeforeRelease).toBe("pending");

    releaseUpdate?.();
    await cleanup;
  });

  it("does not publish completion when the final vectorized-state write rejects", async () => {
    const progressStatuses: string[] = [];

    await expect(
      triggerVectorizeBook(
        "book-1",
        [{ index: 0, title: "Chapter", content: "content" }],
        {
          vectorModelEnabled: true,
          vectorModelMode: "remote",
          selectedBuiltinModelId: null,
          remoteModel: {
            url: "https://example.com/v1/embeddings",
            apiKey: "test",
            modelId: "test-model",
          },
        },
        {
          onBookUpdate: async (_bookId, update) => {
            if (update.isVectorized) throw new Error("final state write failed");
          },
        },
        (progress) => progressStatuses.push(progress.status),
      ),
    ).rejects.toThrow("final state write failed");

    expect(progressStatuses).not.toContain("completed");
    expect(progressStatuses.at(-1)).toBe("error");
    expect(eventBusMocks.emit).not.toHaveBeenCalledWith("vectorize:completed", expect.anything());
    expect(eventBusMocks.emit).toHaveBeenCalledWith("vectorize:error", {
      bookId: "book-1",
      error: "final state write failed",
    });
    expect(databaseMocks.deleteChunks).toHaveBeenCalledTimes(2);
  });

  it("waits for the final vectorized-state write before publishing completion", async () => {
    let releaseFinalWrite: (() => void) | undefined;
    const finalWriteReleased = new Promise<void>((resolve) => {
      releaseFinalWrite = resolve;
    });
    const progressStatuses: string[] = [];

    const vectorization = triggerVectorizeBook(
      "book-1",
      [{ index: 0, title: "Chapter", content: "content" }],
      {
        vectorModelEnabled: true,
        vectorModelMode: "remote",
        selectedBuiltinModelId: null,
        remoteModel: {
          url: "https://example.com/v1/embeddings",
          apiKey: "test",
          modelId: "test-model",
        },
      },
      {
        onBookUpdate: async (_bookId, update) => {
          if (update.isVectorized) await finalWriteReleased;
        },
      },
      (progress) => progressStatuses.push(progress.status),
    );

    await vi.waitFor(() => {
      expect(databaseMocks.setVectorIndexProvenance).toHaveBeenCalledOnce();
    });
    expect(progressStatuses).not.toContain("completed");
    expect(eventBusMocks.emit).not.toHaveBeenCalledWith("vectorize:completed", expect.anything());

    releaseFinalWrite?.();
    await vectorization;

    expect(progressStatuses.at(-1)).toBe("completed");
    expect(eventBusMocks.emit).toHaveBeenCalledWith("vectorize:completed", {
      bookId: "book-1",
      chunksCount: 1,
    });
  });

  it("cancels after a partial chunk write and removes every searchable residue", async () => {
    const controller = new AbortController();
    const chapters = Array.from({ length: 51 }, (_, index) => ({
      index,
      title: `Chapter ${index}`,
      content: "content",
    }));
    databaseMocks.insertChunks.mockImplementationOnce(async () => {
      controller.abort();
    });

    await expect(
      triggerVectorizeBook(
        "book-1",
        chapters,
        {
          vectorModelEnabled: true,
          vectorModelMode: "remote",
          selectedBuiltinModelId: null,
          remoteModel: {
            url: "https://example.com/v1/embeddings",
            apiKey: "test",
            modelId: "test-model",
          },
        },
        { onBookUpdate: vi.fn() },
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(databaseMocks.insertChunks).toHaveBeenCalledOnce();
    expect(databaseMocks.deleteChunks).toHaveBeenCalledTimes(2);
    expect(databaseMocks.deleteVectorIndexProvenance).toHaveBeenCalledTimes(2);
    expect(vectorDatabaseMocks.deleteByBookId).toHaveBeenCalledOnce();
    expect(databaseMocks.setVectorIndexProvenance).not.toHaveBeenCalled();
    expect(eventBusMocks.emit).not.toHaveBeenCalledWith("vectorize:completed", expect.anything());
  });

  it("stops between embedding batches when cancelled", async () => {
    const controller = new AbortController();
    remoteEmbeddingMocks.requestRemoteEmbeddingBatch.mockImplementationOnce(async () => {
      controller.abort();
      return { ok: true, embeddings: Array.from({ length: 8 }, () => [0.1, 0.2]) };
    });

    await expect(
      triggerVectorizeBook(
        "book-1",
        Array.from({ length: 9 }, (_, index) => ({
          index,
          title: `Chapter ${index}`,
          content: "content",
        })),
        {
          vectorModelEnabled: true,
          vectorModelMode: "remote",
          selectedBuiltinModelId: null,
          remoteModel: {
            url: "https://example.com/v1/embeddings",
            apiKey: "test",
            modelId: "test-model",
          },
        },
        { onBookUpdate: vi.fn() },
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(remoteEmbeddingMocks.requestRemoteEmbeddingBatch).toHaveBeenCalledOnce();
    expect(databaseMocks.insertChunks).not.toHaveBeenCalled();
    expect(databaseMocks.setVectorIndexProvenance).not.toHaveBeenCalled();
    expect(eventBusMocks.emit).not.toHaveBeenCalledWith("vectorize:completed", expect.anything());
  });

  it("publishes error instead of cancelled when partial-index cleanup rejects", async () => {
    const controller = new AbortController();
    const progressStatuses: string[] = [];
    const onBookReset = vi.fn();
    databaseMocks.deleteChunks
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("failed to delete partial chunks"));
    databaseMocks.insertChunks.mockImplementationOnce(async () => {
      controller.abort();
    });

    const vectorization = triggerVectorizeBook(
      "book-1",
      [{ index: 0, title: "Chapter", content: "content" }],
      {
        vectorModelEnabled: true,
        vectorModelMode: "remote",
        selectedBuiltinModelId: null,
        remoteModel: {
          url: "https://example.com/v1/embeddings",
          apiKey: "test",
          modelId: "test-model",
        },
      },
      { onBookUpdate: vi.fn(), onBookReset },
      (progress) => progressStatuses.push(progress.status),
      controller.signal,
    );

    await expect(vectorization).rejects.toBeInstanceOf(VectorizationCleanupError);
    expect(progressStatuses.at(-1)).toBe("error");
    expect(onBookReset).toHaveBeenCalledWith("book-1", {
      isVectorized: false,
      vectorizeProgress: 0,
    });
    expect(eventBusMocks.emit).not.toHaveBeenCalledWith("vectorize:cancelled", expect.anything());
    expect(eventBusMocks.emit).not.toHaveBeenCalledWith("vectorize:completed", expect.anything());
    expect(eventBusMocks.emit).toHaveBeenCalledWith("vectorize:error", {
      bookId: "book-1",
      error: expect.stringContaining("failed to delete partial chunks"),
    });
  });
});
