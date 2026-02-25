/**
 * Vectorize pipeline — orchestrates chunking + embedding for a book
 */
import type { Chunk, VectorConfig, VectorizeProgress } from "@/types";
import { chunkContent } from "./chunker";

export type VectorizeCallback = (progress: VectorizeProgress) => void;

/** Run the full vectorization pipeline for a book */
export async function vectorizeBook(
  bookId: string,
  chapters: Array<{ index: number; title: string; content: string }>,
  config: VectorConfig,
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
    const chunks = chunkContent(
      chapter.content,
      bookId,
      chapter.index,
      chapter.title,
      {
        targetTokens: config.chunkSize,
        minTokens: config.chunkMinSize,
        overlapRatio: config.chunkOverlap,
      },
    );
    allChunks.push(...chunks);
  }

  progress.totalChunks = allChunks.length;
  progress.status = "embedding";
  onProgress?.(progress);

  // Phase 2: Generate embeddings
  // TODO: Batch embedding API calls
  for (let i = 0; i < allChunks.length; i++) {
    // TODO: allChunks[i].embedding = await getEmbedding(allChunks[i].content, config.model);
    progress.processedChunks = i + 1;
    onProgress?.(progress);
  }

  // Phase 3: Index
  progress.status = "indexing";
  onProgress?.(progress);
  // TODO: Store chunks in database

  progress.status = "completed";
  onProgress?.(progress);

  return allChunks;
}
