import type { Book } from "../types";
import { deleteChunks } from "./chunk-queries";
import {
  getDB,
  getDeviceId,
  insertTombstone,
  nextSyncVersion,
  nextUpdatedAt,
  parseJSON,
} from "./db-core";
import { deleteThreadsByBookId } from "./thread-queries";

interface BookRow {
  id: string;
  file_path: string;
  format: string;
  title: string;
  author: string;
  publisher: string | null;
  language: string | null;
  isbn: string | null;
  description: string | null;
  cover_url: string | null;
  publish_date: string | null;
  subjects: string | null;
  total_pages: number;
  total_chapters: number;
  group_id: string | null;
  added_at: number;
  last_opened_at: number | null;
  updated_at: number;
  deleted_at: number | null;
  progress: number;
  current_cfi: string | null;
  is_vectorized: number;
  vectorize_progress: number;
  tags: string;
  file_hash: string | null;
  sync_status: string;
}

function rowToBook(row: BookRow): Book {
  return {
    id: row.id,
    filePath: row.file_path,
    format: (row.format as Book["format"]) || "epub",
    meta: {
      title: row.title,
      author: row.author,
      publisher: row.publisher || undefined,
      language: row.language || undefined,
      isbn: row.isbn || undefined,
      description: row.description || undefined,
      coverUrl: row.cover_url || undefined,
      publishDate: row.publish_date || undefined,
      subjects: parseJSON(row.subjects, undefined),
      totalPages: row.total_pages || undefined,
      totalChapters: row.total_chapters || undefined,
    },
    groupId: row.group_id || undefined,
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at || undefined,
    updatedAt: row.updated_at || row.added_at,
    deletedAt: row.deleted_at || undefined,
    progress: row.progress,
    currentCfi: row.current_cfi || undefined,
    isVectorized: row.is_vectorized === 1,
    vectorizeProgress: row.vectorize_progress,
    tags: parseJSON(row.tags, []),
    fileHash: row.file_hash || undefined,
    syncStatus: (row.sync_status as Book["syncStatus"]) || "local",
  };
}

export interface GetBooksOptions {
  includeDeleted?: boolean;
}

export interface DeleteBookOptions {
  preserveData?: boolean;
}

function isMissingDeletedAtColumnError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return /no such column:\s*deleted_at/i.test(message);
}

export async function getDeletedBookByFileHash(fileHash: string): Promise<Book | null> {
  const database = await getDB();
  try {
    const rows = await database.select<BookRow>(
      "SELECT * FROM books WHERE file_hash = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 1",
      [fileHash],
    );
    return rows.length > 0 ? rowToBook(rows[0]) : null;
  } catch (error) {
    if (isMissingDeletedAtColumnError(error)) {
      return null;
    }
    throw error;
  }
}

export async function getDeletedBookByTitle(title: string): Promise<Book | null> {
  const database = await getDB();
  try {
    // Try exact match first, then LIKE match for slight differences
    let rows = await database.select<BookRow>(
      "SELECT * FROM books WHERE title = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 1",
      [title],
    );
    if (rows.length === 0) {
      // Fuzzy: strip non-alphanum and search with LIKE
      const simplified = title.replace(/[^\p{L}\p{N}]+/gu, "%");
      rows = await database.select<BookRow>(
        "SELECT * FROM books WHERE title LIKE ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 1",
        [`%${simplified}%`],
      );
    }
    return rows.length > 0 ? rowToBook(rows[0]) : null;
  } catch (error) {
    if (isMissingDeletedAtColumnError(error)) {
      return null;
    }
    throw error;
  }
}

