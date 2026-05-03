import type { Bookmark } from "../types";
import { getDB, getDeviceId, insertTombstone, nextSyncVersion } from "./db-core";

export async function getBookmarks(bookId: string): Promise<Bookmark[]> {
  const database = await getDB();
  const rows = await database.select<{
    id: string;
    book_id: string;
    cfi: string;
    label: string | null;
    chapter_title: string | null;
    created_at: number;
  }>("SELECT * FROM bookmarks WHERE book_id = ? ORDER BY created_at DESC", [bookId]);
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    cfi: r.cfi,
    label: r.label || undefined,
    chapterTitle: r.chapter_title || undefined,
    createdAt: r.created_at,
  }));
}

export async function insertBookmark(bookmark: Bookmark): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "bookmarks");
  const updatedAt = Math.max(Date.now(), bookmark.createdAt);
  await database.execute(
    "INSERT INTO bookmarks (id, book_id, cfi, label, chapter_title, created_at, updated_at, sync_version, last_modified_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      bookmark.id,
      bookmark.bookId,
      bookmark.cfi,
      bookmark.label || null,
      bookmark.chapterTitle || null,
      bookmark.createdAt,
      updatedAt,
      syncVersion,
      deviceId,
    ],
  );
}

export async function deleteBookmark(id: string): Promise<void> {
  const database = await getDB();
  await insertTombstone(database, id, "bookmarks");
  await database.execute("DELETE FROM bookmarks WHERE id = ?", [id]);
}
