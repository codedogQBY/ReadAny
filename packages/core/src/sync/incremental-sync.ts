/**
 * Incremental sync service — sync only changed records instead of whole database.
 * Uses last-write-wins merge strategy based on updated_at timestamps.
 */

import {
  cleanupOrphanedSyncRows,
  ensureNoTransaction,
  getDB,
  getDeviceId as getLocalDeviceId,
} from "../db/database";
import type { ISyncBackend } from "./sync-backend";
import {
  REMOTE_DATA,
  REMOTE_MANIFEST,
  type RemoteSyncManifest,
  SYNC_META_KEYS,
  SYNC_SCHEMA_VERSION,
} from "./sync-types";

/** Path for the latest delta file on remote */
const REMOTE_DELTA_LATEST = `${REMOTE_DATA}/delta_latest.json`;

/** Incremental sync manifest (stored alongside main manifest) */
export interface IncrementalSyncManifest extends RemoteSyncManifest {
  lastSyncAt: number;
  deviceId: string;
}

/** Delta record for a single table */
export interface TableDelta<T = Record<string, unknown>> {
  table: string;
  records: T[];
  deletedIds: string[];
}

/** Full delta package for sync */
export interface SyncDelta {
  deviceId: string;
  fromTimestamp: number;
  toTimestamp: number;
  tables: {
    books?: TableDelta;
    bookmarks?: TableDelta;
    highlights?: TableDelta;
    notes?: TableDelta;
    reading_sessions?: TableDelta;
    threads?: TableDelta;
    messages?: TableDelta;
    skills?: TableDelta;
  };
}

interface SyncTableConfig {
  name: string;
  pk: string;
  timestampCol: string;
  excludeColumns?: string[];
}

/** Tables that support incremental sync — matches database.ts Migration 7 syncTables */
const SYNC_TABLES: SyncTableConfig[] = [
  {
    name: "books",
    pk: "id",
    timestampCol: "updated_at",
    excludeColumns: ["is_vectorized", "vectorize_progress"],
  },
  { name: "bookmarks", pk: "id", timestampCol: "updated_at" },
  { name: "highlights", pk: "id", timestampCol: "updated_at" },
  { name: "notes", pk: "id", timestampCol: "updated_at" },
  { name: "reading_sessions", pk: "id", timestampCol: "updated_at" },
  { name: "threads", pk: "id", timestampCol: "updated_at" },
  { name: "messages", pk: "id", timestampCol: "created_at" },
  { name: "skills", pk: "id", timestampCol: "updated_at" },
  { name: "mini_reviews", pk: "id", timestampCol: "updated_at" },
  { name: "review_items", pk: "id", timestampCol: "updated_at" },
  // NOT synced: chunks (large vector data, regenerated locally)
] as const;

/** Max age for tombstone records (30 days) */
const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const tableColumnCache = new Map<string, Set<string>>();

async function getTableColumns(
  db: Awaited<ReturnType<typeof getDB>>,
  table: string,
): Promise<Set<string>> {
  const cached = tableColumnCache.get(table);
  if (cached) return cached;

  const rows = await db.select<{ name: string }>(`PRAGMA table_info(${table})`);
  const columns = new Set(rows.map((row) => row.name));
  tableColumnCache.set(table, columns);
  return columns;
}

async function filterRecordToExistingColumns(
  db: Awaited<ReturnType<typeof getDB>>,
  table: string,
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const existingColumns = await getTableColumns(db, table);
  return Object.fromEntries(
    Object.entries(record).filter(([column]) => existingColumns.has(column)),
  );
}

function isForeignKeyConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("FOREIGN KEY constraint failed") || message.includes("(code: 787)");
}

/** Get or create device ID */
export async function getDeviceId(): Promise<string> {
  return getLocalDeviceId();
}

/** Get last sync timestamp for this device */
export async function getLastSyncTimestamp(): Promise<number> {
  const db = await getDB();
  const rows = await db.select<{ value: string }>("SELECT value FROM sync_metadata WHERE key = ?", [
    SYNC_META_KEYS.LAST_SYNC_AT,
  ]);
  return rows[0]?.value ? Number.parseInt(rows[0].value, 10) : 0;
}

/** Set last sync timestamp */
export async function setLastSyncTimestamp(timestamp: number): Promise<void> {
  const db = await getDB();
  await db.execute("INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)", [
    SYNC_META_KEYS.LAST_SYNC_AT,
    String(timestamp),
  ]);
}

