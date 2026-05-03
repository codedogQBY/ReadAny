/**
 * Database migration management
 */
import { getDesktopDatabasePath } from "@/lib/storage/desktop-library-root";

interface Migration {
  version: number;
  description: string;
  up: string | string[]; // single or multiple SQL statements
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
    description: "Add book groups",
    up: [
      `CREATE TABLE IF NOT EXISTS book_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0,
        sync_version INTEGER DEFAULT 0,
        last_modified_by TEXT
      )`,
      "ALTER TABLE books ADD COLUMN group_id TEXT",
      "CREATE INDEX IF NOT EXISTS idx_books_group ON books(group_id)",
    ],
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
      const statements = Array.isArray(migration.up) ? migration.up : [migration.up];
      for (const sql of statements) {
        try {
          await db.execute(sql);
        } catch {
          // Migration SQL may fail if already applied (e.g., column already exists)
        }
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
