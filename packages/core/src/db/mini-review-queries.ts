import { getDB, getDeviceId, insertTombstone, nextSyncVersion /* , nextUpdatedAt */ } from "./db-core";

export interface MiniReviewRow {
  id: string;
  book_id: string;
  content: string;
  generated_at: number;
  rating: number | null;
  source: string | null;
  type: string | null;
  is_pinned: number | null;
}

export async function getMiniReview(bookId: string): Promise<MiniReviewRow | null> {
  const db = await getDB();
  const rows = await db.select<MiniReviewRow>(
    "SELECT * FROM mini_reviews WHERE book_id = ? ORDER BY generated_at DESC LIMIT 1",
    [bookId],
  );
  return rows[0] || null;
}

export async function getAllMiniReviews(): Promise<MiniReviewRow[]> {
  const db = await getDB();
  return db.select<MiniReviewRow>("SELECT * FROM mini_reviews ORDER BY generated_at DESC");
}

export async function insertMiniReview(review: {
  id: string;
  bookId: string;
  content: string;
  generatedAt: number;
  rating?: number;
  source?: string;
  type?: string;
  isPinned?: boolean;
}): Promise<void> {
  const db = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(db, "mini_reviews");
  const updatedAt = Date.now();
  await db.execute(
    "INSERT OR REPLACE INTO mini_reviews (id, book_id, content, generated_at, rating, source, type, is_pinned, updated_at, sync_version, last_modified_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      review.id,
      review.bookId,
      review.content,
      review.generatedAt,
      review.rating ?? null,
      review.source ?? null,
      review.type ?? "hook",
      review.isPinned ? 1 : 0,
      updatedAt,
      syncVersion,
      deviceId,
    ],
  );
}

export async function deleteMiniReview(id: string): Promise<void> {
  const db = await getDB();
  await insertTombstone(db, id, "mini_reviews");
  await db.execute("DELETE FROM mini_reviews WHERE id = ?", [id]);
}
