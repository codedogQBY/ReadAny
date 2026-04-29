import { getDB, getDeviceId, insertTombstone, nextSyncVersion, nextUpdatedAt } from "./db-core";

export interface ReviewItemRow {
  id: string;
  book_id: string;
  chapter_id: string;
  chapter_title: string;
  scheduled_date: number;
  completed_date: number | null;
  quality: string | null;
  status: string;
  review_count: number;
  next_review_date: number | null;
  notes: string | null;
}

export async function getReviewItems(bookId: string): Promise<ReviewItemRow[]> {
  const db = await getDB();
  return db.select<ReviewItemRow>(
    "SELECT * FROM review_items WHERE book_id = ? ORDER BY scheduled_date ASC",
    [bookId],
  );
}

export async function getDueReviewItems(): Promise<ReviewItemRow[]> {
  const db = await getDB();
  const now = Date.now();
  return db.select<ReviewItemRow>(
    "SELECT * FROM review_items WHERE status = 'pending' AND scheduled_date <= ? ORDER BY scheduled_date ASC",
    [now],
  );
}

export async function getUpcomingReviewItems(limit = 10): Promise<ReviewItemRow[]> {
  const db = await getDB();
  const now = Date.now();
  return db.select<ReviewItemRow>(
    "SELECT * FROM review_items WHERE status = 'pending' AND scheduled_date > ? ORDER BY scheduled_date ASC LIMIT ?",
    [now, limit],
  );
}

export async function getReviewItemStats(): Promise<{
  total: number;
  pending: number;
  due: number;
  completed: number;
  skipped: number;
}> {
  const db = await getDB();
  const now = Date.now();
  const total = (await db.select<{ cnt: number }>("SELECT COUNT(*) as cnt FROM review_items"))[0]?.cnt ?? 0;
  const pending = (await db.select<{ cnt: number }>("SELECT COUNT(*) as cnt FROM review_items WHERE status = 'pending'"))[0]?.cnt ?? 0;
  const due = (await db.select<{ cnt: number }>("SELECT COUNT(*) as cnt FROM review_items WHERE status = 'pending' AND scheduled_date <= ?", [now]))[0]?.cnt ?? 0;
  const completed = (await db.select<{ cnt: number }>("SELECT COUNT(*) as cnt FROM review_items WHERE status = 'completed'"))[0]?.cnt ?? 0;
  const skipped = (await db.select<{ cnt: number }>("SELECT COUNT(*) as cnt FROM review_items WHERE status = 'skipped'"))[0]?.cnt ?? 0;
  return { total, pending, due, completed, skipped };
}

export async function insertReviewItem(item: {
  id: string;
  bookId: string;
  chapterId: string;
  chapterTitle: string;
  scheduledDate: number;
  status?: string;
  reviewCount?: number;
}): Promise<void> {
  const db = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(db, "review_items");
  const updatedAt = Date.now();
  await db.execute(
    "INSERT OR REPLACE INTO review_items (id, book_id, chapter_id, chapter_title, scheduled_date, status, review_count, updated_at, sync_version, last_modified_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [item.id, item.bookId, item.chapterId, item.chapterTitle, item.scheduledDate, item.status || "pending", item.reviewCount || 0, updatedAt, syncVersion, deviceId],
  );
}

export async function updateReviewItem(
  id: string,
  updates: {
    scheduledDate?: number;
    completedDate?: number;
    quality?: string;
    status?: string;
    reviewCount?: number;
    nextReviewDate?: number;
    notes?: string;
  },
): Promise<void> {
  const db = await getDB();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.scheduledDate !== undefined) { sets.push("scheduled_date = ?"); values.push(updates.scheduledDate); }
  if (updates.completedDate !== undefined) { sets.push("completed_date = ?"); values.push(updates.completedDate); }
  if (updates.quality !== undefined) { sets.push("quality = ?"); values.push(updates.quality); }
  if (updates.status !== undefined) { sets.push("status = ?"); values.push(updates.status); }
  if (updates.reviewCount !== undefined) { sets.push("review_count = ?"); values.push(updates.reviewCount); }
  if (updates.nextReviewDate !== undefined) { sets.push("next_review_date = ?"); values.push(updates.nextReviewDate); }
  if (updates.notes !== undefined) { sets.push("notes = ?"); values.push(updates.notes); }

  if (sets.length === 0) return;

  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(db, "review_items");
  const updatedAt = await nextUpdatedAt(db, "review_items", id);
  sets.push("updated_at = ?"); values.push(updatedAt);
  sets.push("sync_version = ?"); values.push(syncVersion);
  sets.push("last_modified_by = ?"); values.push(deviceId);

  values.push(id);
  await db.execute(`UPDATE review_items SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function deleteReviewItem(id: string): Promise<void> {
  const db = await getDB();
  await insertTombstone(db, id, "review_items");
  await db.execute("DELETE FROM review_items WHERE id = ?", [id]);
}

export async function deleteReviewItemsByBookId(bookId: string): Promise<void> {
  const db = await getDB();
  const rows = await db.select<{ id: string }>("SELECT id FROM review_items WHERE book_id = ?", [bookId]);
  for (const row of rows) {
    await insertTombstone(db, row.id, "review_items");
  }
  await db.execute("DELETE FROM review_items WHERE book_id = ?", [bookId]);
}
