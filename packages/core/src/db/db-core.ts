import type { IDatabase } from "../services/platform";
import { getPlatformService } from "../services/platform";
import { generateId } from "../utils/generate-id";
import { runSerializedDbTask } from "./write-retry";

// Lazy-loaded database instances
let db: IDatabase | null = null;
let dbInitialized = false;
let dbInitPromise: Promise<void> | null = null;
let dbLoadPromise: Promise<IDatabase> | null = null;

let localDb: IDatabase | null = null;
let localDbInitialized = false;
let localDbInitPromise: Promise<void> | null = null;
let localDbLoadPromise: Promise<IDatabase> | null = null;

const DB_FILENAME = "readany.db";
const LOCAL_DB_FILENAME = "readany_local.db";
const DEVICE_ID_STORAGE_KEY = "sync_device_id";
const DESKTOP_DATA_ROOT_CONFIG_FILE = "desktop-data-root.json";

// Cached device ID for sync tracking
let cachedDeviceId: string | null = null;

function normalizeDir(path: string): string {
  const trimmed = path.replace(/^file:\/\//, "").trim();
  if (!trimmed) return "";
  if (/^[A-Za-z]:\\$/.test(trimmed)) return trimmed;
  return trimmed.replace(/[\\/]+$/, "");
}

async function getDefaultDataRoot(): Promise<string> {
  const platform = getPlatformService();
  return normalizeDir(await platform.getAppDataDir());
}

async function getDesktopDataRootConfigPath(): Promise<string> {
  const platform = getPlatformService();
  return platform.joinPath(await getDefaultDataRoot(), DESKTOP_DATA_ROOT_CONFIG_FILE);
}

async function getDesktopDataRoot(): Promise<string> {
  const platform = getPlatformService();
  const defaultRoot = await getDefaultDataRoot();
  if (!platform.isDesktop) {
    return defaultRoot;
  }

  try {
    const configPath = await getDesktopDataRootConfigPath();
    if (!(await platform.exists(configPath))) {
      return defaultRoot;
    }

    const raw = await platform.readTextFile(configPath);
    const parsed = JSON.parse(raw) as { dataRoot?: string };
    const configuredRoot = normalizeDir(parsed.dataRoot || "");
    return configuredRoot || defaultRoot;
  } catch {
    return defaultRoot;
  }
}

export async function getActiveDataRoot(): Promise<string> {
  return getDesktopDataRoot();
}

export async function getDatabaseFilePath(filename: string): Promise<string> {
  const platform = getPlatformService();
  return platform.joinPath(await getDesktopDataRoot(), filename);
}

async function getDatabaseLocation(filename: string): Promise<string> {
  const platform = getPlatformService();
  if (!platform.isDesktop) {
    return filename;
  }

  return `sqlite:${await getDatabaseFilePath(filename)}`;
}

async function configureDatabaseConnection(database: IDatabase): Promise<void> {
  try {
    await database.execute("PRAGMA journal_mode = WAL");
  } catch {
    // Some adapters may not support WAL mode changes
  }
  try {
    await database.execute("PRAGMA synchronous = NORMAL");
  } catch {
    // Some adapters may not support synchronous mode changes
  }
  try {
    await database.execute("PRAGMA foreign_keys = ON");
  } catch {
    // Some adapters may not support PRAGMA configuration
  }
  try {
    await database.execute("PRAGMA busy_timeout = 15000");
  } catch {
    // Some adapters may not support PRAGMA configuration
  }
}

export async function cleanupOrphanedSyncRows(databaseArg?: IDatabase): Promise<void> {
  const database = databaseArg ?? (await getDB());

  const cleanupStatements = [
    "DELETE FROM highlights WHERE book_id NOT IN (SELECT id FROM books)",
    "DELETE FROM notes WHERE book_id NOT IN (SELECT id FROM books)",
    "DELETE FROM bookmarks WHERE book_id NOT IN (SELECT id FROM books)",
    "DELETE FROM reading_sessions WHERE book_id NOT IN (SELECT id FROM books)",
    "DELETE FROM book_tags WHERE book_id NOT IN (SELECT id FROM books) OR tag_id NOT IN (SELECT id FROM tags)",
    "UPDATE books SET group_id = NULL WHERE group_id IS NOT NULL AND group_id NOT IN (SELECT id FROM book_groups)",
    "DELETE FROM messages WHERE thread_id NOT IN (SELECT id FROM threads)",
  ];

  for (const sql of cleanupStatements) {
    try {
      await database.execute(sql);
    } catch {
      // Ignore partial cleanup failures on older schema variants.
    }
  }
}

export async function getDB(): Promise<IDatabase> {
  if (db) return db;

  if (!dbLoadPromise) {
    dbLoadPromise = (async () => {
      const platform = getPlatformService();
      const loadedDb = await platform.loadDatabase(await getDatabaseLocation(DB_FILENAME));
      await configureDatabaseConnection(loadedDb);
      db = loadedDb;
      return loadedDb;
    })().finally(() => {
      dbLoadPromise = null;
    });
  }

  return dbLoadPromise;
}

/** Get or lazily open the local database (readany_local.db) */
export async function getLocalDB(): Promise<IDatabase> {
  if (localDb) return localDb;

  if (!localDbLoadPromise) {
    localDbLoadPromise = (async () => {
      const platform = getPlatformService();
      const loadedDb = await platform.loadDatabase(await getDatabaseLocation(LOCAL_DB_FILENAME));
      await configureDatabaseConnection(loadedDb);
      localDb = loadedDb;
      return loadedDb;
    })().finally(() => {
      localDbLoadPromise = null;
    });
  }

  return localDbLoadPromise;
}

/** Close the active database connection and clear cache */
export async function closeDB(): Promise<void> {
  dbInitPromise = null;
  dbLoadPromise = null;
  if (db) {
    try {
      await db.close();
    } catch {
      // Ignore close errors
    }
    db = null;
    dbInitialized = false;
    cachedDeviceId = null;
  }
  // Also close the local database
  await closeLocalDB();
}

/** Close the local database connection and clear cache */
export async function closeLocalDB(): Promise<void> {
  localDbInitPromise = null;
  localDbLoadPromise = null;
  if (localDb) {
    try {
      await localDb.close();
    } catch {
      // Ignore close errors
    }
    localDb = null;
    localDbInitialized = false;
  }
}

/** Ensure no active transaction (rollback if any) */
export async function ensureNoTransaction(): Promise<void> {
  if (db) {
    try {
      await db.execute("ROLLBACK", []);
    } catch {
      // No active transaction, ignore
    }
  }
}

/** Reset the DB cache without closing (for use after external file replacement) */
export function resetDBCache(): void {
  db = null;
  dbInitialized = false;
  cachedDeviceId = null;
}

/** Reset the local DB cache without closing */
export function resetLocalDBCache(): void {
  localDb = null;
  localDbInitialized = false;
}

/** Get or create device ID for sync tracking */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  const platform = getPlatformService();
  let kvAvailable = true;

  try {
    const storedDeviceId = await platform.kvGetItem(DEVICE_ID_STORAGE_KEY);
    if (storedDeviceId) {
      cachedDeviceId = storedDeviceId;
      try {
        const database = await getDB();
        await database.execute(
          "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('device_id', ?)",
          [storedDeviceId],
        );
      } catch {
        // Table might not exist yet during init
      }
      return storedDeviceId;
    }
  } catch {
    kvAvailable = false;
  }

  const database = await getDB();
  if (!kvAvailable) {
    try {
      const rows = await database.select<{ value: string }>(
        "SELECT value FROM sync_metadata WHERE key = 'device_id'",
      );
      if (rows.length > 0 && rows[0].value) {
        cachedDeviceId = rows[0].value;
        return rows[0].value;
      }
    } catch {
      // Table might not exist yet
    }
  }

  // Generate new device ID
  const id = generateId();
  try {
    await database.execute(
      "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('device_id', ?)",
      [id],
    );
  } catch {
    // Table might not exist yet during init
  }
  try {
    await platform.kvSetItem(DEVICE_ID_STORAGE_KEY, id);
  } catch {
    // Ignore KV persistence errors; DB copy will still exist.
  }
  cachedDeviceId = id;
  return id;
}

