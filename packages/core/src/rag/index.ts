export type { TextSegment, ChapterData } from "./rag-types";

export { buildChapterSectionGroups } from "./chapter-structure";
export type {
  ChapterSectionGroup,
  SectionRefLike,
  TocTreeItemLike,
} from "./chapter-structure";

export { chunkContent, estimateTokens } from "./chunker";
export type { ChunkerConfig } from "./chunker";

export { requestRemoteEmbeddingBatch, isOllamaEmbeddingUrl } from "./remote-embedding";
export type {
  RemoteEmbeddingBatchOptions,
  RemoteEmbeddingBatchResult,
  RemoteEmbeddingFetch,
  RemoteEmbeddingModel,
} from "./remote-embedding";

export { EmbeddingService } from "./embedding-service";
export type { EmbeddingConfig } from "./embedding-service";
export { createBuiltinEmbeddingService } from "./builtin-embedding-service";
export { normalizeEmbeddingEndpoint } from "./embedding-provenance";

export {
  getEmbeddingModels,
  getDefaultModel,
  getEmbedding,
  getEmbeddings,
  cosineSimilarity,
} from "./embedding";

export {
  search,
  configureSearch,
  clearSearchConfiguration,
  invalidateChunkCache,
  clearChunkCache,
} from "./search";
export type { QueryEmbeddingService } from "./search";
export type { EmbeddingProvenance, VectorIndexProvenance } from "../types";

// Tokenizer exports
export { tokenize, tokenizeQuery, getTokenFrequencies } from "./tokenizer";

// Inverted index exports
export {
  buildInvertedIndex,
  searchInvertedIndex,
  getMatchingDocIds,
  getIntersectingDocIds,
  getIndexStats,
} from "./inverted-index";
export type {
  Posting,
  IndexEntry,
  DocMeta,
  InvertedIndex,
} from "./inverted-index";

export { vectorizeBook } from "./vectorize";
export type { VectorizeCallback } from "./vectorize";

export {
  resetBookVectorization,
  triggerVectorizeBook,
  VectorizationCleanupError,
} from "./vectorize-trigger";
export type {
  VectorizeStatusCallback,
  VectorizeTriggerConfig,
  VectorizeTriggerCallbacks,
} from "./vectorize-trigger";

export {
  setVectorDB,
  getVectorDB,
  hasVectorDB,
} from "./vector-db";
export type {
  IVectorDB,
  VectorRecord,
  VectorSearchResult,
} from "./vector-db";
