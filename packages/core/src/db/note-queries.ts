import type { Note } from "../types";
import {
  getDB,
  getDeviceId,
  insertTombstone,
  nextSyncVersion,
  nextUpdatedAt,
  parseJSON,
} from "./db-core";

export async function getNotes(bookId: string): Promise<Note[]> {
  const database = await getDB();
  const rows = await database.select<{
    id: string;
    book_id: string;
    highlight_id: string | null;
    cfi: string | null;
    title: string;
    content: string;
    chapter_title: string | null;
    tags: string;
    created_at: number;
    updated_at: number;
  }>("SELECT * FROM notes WHERE book_id = ? ORDER BY created_at DESC", [bookId]);
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    highlightId: r.highlight_id || undefined,
    cfi: r.cfi || undefined,
    title: r.title,
    content: r.content,
    chapterTitle: r.chapter_title || undefined,
    tags: parseJSON(r.tags, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** Get all notes across all books (for general chat without bookId) */
export async function getAllNotes(limit = 50): Promise<Note[]> {
  const database = await getDB();
  const rows = await database.select<{
    id: string;
    book_id: string;
    highlight_id: string | null;
    cfi: string | null;
    title: string;
    content: string;
    chapter_title: string | null;
    tags: string;
    created_at: number;
    updated_at: number;
  }>("SELECT * FROM notes ORDER BY created_at DESC LIMIT ?", [limit]);
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    highlightId: r.highlight_id || undefined,
    cfi: r.cfi || undefined,
    title: r.title,
    content: r.content,
    chapterTitle: r.chapter_title || undefined,
    tags: parseJSON(r.tags, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function insertNote(note: Note): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "notes");
  await database.execute(
    "INSERT INTO notes (id, book_id, highlight_id, cfi, title, content, chapter_title, tags, created_at, updated_at, sync_version, last_modified_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      note.id,
      note.bookId,
      note.highlightId || null,
      note.cfi || null,
      note.title,
      note.content,
      note.chapterTitle || null,
      JSON.stringify(note.tags),
      note.createdAt,
      note.updatedAt,
      syncVersion,
      deviceId,
    ],
  );
}

export async function updateNote(id: string, updates: Partial<Note>): Promise<void> {
  const database = await getDB();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    sets.push("title = ?");
    values.push(updates.title);
  }
  if (updates.content !== undefined) {
    sets.push("content = ?");
    values.push(updates.content);
  }
  if (updates.tags !== undefined) {
    sets.push("tags = ?");
    values.push(JSON.stringify(updates.tags));
  }
  // Add sync tracking
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "notes");
  const updatedAt = await nextUpdatedAt(database, "notes", id);
  sets.push("updated_at = ?");
  values.push(updatedAt);
  sets.push("sync_version = ?");
  values.push(syncVersion);
  sets.push("last_modified_by = ?");
  values.push(deviceId);

  if (sets.length === 0) return;
  values.push(id);
  await database.execute(`UPDATE notes SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function deleteNote(id: string): Promise<void> {
  const database = await getDB();
  await insertTombstone(database, id, "notes");
  await database.execute("DELETE FROM notes WHERE id = ?", [id]);
}
