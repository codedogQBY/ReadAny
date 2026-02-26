/**
 * Embedding model management and utilities
 */
import type { EmbeddingModel } from "@/types";
import { EmbeddingService } from "./embedding-service";

const BUILTIN_MODELS: EmbeddingModel[] = [
  {
    id: "text-embedding-3-small",
    name: "OpenAI Embedding 3 Small",
    dimensions: 1536,
    maxTokens: 8191,
    provider: "openai",
  },
  {
    id: "text-embedding-3-large",
    name: "OpenAI Embedding 3 Large",
    dimensions: 3072,
    maxTokens: 8191,
    provider: "openai",
  },
];

/** Get available embedding models */
export function getEmbeddingModels(): EmbeddingModel[] {
  return BUILTIN_MODELS;
}

/** Get default embedding model */
export function getDefaultModel(): EmbeddingModel {
  return BUILTIN_MODELS[0];
}

/** Generate embedding for text using the EmbeddingService */
export async function getEmbedding(
  text: string,
  model: EmbeddingModel,
  apiKey: string,
  baseUrl?: string,
): Promise<number[]> {
  const service = new EmbeddingService({ model, apiKey, baseUrl, batchSize: 1 });
  return service.embed(text);
}

/** Batch generate embeddings using the EmbeddingService */
export async function getEmbeddings(
  texts: string[],
  model: EmbeddingModel,
  apiKey: string,
  baseUrl?: string,
): Promise<number[][]> {
  const service = new EmbeddingService({ model, apiKey, baseUrl, batchSize: 20 });
  return service.embedBatch(texts);
}

/** Compute cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
