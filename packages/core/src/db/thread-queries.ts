import type { Thread } from "../types";
import { getDB, getDeviceId, insertTombstone, nextSyncVersion, nextUpdatedAt } from "./db-core";
import { getMessages } from "./message-queries";

export async function getThreads(bookId?: string): Promise<Thread[]> {
  const database = await getDB();
  const rows = bookId
    ? await database.select<{
        id: string;
        book_id: string | null;
        title: string;
        created_at: number;
        updated_at: number;
      }>("SELECT * FROM threads WHERE book_id = ? ORDER BY updated_at DESC", [bookId])
    : await database.select<{
        id: string;
        book_id: string | null;
        title: string;
        created_at: number;
        updated_at: number;
      }>("SELECT * FROM threads ORDER BY updated_at DESC");

  const threads: Thread[] = [];
  for (const row of rows) {
    const messages = await getMessages(row.id);
    threads.push({
      id: row.id,
      bookId: row.book_id || undefined,
      title: row.title,
      messages,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
  return threads;
}

export async function getThread(id: string): Promise<Thread | null> {
  const database = await getDB();
  const rows = await database.select<{
    id: string;
    book_id: string | null;
    title: string;
    created_at: number;
    updated_at: number;
  }>("SELECT * FROM threads WHERE id = ?", [id]);
  if (rows.length === 0) return null;

  const row = rows[0];
  const messages = await getMessages(row.id);
  return {
    id: row.id,
    bookId: row.book_id || undefined,
    title: row.title,
    messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertThread(thread: Thread): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "threads");
  await database.execute(
    "INSERT INTO threads (id, book_id, title, created_at, updated_at, sync_version, last_modified_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      thread.id,
      thread.bookId || null,
      thread.title,
      thread.createdAt,
      thread.updatedAt,
      syncVersion,
      deviceId,
    ],
  );
}

export async function updateThreadTitle(id: string, title: string): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "threads");
  const updatedAt = await nextUpdatedAt(database, "threads", id);
  await database.execute(
    "UPDATE threads SET title = ?, updated_at = ?, sync_version = ?, last_modified_by = ? WHERE id = ?",
    [title, updatedAt, syncVersion, deviceId, id],
  );
}

export async function deleteThread(id: string): Promise<void> {
  const database = await getDB();
  // Get all message IDs in this thread for tombstones
  const messages = await database.select<{ id: string }>(
    "SELECT id FROM messages WHERE thread_id = ?",
    [id],
  );
  for (const msg of messages) {
    await insertTombstone(database, msg.id, "messages");
  }
  await insertTombstone(database, id, "threads");
  await database.execute("DELETE FROM messages WHERE thread_id = ?", [id]);
  await database.execute("DELETE FROM threads WHERE id = ?", [id]);
}

export async function deleteThreadsByBookId(bookId: string): Promise<void> {
  const database = await getDB();
  // Get all thread IDs for this book
  const threads = await database.select<{ id: string }>(
    "SELECT id FROM threads WHERE book_id = ?",
    [bookId],
  );
  // Delete each thread (this handles messages and tombstones)
  for (const thread of threads) {
    await deleteThread(thread.id);
  }
}