/** Get next sync version for a table */
export async function nextSyncVersion(database: IDatabase, table: string): Promise<number> {
  const rows = await database.select<{ max_v: number | null }>(
    `SELECT MAX(sync_version) as max_v FROM ${table}`,
  );
  return (rows[0]?.max_v || 0) + 1;
}

export async function nextUpdatedAt(
  database: IDatabase,
  table: string,
  id: string,
): Promise<number> {
  const now = Date.now();

  try {
    const rows = await database.select<{ updated_at: number | null }>(
      `SELECT updated_at FROM ${table} WHERE id = ?`,
      [id],
    );
    const current = rows[0]?.updated_at ?? 0;
    return Math.max(now, current + 1);
  } catch {
    return now;
  }
}

/** Insert a tombstone record for sync deletion tracking */
export async function insertTombstone(
  database: IDatabase,
  id: string,
  tableName: string,
): Promise<void> {
  const deviceId = await getDeviceId();
  try {
    await database.execute(
      "INSERT OR REPLACE INTO sync_tombstones (id, table_name, deleted_at, device_id) VALUES (?, ?, ?, ?)",
      [id, tableName, Date.now(), deviceId],
    );
  } catch {
    // sync_tombstones table might not exist on older schema
  }
}

/** Initialize the database, creating tables if needed */
export async function initDatabase(): Promise<void> {
  if (dbInitialized) return;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    await runSerializedDbTask(async () => {
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
      group_id TEXT,
      added_at INTEGER NOT NULL,
      last_opened_at INTEGER,
      deleted_at INTEGER,
      progress REAL DEFAULT 0,
      current_cfi TEXT,
      is_vectorized INTEGER DEFAULT 0,
      vectorize_progress REAL DEFAULT 0,
      tags TEXT DEFAULT '[]'
    )
  `);

      await database.execute(`
    CREATE TABLE IF NOT EXISTS book_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      sync_version INTEGER DEFAULT 0,
      last_modified_by TEXT
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
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);

      await database.execute(`
    CREATE TABLE IF NOT EXISTS book_tags (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE (book_id, tag_id),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
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

      await database.execute(`
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      total_active_time INTEGER DEFAULT 0,
      pages_read INTEGER DEFAULT 0,
      characters_read INTEGER DEFAULT 0,
      state TEXT DEFAULT 'active',
      updated_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )
  `);

      // Create indexes
      await database.execute(
        "CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id)",
      );
      await database.execute("CREATE INDEX IF NOT EXISTS idx_notes_book ON notes(book_id)");
      await database.execute("CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id)");
      await database.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)",
      );
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
        await database.execute("ALTER TABLE books ADD COLUMN group_id TEXT");
      } catch {
        // Column already exists, ignore
      }
      await database.execute("CREATE INDEX IF NOT EXISTS idx_books_group ON books(group_id)");
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
      // --- Sync migrations ---
      // Migration 4: Add updated_at and file_hash to books
      try {
        await database.execute(
          "ALTER TABLE books ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
        );
      } catch {
        // Column already exists
      }
      try {
        await database.execute("ALTER TABLE books ADD COLUMN deleted_at INTEGER");
      } catch {
        // Column already exists
      }
      try {
        await database.execute("ALTER TABLE books ADD COLUMN file_hash TEXT");
      } catch {
        // Column already exists
      }
      try {
        await database.execute("UPDATE books SET updated_at = added_at WHERE updated_at = 0");
      } catch {
        // Already updated
      }

      // Migration 5: Tombstones table
      await database.execute(`
    CREATE TABLE IF NOT EXISTS sync_tombstones (
      id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      deleted_at INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      PRIMARY KEY (id, table_name)
    )
  `);
      await database.execute(
        "CREATE INDEX IF NOT EXISTS idx_tombstones_deleted_at ON sync_tombstones(deleted_at)",
      );

      // Migration 6: Sync metadata table
      await database.execute(`
    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

      // Migration 7: Add sync_version and last_modified_by to all synced tables
      const syncTables = [
        "books",
        "highlights",
        "notes",
        "bookmarks",
        "tags",
        "book_tags",
        "book_groups",
        "reading_sessions",
        "threads",
        "messages",
        "skills",
      ];
      for (const table of syncTables) {
        try {
          await database.execute(`ALTER TABLE ${table} ADD COLUMN sync_version INTEGER DEFAULT 0`);
        } catch {
          // Column already exists
        }
        try {
          await database.execute(`ALTER TABLE ${table} ADD COLUMN last_modified_by TEXT`);
        } catch {
          // Column already exists
        }
      }

      // Migration 8: Add updated_at to tables that need it for incremental sync
      const tablesNeedingUpdatedAt = ["bookmarks"];
      for (const table of tablesNeedingUpdatedAt) {
        try {
          await database.execute(
            `ALTER TABLE ${table} ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`,
          );
        } catch {
          // Column already exists
        }
      }
      // Initialize updated_at from created_at
      try {
        await database.execute("UPDATE bookmarks SET updated_at = created_at WHERE updated_at = 0");
      } catch {
        // Already updated or column doesn't exist
      }

      // Migration 9: Add sync_status to books for on-demand download
      try {
        await database.execute(
          "ALTER TABLE books ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'local'",
        );
      } catch {
        // Column already exists
      }

      // Migration 10: Add updated_at and id to tags/book_tags for sync; add updated_at to reading_sessions
      try {
        await database.execute("ALTER TABLE tags ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0");
      } catch {
        // Column already exists
      }
      try {
        await database.execute("ALTER TABLE book_tags ADD COLUMN id TEXT");
        // Backfill id for existing rows (book_id || '-' || tag_id as stable key)
        await database.execute(
          "UPDATE book_tags SET id = book_id || '-' || tag_id WHERE id IS NULL",
        );
      } catch {
        // Column already exists
      }
      try {
        await database.execute(
          "ALTER TABLE book_tags ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
        );
      } catch {
        // Column already exists
      }
      try {
        await database.execute(
          "ALTER TABLE reading_sessions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
        );
        await database.execute(
          "UPDATE reading_sessions SET updated_at = started_at WHERE updated_at = 0",
        );
      } catch {
        // Column already exists or table doesn't exist yet
      }
      try {
        await database.execute(
          "ALTER TABLE reading_sessions ADD COLUMN characters_read INTEGER DEFAULT 0",
        );
      } catch {
        // Column already exists or table doesn't exist yet
      }
      try {
        await database.execute(
          "CREATE INDEX IF NOT EXISTS idx_books_deleted_at ON books(deleted_at)",
        );
      } catch {
        // Older installs may fail to add the column on the first pass; don't block startup.
      }

      const platform = getPlatformService();
      if (platform.isDesktop) {
        await cleanupOrphanedSyncRows(database);
      }

      dbInitialized = true;
    });

    // Also initialize the local database (chunks only) after the main DB init
    // finishes, so schema migration and sync apply never compete for writes.
    await initLocalDatabase();
  })().finally(() => {
    dbInitPromise = null;
  });

  return dbInitPromise;
}
export async function initLocalDatabase(): Promise<void> {
  if (localDbInitialized) return;
  if (localDbInitPromise) return localDbInitPromise;

  localDbInitPromise = (async () => {
    await runSerializedDbTask(async () => {
      if (localDbInitialized) return;

      const database = await getLocalDB();

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
      segment_cfis TEXT,
      embedding BLOB,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);

      try {
        await database.execute(
          "ALTER TABLE chunks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
        );
      } catch {
        // Column already exists on upgraded installs.
      }

      // Create indexes
      await database.execute("CREATE INDEX IF NOT EXISTS idx_chunks_book ON chunks(book_id)");

      localDbInitialized = true;

      // Migrate data from main DB to local DB on first run
      await migrateDataToLocalDB();
    });
  })().finally(() => {
    localDbInitPromise = null;
  });

  return localDbInitPromise;
}

