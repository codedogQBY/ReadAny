import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocalEmbeddingEngine } from "../ai/local-embedding-service";
import { createBuiltinEmbeddingService } from "./builtin-embedding-service";

describe("createBuiltinEmbeddingService", () => {
  const load = vi.fn(async () => undefined);

  beforeEach(() => {
    setLocalEmbeddingEngine({
      init: () => undefined,
      load,
      generate: async (modelId, texts) => texts.map(() => (modelId === "bge-small-zh-v1.5" ? [1, 2] : [])),
      dispose: async () => undefined,
      clearCache: async () => undefined,
    });
  });

  it("generates query embeddings with the selected builtin model", async () => {
    const service = createBuiltinEmbeddingService("bge-small-zh-v1.5");
    await expect(service.embed("查询文本")).resolves.toEqual([1, 2]);
    expect(load).toHaveBeenCalledWith("bge-small-zh-v1.5", "Xenova/bge-small-zh-v1.5", undefined);
  });
});
