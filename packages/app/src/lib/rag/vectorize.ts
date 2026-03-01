import { deleteChunks, insertChunks } from "@/lib/db/database";
/**
 * Vectorize pipeline — orchestrates chunking + embedding + indexing for a book
 */
import type { Chunk, VectorConfig, VectorizeProgress } from "@/types";
import { chunkContent } from "./chunker";
import type { TextSegment } from "./book-extractor";
import { EmbeddingService } from "./embedding-service";

export type VectorizeCallback = (progress: VectorizeProgress) => void;

/** Run the full vectorization pipeline for a book */
export async function vectorizeBook(
  bookId: string,
  chapters: Array<{ index: number; title: string; content: string; segments?: TextSegment[] }>,
  config: VectorConfig,
  apiKey: string,
  onProgress?: VectorizeCallback,
): Promise<Chunk[]> {
  const allChunks: Chunk[] = [];

  const progress: VectorizeProgress = {
    bookId,
    totalChunks: 0,
    processedChunks: 0,
    status: "chunking",
  };

  onProgress?.(progress);

  // Phase 1: Chunk all chapters
  for (const chapter of chapters) {
    const chunks = chunkContent(chapter.content, bookId, chapter.index, chapter.title, {
      targetTokens: config.chunkSize,
      minTokens: config.chunkMinSize,
      overlapRatio: config.chunkOverlap,
    }, chapter.segments);
    allChunks.push(...chunks);
  }

  progress.totalChunks = allChunks.length;
  progress.status = "embedding";
  onProgress?.(progress);

  // Phase 2: Generate embeddings using the EmbeddingService
  const embeddingService = new EmbeddingService({
    model: config.model,
    apiKey,
    batchSize: 20,
  });

  const batchSize = 20;
  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.content);

    try {
      const embeddings = await embeddingService.embedBatch(texts);
      for (let j = 0; j < batch.length; j++) {
        batch[j].embedding = embeddings[j];
      }
    } catch (err) {
      progress.status = "error";
      progress.error = err instanceof Error ? err.message : "Embedding generation failed";
      onProgress?.(progress);
      throw err;
    }

    progress.processedChunks = Math.min(i + batchSize, allChunks.length);
    onProgress?.(progress);
  }

  // Phase 3: Index — store chunks in database
  progress.status = "indexing";
  onProgress?.(progress);

  try {
    // Clear existing chunks for this book first
    await deleteChunks(bookId);
    // Insert new chunks
    await insertChunks(allChunks);
  } catch (err) {
    progress.status = "error";
    progress.error = err instanceof Error ? err.message : "Database indexing failed";
    onProgress?.(progress);
    throw err;
  }

  progress.status = "completed";
  onProgress?.(progress);

  return allChunks;
}
