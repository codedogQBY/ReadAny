import {
  type BookMemory,
  type BookMemoryExchange,
  createEmptyBookMemory,
  mergeBookMemoryExchange,
} from "../ai/book-memory";
import { getDB, getDeviceId, nextSyncVersion, parseJSON } from "./db-core";

type BookMemoryRow = {
  book_id: string;
  summary: string;
  focus: string | null;
  open_questions: string | null;
  recent_questions: string | null;
  last_chapter_title: string | null;
  last_chapter_index: number | null;
  last_position_percent: number | null;
  total_messages: number;
  last_compacted_at: number;
  compacted_message_count: number | null;
  updated_at: number;
};

export async function getBookMemory(bookId: string): Promise<BookMemory | null> {
  const database = await getDB();
  await ensureBookMemoryTable(database);
  const rows = await database.select<BookMemoryRow>(
    "SELECT * FROM book_memories WHERE book_id = ?",
    [bookId],
  );
  if (rows.length === 0) return null;
  return rowToBookMemory(rows[0]);
}

export async function upsertBookMemory(memory: BookMemory): Promise<void> {
  const database = await getDB();
  await ensureBookMemoryTable(database);
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "book_memories");
  await database.execute(
    `INSERT INTO book_memories (
      book_id, summary, focus, open_questions, recent_questions,
      last_chapter_title, last_chapter_index, last_position_percent,
      total_messages, last_compacted_at, compacted_message_count,
      updated_at, sync_version, last_modified_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id) DO UPDATE SET
      summary = excluded.summary,
      focus = excluded.focus,
      open_questions = excluded.open_questions,
      recent_questions = excluded.recent_questions,
      last_chapter_title = excluded.last_chapter_title,
      last_chapter_index = excluded.last_chapter_index,
      last_position_percent = excluded.last_position_percent,
      total_messages = excluded.total_messages,
      last_compacted_at = excluded.last_compacted_at,
      compacted_message_count = excluded.compacted_message_count,
      updated_at = excluded.updated_at,
      sync_version = excluded.sync_version,
      last_modified_by = excluded.last_modified_by`,
    [
      memory.bookId,
      memory.summary,
      JSON.stringify(memory.focus),
      JSON.stringify(memory.openQuestions),
      JSON.stringify(memory.recentQuestions),
      memory.lastChapterTitle || null,
      memory.lastChapterIndex ?? null,
      memory.lastPositionPercent ?? null,
      memory.totalMessages,
      memory.lastCompactedAt,
      memory.compactedMessageCount,
      memory.updatedAt,
      syncVersion,
      deviceId,
    ],
  );
}

export async function updateBookMemoryAfterExchange(
  bookId: string,
  exchange: BookMemoryExchange,
): Promise<BookMemory> {
  const current = (await getBookMemory(bookId)) ?? createEmptyBookMemory(bookId);
  const merged = mergeBookMemoryExchange(current, exchange);
  const next = { ...merged, bookId };
  await upsertBookMemory(next);
  return next;
}

async function ensureBookMemoryTable(database: Awaited<ReturnType<typeof getDB>>): Promise<void> {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS book_memories (
      book_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL DEFAULT '',
      focus TEXT NOT NULL DEFAULT '[]',
      open_questions TEXT NOT NULL DEFAULT '[]',
      recent_questions TEXT NOT NULL DEFAULT '[]',
      last_chapter_title TEXT,
      last_chapter_index INTEGER,
      last_position_percent REAL,
      total_messages INTEGER NOT NULL DEFAULT 0,
      last_compacted_at INTEGER NOT NULL DEFAULT 0,
      compacted_message_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      sync_version INTEGER DEFAULT 0,
      last_modified_by TEXT,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )
  `);
  try {
    await database.execute(
      "ALTER TABLE book_memories ADD COLUMN compacted_message_count INTEGER NOT NULL DEFAULT 0",
    );
  } catch {
    // Column already exists.
  }
}

function rowToBookMemory(row: BookMemoryRow): BookMemory {
  return {
    bookId: row.book_id,
    summary: row.summary || "",
    focus: parseJSON<string[]>(row.focus, []),
    openQuestions: parseJSON<string[]>(row.open_questions, []),
    recentQuestions: parseJSON<string[]>(row.recent_questions, []),
    lastChapterTitle: row.last_chapter_title || undefined,
    lastChapterIndex: row.last_chapter_index ?? undefined,
    lastPositionPercent: row.last_position_percent ?? undefined,
    totalMessages: row.total_messages || 0,
    lastCompactedAt: row.last_compacted_at || 0,
    compactedMessageCount: row.compacted_message_count ?? 0,
    updatedAt: row.updated_at || 0,
  };
}
