import { describe, expect, it } from "vitest";
import {
  applyCheckpoint,
  checkpointEntries,
  chunkCheckpointKey,
  embeddingModelKey,
  hasEmbedding,
} from "./checkpoint";

describe("chunkCheckpointKey", () => {
  it("is stable for the same chapter and text", () => {
    expect(chunkCheckpointKey(3, "Привет, мир")).toBe(chunkCheckpointKey(3, "Привет, мир"));
  });

  it("differs when the chapter or the text changes", () => {
    const base = chunkCheckpointKey(3, "Привет, мир");
    expect(chunkCheckpointKey(4, "Привет, мир")).not.toBe(base);
    expect(chunkCheckpointKey(3, "Привет, мир!")).not.toBe(base);
    expect(chunkCheckpointKey(3, "привет, мир")).not.toBe(base);
  });

  it("separates texts that only differ by a character in the middle", () => {
    const a = `${"x".repeat(500)}a${"y".repeat(500)}`;
    const b = `${"x".repeat(500)}b${"y".repeat(500)}`;
    expect(chunkCheckpointKey(0, a)).not.toBe(chunkCheckpointKey(0, b));
  });
});

describe("embeddingModelKey", () => {
  it("identifies built-in models by id", () => {
    expect(
      embeddingModelKey({
        vectorModelMode: "builtin",
        selectedBuiltinModelId: "multilingual-e5-small",
        remoteModel: null,
      }),
    ).toBe("builtin:multilingual-e5-small");
  });

  it("identifies remote models by endpoint and model id", () => {
    const a = embeddingModelKey({
      vectorModelMode: "remote",
      selectedBuiltinModelId: null,
      remoteModel: { url: "https://api.example.com/v1", modelId: "embed-1" },
    });
    const b = embeddingModelKey({
      vectorModelMode: "remote",
      selectedBuiltinModelId: null,
      remoteModel: { url: "https://api.example.com/v1", modelId: "embed-2" },
    });
    expect(a).toMatch(/^remote:/);
    expect(a).not.toBe(b);
  });
});

describe("applyCheckpoint", () => {
  const chunks = () => [
    { chapterIndex: 0, content: "one" },
    { chapterIndex: 0, content: "two" },
    { chapterIndex: 1, content: "one" },
  ];

  it("restores the embeddings that were saved and reports how many", () => {
    const list: { chapterIndex: number; content: string; embedding?: number[] }[] = chunks();
    const saved = new Map([[chunkCheckpointKey(0, "two"), [1, 2, 3]]]);

    expect(applyCheckpoint(list, saved)).toBe(1);
    expect(list.map((c) => c.embedding)).toEqual([undefined, [1, 2, 3], undefined]);
  });

  it("matches on chapter as well as text", () => {
    const list: { chapterIndex: number; content: string; embedding?: number[] }[] = chunks();
    const saved = new Map([[chunkCheckpointKey(1, "one"), [9]]]);

    expect(applyCheckpoint(list, saved)).toBe(1);
    expect(list[0].embedding).toBeUndefined();
    expect(list[2].embedding).toEqual([9]);
  });

  it("does nothing for an empty checkpoint", () => {
    expect(applyCheckpoint(chunks(), new Map())).toBe(0);
  });

  it("ignores empty saved embeddings", () => {
    const list: { chapterIndex: number; content: string; embedding?: number[] }[] = chunks();
    expect(applyCheckpoint(list, new Map([[chunkCheckpointKey(0, "one"), []]]))).toBe(0);
  });
});

describe("checkpointEntries", () => {
  it("keeps only chunks that actually got an embedding", () => {
    const entries = checkpointEntries([
      { chapterIndex: 0, content: "a", embedding: [1] },
      { chapterIndex: 0, content: "b", embedding: [] },
      { chapterIndex: 0, content: "c" },
    ]);
    expect(entries).toEqual([{ key: chunkCheckpointKey(0, "a"), embedding: [1] }]);
  });
});

describe("hasEmbedding", () => {
  it("is false for a missing or empty embedding", () => {
    expect(hasEmbedding({})).toBe(false);
    expect(hasEmbedding({ embedding: [] })).toBe(false);
    expect(hasEmbedding({ embedding: [0.1] })).toBe(true);
  });
});
