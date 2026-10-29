import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterData } from "./rag-types";

// In-memory stand-ins for the local database and the embedding model.
const state = vi.hoisted(() => ({
  checkpoint: null as null | { modelKey: string; total: number; entries: Map<string, number[]> },
  inserted: [] as { embedding?: number[] }[],
  embeddedTexts: 0,
  failOnCall: 0,
  calls: 0,
}));

vi.mock("../db/database", () => ({
  clearVectorCheckpoint: vi.fn(async () => {
    state.checkpoint = null;
  }),
  loadVectorCheckpoint: vi.fn(async (_bookId: string, modelKey: string) => {
    if (state.checkpoint && state.checkpoint.modelKey !== modelKey) state.checkpoint = null;
    return new Map(state.checkpoint?.entries ?? []);
  }),
  saveVectorCheckpointBatch: vi.fn(
    async (
      _bookId: string,
      modelKey: string,
      total: number,
      entries: { key: string; embedding: number[] }[],
    ) => {
      state.checkpoint ??= { modelKey, total, entries: new Map() };
      for (const entry of entries) state.checkpoint.entries.set(entry.key, entry.embedding);
    },
  ),
  deleteChunks: vi.fn(async () => undefined),
  deleteVectorIndexProvenance: vi.fn(async () => undefined),
  setVectorIndexProvenance: vi.fn(async () => undefined),
  insertChunks: vi.fn(async (chunks: { embedding?: number[] }[]) => {
    state.inserted.push(...chunks);
  }),
}));

vi.mock("../ai/local-embedding-service", () => ({
  loadEmbeddingPipeline: vi.fn(async () => undefined),
  generateLocalEmbeddings: vi.fn(
    async (_id: string, texts: string[], onItem?: (done: number, total: number) => void) => {
      state.calls++;
      if (state.failOnCall && state.calls === state.failOnCall) {
        throw new Error("app was interrupted");
      }
      state.embeddedTexts += texts.length;
      onItem?.(texts.length, texts.length);
      return texts.map((text) => [text.length, 1, 2]);
    },
  ),
}));

vi.mock("./vector-db", () => ({ hasVectorDB: () => false, getVectorDB: () => null }));
vi.mock("./search", () => ({ invalidateChunkCache: vi.fn() }));

import { triggerVectorizeBook } from "./vectorize-trigger";
import type { VectorizeTriggerConfig } from "./vectorize-trigger";

const config = (modelId: string): VectorizeTriggerConfig => ({
  vectorModelEnabled: true,
  vectorModelMode: "builtin",
  selectedBuiltinModelId: modelId,
  remoteModel: null,
});

/** 10 chapters of 12 distinct ~400-character paragraphs: enough chunks for several batches. */
function makeChapters(): ChapterData[] {
  return Array.from({ length: 10 }, (_, chapter) => {
    const segments = Array.from({ length: 12 }, (_, i) => ({
      text: `Chapter ${chapter} paragraph ${i}. ${"lorem ipsum dolor sit amet ".repeat(15)}`,
      cfi: `epubcfi(/6/${chapter}!/4/${i})`,
    }));
    return {
      index: chapter,
      title: `Chapter ${chapter}`,
      content: segments.map((s) => s.text).join("\n\n"),
      segments,
    };
  });
}

function makeCallbacks() {
  return {
    onBookUpdate: vi.fn(),
    onCheckpoint: vi.fn(),
  };
}

