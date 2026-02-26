use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

/// Initialize SQLite database with schema
/// IMPORTANT: This schema must stay in sync with the frontend's database.ts
pub fn initialize(db_path: &Path) -> Result<()> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch(
        "
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
            highlight_id TEXT,
            cfi TEXT,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            chapter_title TEXT,
            tags TEXT DEFAULT '[]',
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
            book_id TEXT,
            title TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            citations TEXT,
            tool_calls TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS reading_sessions (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            total_active_time INTEGER DEFAULT 0,
            pages_read INTEGER DEFAULT 0,
            state TEXT DEFAULT 'active',
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            chapter_index INTEGER NOT NULL,
            chapter_title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL,
            token_count INTEGER NOT NULL DEFAULT 0,
            start_cfi TEXT,
            end_cfi TEXT,
            embedding BLOB
        );

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
        );

        CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id);
        CREATE INDEX IF NOT EXISTS idx_notes_book ON notes(book_id);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);
        CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
        CREATE INDEX IF NOT EXISTS idx_reading_sessions_book ON reading_sessions(book_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_book ON chunks(book_id);
        ",
    )?;

    // Migrations for existing databases
    // Add format column if missing (from older schema)
    let _ = conn.execute_batch("ALTER TABLE books ADD COLUMN format TEXT NOT NULL DEFAULT 'epub'");
    // Add tags column if missing
    let _ = conn.execute_batch("ALTER TABLE books ADD COLUMN tags TEXT DEFAULT '[]'");

    Ok(())
}
