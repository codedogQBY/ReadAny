import { getChunks } from "@/lib/db/database";
/**
 * Hybrid search — vector + BM25 with configurable weighting
 * Full implementation with actual search algorithms
 */
import type { SearchQuery, SearchResult } from "@/types";
import { cosineSimilarity } from "./embedding";
import type { EmbeddingService } from "./embedding-service";

let embeddingService: EmbeddingService | null = null;

/** Configure the embedding service for vector search */
export function configureSearch(service: EmbeddingService): void {
  embeddingService = service;
}

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

  // Get query embedding
  const queryEmbedding = await embeddingService.embed(query.query);

  // Get all chunks for this book
  const chunks = await getChunks(query.bookId);

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

/** BM25 keyword search */
async function bm25Search(query: SearchQuery): Promise<SearchResult[]> {
  const chunks = await getChunks(query.bookId);
  if (chunks.length === 0) return [];

  const terms = tokenize(query.query);
  if (terms.length === 0) return [];

  // BM25 parameters
  const k1 = 1.5;
  const b = 0.75;

  // Compute average document length
  const avgdl = chunks.reduce((sum, c) => sum + c.tokenCount, 0) / chunks.length;

  // Compute IDF for each term
  const idfMap = new Map<string, number>();
  for (const term of terms) {
    const df = chunks.filter((c) => tokenize(c.content).includes(term)).length;
    const idf = Math.log((chunks.length - df + 0.5) / (df + 0.5) + 1);
    idfMap.set(term, idf);
  }

  // Score each chunk
  const results: SearchResult[] = chunks
    .map((chunk) => {
      const docTokens = tokenize(chunk.content);
      const docLen = docTokens.length;
      let score = 0;

      for (const term of terms) {
        const tf = docTokens.filter((t) => t === term).length;
        const idf = idfMap.get(term) || 0;
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgdl))));
      }

      // Find highlight snippets
      const highlights = findHighlightSnippets(chunk.content, terms);

      return {
        chunk,
        score,
        matchType: "bm25" as const,
        highlights,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, query.topK);

  return results;
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
  } catch {
    // Fall back to BM25 only
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

/** Tokenize text for BM25 — handles both English and CJK characters */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Find highlight snippets around matching terms */
function findHighlightSnippets(content: string, terms: string[], contextChars = 50): string[] {
  const snippets: string[] = [];
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
