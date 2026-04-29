/**
 * Simplified sync service — incremental, per-device, JSON-based.
 *
 * Design:
 * 1. Each device writes to its own file: /readany/sync/device-{id}.json
 *    → No write conflicts between devices
 * 2. Pull all other devices' files and apply changes (last-write-wins per record)
 * 3. Push local changes since last sync
 * 4. Tombstones for deletions
 */

import {
  cleanupOrphanedSyncRows,
  ensureNoTransaction,
  getDB,
  getDeviceId as getLocalDeviceId,
} from "../db/database";
import { runSerializedDbTask } from "../db/write-retry";
import { getPlatformService } from "../services/platform";
import type { ISyncBackend } from "./sync-backend";

interface SyncTableConfig {
  name: string;
  pk: string;
  timestampCol: string;
  excludeColumns?: readonly string[];
}

export interface SimpleSyncOptions {
  receiveOnly?: boolean;
}

/** Tables included in sync, with their primary key and timestamp column */
const SYNC_TABLES: SyncTableConfig[] = [
  // is_vectorized and vectorize_progress are local-only (chunks live in readany_local.db)
  {
    name: "books",
    pk: "id",
    timestampCol: "updated_at",
    excludeColumns: ["is_vectorized", "vectorize_progress"],
  },
  { name: "highlights", pk: "id", timestampCol: "updated_at" },
  { name: "notes", pk: "id", timestampCol: "updated_at" },
  { name: "bookmarks", pk: "id", timestampCol: "updated_at" },
  { name: "threads", pk: "id", timestampCol: "updated_at" },
  { name: "messages", pk: "id", timestampCol: "created_at" },
  { name: "skills", pk: "id", timestampCol: "updated_at" },
  { name: "tags", pk: "id", timestampCol: "updated_at" },
  { name: "book_tags", pk: "id", timestampCol: "updated_at" },
  { name: "reading_sessions", pk: "id", timestampCol: "updated_at" },
  { name: "mini_reviews", pk: "id", timestampCol: "updated_at" },
  { name: "review_items", pk: "id", timestampCol: "updated_at" },
];

/** Remote directory for per-device sync files */
const SYNC_DIR = "/readany/sync";

/** Build the remote path for a device's changeset file */
function deviceSyncPath(deviceId: string): string {
  return `${SYNC_DIR}/device-${deviceId}.json`;
}

const DB_LOCK_MAX_RETRIES = 6;
const DB_LOCK_RETRY_DELAY_MS = 500;

function isDatabaseLockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("database is locked") || message.includes("(code: 5)");
}

function isForeignKeyConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("FOREIGN KEY constraint failed") || message.includes("(code: 787)");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function yieldToEventLoop(): Promise<void> {
  await sleep(0);
}

function shouldRunSyncCleanup(): boolean {
  try {
    return getPlatformService().isDesktop;
  } catch {
    return false;
  }
}

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

async function withDatabaseLockRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DB_LOCK_MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isDatabaseLockedError(error) || attempt === DB_LOCK_MAX_RETRIES) {
        throw error;
      }

      const delay = DB_LOCK_RETRY_DELAY_MS * attempt;
      console.warn(
        `[SimpleSync] ${label} hit a locked database, retrying (${attempt}/${DB_LOCK_MAX_RETRIES}) in ${delay}ms...`,
      );
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface TableChangeset {
  records: Record<string, unknown>[];
  deletedIds: string[];
}

export interface DeviceSyncPayload {
  deviceId: string;
  /** Unix ms timestamp of when this payload was generated */
  timestamp: number;
  /** The last sync timestamp this device used to collect changes */
  since: number;
  tables: {
    [tableName: string]: TableChangeset;
  };
}

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

async function getDeviceId(): Promise<string> {
  return getLocalDeviceId();
}

async function getLastSyncTimestamp(): Promise<number> {
  const db = await getDB();
  const rows = await db.select<{ value: string }>(
    "SELECT value FROM sync_metadata WHERE key = 'last_sync_at'",
  );
  return rows[0]?.value ? Number.parseInt(rows[0].value, 10) : 0;
}