/** Collect local changes since given timestamp, including tombstones for deletions */
export async function collectLocalChanges(since: number): Promise<SyncDelta> {
  await ensureNoTransaction();
  const db = await getDB();
  await cleanupOrphanedSyncRows(db);
  const deviceId = await getDeviceId();
  const toTimestamp = Date.now();

  const delta: SyncDelta = {
    deviceId,
    fromTimestamp: since,
    toTimestamp,
    tables: {},
  };

  for (const { name, timestampCol, excludeColumns } of SYNC_TABLES) {
    const rows = await db.select<Record<string, unknown>>(
      `SELECT * FROM ${name} WHERE ${timestampCol} > ?`,
      [since],
    );
    const sanitizedRows = excludeColumns?.length
      ? rows.map((row) => {
          const nextRow = { ...row };
          for (const column of excludeColumns) {
            delete nextRow[column];
          }
          return nextRow;
        })
      : rows;

    // Query tombstones for this table
    let deletedIds: string[] = [];
    try {
      const tombstones = await db.select<{ id: string }>(
        "SELECT id FROM sync_tombstones WHERE table_name = ? AND deleted_at > ?",
        [name, since],
      );
      deletedIds = tombstones.map((t) => t.id);
    } catch {
      // sync_tombstones table might not exist on older schema
    }

    if (rows.length > 0 || deletedIds.length > 0) {
      delta.tables[name as keyof typeof delta.tables] = {
        table: name,
        records: sanitizedRows,
        deletedIds,
      };
    }
  }

  return delta;
}

/** Apply remote delta to local database */
export async function applyRemoteDelta(delta: SyncDelta): Promise<{
  applied: number;
  conflicts: number;
}> {
  await ensureNoTransaction();
  const db = await getDB();
  await cleanupOrphanedSyncRows(db);
  let applied = 0;
  let conflicts = 0;

  // Keep this transaction-free for cross-platform stability.
  for (const tableName of Object.keys(delta.tables) as (keyof typeof delta.tables)[]) {
    const tableDelta = delta.tables[tableName];
    if (!tableDelta || (tableDelta.records.length === 0 && tableDelta.deletedIds.length === 0))
      continue;

    const { table, records } = tableDelta;
    const tableInfo = SYNC_TABLES.find((t) => t.name === table);
    if (!tableInfo) continue;

    const { pk, timestampCol } = tableInfo;

    for (const record of records) {
      const pkValue = record[pk];
      const remoteTimestamp = record[timestampCol] as number;

      const existing = await db.select<Record<string, unknown>>(
        `SELECT ${timestampCol} FROM ${table} WHERE ${pk} = ?`,
        [pkValue],
      );

      if (existing.length > 0) {
        const localTimestamp = existing[0][timestampCol] as number;
        if (remoteTimestamp > localTimestamp) {
          try {
            await upsertRecord(db, table, record, pk);
            applied++;
          } catch (error) {
            if (isForeignKeyConstraintError(error)) {
              console.warn(
                `[IncrementalSync] Skipping orphaned ${table} record ${String(pkValue)}: ${error instanceof Error ? error.message : String(error)}`,
              );
              conflicts++;
              continue;
            }
            throw error;
          }
        } else {
          conflicts++;
        }
      } else {
        try {
          await upsertRecord(db, table, record, pk);
          applied++;
        } catch (error) {
          if (isForeignKeyConstraintError(error)) {
            console.warn(
              `[IncrementalSync] Skipping orphaned ${table} record ${String(pkValue)}: ${error instanceof Error ? error.message : String(error)}`,
            );
            conflicts++;
            continue;
          }
          throw error;
        }
      }
    }

    for (const deletedId of tableDelta.deletedIds) {
      await db.execute(`DELETE FROM ${table} WHERE ${pk} = ?`, [deletedId]);
      applied++;
    }
  }

  await db.execute("INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)", [
    SYNC_META_KEYS.LAST_SYNC_AT,
    String(Date.now()),
  ]);

  return { applied, conflicts };
}

