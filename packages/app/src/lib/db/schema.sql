-- ReadAny Database Schema
-- SQLite

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT DEFAULT '',
  publisher TEXT,
  language TEXT,
  isbn TEXT,
  description TEXT,
  cover_url TEXT,
  publish_date TEXT,
  subjects TEXT, -- JSON array
  total_pages INTEGER DEFAULT 0,
  total_chapters INTEGER DEFAULT 0,
  progress REAL DEFAULT 0.0,
  current_cfi TEXT,
  is_vectorized INTEGER DEFAULT 0,
  vectorize_progress REAL DEFAULT 0.0,
  added_at INTEGER NOT NULL,
  last_opened_at INTEGER
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS book_tags (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, tag_id)
);

CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  cfi TEXT NOT NULL,
  text TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'yellow',
  note TEXT,
  chapter_title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  highlight_id TEXT REFERENCES highlights(id) ON DELETE SET NULL,
  cfi TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  chapter_title TEXT,
  tags TEXT DEFAULT '[]', -- JSON array
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  cfi TEXT NOT NULL,
  label TEXT,
  chapter_title TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  citations TEXT, -- JSON array
  tool_calls TEXT, -- JSON array
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_sessions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'PAUSED', 'STOPPED')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  paused_at INTEGER,
  total_active_time INTEGER DEFAULT 0,
  pages_read INTEGER DEFAULT 0,
  start_cfi TEXT,
  end_cfi TEXT
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT,
  enabled INTEGER DEFAULT 1,
  parameters TEXT DEFAULT '[]', -- JSON array
  prompt TEXT NOT NULL DEFAULT '',
  built_in INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  chapter_title TEXT,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  start_cfi TEXT,
  end_cfi TEXT,
  embedding BLOB -- serialized float32 array
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id);
CREATE INDEX IF NOT EXISTS idx_notes_book ON notes(book_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_threads_book ON threads(book_id);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_book ON reading_sessions(book_id);
CREATE INDEX IF NOT EXISTS idx_chunks_book ON chunks(book_id);
CREATE INDEX IF NOT EXISTS idx_books_last_opened ON books(last_opened_at DESC);
