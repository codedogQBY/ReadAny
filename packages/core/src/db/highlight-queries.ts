import type { Highlight } from "../types";
import { getDB, getDeviceId, insertTombstone, nextSyncVersion, nextUpdatedAt } from "./db-core";

/** Extended highlight with book info for notes page */
export interface HighlightWithBook extends Highlight {
  bookTitle: string;
  bookAuthor: string;
  bookCoverUrl?: string;
}

export async function getHighlights(bookId: string): Promise<Highlight[]> {
  const database = await getDB();
  const rows = await database.select<{
    id: string;
    book_id: string;
    cfi: string;
    text: string;
    color: string;
    note: string | null;
    chapter_title: string | null;
    created_at: number;
    updated_at: number;
  }>("SELECT * FROM highlights WHERE book_id = ? ORDER BY created_at DESC", [bookId]);
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    cfi: r.cfi,
    text: r.text,
    color: r.color as Highlight["color"],
    note: r.note || undefined,
    chapterTitle: r.chapter_title || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** Get all highlights across all books (for general chat without bookId) */
export async function getAllHighlights(limit = 50): Promise<Highlight[]> {
  const database = await getDB();
  const rows = await database.select<{
    id: string;
    book_id: string;
    cfi: string;
    text: string;
    color: string;
    note: string | null;
    chapter_title: string | null;
    created_at: number;
    updated_at: number;
  }>("SELECT * FROM highlights ORDER BY created_at DESC LIMIT ?", [limit]);
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    cfi: r.cfi,
    text: r.text,
    color: r.color as Highlight["color"],
    note: r.note || undefined,
    chapterTitle: r.chapter_title || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** Get all highlights with book info (JOIN query) */
export async function getAllHighlightsWithBooks(limit = 500): Promise<HighlightWithBook[]> {
  const database = await getDB();
  const rows = await database.select<{
    id: string;
    book_id: string;
    cfi: string;
    text: string;
    color: string;
    note: string | null;
    chapter_title: string | null;
    created_at: number;
    updated_at: number;
    book_title: string;
    book_author: string;
    book_cover_url: string | null;
  }>(
    `SELECT 
      h.id, h.book_id, h.cfi, h.text, h.color, h.note, h.chapter_title, h.created_at, h.updated_at,
      b.title as book_title, b.author as book_author, b.cover_url as book_cover_url
    FROM highlights h
    LEFT JOIN books b ON h.book_id = b.id
    ORDER BY h.created_at DESC
    LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    cfi: r.cfi,
    text: r.text,
    color: r.color as Highlight["color"],
    note: r.note || undefined,
    chapterTitle: r.chapter_title || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    bookTitle: r.book_title || "",
    bookAuthor: r.book_author || "",
    bookCoverUrl: r.book_cover_url || undefined,
  }));
}

/** Get highlight statistics */
export async function getHighlightStats(): Promise<{
  totalHighlights: number;
  highlightsWithNotes: number;
  totalBooks: number;
  colorDistribution: Record<string, number>;
  recentCount: number; // last 7 days
}> {
  const database = await getDB();

  const totalRows = await database.select<{ count: number }>(
    "SELECT COUNT(*) as count FROM highlights",
  );
  const notesRows = await database.select<{ count: number }>(
    "SELECT COUNT(*) as count FROM highlights WHERE note IS NOT NULL AND note != ''",
  );
  const booksRows = await database.select<{ count: number }>(
    "SELECT COUNT(DISTINCT book_id) as count FROM highlights",
  );

  const colorRows = await database.select<{ color: string; count: number }>(
    "SELECT color, COUNT(*) as count FROM highlights GROUP BY color",
  );
  const colorDistribution: Record<string, number> = {};
  for (const row of colorRows) {
    colorDistribution[row.color] = row.count;
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentRows = await database.select<{ count: number }>(
    "SELECT COUNT(*) as count FROM highlights WHERE created_at >= ?",
    [sevenDaysAgo],
  );

  return {
    totalHighlights: totalRows[0]?.count || 0,
    highlightsWithNotes: notesRows[0]?.count || 0,
    totalBooks: booksRows[0]?.count || 0,
    colorDistribution,
    recentCount: recentRows[0]?.count || 0,
  };
}

export async function insertHighlight(highlight: Highlight): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "highlights");
  await database.execute(
    "INSERT INTO highlights (id, book_id, cfi, text, color, note, chapter_title, created_at, updated_at, sync_version, last_modified_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      highlight.id,
      highlight.bookId,
      highlight.cfi,
      highlight.text,
      highlight.color,
      highlight.note || null,
      highlight.chapterTitle || null,
      highlight.createdAt,
      highlight.updatedAt,
      syncVersion,
      deviceId,
    ],
  );
}

export async function updateHighlight(id: string, updates: Partial<Highlight>): Promise<void> {
  const database = await getDB();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.color !== undefined) {
    sets.push("color = ?");
    values.push(updates.color);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "note")) {
    sets.push("note = ?");
    values.push(updates.note ?? null);
  }
  if (updates.text !== undefined) {
    sets.push("text = ?");
    values.push(updates.text);
  }
  // Add sync tracking
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "highlights");
  const updatedAt = await nextUpdatedAt(database, "highlights", id);
  sets.push("updated_at = ?");
  values.push(updatedAt);
  sets.push("sync_version = ?");
  values.push(syncVersion);
  sets.push("last_modified_by = ?");
  values.push(deviceId);

  if (sets.length === 0) return;
  values.push(id);
  await database.execute(`UPDATE highlights SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function deleteHighlight(id: string): Promise<void> {
  const database = await getDB();
  await insertTombstone(database, id, "highlights");
  await database.execute("DELETE FROM highlights WHERE id = ?", [id]);
}
