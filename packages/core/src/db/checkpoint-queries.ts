/**
 * Local-only storage for partially finished vectorization (see rag/checkpoint.ts).
 * Kept apart from `chunks` so search never sees a half-built index.
 */
import { deserializeEmbedding, getLocalDB, serializeEmbedding } from "./db-core";

export interface VectorCheckpointSummary {
  bookId: string;
  doneChunks: number;
  totalChunks: number;
  modelKey: string;
}

export async function clearVectorCheckpoint(bookId: string): Promise<void> {
  const database = await getLocalDB();
  await database.execute("DELETE FROM vector_checkpoints WHERE book_id = ?", [bookId]);
  await database.execute("DELETE FROM vector_checkpoint_meta WHERE book_id = ?", [bookId]);
}

/** Saved embeddings for `bookId`, or an empty map when none exist or they belong to another model. */
export async function loadVectorCheckpoint(
  bookId: string,
  modelKey: string,
): Promise<Map<string, number[]>> {
  const database = await getLocalDB();
  const meta = await database.select<{ model_key: string }>(
    "SELECT model_key FROM vector_checkpoint_meta WHERE book_id = ?",
    [bookId],
  );
  if (meta[0] && meta[0].model_key !== modelKey) {
    await clearVectorCheckpoint(bookId);
    return new Map();
  }
  const rows = await database.select<{ chunk_key: string; embedding: unknown }>(
    "SELECT chunk_key, embedding FROM vector_checkpoints WHERE book_id = ?",
    [bookId],
  );
  const saved = new Map<string, number[]>();
  for (const row of rows) {
    const embedding = deserializeEmbedding(row.embedding);
    if (embedding && embedding.length > 0) saved.set(row.chunk_key, embedding);
  }
  return saved;
}

export async function saveVectorCheckpointBatch(
  bookId: string,
  modelKey: string,
  totalChunks: number,
  entries: { key: string; embedding: number[] }[],
): Promise<void> {
  if (entries.length === 0) return;
  const database = await getLocalDB();
  for (const entry of entries) {
    await database.execute(
      "INSERT OR REPLACE INTO vector_checkpoints (book_id, chunk_key, model_key, embedding) VALUES (?, ?, ?, ?)",
      [bookId, entry.key, modelKey, serializeEmbedding(entry.embedding)],
    );
  }
  await database.execute(
    "INSERT OR REPLACE INTO vector_checkpoint_meta (book_id, model_key, total_chunks, updated_at) VALUES (?, ?, ?, ?)",
    [bookId, modelKey, totalChunks, Date.now()],
  );
}

/** One row per book that has an unfinished vectorization. */
export async function listVectorCheckpoints(): Promise<VectorCheckpointSummary[]> {
  const database = await getLocalDB();
  const rows = await database.select<{
    book_id: string;
    model_key: string;
    total_chunks: number;
    done_chunks: number;
  }>(
    `SELECT m.book_id AS book_id, m.model_key AS model_key, m.total_chunks AS total_chunks,
            COUNT(c.chunk_key) AS done_chunks
     FROM vector_checkpoint_meta m
     LEFT JOIN vector_checkpoints c ON c.book_id = m.book_id
     GROUP BY m.book_id, m.model_key, m.total_chunks`,
  );
  return rows.map((row) => ({
    bookId: row.book_id,
    modelKey: row.model_key,
    totalChunks: row.total_chunks,
    doneChunks: row.done_chunks,
  }));
}