/** Upsert a record into a table */
async function upsertRecord(
  db: Awaited<ReturnType<typeof getDB>>,
  table: string,
  record: Record<string, unknown>,
  pk: string,
): Promise<void> {
  const filteredRecord = await filterRecordToExistingColumns(db, table, record);
  const columns = Object.keys(filteredRecord);
  if (columns.length === 0 || !columns.includes(pk)) return;

  const values = Object.values(filteredRecord);
  const placeholders = columns.map(() => "?").join(", ");
  const updateColumns = columns.filter((c) => c !== pk);
  const updateSet = updateColumns.map((c) => `${c} = excluded.${c}`).join(", ");

  const sql =
    updateColumns.length === 0
      ? `
    INSERT INTO ${table} (${columns.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(${pk}) DO NOTHING
  `
      : `
    INSERT INTO ${table} (${columns.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(${pk}) DO UPDATE SET ${updateSet}
  `;

  await db.execute(sql, values);
}

/** Clean up old tombstone records */
async function cleanupOldTombstones(): Promise<void> {
  try {
    const db = await getDB();
    const cutoff = Date.now() - TOMBSTONE_MAX_AGE_MS;
    await db.execute("DELETE FROM sync_tombstones WHERE deleted_at < ?", [cutoff]);
  } catch {
    // sync_tombstones table might not exist on older schema
  }
}

/** Clean up old per-device delta files from remote (legacy format) */
async function cleanupOldDeltaFiles(backend: ISyncBackend): Promise<void> {
  try {
    const files = await backend.listDir(REMOTE_DATA);
    for (const file of files) {
      // Delete old-format delta files: delta_{deviceId}_{timestamp}.json
      if (
        file.name.startsWith("delta_") &&
        file.name !== "delta_latest.json" &&
        file.name.endsWith(".json")
      ) {
        try {
          await backend.delete(`${REMOTE_DATA}/${file.name}`);
        } catch {
          // Ignore individual file deletion errors
        }
      }
    }
  } catch {
    // Ignore cleanup errors — not critical
  }
}

/** Count total changes in a delta (records + deletions) */
function countDeltaChanges(delta: SyncDelta): number {
  return Object.values(delta.tables).reduce(
    (sum, t) => sum + (t?.records.length || 0) + (t?.deletedIds.length || 0),
    0,
  );
}

/** Run incremental sync */
export async function runIncrementalSync(
  backend: ISyncBackend,
  direction: "upload" | "download",
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; changes: number; error?: string; needsFullSync?: boolean }> {
  try {
    await ensureNoTransaction();
    const deviceId = await getDeviceId();
    const lastSync = await getLastSyncTimestamp();
    const now = Date.now();

    if (direction === "upload") {
      onProgress?.("Collecting local changes...");

      // For first upload (lastSync = 0), collect all records as changes
      const delta = await collectLocalChanges(lastSync);

      const totalChanges = countDeltaChanges(delta);

      if (totalChanges === 0) {
        onProgress?.("No changes to sync");
        return { success: true, changes: 0 };
      }

      onProgress?.(`Uploading ${totalChanges} changes...`);

      // Write delta to a single well-known path
      await backend.putJSON(REMOTE_DELTA_LATEST, delta);

      const manifest: IncrementalSyncManifest = {
        lastModifiedAt: now,
        lastSyncAt: now,
        deviceId,
        uploadedBy: deviceId,
        appVersion: "",
        schemaVersion: SYNC_SCHEMA_VERSION,
      };
      await backend.putJSON(REMOTE_MANIFEST, manifest);

      await setLastSyncTimestamp(now);

      // Clean up old per-device delta files and expired tombstones
      await cleanupOldDeltaFiles(backend);
      await cleanupOldTombstones();

      return { success: true, changes: totalChanges };
    } else {
      onProgress?.("Fetching remote changes...");

      const remoteManifest = await backend.getJSON<IncrementalSyncManifest>(REMOTE_MANIFEST);
      if (!remoteManifest) {
        onProgress?.("No remote manifest found, need full sync");
        return { success: true, changes: 0, needsFullSync: true };
      }

      // Read from the well-known delta path
      const delta = await backend.getJSON<SyncDelta>(REMOTE_DELTA_LATEST);

      if (!delta) {
        // No delta file exists yet - this is first sync on this device
        // We need full sync to get initial data
        onProgress?.("No delta file found, need full sync");
        return { success: true, changes: 0, needsFullSync: true };
      }

      const totalChanges = countDeltaChanges(delta);

      if (totalChanges === 0) {
        onProgress?.("No remote changes found");
        await setLastSyncTimestamp(now);
        return { success: true, changes: 0 };
      }

      onProgress?.(`Applying ${totalChanges} remote changes...`);

      const result = await applyRemoteDelta(delta);

      // Clean up expired tombstones after successful download
      await cleanupOldTombstones();

      return { success: true, changes: result.applied };
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, changes: 0, error };
  }
}
