/**
 * Database migration management
 */
import { getDesktopDatabasePath } from "@/lib/storage/desktop-library-root";

interface Migration {
  version: number;
  description: string;
  up: string; // SQL statement
}

const migrations: Migration[] = [
  {
    version: 1,
    description: "Initial schema",
    up: "", // schema.sql handles initial creation via initDatabase
  },
  {
    version: 2,
    description: "Add format column to books",
    up: "ALTER TABLE books ADD COLUMN format TEXT NOT NULL DEFAULT 'epub'",
  },
  {
    version: 3,
    description: "Create mini_reviews table",
    up: `
      CREATE TABLE IF NOT EXISTS mini_reviews (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        content TEXT NOT NULL,
        generated_at INTEGER NOT NULL,
        rating INTEGER,
        source TEXT,
        FOREIGN KEY (book_id) REFERENCES books(id)
      )
    `,
  },
  {
    version: 4,
    description: "Add index on mini_reviews.book_id",
    up: "CREATE INDEX IF NOT EXISTS idx_mini_reviews_book_id ON mini_reviews(book_id)",
  },
  {
    version: 5,
    description: "Add created_at to books",
    up: "ALTER TABLE books ADD COLUMN created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)",
  },
  {
    version: 6,
    description: "Add updated_at to books",
    up: "ALTER TABLE books ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)",
  },
  {
    version: 7,
    description: "Add reading_progress to books",
    up: "ALTER TABLE books ADD COLUMN reading_progress REAL NOT NULL DEFAULT 0.0",
  },
  {
    version: 8,
    description: "Add last_read_at to books",
    up: "ALTER TABLE books ADD COLUMN last_read_at INTEGER",
  },
  {
    version: 9,
    description: "Add type and is_pinned columns to mini_reviews",
    up: `
      ALTER TABLE mini_reviews ADD COLUMN type TEXT DEFAULT 'hook';
      ALTER TABLE mini_reviews ADD COLUMN is_pinned INTEGER DEFAULT 0;
    `,
  },
];

/** Run pending migrations */
export async function runMigrations(): Promise<void> {
  const Database = (await import("@tauri-apps/plugin-sql")).default;
  const db = await Database.load(`sqlite:${await getDesktopDatabasePath("readany.db")}`);

  // Create migrations table if not exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      applied_at INTEGER NOT NULL
    )
  `);

  // Get current version
  const currentVersion = await getSchemaVersion();

  // Run pending migrations in order
  for (const migration of migrations) {
    if (migration.version > currentVersion && migration.up) {
      try {
        await db.execute(migration.up);
      } catch {
        // Migration SQL may fail if already applied (e.g., column already exists)
      }
      await db.execute(
        "INSERT OR REPLACE INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)",
        [migration.version, migration.description, Date.now()],
      );
    }
  }
}

/** Get current schema version */
export async function getSchemaVersion(): Promise<number> {
  try {
    const Database = (await import("@tauri-apps/plugin-sql")).default;
    const db = await Database.load(`sqlite:${await getDesktopDatabasePath("readany.db")}`);
    const rows = await db.select<Array<{ max_version: number | null }>>(
      "SELECT MAX(version) as max_version FROM schema_migrations",
    );
    return rows[0]?.max_version ?? 0;
  } catch {
    return 0;
  }
}
