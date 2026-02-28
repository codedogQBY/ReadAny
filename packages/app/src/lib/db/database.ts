/**
 * Database access layer — wraps Tauri SQL plugin
 * Full implementation with actual SQL queries
 */
import type { Book, Bookmark, Chunk, Highlight, Message, Note, Skill, Thread } from "@/types";
import type { ReadingSession } from "@/types/reading";

// Lazy-loaded database instance
let db: Awaited<ReturnType<typeof import("@tauri-apps/plugin-sql").default.load>> | null = null;
let dbInitialized = false;

const DB_NAME = "sqlite:readany.db";

async function getDB() {
  if (!db) {
    const Database = (await import("@tauri-apps/plugin-sql")).default;
    db = await Database.load(DB_NAME);
  }
  return db;
}

/** Initialize the database, creating tables if needed */
export async function initDatabase(): Promise<void> {
  if (dbInitialized) return;

  const database = await getDB();

  // Create tables
  await database.execute(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'epub',
      title TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      publisher TEXT,
      language TEXT,
      isbn TEXT,
      description TEXT,
      cover_url TEXT,
      publish_date TEXT,
      subjects TEXT,
      total_pages INTEGER DEFAULT 0,
      total_chapters INTEGER DEFAULT 0,
      added_at INTEGER NOT NULL,
      last_opened_at INTEGER,
      progress REAL DEFAULT 0,
      current_cfi TEXT,
      is_vectorized INTEGER DEFAULT 0,
      vectorize_progress REAL DEFAULT 0,
      tags TEXT DEFAULT '[]'
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      cfi TEXT NOT NULL,
      text TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'yellow',
      note TEXT,
      chapter_title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      highlight_id TEXT,
      cfi TEXT,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      chapter_title TEXT,
      tags TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      cfi TEXT NOT NULL,
      label TEXT,
      chapter_title TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      book_id TEXT,
      title TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      citations TEXT,
      tool_calls TEXT,
      reasoning TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      total_active_time INTEGER DEFAULT 0,
      pages_read INTEGER DEFAULT 0,
      state TEXT DEFAULT 'active',
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      chapter_title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      start_cfi TEXT,
      end_cfi TEXT,
      embedding BLOB,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT,
      enabled INTEGER DEFAULT 1,
      parameters TEXT DEFAULT '[]',
      prompt TEXT DEFAULT '',
      built_in INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Create indexes
  await database.execute("CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id)");
  await database.execute("CREATE INDEX IF NOT EXISTS idx_notes_book ON notes(book_id)");
  await database.execute("CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id)");
  await database.execute("CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)");
  await database.execute("CREATE INDEX IF NOT EXISTS idx_chunks_book ON chunks(book_id)");
  await database.execute(
    "CREATE INDEX IF NOT EXISTS idx_reading_sessions_book ON reading_sessions(book_id)",
  );

  // Migrations: add columns that may be missing from older schema versions
  try {
    await database.execute("ALTER TABLE books ADD COLUMN format TEXT NOT NULL DEFAULT 'epub'");
  } catch {
    // Column already exists, ignore
  }
  try {
    await database.execute("ALTER TABLE books ADD COLUMN tags TEXT DEFAULT '[]'");
  } catch {
    // Column already exists, ignore
  }
  try {
    await database.execute("ALTER TABLE messages ADD COLUMN reasoning TEXT");
  } catch {
    // Column already exists, ignore
  }
  try {
    await database.execute("ALTER TABLE messages ADD COLUMN parts_order TEXT");
  } catch {
    // Column already exists, ignore
  }

  dbInitialized = true;
}

// --- Serialization helpers ---

function serializeEmbedding(embedding?: number[]): Uint8Array | null {
  if (!embedding || embedding.length === 0) return null;
  const buffer = new ArrayBuffer(embedding.length * 4);
  const view = new Float32Array(buffer);
  for (let i = 0; i < embedding.length; i++) {
    view[i] = embedding[i];
  }
  return new Uint8Array(buffer);
}

function deserializeEmbedding(data: unknown): number[] | undefined {
  if (!data) return undefined;
  // Data comes as an array of bytes from the SQL plugin
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
  if (bytes.length === 0) return undefined;
  const view = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return Array.from(view);
}

function parseJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

// --- Books ---

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
  added_at: number;
  last_opened_at: number | null;
  progress: number;
  current_cfi: string | null;
  is_vectorized: number;
  vectorize_progress: number;
  tags: string;
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
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at || undefined,
    progress: row.progress,
    currentCfi: row.current_cfi || undefined,
    isVectorized: row.is_vectorized === 1,
    vectorizeProgress: row.vectorize_progress,
    tags: parseJSON(row.tags, []),
  };
}

