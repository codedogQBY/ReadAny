/** RAG (Retrieval-Augmented Generation) types */

export interface Chunk {
  id: string;
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  content: string;
  tokenCount: number;
  startCfi: string;
  endCfi: string;
  embedding?: number[];
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
  matchType: "vector" | "bm25" | "hybrid";
  highlights?: string[]; // matched text segments
}

export type SearchMode = "hybrid" | "vector" | "bm25";

export interface SearchQuery {
  query: string;
  bookId: string;
  mode: SearchMode;
  topK: number;
  threshold: number;
}

export interface EmbeddingModel {
  id: string;
  name: string;
  dimensions: number;
  maxTokens: number;
  provider: "openai" | "local";
}

export interface VectorConfig {
  model: EmbeddingModel;
  chunkSize: number; // default 300 tokens
  chunkMinSize: number; // default 50 tokens
  chunkOverlap: number; // default 0.2 (20%)
  hybridAlpha: number; // vector weight, 0-1, default 0.7
}

export interface VectorizeProgress {
  bookId: string;
  totalChunks: number;
  processedChunks: number;
  status: "idle" | "chunking" | "embedding" | "indexing" | "completed" | "error";
  error?: string;
}
