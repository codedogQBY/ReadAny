import { generateLocalEmbeddings, loadEmbeddingPipeline } from "../ai/local-embedding-service";
import { BUILTIN_EMBEDDING_MODELS } from "../ai/builtin-embedding-models";
import type { QueryEmbeddingService } from "./search";

/**
 * Adapts the platform's configured builtin embedding engine to RAG query search.
 * Vectorization and query embedding therefore use the same Transformers.js pipeline.
 */
export function createBuiltinEmbeddingService(builtinModelId: string): QueryEmbeddingService {
  const model = BUILTIN_EMBEDDING_MODELS.find((candidate) => candidate.id === builtinModelId);
  if (!model) throw new Error(`Unknown built-in embedding model: ${builtinModelId}`);

  return {
    provenance: {
      kind: "builtin",
      modelId: model.id,
      dimensions: model.dimension,
    },
    async embed(text: string): Promise<number[]> {
      await loadEmbeddingPipeline(builtinModelId);
      const [embedding] = await generateLocalEmbeddings(builtinModelId, [text]);
      if (!embedding?.length) {
        throw new Error(`Built-in embedding model ${builtinModelId} returned no embedding.`);
      }
      return embedding;
    },
  };
}