export async function getBooks(): Promise<Book[]> {
  const database = await getDB();
  const rows = await database.select<BookRow[]>(
    "SELECT * FROM books ORDER BY last_opened_at DESC, added_at DESC",
  );
  return rows.map(rowToBook);
}

export async function getBook(id: string): Promise<Book | null> {
  const database = await getDB();
  const rows = await database.select<BookRow[]>("SELECT * FROM books WHERE id = ?", [id]);
  return rows.length > 0 ? rowToBook(rows[0]) : null;
}

export async function insertBook(book: Book): Promise<void> {
  const database = await getDB();
  await database.execute(
    `INSERT INTO books (id, file_path, format, title, author, publisher, language, isbn, description, cover_url, publish_date, subjects, total_pages, total_chapters, added_at, last_opened_at, progress, current_cfi, is_vectorized, vectorize_progress, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      book.addedAt,
      book.lastOpenedAt || null,
      book.progress,
      book.currentCfi || null,
      book.isVectorized ? 1 : 0,
      book.vectorizeProgress,
      JSON.stringify(book.tags),
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

  if (sets.length === 0) return;

  values.push(id);
  await database.execute(`UPDATE books SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function deleteBook(id: string): Promise<void> {
  const database = await getDB();
  await database.execute("DELETE FROM books WHERE id = ?", [id]);
}

// --- Highlights ---

interface HighlightRow {
  id: string;
  book_id: string;
  cfi: string;
  text: string;
  color: string;
  note: string | null;
  chapter_title: string | null;
  created_at: number;
  updated_at: number;
}

export async function getHighlights(bookId: string): Promise<Highlight[]> {
  const database = await getDB();
  const rows = await database.select<HighlightRow[]>(
    "SELECT * FROM highlights WHERE book_id = ? ORDER BY created_at DESC",
    [bookId],
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
  }));
}

export async function insertHighlight(highlight: Highlight): Promise<void> {
  const database = await getDB();
  await database.execute(
    "INSERT INTO highlights (id, book_id, cfi, text, color, note, chapter_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
  if (updates.note !== undefined) {
    sets.push("note = ?");
    values.push(updates.note);
  }
  if (updates.text !== undefined) {
    sets.push("text = ?");
    values.push(updates.text);
  }
  sets.push("updated_at = ?");
  values.push(Date.now());

  if (sets.length === 0) return;
  values.push(id);
  await database.execute(`UPDATE highlights SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function deleteHighlight(id: string): Promise<void> {
  const database = await getDB();
  await database.execute("DELETE FROM highlights WHERE id = ?", [id]);
}

// --- Notes ---

export async function getNotes(bookId: string): Promise<Note[]> {
  const database = await getDB();
  const rows = await database.select<
    Array<{
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
    }>
  >("SELECT * FROM notes WHERE book_id = ? ORDER BY created_at DESC", [bookId]);
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
  await database.execute(
    "INSERT INTO notes (id, book_id, highlight_id, cfi, title, content, chapter_title, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
  sets.push("updated_at = ?");
  values.push(Date.now());

  if (sets.length === 0) return;
  values.push(id);
  await database.execute(`UPDATE notes SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function deleteNote(id: string): Promise<void> {
  const database = await getDB();
  await database.execute("DELETE FROM notes WHERE id = ?", [id]);
}

// --- Bookmarks ---

export async function getBookmarks(bookId: string): Promise<Bookmark[]> {
  const database = await getDB();
  const rows = await database.select<
    Array<{
      id: string;
      book_id: string;
      cfi: string;
      label: string | null;
      chapter_title: string | null;
      created_at: number;
    }>
  >("SELECT * FROM bookmarks WHERE book_id = ? ORDER BY created_at DESC", [bookId]);
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
  await database.execute(
    "INSERT INTO bookmarks (id, book_id, cfi, label, chapter_title, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      bookmark.id,
      bookmark.bookId,
      bookmark.cfi,
      bookmark.label || null,
      bookmark.chapterTitle || null,
      bookmark.createdAt,
    ],
  );
}

export async function deleteBookmark(id: string): Promise<void> {
  const database = await getDB();
  await database.execute("DELETE FROM bookmarks WHERE id = ?", [id]);
}

// --- Threads ---

export async function getThreads(bookId?: string): Promise<Thread[]> {
  const database = await getDB();
  const rows = bookId
    ? await database.select<
        Array<{
          id: string;
          book_id: string | null;
          title: string;
          created_at: number;
          updated_at: number;
        }>
      >("SELECT * FROM threads WHERE book_id = ? ORDER BY updated_at DESC", [bookId])
    : await database.select<
        Array<{
          id: string;
          book_id: string | null;
          title: string;
          created_at: number;
          updated_at: number;
        }>
      >("SELECT * FROM threads ORDER BY updated_at DESC");

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
  const rows = await database.select<
    Array<{
      id: string;
      book_id: string | null;
      title: string;
      created_at: number;
      updated_at: number;
    }>
  >("SELECT * FROM threads WHERE id = ?", [id]);
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
  await database.execute(
    "INSERT INTO threads (id, book_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [thread.id, thread.bookId || null, thread.title, thread.createdAt, thread.updatedAt],
  );
}

export async function updateThreadTitle(id: string, title: string): Promise<void> {
  const database = await getDB();
  await database.execute("UPDATE threads SET title = ?, updated_at = ? WHERE id = ?", [
    title,
    Date.now(),
    id,
  ]);
}

export async function deleteThread(id: string): Promise<void> {
  const database = await getDB();
  await database.execute("DELETE FROM messages WHERE thread_id = ?", [id]);
  await database.execute("DELETE FROM threads WHERE id = ?", [id]);
}

// --- Messages ---

export async function getMessages(threadId: string): Promise<Message[]> {
  const database = await getDB();
  const rows = await database.select<
    Array<{
      id: string;
      thread_id: string;
      role: string;
      content: string;
      citations: string | null;
      tool_calls: string | null;
      reasoning: string | null;
      parts_order: string | null;
      created_at: number;
    }>
  >("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC", [threadId]);
  return rows.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    role: r.role as Message["role"],
    content: r.content,
    citations: parseJSON(r.citations, undefined),
    toolCalls: parseJSON(r.tool_calls, undefined),
    reasoning: parseJSON(r.reasoning, undefined),
    partsOrder: parseJSON(r.parts_order, undefined),
    createdAt: r.created_at,
  }));
}

