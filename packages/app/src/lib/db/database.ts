/**
 * Database access layer — wraps Tauri SQL plugin
 */
import type { Book, Highlight, Note, Bookmark, Thread, Message, ReadingSession, Chunk, Skill } from "@/types";

// Database name for SQLite
// const DB_NAME = "readany.db";

let dbInitialized = false;

/** Initialize the database, creating tables if needed */
export async function initDatabase(): Promise<void> {
  if (dbInitialized) return;

  // TODO: Use @tauri-apps/plugin-sql to execute schema.sql
  // const db = await Database.load(`sqlite:${DB_NAME}`);
  // await db.execute(schemaSql);

  dbInitialized = true;
}

// --- Books ---

export async function getBooks(): Promise<Book[]> {
  // TODO: SELECT * FROM books
  return [];
}

export async function getBook(id: string): Promise<Book | null> {
  void id;
  // TODO: SELECT * FROM books WHERE id = ?
  return null;
}

export async function insertBook(book: Book): Promise<void> {
  void book;
  // TODO: INSERT INTO books
}

export async function updateBook(id: string, updates: Partial<Book>): Promise<void> {
  void id;
  void updates;
  // TODO: UPDATE books SET ... WHERE id = ?
}

export async function deleteBook(id: string): Promise<void> {
  void id;
  // TODO: DELETE FROM books WHERE id = ?
}

// --- Highlights ---

export async function getHighlights(bookId: string): Promise<Highlight[]> {
  void bookId;
  return [];
}

export async function insertHighlight(highlight: Highlight): Promise<void> {
  void highlight;
}

export async function updateHighlight(id: string, updates: Partial<Highlight>): Promise<void> {
  void id;
  void updates;
}

export async function deleteHighlight(id: string): Promise<void> {
  void id;
}

// --- Notes ---

export async function getNotes(bookId: string): Promise<Note[]> {
  void bookId;
  return [];
}

export async function insertNote(note: Note): Promise<void> {
  void note;
}

export async function updateNote(id: string, updates: Partial<Note>): Promise<void> {
  void id;
  void updates;
}

export async function deleteNote(id: string): Promise<void> {
  void id;
}

// --- Bookmarks ---

export async function getBookmarks(bookId: string): Promise<Bookmark[]> {
  void bookId;
  return [];
}

export async function insertBookmark(bookmark: Bookmark): Promise<void> {
  void bookmark;
}

export async function deleteBookmark(id: string): Promise<void> {
  void id;
}

// --- Threads ---

export async function getThreads(bookId?: string): Promise<Thread[]> {
  void bookId;
  return [];
}

export async function getThread(id: string): Promise<Thread | null> {
  void id;
  return null;
}

export async function insertThread(thread: Thread): Promise<void> {
  void thread;
}

export async function deleteThread(id: string): Promise<void> {
  void id;
}

// --- Messages ---

export async function getMessages(threadId: string): Promise<Message[]> {
  void threadId;
  return [];
}

export async function insertMessage(message: Message): Promise<void> {
  void message;
}

// --- Reading Sessions ---

export async function getReadingSessions(bookId: string): Promise<ReadingSession[]> {
  void bookId;
  return [];
}

export async function insertReadingSession(session: ReadingSession): Promise<void> {
  void session;
}

export async function updateReadingSession(id: string, updates: Partial<ReadingSession>): Promise<void> {
  void id;
  void updates;
}

// --- Chunks ---

export async function getChunks(bookId: string): Promise<Chunk[]> {
  void bookId;
  return [];
}

export async function insertChunks(chunks: Chunk[]): Promise<void> {
  void chunks;
}

export async function deleteChunks(bookId: string): Promise<void> {
  void bookId;
}

// --- Skills ---

export async function getSkills(): Promise<Skill[]> {
  return [];
}

export async function insertSkill(skill: Skill): Promise<void> {
  void skill;
}

export async function updateSkill(id: string, updates: Partial<Skill>): Promise<void> {
  void id;
  void updates;
}

export async function deleteSkill(id: string): Promise<void> {
  void id;
}
