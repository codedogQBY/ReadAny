/**
 * Hybrid search — vector + BM25 with configurable weighting
 */
import type { Chunk, SearchResult, SearchQuery } from "@/types";

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
  // TODO: Get query embedding, compute cosine similarity against chunks
  void query;
  return [];
}

/** BM25 keyword search */
async function bm25Search(query: SearchQuery): Promise<SearchResult[]> {
  // TODO: Tokenize query, compute BM25 scores against chunks
  void query;
  return [];
}

/** Hybrid search combining vector and BM25 with weighted scoring */
async function hybridSearch(query: SearchQuery): Promise<SearchResult[]> {
  const [vectorResults, bm25Results] = await Promise.all([
    vectorSearch(query),
    bm25Search(query),
  ]);

  return mergeResults(vectorResults, bm25Results, 0.7); // default alpha=0.7 for vector weight
}

/** Merge and re-rank results from multiple sources */
function mergeResults(
  vectorResults: SearchResult[],
  bm25Results: SearchResult[],
  alpha: number,
): SearchResult[] {
  const scoreMap = new Map<string, { chunk: Chunk; vectorScore: number; bm25Score: number }>();

  for (const r of vectorResults) {
    scoreMap.set(r.chunk.id, { chunk: r.chunk, vectorScore: r.score, bm25Score: 0 });
  }

  for (const r of bm25Results) {
    const existing = scoreMap.get(r.chunk.id);
    if (existing) {
      existing.bm25Score = r.score;
    } else {
      scoreMap.set(r.chunk.id, { chunk: r.chunk, vectorScore: 0, bm25Score: r.score });
    }
  }

  return Array.from(scoreMap.values())
    .map(({ chunk, vectorScore, bm25Score }) => ({
      chunk,
      score: alpha * vectorScore + (1 - alpha) * bm25Score,
      matchType: "hybrid" as const,
    }))
    .sort((a, b) => b.score - a.score);
}