export async function insertMessage(message: Message): Promise<void> {
  const database = await getDB();
  await database.execute(
    "INSERT INTO messages (id, thread_id, role, content, citations, tool_calls, reasoning, parts_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      message.id,
      message.threadId,
      message.role,
      message.content,
      message.citations ? JSON.stringify(message.citations) : null,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.reasoning ? JSON.stringify(message.reasoning) : null,
      (message as any).partsOrder ? JSON.stringify((message as any).partsOrder) : null,
      message.createdAt,
    ],
  );
}

// --- Reading Sessions ---

export async function getReadingSessions(bookId: string): Promise<ReadingSession[]> {
  const database = await getDB();
  const rows = await database.select<
    Array<{
      id: string;
      book_id: string;
      started_at: number;
      ended_at: number | null;
      total_active_time: number;
      pages_read: number;
      state: string;
    }>
  >("SELECT * FROM reading_sessions WHERE book_id = ? ORDER BY started_at DESC", [bookId]);
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    startedAt: r.started_at,
    endedAt: r.ended_at || undefined,
    totalActiveTime: r.total_active_time,
    pagesRead: r.pages_read,
    state: r.state as ReadingSession["state"],
  }));
}

export async function getReadingSessionsByDateRange(
  startDate: Date,
  endDate: Date,
): Promise<ReadingSession[]> {
  const database = await getDB();
  const rows = await database.select<
    Array<{
      id: string;
      book_id: string;
      started_at: number;
      ended_at: number | null;
      total_active_time: number;
      pages_read: number;
      state: string;
    }>
  >(
    "SELECT * FROM reading_sessions WHERE started_at >= ? AND started_at <= ? ORDER BY started_at DESC",
    [startDate.getTime(), endDate.getTime()],
  );
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    startedAt: r.started_at,
    endedAt: r.ended_at || undefined,
    totalActiveTime: r.total_active_time,
    pagesRead: r.pages_read,
    state: r.state as ReadingSession["state"],
  }));
}