async function setLastSyncTimestamp(timestamp: number): Promise<void> {
  const db = await getDB();
  await db.execute("INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('last_sync_at', ?)", [
    String(timestamp),
  ]);
}

// ---------------------------------------------------------------------------
// Collect local changes
// ---------------------------------------------------------------------------

export async function collectChanges(since: number): Promise<DeviceSyncPayload> {
  await ensureNoTransaction();
  const db = await getDB();
  if (shouldRunSyncCleanup()) {
    await cleanupOrphanedSyncRows(db);
  }
  const deviceId = await getDeviceId();
  const now = Date.now();

  const payload: DeviceSyncPayload = {
    deviceId,
    timestamp: now,
    since,
    tables: {},
  };

  for (const { name, timestampCol, excludeColumns } of SYNC_TABLES) {
    const exclude = excludeColumns ?? [];

    // Build column list — SELECT * then strip excluded columns client-side,
    // or use explicit column list when exclusions exist
    let records: Record<string, unknown>[];
    if (exclude.length > 0) {
      const allRows = await db.select<Record<string, unknown>>(
        `SELECT * FROM ${name} WHERE ${timestampCol} > ?`,
        [since],
      );
      records = allRows.map((row) => {
        const filtered = { ...row };
        for (const col of exclude) delete filtered[col];
        return filtered;
      });
    } else {
      records = await db.select<Record<string, unknown>>(
        `SELECT * FROM ${name} WHERE ${timestampCol} > ?`,
        [since],
      );
    }

    let deletedIds: string[] = [];
    try {
      const tombstones = await db.select<{ id: string }>(
        "SELECT id FROM sync_tombstones WHERE table_name = ? AND deleted_at > ?",
        [name, since],
      );
      deletedIds = tombstones.map((t) => t.id);
    } catch {
      // sync_tombstones may not exist on older schema
    }

    if (records.length > 0 || deletedIds.length > 0) {
      payload.tables[name] = { records, deletedIds };
    }
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Apply remote changes
// ---------------------------------------------------------------------------

export async function applyChanges(
  payload: DeviceSyncPayload,
): Promise<{ applied: number; skipped: number }> {
  return runSerializedDbTask(() =>
    withDatabaseLockRetry(async () => {
      await ensureNoTransaction();
      const db = await getDB();
      if (shouldRunSyncCleanup()) {
        await cleanupOrphanedSyncRows(db);
      }
      let applied = 0;
      let skipped = 0;

      // Keep this transaction-free. On some adapters, explicit BEGIN/COMMIT can
      // lose state across awaited calls and end with "cannot commit - no transaction is active".
      for (const [tableName, tableData] of Object.entries(payload.tables)) {
        const tableInfo = SYNC_TABLES.find((t) => t.name === tableName);
        if (!tableInfo) continue;

        const { pk, timestampCol } = tableInfo;
        const exclude = tableInfo.excludeColumns ?? [];
        console.log(
          `[SimpleSync] Applying table ${tableName}: ${tableData.records.length} record(s), ${tableData.deletedIds.length} deletion(s)`,
        );
        const existingTimestamps = await loadExistingTimestamps(
          db,
          tableName,
          pk,
          timestampCol,
          tableData.records.map((record) => record[pk]).filter((value) => value !== undefined),
        );
        let processedRecords = 0;

        for (const record of tableData.records) {
          const pkValue = record[pk];
          const remoteTs = record[timestampCol] as number;

          const safeRecord =
            exclude.length > 0
              ? Object.fromEntries(Object.entries(record).filter(([k]) => !exclude.includes(k)))
              : record;

          const localTs = existingTimestamps.get(String(pkValue));
          if (localTs !== undefined && remoteTs <= localTs) {
            skipped++;
          } else {
            try {
              await upsertRecord(db, tableName, safeRecord, pk);
              applied++;
              existingTimestamps.set(String(pkValue), remoteTs);
            } catch (error) {
              if (isForeignKeyConstraintError(error)) {
                console.warn(
                  `[SimpleSync] Skipping orphaned ${tableName} record ${String(pkValue)}: ${error instanceof Error ? error.message : String(error)}`,
                );
                skipped++;
                continue;
              }
              throw error;
            }
          }

          processedRecords++;
          if (processedRecords % 100 === 0) {
            console.log(
              `[SimpleSync] Applying table ${tableName}: ${processedRecords}/${tableData.records.length} record(s) processed`,
            );
            await yieldToEventLoop();
          }
        }

        for (const deletedId of tableData.deletedIds) {
          await db.execute(`DELETE FROM ${tableName} WHERE ${pk} = ?`, [deletedId]);
          applied++;
        }

        console.log(
          `[SimpleSync] Finished table ${tableName}: applied=${applied}, skipped=${skipped}`,
        );
      }

      return { applied, skipped };
    }, "apply remote changes"),
  );
}

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

  if (updateColumns.length === 0) {
    await db.execute(
      `INSERT INTO ${table} (${columns.join(", ")})
       VALUES (${placeholders})
       ON CONFLICT(${pk}) DO NOTHING`,
      values,
    );
    return;
  }

  await db.execute(
    `INSERT INTO ${table} (${columns.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT(${pk}) DO UPDATE SET ${updateSet}`,
    values,
  );
}

async function loadExistingTimestamps(
  db: Awaited<ReturnType<typeof getDB>>,
  tableName: string,
  pk: string,
  timestampCol: string,
  ids: unknown[],
): Promise<Map<string, number>> {
  const timestamps = new Map<string, number>();
  if (ids.length === 0) return timestamps;

  const chunkSize = 200;
  for (let offset = 0; offset < ids.length; offset += chunkSize) {
    const chunk = ids.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await db.select<{ id: string; timestamp: number | null }>(
      `SELECT ${pk} AS id, ${timestampCol} AS timestamp FROM ${tableName} WHERE ${pk} IN (${placeholders})`,
      chunk,
    );

    for (const row of rows) {
      timestamps.set(String(row.id), row.timestamp ?? 0);
    }
  }

  return timestamps;
}

// ---------------------------------------------------------------------------
// Remote file helpers
// ---------------------------------------------------------------------------

async function listRemoteDeviceFiles(
  backend: ISyncBackend,
): Promise<{ deviceId: string; path: string }[]> {
  try {
    const files = await backend.listDir(SYNC_DIR);
    return files
      .filter((f) => !f.isDirectory && f.name.startsWith("device-") && f.name.endsWith(".json"))
      .map((f) => ({
        deviceId: f.name.replace(/^device-/, "").replace(/\.json$/, ""),
        path: `${SYNC_DIR}/${f.name}`,
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main sync entry point
// ---------------------------------------------------------------------------

export async function runSimpleSync(
  backend: ISyncBackend,
  onProgress?: (progress: {
    phase: "database" | "files";
    operation: "upload" | "download";
    message: string;
  }) => void,
  options: SimpleSyncOptions = {},
): Promise<{
  success: boolean;
  changes: number;
  filesUploaded: number;
  filesDownloaded: number;
  error?: string;
}> {
  try {
    const { receiveOnly = false } = options;
    onProgress?.({
      phase: "database",
      operation: receiveOnly ? "download" : "upload",
      message: "准备同步...",
    });

    const lastSync = await getLastSyncTimestamp();
    const localDeviceId = await getDeviceId();
    const now = Date.now();

    // 1. Ensure remote sync directory exists
    onProgress?.({
      phase: "database",
      operation: receiveOnly ? "download" : "upload",
      message: "检查远程目录...",
    });
    try {
      await backend.ensureDirectories();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`无法创建远程同步目录，请检查存储服务配置和权限：${msg}`);
    }

    // 2. Pull and apply all other devices' changesets
    onProgress?.({ phase: "database", operation: "download", message: "获取其他设备的变更..." });
    const remoteFiles = await listRemoteDeviceFiles(backend);
    console.log(`[SimpleSync] Found ${remoteFiles.length} remote device snapshot(s)`);

    let totalApplied = 0;
    let remoteSyncError: string | null = null;
    for (const { deviceId, path } of remoteFiles) {
      // Skip our own file
      if (deviceId === localDeviceId) continue;

      try {
        console.log(`[SimpleSync] Downloading changes from device ${deviceId}...`);
        const payload = await backend.getJSON<DeviceSyncPayload>(path);
        if (!payload) continue;
        console.log(
          `[SimpleSync] Downloaded device ${deviceId}: ${Object.keys(payload.tables).length} table(s)`,
        );

        onProgress?.({
          phase: "database",
          operation: "download",
          message: `应用设备 ${deviceId.slice(0, 8)} 的变更...`,
        });
        const result = await applyChanges(payload);
        console.log(
          `[SimpleSync] Applied device ${deviceId}: applied=${result.applied}, skipped=${result.skipped}`,
        );
        totalApplied += result.applied;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        remoteSyncError = `Failed to apply changes from device ${deviceId}: ${error}`;
        console.warn(`[SimpleSync] ${remoteSyncError}`);
        break;
      }
    }

    if (remoteSyncError) {
      onProgress?.({
        phase: "database",
        operation: "download",
        message: "同步中止：远端数据读取失败",
      });
      return {
        success: false,
        changes: totalApplied,
        filesUploaded: 0,
        filesDownloaded: 0,
        error: remoteSyncError,
      };
    }

    // 3. Collect and push local changes
    let changeCount = 0;
    if (!receiveOnly) {
      onProgress?.({ phase: "database", operation: "upload", message: "收集本地变更..." });
      const localDelta = await collectChanges(lastSync);
      const snapshotPayload = await collectChanges(0);

      changeCount = Object.values(localDelta.tables).reduce(
        (sum, t) => sum + t.records.length + t.deletedIds.length,
        0,
      );

      try {
        if (changeCount > 0) {
          onProgress?.({
            phase: "database",
            operation: "upload",
            message: `上传 ${changeCount} 条变更...`,
          });
          await backend.putJSON(deviceSyncPath(localDeviceId), snapshotPayload);
        } else {
          // Keep a full snapshot on the server so devices that sync later can still
          // bootstrap from this device even when there are no new local changes.
          const existing = await backend
            .getJSON<DeviceSyncPayload>(deviceSyncPath(localDeviceId))
            .catch(() => null);
          if (!existing || now - existing.timestamp > 5 * 60 * 1000) {
            await backend.putJSON(deviceSyncPath(localDeviceId), snapshotPayload);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`上传本地变更失败，请检查网络连接或存储服务权限：${msg}`);
      }
    }

    // 4. Sync book files and covers
    let filesUploaded = 0;
    let filesDownloaded = 0;
    onProgress?.({
      phase: "files",
      operation: receiveOnly ? "download" : "upload",
      message: "同步书籍和封面文件...",
    });
    try {
      const { syncFiles } = await import("./sync-engine");
      const fileResult = await syncFiles(
        backend,
        (progress) => {
          onProgress?.({
            phase: "files",
            operation: progress.operation,
            message: progress.message || "同步文件...",
          });
        },
        receiveOnly
          ? {
              downloadRemoteBooks: true,
              disableUploads: true,
              disableRemoteDeletes: true,
            }
          : undefined,
      );
      filesUploaded = fileResult.filesUploaded;
      filesDownloaded = fileResult.filesDownloaded;
      console.log(
        `[SimpleSync] File sync: ${filesUploaded} uploaded, ${filesDownloaded} downloaded`,
      );
    } catch (e) {
      console.warn("[SimpleSync] File sync failed (non-fatal):", e);
      // Don't fail the whole sync if file sync fails
    }

    // 5. Update last sync timestamp
    await setLastSyncTimestamp(now);

    onProgress?.({
      phase: "database",
      operation: receiveOnly ? "download" : "upload",
      message: "同步完成",
    });
    return { success: true, changes: changeCount + totalApplied, filesUploaded, filesDownloaded };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[SimpleSync] Sync failed:", error);
    return { success: false, changes: 0, filesUploaded: 0, filesDownloaded: 0, error };
  }
}
