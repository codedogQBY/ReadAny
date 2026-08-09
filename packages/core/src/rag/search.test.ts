import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chunk } from "../types";
import { getChunks, getVectorIndexProvenance } from "../db/database";
import { clearChunkCache, clearSearchConfiguration, configureSearch, search } from "./search";

vi.mock("../db/database", () => ({
  getChunks: vi.fn(),
  getVectorIndexProvenance: vi.fn(),
}));

const chunk: Chunk = {
  id: "chunk-1",
  bookId: "book-1",
  chapterIndex: 0,
  chapterTitle: "Chapter 1",
  content: "A semantic search result about astronomy.",
  tokenCount: 7,
  startCfi: "",
  endCfi: "",
  embedding: [0.1, 0.2],
};

describe("RAG index provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChunkCache();
    clearSearchConfiguration();
    vi.mocked(getChunks).mockResolvedValue([chunk]);
  });

  it("rejects vector search when the active query model differs from the book index", async () => {
    vi.mocked(getVectorIndexProvenance).mockResolvedValue({
      bookId: "book-1",
      kind: "builtin",
      modelId: "all-MiniLM-L6-v2",
      dimensions: 384,
      createdAt: 1,
    });
    configureSearch({
      provenance: { kind: "builtin", modelId: "bge-small-zh-v1.5", dimensions: 512 },
      embed: vi.fn(),
    });

    await expect(
      search({ query: "astronomy", bookId: "book-1", mode: "vector", topK: 5, threshold: 0 }),
    ).rejects.toThrow("Vector index model mismatch");
  });

  it("marks hybrid results when vector retrieval is unavailable instead of silently returning BM25", async () => {
    vi.mocked(getVectorIndexProvenance).mockResolvedValue(null);
    configureSearch({
      provenance: { kind: "builtin", modelId: "all-MiniLM-L6-v2", dimensions: 384 },
      embed: vi.fn(),
    });

    const results = await search({
      query: "astronomy",
      bookId: "book-1",
      mode: "hybrid",
      topK: 5,
      threshold: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      matchType: "bm25",
      vectorStatus: "unavailable",
      vectorError: expect.stringContaining("no embedding provenance"),
    });
  });

  it("accepts remote endpoints that differ only by a trailing slash", async () => {
    vi.mocked(getVectorIndexProvenance).mockResolvedValue({
      bookId: "book-1",
      kind: "remote",
      modelId: "text-embedding-v3",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      dimensions: 2,
      createdAt: 1,
    });
    configureSearch({
      provenance: {
        kind: "remote",
        modelId: "text-embedding-v3",
        endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/",
        dimensions: 2,
      },
      embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    });

    await expect(
      search({ query: "astronomy", bookId: "book-1", mode: "vector", topK: 5, threshold: 0 }),
    ).resolves.toHaveLength(1);
  });
});
