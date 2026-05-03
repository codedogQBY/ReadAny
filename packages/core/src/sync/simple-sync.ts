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
import type { SyncFilesOptions } from "./sync-files";

interface SyncTableConfig {
  name: string;
  pk: string;
  timestampCol: string;
  excludeColumns?: readonly string[];
}

interface ExistingRecordState {
  timestamp: number;
  deletedAt?: number | null;
}

export interface SimpleSyncOptions {
  receiveOnly?: boolean;
  /** When true, bypass timestamp comparisons and force-apply all remote records */
  forceApply?: boolean;
  fileSyncOptions?: SyncFilesOptions;
}

/** Tables included in sync, with their primary key and timestamp column */
const SYNC_TABLES: SyncTableConfig[] = [
  { name: "book_groups", pk: "id", timestampCol: "updated_at" },
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
  deletedTimestamps?: Record<string, number>;
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

  for (const { name, pk, timestampCol, excludeColumns } of SYNC_TABLES) {
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
    const deletedTimestamps: Record<string, number> = {};
    try {
      const tombstones = await db.select<{ id: string; deleted_at: number }>(
        `SELECT id, deleted_at
         FROM sync_tombstones
         WHERE table_name = ?
           AND deleted_at > ?
           AND NOT EXISTS (SELECT 1 FROM ${name} WHERE ${pk} = sync_tombstones.id)`,
        [name, since],
      );
      deletedIds = tombstones.map((t) => t.id);
      for (const t of tombstones) {
        deletedTimestamps[t.id] = t.deleted_at;
      }
    } catch {
      // sync_tombstones may not exist on older schema
    }

    if (records.length > 0 || deletedIds.length > 0) {
      payload.tables[name] = { records, deletedIds, deletedTimestamps };
    }
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Apply remote changes
// ---------------------------------------------------------------------------

export async function applyChanges(
  payload: DeviceSyncPayload,
  options: { forceApply?: boolean } = {},
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
      for (const tableInfo of SYNC_TABLES) {
        const tableName = tableInfo.name;
        const tableData = payload.tables[tableName];
        if (!tableData) continue;

        const { pk, timestampCol } = tableInfo;
        const exclude = tableInfo.excludeColumns ?? [];
        console.log(
          `[SimpleSync] Applying table ${tableName}: ${tableData.records.length} record(s), ${tableData.deletedIds.length} deletion(s)`,
        );
        const allIdsToCheck = [
          ...tableData.records.map((record) => record[pk]).filter((value) => value !== undefined),
          ...tableData.deletedIds,
        ];
        const existingRecords = await loadExistingRecordStates(
          db,
          tableName,
          pk,
          timestampCol,
          allIdsToCheck,
        );
        const remoteRecordIds = new Set(
          tableData.records
            .map((record) => record[pk])
            .filter((value) => value !== undefined)
            .map(String),
        );
        let processedRecords = 0;

        for (const record of tableData.records) {
          const pkValue = record[pk];
          const remoteTs = record[timestampCol] as number;

          const safeRecord =
            exclude.length > 0
              ? Object.fromEntries(Object.entries(record).filter(([k]) => !exclude.includes(k)))
              : record;

          const localState = existingRecords.get(String(pkValue));
          if (!options.forceApply && !shouldApplyRemoteRecord(record, timestampCol, localState)) {
            skipped++;
          } else {
            try {
              await upsertRecord(db, tableName, safeRecord, pk);
              applied++;
              existingRecords.set(String(pkValue), {
                timestamp: remoteTs,
                deletedAt: normalizeDeletedAt(record.deleted_at),
              });
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
          if (remoteRecordIds.has(String(deletedId))) {
            console.warn(
              `[SimpleSync] Ignoring stale tombstone for live ${tableName}/${deletedId} from device ${payload.deviceId}`,
            );
            skipped++;
            continue;
          }

          const deletedAt = tableData.deletedTimestamps?.[deletedId] ?? 0;
          if (!options.forceApply && deletedAt > 0) {
            const localTs = existingRecords.get(String(deletedId))?.timestamp;
            if (localTs !== undefined && localTs > deletedAt) {
              console.log(
                `[SimpleSync] Skipping deletion of ${tableName}/${deletedId}: local record is newer (${localTs} > ${deletedAt})`,
              );
              skipped++;
              continue;
            }
          }
          await db.execute(`DELETE FROM ${tableName} WHERE ${pk} = ?`, [deletedId]);
          applied++;
          existingRecords.delete(String(deletedId));
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

function normalizeDeletedAt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "number" ? value : Number(value) || null;
}

function shouldApplyRemoteRecord(
  record: Record<string, unknown>,
  timestampCol: string,
  localState: ExistingRecordState | undefined,
): boolean {
  if (!localState) return true;

  const remoteTs = record[timestampCol] as number;
  if (remoteTs > localState.timestamp) return true;
  if (remoteTs < localState.timestamp) return false;

  // Preserved book deletes are represented as regular rows with deleted_at set.
  // When timestamps tie, let the newer delete marker break the tie so devices
  // cannot stay split between live and deleted copies of the same book.
  if (!Object.prototype.hasOwnProperty.call(record, "deleted_at")) return false;

  const remoteDeletedAt = normalizeDeletedAt(record.deleted_at);
  const localDeletedAt = localState.deletedAt ?? null;
  if (remoteDeletedAt === undefined || remoteDeletedAt === localDeletedAt) return false;

  return (remoteDeletedAt ?? 0) > (localDeletedAt ?? 0);
}

async function loadExistingRecordStates(
  db: Awaited<ReturnType<typeof getDB>>,
  tableName: string,
  pk: string,
  timestampCol: string,
  ids: unknown[],
): Promise<Map<string, ExistingRecordState>> {
  const states = new Map<string, ExistingRecordState>();
  if (ids.length === 0) return states;

  const columns = await getTableColumns(db, tableName);
  const deletedAtSelect = columns.has("deleted_at") ? ", deleted_at AS deleted_at" : "";

  const chunkSize = 200;
  for (let offset = 0; offset < ids.length; offset += chunkSize) {
    const chunk = ids.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await db.select<{
      id: string;
      timestamp: number | null;
      deleted_at?: number | null;
    }>(
      `SELECT ${pk} AS id, ${timestampCol} AS timestamp${deletedAtSelect} FROM ${tableName} WHERE ${pk} IN (${placeholders})`,
      chunk,
    );

    for (const row of rows) {
      states.set(String(row.id), {
        timestamp: row.timestamp ?? 0,
        deletedAt: normalizeDeletedAt(row.deleted_at),
      });
    }
  }

  return states;
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
    const { receiveOnly = false, forceApply = false } = options;
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
        const result = await applyChanges(payload, { forceApply });
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
        if (changeCount > 0 || totalApplied > 0) {
          onProgress?.({
            phase: "database",
            operation: "upload",
            message: `上传 ${changeCount + totalApplied} 条变更...`,
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
    } else if (totalApplied > 0) {
      // receiveOnly mode: still upload merged snapshot so other devices see the result
      onProgress?.({ phase: "database", operation: "upload", message: "上传合并后的快照..." });
      try {
        const snapshotPayload = await collectChanges(0);
        await backend.putJSON(deviceSyncPath(localDeviceId), snapshotPayload);
        console.log("[SimpleSync] Uploaded merged snapshot after receive-only sync");
      } catch (e) {
        console.warn("[SimpleSync] Failed to upload merged snapshot (non-fatal):", e);
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
      const { syncFiles } = await import("./sync-files");
      const defaultFileOptions: SyncFilesOptions = receiveOnly
        ? {
            downloadRemoteBooks: true,
            disableUploads: true,
            disableRemoteDeletes: true,
          }
        : {};
      const fileResult = await syncFiles(
        backend,
        (progress) => {
          onProgress?.({
            phase: "files",
            operation: progress.operation,
            message: progress.message || "同步文件...",
          });
        },
        { ...defaultFileOptions, ...options.fileSyncOptions },
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
