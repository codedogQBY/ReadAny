import { describe, expect, it } from "vitest";
import { canStoreInSharedVectorDB } from "./vectorize-trigger";

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
