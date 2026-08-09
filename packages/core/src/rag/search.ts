import { getChunks, getVectorIndexProvenance } from "../db/database";
/**
 * Hybrid search — vector + BM25 with configurable weighting
 *
 * Optimizations:
 * - Inverted index for O(k*d) BM25 search instead of O(k*n*m)
 * - Advanced tokenizer with CJK bigram support
 * - In-memory caching for chunks and indexes
 * - Graceful fallback when vector search fails
 */
import type { Chunk, EmbeddingProvenance, SearchQuery, SearchResult, VectorIndexProvenance } from "../types";
import { cosineSimilarity } from "./embedding";
import { normalizeEmbeddingEndpoint } from "./embedding-provenance";
import { type InvertedIndex, buildInvertedIndex, searchInvertedIndex } from "./inverted-index";
import { tokenize, tokenizeQuery } from "./tokenizer";
import { getVectorDB, hasVectorDB } from "./vector-db";

/** Minimal contract needed by vector search. Both remote and builtin engines implement it. */
export interface QueryEmbeddingService {
  embed(text: string): Promise<number[]>;
  provenance?: EmbeddingProvenance;
}

let embeddingService: QueryEmbeddingService | null = null;

/** Configure the embedding service for vector search */
export function configureSearch(service: QueryEmbeddingService, provenance?: EmbeddingProvenance): void {
  if (provenance && !service.provenance) {
    service.provenance = provenance;
  }
  embeddingService = service;
}

function provenanceMatches(
  query: EmbeddingProvenance,
  index: VectorIndexProvenance,
): boolean {
  return (
    query.kind === index.kind &&
    query.modelId === index.modelId &&
    // Some remote providers do not expose dimensions in their saved settings.
    // In that case the actual query vector is checked immediately after embedding.
    (query.dimensions === 0 || index.dimensions === 0 || query.dimensions === index.dimensions) &&
    (query.kind === "builtin" ||
      normalizeEmbeddingEndpoint(query.endpoint || "") === normalizeEmbeddingEndpoint(index.endpoint || ""))
  );
}

async function assertCompatibleIndex(bookId: string): Promise<VectorIndexProvenance> {
  if (!embeddingService?.provenance) {
    throw new Error("Embedding service has no model identity; cannot safely query this vector index.");
  }
  const index = await getVectorIndexProvenance(bookId);
  if (!index) {
    throw new Error(
      "This book's vector index has no embedding provenance. Re-vectorize it before semantic search.",
    );
  }
  if (!provenanceMatches(embeddingService.provenance, index)) {
    throw new Error(
      `Vector index model mismatch: book uses ${index.kind}:${index.modelId} (${index.dimensions}d), ` +
        `but the active query model is ${embeddingService.provenance.kind}:${embeddingService.provenance.modelId} ` +
        `(${embeddingService.provenance.dimensions}d). Re-vectorize this book with the active model.`,
    );
  }
  return index;
}

/** Clear configured embedding service for vector search */
export function clearSearchConfiguration(): void {
  embeddingService = null;
}

// ---- In-memory chunk cache per book ----
interface CachedBookChunks {
  chunks: Chunk[];
  timestamp: number;
}

const chunkCache = new Map<string, CachedBookChunks>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Get chunks for a book, using cache if available */
async function getCachedChunks(bookId: string): Promise<Chunk[]> {
  const cached = chunkCache.get(bookId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.chunks;
  }
  const chunks = await getChunks(bookId);
  chunkCache.set(bookId, { chunks, timestamp: Date.now() });
  return chunks;
}

/** Invalidate cache for a book (call after vectorization) */
export function invalidateChunkCache(bookId: string): void {
  chunkCache.delete(bookId);
  invalidateInvertedIndex(bookId);
}

/** Clear entire cache */
export function clearChunkCache(): void {
  chunkCache.clear();
  clearInvertedIndexCache();
}

// ---- Inverted index cache ----
const invertedIndexCache = new Map<string, { index: InvertedIndex; timestamp: number }>();

/** Build or get cached inverted index for a book */
function getOrBuildInvertedIndex(chunks: Chunk[], bookId: string): InvertedIndex {
  const cached = invertedIndexCache.get(bookId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.index;
  }

  const documents = chunks.map((c) => ({ id: c.id, content: c.content }));
  const index = buildInvertedIndex(documents, tokenize);

  invertedIndexCache.set(bookId, { index, timestamp: Date.now() });
  return index;
}

/** Invalidate inverted index cache for a book */
function invalidateInvertedIndex(bookId: string): void {
  invertedIndexCache.delete(bookId);
}

/** Clear all inverted index cache */
function clearInvertedIndexCache(): void {
  invertedIndexCache.clear();
}

// ---- Search functions ----

/** Execute a search query against book chunks */
export async function search(query: SearchQuery): Promise<SearchResult[]> {
  switch (query.mode) {
    case "vector":
      return vectorSearch(query);
    case "bm25":
      return bm25Search(query);
    case "hybrid":
      return hybridSearch(query);
  }
}