export async function getBooks(options: GetBooksOptions = {}): Promise<Book[]> {
  const database = await getDB();
  const sql = options.includeDeleted
    ? "SELECT * FROM books ORDER BY last_opened_at DESC, added_at DESC"
    : "SELECT * FROM books WHERE deleted_at IS NULL ORDER BY last_opened_at DESC, added_at DESC";
  let rows: BookRow[];
  try {
    rows = await database.select<BookRow>(sql);
  } catch (error) {
    if (!isMissingDeletedAtColumnError(error)) throw error;
    rows = await database.select<BookRow>(
      "SELECT * FROM books ORDER BY last_opened_at DESC, added_at DESC",
    );
  }
  return rows.map(rowToBook);
}

export async function getBook(id: string, options: GetBooksOptions = {}): Promise<Book | null> {
  const database = await getDB();
  const sql = options.includeDeleted
    ? "SELECT * FROM books WHERE id = ?"
    : "SELECT * FROM books WHERE id = ? AND deleted_at IS NULL";
  let rows: BookRow[];
  try {
    rows = await database.select<BookRow>(sql, [id]);
  } catch (error) {
    if (!isMissingDeletedAtColumnError(error)) throw error;
    rows = await database.select<BookRow>("SELECT * FROM books WHERE id = ?", [id]);
  }
  return rows.length > 0 ? rowToBook(rows[0]) : null;
}