/** Migrate chunks from main DB to local DB (one-time) */
async function migrateDataToLocalDB(): Promise<void> {
  const platform = getPlatformService();
  if (!platform.isDesktop) {
    return;
  }

  const mainDB = await getDB();

  // Check if migration has already been done
  try {
    const rows = await mainDB.select<{ value: string }>(
      "SELECT value FROM sync_metadata WHERE key = 'local_db_migration_done'",
    );
    if (rows.length > 0 && rows[0].value === "1") {
      return; // Already migrated
    }
  } catch {
    // sync_metadata might not exist yet, skip migration
    return;
  }

  // Check if chunks table exists in main DB
  let hasChunksInMain = false;

  try {
    await mainDB.select<{ id: string }>("SELECT id FROM chunks LIMIT 1");
    hasChunksInMain = true;
  } catch {
    // Table doesn't exist in main DB
  }

  const localDB = await getLocalDB();

  // Migrate chunks
  if (hasChunksInMain) {
    try {
      const chunks = await mainDB.select<Record<string, unknown>>(
        "SELECT id, book_id, chapter_index, chapter_title, content, token_count, start_cfi, end_cfi, segment_cfis, embedding FROM chunks",
      );
      for (const chunk of chunks) {
        await localDB.execute(
          "INSERT OR IGNORE INTO chunks (id, book_id, chapter_index, chapter_title, content, token_count, start_cfi, end_cfi, segment_cfis, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            chunk.id,
            chunk.book_id,
            chunk.chapter_index,
            chunk.chapter_title,
            chunk.content,
            chunk.token_count,
            chunk.start_cfi,
            chunk.end_cfi,
            chunk.segment_cfis,
            chunk.embedding,
          ],
        );
      }
      // Drop from main DB
      await mainDB.execute("DROP TABLE IF EXISTS chunks");
    } catch {
      // Migration error — non-fatal, table may be partially migrated
    }
  }

  // Mark migration as done
  try {
    await mainDB.execute(
      "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('local_db_migration_done', '1')",
    );
  } catch {
    // Non-fatal
  }
}

/** Shared JSON parser */
export function parseJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

/** Serialize float32 embedding array to bytes */
export function serializeEmbedding(embedding?: number[]): Uint8Array | null {
  if (!embedding || embedding.length === 0) return null;
  const buffer = new ArrayBuffer(embedding.length * 4);
  const view = new Float32Array(buffer);
  for (let i = 0; i < embedding.length; i++) {
    view[i] = embedding[i];
  }
  return new Uint8Array(buffer);
}

/** Deserialize bytes back to float32 embedding array */
export function deserializeEmbedding(data: unknown): number[] | undefined {
  if (!data) return undefined;
  // Data comes as an array of bytes from the SQL plugin
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
  if (bytes.length === 0) return undefined;
  const view = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return Array.from(view);
}