/** Vector similarity search */
async function vectorSearch(query: SearchQuery): Promise<SearchResult[]> {
  if (!embeddingService) {
    throw new Error("Embedding service not configured. Call configureSearch() first.");
  }

  const indexProvenance = await assertCompatibleIndex(query.bookId);

  // Get query embedding
  const queryEmbedding = await embeddingService.embed(query.query);
  if (indexProvenance.dimensions > 0 && queryEmbedding.length !== indexProvenance.dimensions) {
    throw new Error(
      `Vector index dimension mismatch: book uses ${indexProvenance.dimensions}d, ` +
        `but the query model returned ${queryEmbedding.length}d. Re-vectorize this book with the active model.`,
    );
  }

  // Try vector database first (sqlite-vec)
  if (hasVectorDB()) {
    try {
      const vectorDB = getVectorDB();
      if (vectorDB && (await vectorDB.isReady())) {
        const results = await vectorDB.search(queryEmbedding, query.bookId, query.topK);

        if (results.length > 0) {
          // Get chunks for the matched IDs
          const chunks = await getCachedChunks(query.bookId);
          const chunkMap = new Map(chunks.map((c) => [c.id, c]));

          return results
            .filter((r) => r.score >= (query.threshold || 0.3))
            .map((r) => ({
              chunk: chunkMap.get(r.id)!,
              score: r.score,
              matchType: "vector" as const,
            }))
            .filter((r) => r.chunk);
        }
      }
    } catch (err) {
      console.error("[Search] Vector DB search failed, falling back to in-memory:", err);
    }
  }

  // Fallback: in-memory vector search
  const chunks = await getCachedChunks(query.bookId);

  // Compute cosine similarity against each chunk with an embedding
  const results: SearchResult[] = chunks
    .filter((c) => c.embedding && c.embedding.length > 0)
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding!),
      matchType: "vector" as const,
    }))
    .filter((r) => r.score >= (query.threshold || 0.3))
    .sort((a, b) => b.score - a.score)
    .slice(0, query.topK);

  return results;
}

/** BM25 keyword search using inverted index */
async function bm25Search(query: SearchQuery): Promise<SearchResult[]> {
  const chunks = await getCachedChunks(query.bookId);
  if (chunks.length === 0) return [];

  // Tokenize query (use query tokenizer for exact matching)
  const queryTerms = tokenizeQuery(query.query);
  if (queryTerms.length === 0) return [];

  // Build or get cached inverted index
  const index = getOrBuildInvertedIndex(chunks, query.bookId);

  // Search using inverted index (O(k*d) complexity)
  const searchResults = searchInvertedIndex(index, queryTerms, query.topK);

  // Map results back to chunks
  const chunkMap = new Map(chunks.map((c) => [c.id, c]));

  return searchResults
    .map(({ docId, score }) => ({
      chunk: chunkMap.get(docId)!,
      score,
      matchType: "bm25" as const,
      highlights: findHighlightSnippets(chunkMap.get(docId)?.content || "", queryTerms),
    }))
    .filter((r) => r.chunk); // Filter out missing chunks
}

/** Hybrid search combining vector and BM25 with RRF fusion */
async function hybridSearch(query: SearchQuery): Promise<SearchResult[]> {
  // Run both searches in parallel with double the topK to get better fusion
  const expandedQuery = { ...query, topK: query.topK * 2 };

  let vectorResults: SearchResult[] = [];
  let bm25Results: SearchResult[] = [];

  // Vector search may fail if no embeddings are configured
  try {
    vectorResults = await vectorSearch(expandedQuery);
  } catch (err) {
    console.warn("[Search] Vector search failed, falling back to BM25 only:", err);
    const vectorError = err instanceof Error ? err.message : String(err);
    bm25Results = await bm25Search(expandedQuery);
    return bm25Results.slice(0, query.topK).map((result) => ({
      ...result,
      vectorStatus: "unavailable" as const,
      vectorError,
    }));
  }

  bm25Results = await bm25Search(expandedQuery);

  if (vectorResults.length === 0) return bm25Results.slice(0, query.topK);
  if (bm25Results.length === 0) return vectorResults.slice(0, query.topK);

  return rrfFusion(vectorResults, bm25Results, query.topK);
}

/** Reciprocal Rank Fusion — merges results from multiple retrieval methods */
function rrfFusion(
  vectorResults: SearchResult[],
  bm25Results: SearchResult[],
  topK: number,
  k = 60,
): SearchResult[] {
  const scores = new Map<string, number>();
  const chunkMap = new Map<string, SearchResult>();

  // Score from vector results
  vectorResults.forEach((r, i) => {
    const id = r.chunk.id;
    scores.set(id, (scores.get(id) || 0) + 1 / (k + i + 1));
    chunkMap.set(id, r);
  });

  // Score from BM25 results
  bm25Results.forEach((r, i) => {
    const id = r.chunk.id;
    scores.set(id, (scores.get(id) || 0) + 1 / (k + i + 1));
    if (!chunkMap.has(id)) {
      chunkMap.set(id, r);
    }
  });

  return Array.from(scores.entries())
    .map(([id, score]) => ({
      ...chunkMap.get(id)!,
      score,
      matchType: "hybrid" as const,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Find highlight snippets around matching terms */
function findHighlightSnippets(content: string, terms: string[], contextChars = 50): string[] {
  const snippets: string[] = [];
  if (!content) return snippets;
  const lowerContent = content.toLowerCase();

  for (const term of terms) {
    const idx = lowerContent.indexOf(term);
    if (idx === -1) continue;

    const start = Math.max(0, idx - contextChars);
    const end = Math.min(content.length, idx + term.length + contextChars);
    const snippet =
      (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "");
    snippets.push(snippet);
  }

  return snippets.slice(0, 3); // max 3 snippets
}
