/**
 * Resume support for book vectorization.
 *
 * Embeddings are expensive (minutes on a phone) and used to live in memory until the
 * very end, so any interruption lost everything. Finished embeddings are now saved as
 * they are produced, keyed by what was embedded, and a later run reuses them.
 *
 * Chunk ids are not stable enough to match on, so a chunk is identified by its chapter
 * and a hash of its text: the same book chunked the same way produces the same keys.
 */
import { normalizeEmbeddingEndpoint } from "./embedding-provenance";

export interface CheckpointModelConfig {
  vectorModelMode: "builtin" | "remote";
  selectedBuiltinModelId: string | null;
  remoteModel: { url: string; modelId: string } | null;
}

export interface CheckpointChunk {
  chapterIndex: number;
  content: string;
  embedding?: number[];
}

/** Two independent 32-bit FNV-1a hashes of the UTF-16 code units, as 16 hex digits. */
function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Stable identity of a chunk's text within a book. */
export function chunkCheckpointKey(chapterIndex: number, content: string): string {
  return `${chapterIndex}:${content.length}:${hashText(content)}`;
}

/** Embeddings from different models are not interchangeable, so checkpoints are per model. */
export function embeddingModelKey(config: CheckpointModelConfig): string {
  if (config.vectorModelMode === "builtin") return `builtin:${config.selectedBuiltinModelId ?? ""}`;
  const remote = config.remoteModel;
  return `remote:${remote ? normalizeEmbeddingEndpoint(remote.url) : ""}:${remote?.modelId ?? ""}`;
}

export function hasEmbedding(chunk: { embedding?: number[] }): boolean {
  return !!chunk.embedding && chunk.embedding.length > 0;
}

/** Fills in embeddings found in `saved` and returns how many chunks were restored. */
export function applyCheckpoint(chunks: CheckpointChunk[], saved: Map<string, number[]>): number {
  if (saved.size === 0) return 0;
  let restored = 0;
  for (const chunk of chunks) {
    const embedding = saved.get(chunkCheckpointKey(chunk.chapterIndex, chunk.content));
    if (embedding && embedding.length > 0) {
      chunk.embedding = embedding;
      restored++;
    }
  }
  return restored;
}

/** Entries to save for a batch: only chunks that really got an embedding. */
export function checkpointEntries(
  batch: CheckpointChunk[],
): { key: string; embedding: number[] }[] {
  const entries: { key: string; embedding: number[] }[] = [];
  for (const chunk of batch) {
    if (chunk.embedding && chunk.embedding.length > 0) {
      entries.push({
        key: chunkCheckpointKey(chunk.chapterIndex, chunk.content),
        embedding: chunk.embedding,
      });
    }
  }
  return entries;
}
