import type { Chunk, VectorIndexProvenance } from "../types";
import { getDB, getLocalDB, serializeEmbedding, deserializeEmbedding } from "./db-core";

export async function getChunks(bookId: string): Promise<Chunk[]> {
  const database = await getLocalDB();
  const rows = await database.select<{
    id: string;
    book_id: string;
    chapter_index: number;
    chapter_title: string;
    content: string;
    token_count: number;
    start_cfi: string | null;
    end_cfi: string | null;
    segment_cfis: string | null;
    embedding: unknown;
  }>("SELECT * FROM chunks WHERE book_id = ? ORDER BY chapter_index, id", [bookId]);
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    chapterIndex: r.chapter_index,
    chapterTitle: r.chapter_title,
    content: r.content,
    tokenCount: r.token_count,
    startCfi: r.start_cfi || "",
    endCfi: r.end_cfi || "",
    segmentCfis: r.segment_cfis ? JSON.parse(r.segment_cfis) : undefined,
    embedding: deserializeEmbedding(r.embedding),
  }));
}

export async function insertChunks(chunks: Chunk[]): Promise<void> {
  const database = await getLocalDB();
  const now = Date.now();
  for (const chunk of chunks) {
    await database.execute(
      "INSERT INTO chunks (id, book_id, chapter_index, chapter_title, content, token_count, start_cfi, end_cfi, segment_cfis, embedding, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        chunk.id,
        chunk.bookId,
        chunk.chapterIndex,
        chunk.chapterTitle,
        chunk.content,
        chunk.tokenCount,
        chunk.startCfi || null,
        chunk.endCfi || null,
        chunk.segmentCfis ? JSON.stringify(chunk.segmentCfis) : null,
        serializeEmbedding(chunk.embedding),
        now,
      ],
    );
  }
}

export async function deleteChunks(bookId: string): Promise<void> {
  const database = await getLocalDB();
  await database.execute("DELETE FROM chunks WHERE book_id = ?", [bookId]);
}

export async function getVectorIndexProvenance(bookId: string): Promise<VectorIndexProvenance | null> {
  const database = await getLocalDB();
  const rows = await database.select<{
    book_id: string;
    model_kind: "builtin" | "remote";
    model_id: string;
    endpoint: string | null;
    dimensions: number;
    created_at: number;
  }>("SELECT * FROM vector_index_provenance WHERE book_id = ?", [bookId]);
  const row = rows[0];
  if (!row) return null;
  return {
    bookId: row.book_id,
    kind: row.model_kind,
    modelId: row.model_id,
    endpoint: row.endpoint || undefined,
    dimensions: row.dimensions,
    createdAt: row.created_at,
  };
}

export async function setVectorIndexProvenance(provenance: VectorIndexProvenance): Promise<void> {
  const database = await getLocalDB();
  await database.execute(
    `INSERT OR REPLACE INTO vector_index_provenance
      (book_id, model_kind, model_id, endpoint, dimensions, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      provenance.bookId,
      provenance.kind,
      provenance.modelId,
      provenance.endpoint || null,
      provenance.dimensions,
      provenance.createdAt,
    ],
  );
}

export async function deleteVectorIndexProvenance(bookId: string): Promise<void> {
  const database = await getLocalDB();
  await database.execute("DELETE FROM vector_index_provenance WHERE book_id = ?", [bookId]);
}

export async function clearVectorizationFlagsWithoutLocalChunks(): Promise<void> {
  const database = await getDB();
  const localDatabase = await getLocalDB();
  const rows = await localDatabase.select<{ book_id: string }>(
    `SELECT DISTINCT chunks.book_id
     FROM chunks
     INNER JOIN vector_index_provenance ON vector_index_provenance.book_id = chunks.book_id`,
  );
  const bookIds = rows.map((row) => row.book_id).filter((bookId) => !!bookId);

  if (bookIds.length === 0) {
    await database.execute(
      "UPDATE books SET is_vectorized = 0, vectorize_progress = 0 WHERE is_vectorized != 0 OR vectorize_progress != 0",
    );
    return;
  }

  const batchSize = 400;
  const clauses: string[] = [];
  const params: string[] = [];

  for (let index = 0; index < bookIds.length; index += batchSize) {
    const batch = bookIds.slice(index, index + batchSize);
    clauses.push(`id NOT IN (${batch.map(() => "?").join(", ")})`);
    params.push(...batch);
  }

  await database.execute(
    `UPDATE books
     SET is_vectorized = 0, vectorize_progress = 0
     WHERE (is_vectorized != 0 OR vectorize_progress != 0)
       AND ${clauses.join(" AND ")}`,
    params,
  );

  const restoreClauses: string[] = [];
  const restoreParams: string[] = [];

  for (let index = 0; index < bookIds.length; index += batchSize) {
    const batch = bookIds.slice(index, index + batchSize);
    restoreClauses.push(`id IN (${batch.map(() => "?").join(", ")})`);
    restoreParams.push(...batch);
  }

  await database.execute(
    `UPDATE books
     SET is_vectorized = 1, vectorize_progress = 1
     WHERE (is_vectorized = 0 OR vectorize_progress < 1)
       AND (${restoreClauses.join(" OR ")})`,
    restoreParams,
  );
}