describe("triggerVectorizeBook resume", () => {
  beforeEach(() => {
    state.checkpoint = null;
    state.inserted = [];
    state.embeddedTexts = 0;
    state.failOnCall = 0;
    state.calls = 0;
  });

  it("saves a checkpoint after every batch and keeps it when the run fails", async () => {
    state.failOnCall = 3; // two batches of 16 succeed, the third fails
    const callbacks = makeCallbacks();

    await expect(
      triggerVectorizeBook("book", makeChapters(), config("all-MiniLM-L6-v2"), callbacks),
    ).rejects.toThrow("app was interrupted");

    expect(state.checkpoint?.entries.size).toBe(32);
    expect(state.inserted).toHaveLength(0); // nothing half-built is published as the index
    const last = callbacks.onCheckpoint.mock.calls[callbacks.onCheckpoint.mock.calls.length - 1];
    expect(last?.[1]).toMatchObject({ doneChunks: 32 });
    expect(callbacks.onBookUpdate).toHaveBeenLastCalledWith("book", {
      isVectorized: false,
      vectorizeProgress: 0,
    });
  });

  it("resumes from the checkpoint and only embeds what is missing", async () => {
    state.failOnCall = 3;
    await expect(
      triggerVectorizeBook("book", makeChapters(), config("all-MiniLM-L6-v2"), makeCallbacks()),
    ).rejects.toThrow();
    const totalEmbeddedFirstRun = state.embeddedTexts;
    expect(totalEmbeddedFirstRun).toBe(32);

    state.failOnCall = 0;
    state.embeddedTexts = 0;
    const callbacks = makeCallbacks();
    const updates: { processedChunks: number; totalChunks: number; resumedChunks?: number }[] = [];
    await triggerVectorizeBook(
      "book",
      makeChapters(),
      config("all-MiniLM-L6-v2"),
      callbacks,
      (progress) => {
        if (progress.status === "embedding") updates.push({ ...progress });
      },
    );

    const total = state.inserted.length;
    expect(total).toBeGreaterThan(32);
    expect(state.embeddedTexts).toBe(total - 32);
    expect(updates[0]).toMatchObject({ processedChunks: 32, resumedChunks: 32 });
    expect(updates[updates.length - 1]?.processedChunks).toBe(total);
    expect(state.inserted.every((chunk) => (chunk.embedding?.length ?? 0) > 0)).toBe(true);
    expect(state.checkpoint).toBeNull();
    expect(callbacks.onCheckpoint).toHaveBeenLastCalledWith("book", null);
    expect(callbacks.onBookUpdate).toHaveBeenLastCalledWith("book", {
      isVectorized: true,
      vectorizeProgress: 1,
    });
  });

  it("does not reuse a checkpoint made by a different model", async () => {
    state.failOnCall = 3;
    await expect(
      triggerVectorizeBook("book", makeChapters(), config("all-MiniLM-L6-v2"), makeCallbacks()),
    ).rejects.toThrow();

    state.failOnCall = 0;
    state.embeddedTexts = 0;
    await triggerVectorizeBook(
      "book",
      makeChapters(),
      config("multilingual-e5-small"),
      makeCallbacks(),
    );

    expect(state.embeddedTexts).toBe(state.inserted.length);
  });

  it("re-embeds a chunk whose text changed since the checkpoint", async () => {
    state.failOnCall = 3;
    await expect(
      triggerVectorizeBook("book", makeChapters(), config("all-MiniLM-L6-v2"), makeCallbacks()),
    ).rejects.toThrow();

    const changed = makeChapters();
    changed[0].segments[0].text = "A completely different opening paragraph. ".repeat(10);
    state.failOnCall = 0;
    state.embeddedTexts = 0;
    await triggerVectorizeBook("book", changed, config("all-MiniLM-L6-v2"), makeCallbacks());

    // Everything not in the saved 32 is embedded, plus the chunk(s) that changed.
    expect(state.embeddedTexts).toBeGreaterThan(state.inserted.length - 32);
  });

  it("finishes with an injected yield even when timers never fire (screen off)", async () => {
    vi.useFakeTimers(); // setTimeout would never resolve, like on a locked Android phone
    try {
      const yieldToUI = vi.fn(async () => undefined);
      await triggerVectorizeBook("book", makeChapters(), config("all-MiniLM-L6-v2"), {
        ...makeCallbacks(),
        yieldToUI,
      });

      expect(yieldToUI).toHaveBeenCalled();
      expect(state.inserted.length).toBeGreaterThan(0);
      expect(state.embeddedTexts).toBe(state.inserted.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it("works as before when nothing was saved", async () => {
    const callbacks = makeCallbacks();
    await triggerVectorizeBook("book", makeChapters(), config("all-MiniLM-L6-v2"), callbacks);

    expect(state.embeddedTexts).toBe(state.inserted.length);
    expect(state.checkpoint).toBeNull();
  });
});
