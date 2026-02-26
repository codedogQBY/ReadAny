/**
 * Database migration management
 */

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
];

/** Run pending migrations */
export async function runMigrations(): Promise<void> {
  const Database = (await import("@tauri-apps/plugin-sql")).default;
  const db = await Database.load("sqlite:readany.db");

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
    const db = await Database.load("sqlite:readany.db");
    const rows = await db.select<Array<{ max_version: number | null }>>(
      "SELECT MAX(version) as max_version FROM schema_migrations",
    );
    return rows[0]?.max_version ?? 0;
  } catch {
    return 0;
  }
}