export async function insertBook(book: Book): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "books");
  const now = Date.now();
  await database.execute(
    `INSERT INTO books (id, file_path, format, title, author, publisher, language, isbn, description, cover_url, publish_date, subjects, total_pages, total_chapters, group_id, added_at, last_opened_at, updated_at, deleted_at, progress, current_cfi, is_vectorized, vectorize_progress, tags, file_hash, sync_status, sync_version, last_modified_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      book.id,
      book.filePath,
      book.format || "epub",
      book.meta.title,
      book.meta.author,
      book.meta.publisher || null,
      book.meta.language || null,
      book.meta.isbn || null,
      book.meta.description || null,
      book.meta.coverUrl || null,
      book.meta.publishDate || null,
      book.meta.subjects ? JSON.stringify(book.meta.subjects) : null,
      book.meta.totalPages || 0,
      book.meta.totalChapters || 0,
      book.groupId || null,
      book.addedAt,
      book.lastOpenedAt || null,
      now,
      book.deletedAt || null,
      book.progress,
      book.currentCfi || null,
      book.isVectorized ? 1 : 0,
      book.vectorizeProgress,
      JSON.stringify(book.tags),
      book.fileHash || null,
      book.syncStatus || "local",
      syncVersion,
      deviceId,
    ],
  );
}

export async function updateBook(id: string, updates: Partial<Book>): Promise<void> {
  const database = await getDB();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.filePath !== undefined) {
    sets.push("file_path = ?");
    values.push(updates.filePath);
  }
  if (updates.meta?.title !== undefined) {
    sets.push("title = ?");
    values.push(updates.meta.title);
  }
  if (updates.meta?.author !== undefined) {
    sets.push("author = ?");
    values.push(updates.meta.author);
  }
  if (updates.meta?.coverUrl !== undefined) {
    sets.push("cover_url = ?");
    values.push(updates.meta.coverUrl || null);
  }
  if (updates.meta?.publisher !== undefined) {
    sets.push("publisher = ?");
    values.push(updates.meta.publisher || null);
  }
  if (updates.meta?.description !== undefined) {
    sets.push("description = ?");
    values.push(updates.meta.description || null);
  }
  if (updates.meta?.language !== undefined) {
    sets.push("language = ?");
    values.push(updates.meta.language || null);
  }
  if (updates.meta?.totalPages !== undefined) {
    sets.push("total_pages = ?");
    values.push(updates.meta.totalPages);
  }
  if (updates.format !== undefined) {
    sets.push("format = ?");
    values.push(updates.format);
  }
  if (updates.progress !== undefined) {
    sets.push("progress = ?");
    values.push(updates.progress);
  }
  if (updates.currentCfi !== undefined) {
    sets.push("current_cfi = ?");
    values.push(updates.currentCfi);
  }
  if (updates.lastOpenedAt !== undefined) {
    sets.push("last_opened_at = ?");
    values.push(updates.lastOpenedAt);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "deletedAt")) {
    sets.push("deleted_at = ?");
    values.push(updates.deletedAt ?? null);
  }
  if (updates.isVectorized !== undefined) {
    sets.push("is_vectorized = ?");
    values.push(updates.isVectorized ? 1 : 0);
  }
  if (updates.vectorizeProgress !== undefined) {
    sets.push("vectorize_progress = ?");
    values.push(updates.vectorizeProgress);
  }
  if (updates.tags !== undefined) {
    sets.push("tags = ?");
    values.push(JSON.stringify(updates.tags));
  }
  if (Object.prototype.hasOwnProperty.call(updates, "groupId")) {
    sets.push("group_id = ?");
    values.push(updates.groupId || null);
  }
  if (updates.fileHash !== undefined) {
    sets.push("file_hash = ?");
    values.push(updates.fileHash);
  }
  if (updates.syncStatus !== undefined) {
    sets.push("sync_status = ?");
    values.push(updates.syncStatus);
  }

  if (sets.length === 0) return;

  // Add sync tracking fields
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "books");
  const updatedAt = await nextUpdatedAt(database, "books", id);
  sets.push("updated_at = ?");
  values.push(updatedAt);
  sets.push("sync_version = ?");
  values.push(syncVersion);
  sets.push("last_modified_by = ?");
  values.push(deviceId);

  values.push(id);
  await database.execute(`UPDATE books SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function setBookSyncStatus(id: string, syncStatus: Book["syncStatus"]): Promise<void> {
  const database = await getDB();
  await database.execute("UPDATE books SET sync_status = ? WHERE id = ?", [syncStatus, id]);
}

export async function deleteBook(id: string, options: DeleteBookOptions = {}): Promise<void> {
  const database = await getDB();
  const preserveData = options.preserveData ?? false;

  if (preserveData) {
    const deletedAt = Date.now();

    // Keep notes/highlights/bookmarks and reading sessions, but remove chat
    // threads and vector chunks tied to the deleted book payload.
    await deleteThreadsByBookId(id);
    await deleteChunks(id);

    const deviceId = await getDeviceId();
    const syncVersion = await nextSyncVersion(database, "books");
    const updatedAt = await nextUpdatedAt(database, "books", id);
    await database.execute(
      `UPDATE books
       SET deleted_at = ?, is_vectorized = 0, vectorize_progress = 0,
           updated_at = ?, sync_version = ?, last_modified_by = ?
       WHERE id = ?`,
      [deletedAt, updatedAt, syncVersion, deviceId, id],
    );
    return;
  }

  const [highlightRows, noteRows, bookmarkRows] = await Promise.all([
    database.select<{ id: string }>("SELECT id FROM highlights WHERE book_id = ?", [id]),
    database.select<{ id: string }>("SELECT id FROM notes WHERE book_id = ?", [id]),
    database.select<{ id: string }>("SELECT id FROM bookmarks WHERE book_id = ?", [id]),
  ]);

  for (const row of highlightRows) {
    await insertTombstone(database, row.id, "highlights");
  }
  for (const row of noteRows) {
    await insertTombstone(database, row.id, "notes");
  }
  for (const row of bookmarkRows) {
    await insertTombstone(database, row.id, "bookmarks");
  }

  await database.execute("DELETE FROM highlights WHERE book_id = ?", [id]);
  await database.execute("DELETE FROM notes WHERE book_id = ?", [id]);
  await database.execute("DELETE FROM bookmarks WHERE book_id = ?", [id]);
  await database.execute("DELETE FROM reading_sessions WHERE book_id = ?", [id]);
  await deleteThreadsByBookId(id);
  await deleteChunks(id);
  await insertTombstone(database, id, "books");
  await database.execute("DELETE FROM books WHERE id = ?", [id]);
}