export async function insertReadingSession(session: ReadingSession): Promise<void> {
  const database = await getDB();
  await database.execute(
    "INSERT INTO reading_sessions (id, book_id, started_at, ended_at, total_active_time, pages_read, state) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      session.id,
      session.bookId,
      session.startedAt,
      session.endedAt || null,
      session.totalActiveTime,
      session.pagesRead,
      session.state,
    ],
  );
}

export async function updateReadingSession(
  id: string,
  updates: Partial<ReadingSession>,
): Promise<void> {
  const database = await getDB();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.endedAt !== undefined) {
    sets.push("ended_at = ?");
    values.push(updates.endedAt);
  }
  if (updates.totalActiveTime !== undefined) {
    sets.push("total_active_time = ?");
    values.push(updates.totalActiveTime);
  }
  if (updates.pagesRead !== undefined) {
    sets.push("pages_read = ?");
    values.push(updates.pagesRead);
  }
  if (updates.state !== undefined) {
    sets.push("state = ?");
    values.push(updates.state);
  }

  if (sets.length === 0) return;
  values.push(id);
  await database.execute(`UPDATE reading_sessions SET ${sets.join(", ")} WHERE id = ?`, values);
}

// --- Chunks ---

export async function getChunks(bookId: string): Promise<Chunk[]> {
  const database = await getDB();
  const rows = await database.select<
    Array<{
      id: string;
      book_id: string;
      chapter_index: number;
      chapter_title: string;
      content: string;
      token_count: number;
      start_cfi: string | null;
      end_cfi: string | null;
      embedding: unknown;
    }>
  >("SELECT * FROM chunks WHERE book_id = ? ORDER BY chapter_index, id", [bookId]);
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    chapterIndex: r.chapter_index,
    chapterTitle: r.chapter_title,
    content: r.content,
    tokenCount: r.token_count,
    startCfi: r.start_cfi || "",
    endCfi: r.end_cfi || "",
    embedding: deserializeEmbedding(r.embedding),
  }));
}

export async function insertChunks(chunks: Chunk[]): Promise<void> {
  const database = await getDB();
  for (const chunk of chunks) {
    await database.execute(
      "INSERT INTO chunks (id, book_id, chapter_index, chapter_title, content, token_count, start_cfi, end_cfi, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        chunk.id,
        chunk.bookId,
        chunk.chapterIndex,
        chunk.chapterTitle,
        chunk.content,
        chunk.tokenCount,
        chunk.startCfi || null,
        chunk.endCfi || null,
        serializeEmbedding(chunk.embedding),
      ],
    );
  }
}

export async function deleteChunks(bookId: string): Promise<void> {
  const database = await getDB();
  await database.execute("DELETE FROM chunks WHERE book_id = ?", [bookId]);
}

// --- Skills ---

export async function getSkills(): Promise<Skill[]> {
  const database = await getDB();
  const rows = await database.select<
    Array<{
      id: string;
      name: string;
      description: string;
      icon: string | null;
      enabled: number;
      parameters: string;
      prompt: string;
      built_in: number;
      created_at: number;
      updated_at: number;
    }>
  >("SELECT * FROM skills ORDER BY created_at ASC");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    icon: r.icon || undefined,
    enabled: r.enabled === 1,
    parameters: parseJSON(r.parameters, []),
    prompt: r.prompt,
    builtIn: r.built_in === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function insertSkill(skill: Skill): Promise<void> {
  const database = await getDB();
  await database.execute(
    "INSERT INTO skills (id, name, description, icon, enabled, parameters, prompt, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      skill.id,
      skill.name,
      skill.description,
      skill.icon || null,
      skill.enabled ? 1 : 0,
      JSON.stringify(skill.parameters),
      skill.prompt,
      skill.builtIn ? 1 : 0,
      skill.createdAt,
      skill.updatedAt,
    ],
  );
}

export async function updateSkill(id: string, updates: Partial<Skill>): Promise<void> {
  const database = await getDB();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    values.push(updates.description);
  }
  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }
  if (updates.parameters !== undefined) {
    sets.push("parameters = ?");
    values.push(JSON.stringify(updates.parameters));
  }
  if (updates.prompt !== undefined) {
    sets.push("prompt = ?");
    values.push(updates.prompt);
  }
  sets.push("updated_at = ?");
  values.push(Date.now());

  if (sets.length === 0) return;
  values.push(id);
  await database.execute(`UPDATE skills SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function deleteSkill(id: string): Promise<void> {
  const database = await getDB();
  await database.execute("DELETE FROM skills WHERE id = ?", [id]);
}
