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

        CREATE TABLE IF NOT EXISTS book_memories (
            book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
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
            last_modified_by TEXT
        );

        CREATE TABLE IF NOT EXISTS chapter_translations (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            section_index INTEGER NOT NULL,
            source_lang TEXT NOT NULL,
            target_lang TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT '',
            model TEXT,
            source_hash TEXT NOT NULL,
            paragraphs TEXT NOT NULL DEFAULT '[]',
            original_visible INTEGER NOT NULL DEFAULT 1,
            translation_visible INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            sync_version INTEGER DEFAULT 0,
            last_modified_by TEXT
        );

        CREATE TABLE IF NOT EXISTS reading_sessions (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            total_active_time INTEGER DEFAULT 0,
            pages_read INTEGER DEFAULT 0,
            characters_read INTEGER DEFAULT 0,
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
            segment_cfis TEXT,
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
        CREATE INDEX IF NOT EXISTS idx_book_memories_updated ON book_memories(updated_at);
        CREATE INDEX IF NOT EXISTS idx_chapter_translations_book ON chapter_translations(book_id);
        CREATE INDEX IF NOT EXISTS idx_reading_sessions_book ON reading_sessions(book_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_book ON chunks(book_id);
        ",
    )?;

    // Migrations for existing databases
    // Add format column if missing (from older schema)
    let _ = conn.execute_batch("ALTER TABLE books ADD COLUMN format TEXT NOT NULL DEFAULT 'epub'");
    // Add tags column if missing
    let _ = conn.execute_batch("ALTER TABLE books ADD COLUMN tags TEXT DEFAULT '[]'");
    // Add segment_cfis column if missing
    let _ = conn.execute_batch("ALTER TABLE chunks ADD COLUMN segment_cfis TEXT");

    // --- Sync migrations ---

    // Migration 4: Add updated_at and file_hash to books
    let _ =
        conn.execute_batch("ALTER TABLE books ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0");
    let _ = conn.execute_batch("ALTER TABLE books ADD COLUMN file_hash TEXT");
    let _ = conn.execute_batch("UPDATE books SET updated_at = added_at WHERE updated_at = 0");

    // Migration 5: Tombstones table for tracking deletions across sync
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_tombstones (
            id TEXT NOT NULL,
            table_name TEXT NOT NULL,
            deleted_at INTEGER NOT NULL,
            device_id TEXT NOT NULL,
            PRIMARY KEY (id, table_name)
        )",
    );
    let _ = conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_tombstones_deleted_at ON sync_tombstones(deleted_at)",
    );

    // Migration 6: Sync metadata table
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
    );

    // Migration 7: Add sync_version and last_modified_by to all synced tables
    let _ = conn.execute_batch("ALTER TABLE books ADD COLUMN sync_version INTEGER DEFAULT 0");
    let _ = conn.execute_batch("ALTER TABLE books ADD COLUMN last_modified_by TEXT");
    let _ = conn.execute_batch("ALTER TABLE highlights ADD COLUMN sync_version INTEGER DEFAULT 0");
    let _ = conn.execute_batch("ALTER TABLE highlights ADD COLUMN last_modified_by TEXT");
    let _ = conn.execute_batch("ALTER TABLE notes ADD COLUMN sync_version INTEGER DEFAULT 0");
    let _ = conn.execute_batch("ALTER TABLE notes ADD COLUMN last_modified_by TEXT");
    let _ = conn.execute_batch("ALTER TABLE bookmarks ADD COLUMN sync_version INTEGER DEFAULT 0");
    let _ = conn.execute_batch("ALTER TABLE bookmarks ADD COLUMN last_modified_by TEXT");
    let _ = conn.execute_batch("ALTER TABLE threads ADD COLUMN sync_version INTEGER DEFAULT 0");
    let _ = conn.execute_batch("ALTER TABLE threads ADD COLUMN last_modified_by TEXT");
    let _ = conn.execute_batch("ALTER TABLE messages ADD COLUMN sync_version INTEGER DEFAULT 0");
    let _ = conn.execute_batch("ALTER TABLE messages ADD COLUMN last_modified_by TEXT");
    let _ = conn
        .execute_batch("ALTER TABLE chapter_translations ADD COLUMN sync_version INTEGER DEFAULT 0");
    let _ = conn.execute_batch("ALTER TABLE chapter_translations ADD COLUMN last_modified_by TEXT");
    let _ = conn
        .execute_batch("ALTER TABLE reading_sessions ADD COLUMN sync_version INTEGER DEFAULT 0");
    let _ = conn.execute_batch("ALTER TABLE reading_sessions ADD COLUMN last_modified_by TEXT");
    let _ = conn.execute_batch("ALTER TABLE skills ADD COLUMN sync_version INTEGER DEFAULT 0");
    let _ = conn.execute_batch("ALTER TABLE skills ADD COLUMN last_modified_by TEXT");

    Ok(())
}
