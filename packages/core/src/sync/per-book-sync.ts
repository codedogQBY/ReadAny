/**
 * Per-book cloud sync engine (WebDAV / S3).
 *
 * Replaces the per-device full-snapshot layout for cloud backends. Remote
 * layout (all under the synced root, e.g. /readany/sync):
 *
 *   index.json                 — membership + change markers, one entry per
 *                                book / thread: { b: bookUpdatedAt, a: annotationsUpdatedAt,
 *                                d: deletedAt } / { t: threadUpdatedAt, d: deletedAt }.
 *                                Written read-merge-write by every device.
 *   books/{bookId}.json        — the book row plus ALL of its highlights,
 *                                notes and bookmarks, and a per-table
 *                                `deleted` map (id → deletedAt).
 *   threads/{threadId}.json    — thread row only (title/metadata).
 *   chat/{YYYY-MM-DD}.json     — every chat message CREATED that day, with a
 *                                `deleted` map. Devices keep a pulled-day
 *                                cursor and only fetch days past it, plus
 *                                days whose file changed under the cursor
 *                                (late-arriving offline messages).
 *   profile/{table}.json       — tags / book_tags / book_groups / skills,
 *                                one uniform single-table file each.
 *   sessions/{YYYY-MM}.json    — reading_sessions monthly shards.
 *
 * Why this shape: every request carries KB-sized payloads, sync work is
 * O(changed) instead of O(library × devices), and a single giant
 * JSON.stringify/parse never runs on the renderer main thread.
 *
 * Merge rules (unchanged from the snapshot engine): last-writer-wins per row
 * on the table's timestamp column, with deleted_at breaking ties; annotations
 * and messages merge per item; deletions travel as explicit tombstone maps.
 * The shared index is a union: every writer merges what it saw before
 * writing, so a racing writer can only drop its own delta for one pass.
 *
 * Cloud sync imports the old per-device snapshot layout when it finds a
 * legacy remote index or device snapshot. The imported rows are then written
 * into this layout during the same pass. LAN sync keeps the old snapshot
 * protocol and is unaffected.
 */

import {
  cleanupOrphanedSyncRows,
  ensureNoTransaction,
  getDB,
  getDeviceId as getLocalDeviceId,
} from "../db/database";
type Row = Record<string, unknown>;
import { getPlatformService } from "../services/platform";
import {
  applyChanges,
  getLastSyncTimestamp,
  listRemoteDeviceFiles,
  localizeSyncedBookRecord,
  rememberRemoteTombstone,
  setLastSyncTimestamp,
  shouldApplyRemoteRecord,
  upsertRecord,
  withDatabaseLockRetry,
} from "./simple-sync";
import type { DeviceSyncPayload } from "./simple-sync";
import type { ISyncBackend, RemoteFile } from "./sync-backend";
import type { SyncFilesOptions } from "./sync-files";
import type { SyncProgress } from "./sync-types";

export interface PerBookSyncOptions {
  receiveOnly?: boolean;
  /** When true, bypass timestamp comparisons and force-apply all remote records */
  forceApply?: boolean;
  fileSyncOptions?: SyncFilesOptions;
}

const SYNC_ROOT = "/readany/sync";
const INDEX_PATH = `${SYNC_ROOT}/index.json`;
const BOOKS_DIR = `${SYNC_ROOT}/books`;
const THREADS_DIR = `${SYNC_ROOT}/threads`;
const CHAT_DIR = `${SYNC_ROOT}/chat`;
const PROFILE_DIR = `${SYNC_ROOT}/profile`;
const SESSIONS_DIR = `${SYNC_ROOT}/sessions`;

const CHAT_PULLED_DAY_KEY = "perbook:chat-pulled-day";
const CHAT_MERGED_DAYS_KEY = "perbook:chat-merged-days";
const CHAT_PUSHED_AT_KEY = "perbook:chat-pushed-at";

const BOOK_LOCAL_EXCLUDED_COLUMNS = ["is_vectorized", "vectorize_progress"];
const ANNOTATION_TABLES = ["highlights", "notes", "bookmarks"] as const;
type AnnotationTable = (typeof ANNOTATION_TABLES)[number];
type DeletedMap = Record<string, number>;

interface BookIndexEntry {
  /** Book row updated_at marker. */
  b?: number;
  /** Max annotations updated_at / tombstone marker for this book. */
  a?: number;
  /** Tombstone: book deleted at. */
  d?: number;
}

interface ThreadIndexEntry {
  /** Thread row updated_at marker. */
  t?: number;
  /** Tombstone: thread deleted at. */
  d?: number;
}

interface SyncIndexFile {
  schemaVersion: 2;
  updatedAt: number;
  books: Record<string, BookIndexEntry>;
  threads: Record<string, ThreadIndexEntry>;
}

function isPerBookIndex(value: unknown): value is SyncIndexFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SyncIndexFile>;
  return (
    candidate.schemaVersion === 2 &&
    !!candidate.books &&
    typeof candidate.books === "object" &&
    !!candidate.threads &&
    typeof candidate.threads === "object"
  );
}

function isLegacyDevicePayload(value: unknown): value is DeviceSyncPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DeviceSyncPayload>;
  return (
    typeof candidate.deviceId === "string" &&
    typeof candidate.timestamp === "number" &&
    !!candidate.tables &&
    typeof candidate.tables === "object"
  );
}

/**
 * Import snapshots written by the pre per-book cloud engine.
 *
 * This runs before using the new index. A legacy index uses the same path as
 * the per-book index, so treating it as an empty object would silently hide
 * all existing cloud data from a new client.
 */
export async function importLegacySnapshots(
  backend: ISyncBackend,
  onProgress: (message: string) => void,
  forceApply: boolean,
): Promise<{ imported: boolean; applied: number }> {
  const remoteFiles = await listRemoteDeviceFiles(backend);
  if (remoteFiles.length === 0) return { imported: false, applied: 0 };

  let imported = false;
  let applied = 0;
  for (const { deviceId, path } of remoteFiles) {
    try {
      const payload = await backend.getJSON<unknown>(path);
      if (!isLegacyDevicePayload(payload)) {
        console.warn(`[PerBookSync] Skipping invalid legacy snapshot from device ${deviceId}`);
        continue;
      }

      onProgress(`导入旧设备 ${deviceId.slice(0, 8)} 的同步数据...`);
      const result = await applyChanges(payload, { forceApply });
      imported = true;
      applied += result.applied;
      console.log(
        `[PerBookSync] Imported legacy snapshot from ${deviceId}: ` +
          `applied=${result.applied}, skipped=${result.skipped}`,
      );
    } catch (error) {
      console.warn(
        `[PerBookSync] Failed to import legacy snapshot from ${deviceId}:`,
        error,
      );
    }
  }

  return { imported, applied };
}

interface BookSyncFile {
  schemaVersion: 1;
  bookId: string;
  book: Row;
  highlights: Row[];
  notes: Row[];
  bookmarks: Row[];
  deleted?: Partial<Record<AnnotationTable, DeletedMap>>;
  writerDeviceId: string;
  updatedAt: number;
}

interface ThreadRowFile {
  schemaVersion: 1;
  threadId: string;
  thread: Row;
  writerDeviceId: string;
  updatedAt: number;
}

interface ChatDayFile {
  schemaVersion: 1;
  date: string;
  messages: Row[];
  deleted?: DeletedMap;
  updatedAt: number;
}

interface ProfileSyncFile {
  schemaVersion: 1;
  rows: Row[];
  deleted?: DeletedMap;
  updatedAt: number;
}

interface SessionShardFile {
  schemaVersion: 1;
  month: string;
  sessions: Row[];
  updatedAt: number;
}

interface LocalBookState {
  book: Row;
  highlights: Row[];
  notes: Row[];
  bookmarks: Row[];
  deletedMaps: Partial<Record<AnnotationTable, DeletedMap>>;
  markerB: number;
  markerA: number;
}

function isForeignKeyConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("FOREIGN KEY constraint failed") || message.includes("(code: 787)");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dayKeyOf(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function monthKeyOf(timestamp: number): string {
  return dayKeyOf(timestamp).slice(0, 7);
}

function stripBookLocalColumns(row: Row): Row {
  const copy = { ...row };
  for (const column of BOOK_LOCAL_EXCLUDED_COLUMNS) delete copy[column];
  return copy;
}

function emptyIndex(): SyncIndexFile {
  return { schemaVersion: 2, updatedAt: 0, books: {}, threads: {} };
}

/** Per-field max union of two index/thread entries (markers and tombstones). */
function mergeIndexEntry<
  T extends Partial<BookIndexEntry & ThreadIndexEntry>,
>(remote: T | undefined, ours: T | undefined): T {
  const merged = { ...(remote ?? {}), ...(ours ?? {}) } as T;
  for (const key of ["b", "a", "t", "d"] as const) {
    const remoteValue = remote?.[key];
    const ourValue = ours?.[key];
    if (remoteValue !== undefined && ourValue !== undefined) {
      merged[key] = Math.max(remoteValue, ourValue) as T[typeof key];
    }
  }
  return merged;
}

function mergeDeletedMap(
  remote: DeletedMap | undefined,
  ours: DeletedMap | undefined,
): DeletedMap | undefined {
  if (!remote && !ours) return undefined;
  const merged: DeletedMap = { ...(remote ?? {}) };
  for (const [id, ts] of Object.entries(ours ?? {})) {
    merged[id] = Math.max(merged[id] ?? 0, ts);
  }
  return merged;
}

/**
 * Change markers for every book that has annotations.
 *
 * A marker is the max of the live rows' `updated_at` AND the active tombstones'
 * `deleted_at`. Counting tombstones is what makes a *deletion* visible to the
 * change detection: a delete leaves no live row behind, so an updated_at-only
 * marker would not move, the per-book file (whose `deleted` map carries the
 * tombstones) would never be re-uploaded, and the deleting device would see the
 * remote as newer and pull its own stale rows back.
 *
 * `withPendingDeletions` additionally reports which books still carry an active
 * tombstone, so the push gate can force those files up even when every numeric
 * marker is already satisfied (a peer's later push may have carried the index
 * past our tombstone).
 */
async function localAnnotationMarkers(
  db: Awaited<ReturnType<typeof getDB>>,
): Promise<{ byBook: Map<string, number>; withPendingDeletions: Set<string> }> {
  const byBook = new Map<string, number>();
  const withPendingDeletions = new Set<string>();
  for (const table of ANNOTATION_TABLES) {
    try {
      const rows = await db.select<{ book_id: string; max_ts: number }>(
        `SELECT book_id, MAX(updated_at) AS max_ts FROM ${table} GROUP BY book_id`,
      );
      for (const row of rows) {
        byBook.set(row.book_id, Math.max(byBook.get(row.book_id) ?? 0, row.max_ts));
      }
    } catch {
      // Table may not exist on very old schemas.
    }
    try {
      const rows = await db.select<{ book_id: string; max_ts: number }>(
        `SELECT t.book_id AS book_id, MAX(t.deleted_at) AS max_ts
         FROM sync_tombstones t
         WHERE t.table_name = '${table}' AND t.book_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM ${table} WHERE id = t.id)
         GROUP BY t.book_id`,
      );
      for (const row of rows) {
        byBook.set(row.book_id, Math.max(byBook.get(row.book_id) ?? 0, row.max_ts));
        withPendingDeletions.add(row.book_id);
      }
    } catch {
      // Tombstone table may not exist on older schemas.
    }
  }
  return { byBook, withPendingDeletions };
}

/**
 * Tombstones for one book's annotation tables that are still "active": the id
 * has no live row anymore (a live row newer than the tombstone means the item
 * was resurrected locally and travels in `items` instead).
 */
async function bookAnnotationTombstones(
  db: Awaited<ReturnType<typeof getDB>>,
  bookId: string,
): Promise<Partial<Record<AnnotationTable, DeletedMap>>> {
  const result: Partial<Record<AnnotationTable, DeletedMap>> = {};
  for (const table of ANNOTATION_TABLES) {
    try {
      const rows = await db.select<{ id: string; deleted_at: number }>(
        `SELECT t.id, t.deleted_at
         FROM sync_tombstones t
         WHERE t.book_id = ? AND t.table_name = '${table}'
           AND NOT EXISTS (SELECT 1 FROM ${table} WHERE id = t.id)`,
        [bookId],
      );
      if (rows.length > 0) {
        const map: DeletedMap = {};
        for (const row of rows) map[row.id] = row.deleted_at;
        result[table] = map;
      }
    } catch {
      // Tombstone table/column may not exist on older schemas.
    }
  }
  return result;
}

async function tableTombstones(
  db: Awaited<ReturnType<typeof getDB>>,
  tableName: string,
): Promise<DeletedMap> {
  const map: DeletedMap = {};
  try {
    const rows = await db.select<{ id: string; deleted_at: number }>(
      `SELECT t.id, t.deleted_at
       FROM sync_tombstones t
       WHERE t.table_name = '${tableName}'
         AND NOT EXISTS (SELECT 1 FROM ${tableName} WHERE id = t.id)`,
    );
    for (const row of rows) map[row.id] = row.deleted_at;
  } catch {
    // Tombstone table may not exist on older schemas.
  }
  return map;
}

async function tableRows(db: Awaited<ReturnType<typeof getDB>>, tableName: string): Promise<Row[]> {
  try {
    return await db.select<Row>(`SELECT * FROM ${tableName}`);
  } catch {
    return [];
  }
}

/**
 * Whether the remote per-book file already carries every one of our active
 * tombstones (same id, same or newer timestamp). Used by the push gate to avoid
 * re-uploading a file whose deletions have already travelled.
 */
async function remoteHasOurDeletions(
  readFile: () => Promise<BookSyncFile | null>,
  localDeletions: Partial<Record<AnnotationTable, DeletedMap>>,
): Promise<boolean> {
  const remote = await readFile();
  if (!remote?.deleted) return false;
  for (const [table, map] of Object.entries(localDeletions)) {
    for (const [id, deletedAt] of Object.entries(map ?? {})) {
      const remoteDeletedAt = remote.deleted[table as AnnotationTable]?.[id];
      if (remoteDeletedAt === undefined || remoteDeletedAt < deletedAt) return false;
    }
  }
  return true;
}

/** Apply a tombstone map: delete local rows the remote already deleted. */
async function applyTombstoneMap(
  db: Awaited<ReturnType<typeof getDB>>,
  tableName: string,
  deleted: DeletedMap | undefined,
  bookId: string | undefined,
  forceApply: boolean,
  deviceId: string,
): Promise<number> {
  let applied = 0;
  // Diagnostics: report the verdict of each deletion we were told about, capped so
  // a big map cannot flood the log. "absent locally, not recorded" is the case
  // where a peer's deletion never reaches our own tombstone table — the local
  // marker then stays below the peer's and the book is re-pulled every sync.
  let reported = 0;
  const report = (lineId: string, message: string) => {
    if (reported < 12) {
      reported++;
      console.log(`[PerBookSync] tombstone ${tableName}/${lineId}: ${message}`);
    }
  };
  for (const [id, deletedAt] of Object.entries(deleted ?? {})) {
    try {
      const rows = await db.select<{ updated_at: number }>(
        `SELECT updated_at FROM ${tableName} WHERE id = ?`,
        [id],
      );
      if (rows.length === 0) {
        // The peer deleted a row this device never had. Remember it anyway: our own
        // marker has to reach the peer's `deleted_at`, otherwise the book is
        // re-pulled on every sync (the marker can never catch up), and the deletion
        // is not carried on to other peers either.
        await rememberRemoteTombstone(db, tableName, id, deletedAt, deviceId, bookId);
        report(id, `absent locally, tombstone recorded (deleted_at=${deletedAt})`);
        continue;
      }
      const localTs = rows[0]?.updated_at ?? 0;
      if (!forceApply && deletedAt < localTs) {
        // Local row was edited after the remote deletion — keep it; it will
        // re-sync as a resurrection.
        report(id, `skipped, local ${localTs} >= remote ${deletedAt}`);
        continue;
      }
      await db.execute(`DELETE FROM ${tableName} WHERE id = ?`, [id]);
      applied++;
      await rememberRemoteTombstone(db, tableName, id, deletedAt, deviceId, bookId);
      report(id, `deleted locally (localTs=${localTs}, deleted_at=${deletedAt})`);
    } catch (error) {
      console.warn(`[PerBookSync] Failed to apply deletion ${tableName}/${id}:`, error);
    }
  }
  return applied;
}

/** Merge two row lists by id, taking the newer row per timestamp key. */
function mergeItemRows(localRows: Row[], remoteRows: Row[] | undefined, tsKey: string): Row[] {
  if (!remoteRows || remoteRows.length === 0) return localRows;
  const byId = new Map<string, Row>();
  for (const row of localRows) byId.set(String(row.id), row);
  for (const row of remoteRows) {
    const id = String(row.id);
    const local = byId.get(id);
    if (!local) {
      byId.set(id, row);
      continue;
    }
    if (Number(row[tsKey] ?? 0) > Number(local[tsKey] ?? 0)) byId.set(id, row);
  }
  return [...byId.values()];
}

async function loadLocalBookState(
  db: Awaited<ReturnType<typeof getDB>>,
  bookId: string,
  markers: Map<string, number>,
): Promise<LocalBookState | null> {
  const rows = await db.select<Row>("SELECT * FROM books WHERE id = ?", [bookId]);
  const book = rows[0];
  if (!book) return null;
  const [highlights, notes, bookmarks] = await Promise.all([
    db.select<Row>("SELECT * FROM highlights WHERE book_id = ?", [bookId]),
    db.select<Row>("SELECT * FROM notes WHERE book_id = ?", [bookId]),
    db.select<Row>("SELECT * FROM bookmarks WHERE book_id = ?", [bookId]),
  ]);
  return {
    book: stripBookLocalColumns(book),
    highlights,
    notes,
    bookmarks,
    deletedMaps: await bookAnnotationTombstones(db, bookId),
    markerB: Number(book.updated_at ?? 0),
    markerA: markers.get(bookId) ?? 0,
  };
}

/**
 * Drop rows that the merged tombstone map declares deleted (same rule the pull
 * side applies: a row only survives when it is strictly newer than the
 * tombstone). Keeps an uploaded file self-consistent — no row shipped together
 * with a deletion that is newer than it.
 */
function dropDeletedRows(
  rows: Row[],
  deleted: DeletedMap | undefined,
  tsKey = "updated_at",
): Row[] {
  if (!deleted) return rows;
  return rows.filter((row) => {
    const deletedAt = deleted[String(row.id)];
    return deletedAt === undefined || deletedAt < Number(row[tsKey] ?? 0);
  });
}

/**
 * The newest marker a remote file itself proves it contains: the newest row
 * timestamp and the newest tombstone timestamp across the annotation tables, plus
 * the book row. The index entry advertises the same two numbers as seen by the
 * pushing device, so `file < index` means the file is missing data the index
 * claims exists (stale read, lost write, or a peer that never uploaded).
 */
function bookFileMarkers(file: BookSyncFile): { b: number; a: number } {
  let a = 0;
  for (const table of ANNOTATION_TABLES) {
    for (const row of (file[table] ?? []) as Row[]) {
      a = Math.max(a, Number(row.updated_at ?? 0));
    }
    for (const deletedAt of Object.values(file.deleted?.[table] ?? {})) {
      a = Math.max(a, Number(deletedAt));
    }
  }
  return { b: Number(file.book?.updated_at ?? 0), a };
}

function buildBookFile(
  local: LocalBookState,
  remote: BookSyncFile | null,
  deviceId: string,
): BookSyncFile {
  const deleted: Partial<Record<AnnotationTable, DeletedMap>> = {};
  for (const table of ANNOTATION_TABLES) {
    const merged = mergeDeletedMap(remote?.deleted?.[table], local.deletedMaps?.[table]);
    if (merged && Object.keys(merged).length > 0) deleted[table] = merged;
  }
  return {
    schemaVersion: 1,
    bookId: local.book.id as string,
    book: mergeItemRows([local.book], remote?.book ? [remote.book] : undefined, "updated_at")[0],
    highlights: dropDeletedRows(
      mergeItemRows(local.highlights, remote?.highlights, "updated_at"),
      deleted.highlights,
    ),
    notes: dropDeletedRows(mergeItemRows(local.notes, remote?.notes, "updated_at"), deleted.notes),
    bookmarks: dropDeletedRows(
      mergeItemRows(local.bookmarks, remote?.bookmarks, "updated_at"),
      deleted.bookmarks,
    ),
    deleted,
    writerDeviceId: deviceId,
    updatedAt: Date.now(),
  };
}

async function applyBookFile(
  db: Awaited<ReturnType<typeof getDB>>,
  file: BookSyncFile,
  forceApply: boolean,
  deviceId: string,
): Promise<number> {
  let applied = 0;
  await withDatabaseLockRetry(async () => {
    await ensureNoTransaction();

    const bookRow = file.book ?? {};
    const localRows = await db.select<Row>("SELECT * FROM books WHERE id = ?", [file.bookId]);
    const local = localRows[0] as Row | undefined;
    const localState = local
      ? {
          timestamp: Number(local.updated_at ?? 0),
          deletedAt:
            local.deleted_at === null || local.deleted_at === undefined
              ? null
              : Number(local.deleted_at),
        }
      : undefined;

    // Diagnostics: one line per book describing what this apply actually wrote,
    // so a "pulled but nothing changed" loop can be read straight off the log.
    let bookRowVerdict: "applied" | "rejected" | "absent" = "absent";
    if (forceApply || shouldApplyRemoteRecord(bookRow, "updated_at", localState)) {
      const localized = Number(bookRow.deleted_at ?? 0)
        ? bookRow
        : localizeSyncedBookRecord(bookRow);
      await upsertRecord(db, "books", localized, "id");
      applied++;
      bookRowVerdict = "applied";
    } else {
      bookRowVerdict = "rejected";
    }

    // Local deletions are authoritative for rows the remote still ships at an
    // older timestamp (the engine's rule: last writer wins, `deleted_at` breaks
    // ties). Without this, pulling a stale file that still contains a row we
    // already deleted re-creates the row — and the tombstone then stops being
    // "active", so the deletion is silently lost. Skipped under forceApply,
    // which means "the remote is the truth" (restore / forced download).
    const localDeletions = forceApply ? {} : await bookAnnotationTombstones(db, file.bookId);

    const tableSummaries: string[] = [];
    let tombstonesApplied = 0;
    for (const table of ANNOTATION_TABLES) {
      const items = (file[table] ?? []) as Row[];
      const deletedLocally = localDeletions[table];
      let tableApplied = 0;
      let tableRejected = 0;
      let tableLocalTombstone = 0;
      let tableOrphaned = 0;
      for (const item of items) {
        const localDeletedAt = deletedLocally?.[String(item.id)];
        if (localDeletedAt !== undefined && localDeletedAt >= Number(item.updated_at ?? 0)) {
          tableLocalTombstone++;
          continue;
        }
        const itemRows = await db.select<{ updated_at: number }>(
          `SELECT updated_at FROM ${table} WHERE id = ?`,
          [String(item.id)],
        );
        const itemState = itemRows[0]
          ? { timestamp: Number(itemRows[0].updated_at ?? 0), deletedAt: null }
          : undefined;
        if (forceApply || shouldApplyRemoteRecord(item, "updated_at", itemState)) {
          try {
            await upsertRecord(db, table, item, "id");
            applied++;
            tableApplied++;
          } catch (error) {
            if (isForeignKeyConstraintError(error)) {
              tableOrphaned++;
              console.warn(
                `[PerBookSync] Skipping orphaned ${table}/${String(item.id)}: ${String(error)}`,
              );
            } else {
              throw error;
            }
          }
        } else {
          tableRejected++;
        }
      }

      const tableTombstones = await applyTombstoneMap(
        db,
        table,
        file.deleted?.[table],
        file.bookId,
        forceApply,
        deviceId,
      );
      applied += tableTombstones;
      tombstonesApplied += tableTombstones;
      tableSummaries.push(
        `${table}=${tableApplied}/${items.length}` +
          `(older=${tableRejected},localTombstone=${tableLocalTombstone},orphaned=${tableOrphaned})`,
      );
    }

    console.log(
      `[PerBookSync] apply ${file.bookId}: bookRow=${bookRowVerdict}` +
        `(remote=${Number(bookRow.updated_at ?? 0)},local=${localState?.timestamp ?? 0},localRow=${local ? "yes" : "no"})` +
        ` ${tableSummaries.join(" ")} tombstones=${tombstonesApplied}`,
    );
  }, "apply book file");
  return applied;
}

async function getMetadata(key: string): Promise<string | null> {
  const db = await getDB();
  try {
    const rows = await db.select<{ value: string }>(
      "SELECT value FROM sync_metadata WHERE key = ?",
      [key],
    );
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function setMetadata(key: string, value: string): Promise<void> {
  const db = await getDB();
  try {
    await db.execute("INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)", [
      key,
      value,
    ]);
  } catch {
    // Metadata table may not exist on very old schemas.
  }
}

export async function runPerBookSync(
  backend: ISyncBackend,
  onProgress?: (progress: SyncProgress) => void,
  options: PerBookSyncOptions = {},
): Promise<{
  success: boolean;
  changes: number;
  filesUploaded: number;
  filesDownloaded: number;
  filesUploadFailed: number;
  filesDownloadFailed: number;
  error?: string;
}> {
  const { receiveOnly = false, forceApply = false } = options;
  try {
    const db = await getDB();
    const deviceId = await getLocalDeviceId();
    const platform = getPlatformService();
    let changes = 0;

    const progress = (message: string) => {
      onProgress?.({
        phase: "database",
        operation: receiveOnly ? "download" : "upload",
        completedFiles: 0,
        totalFiles: 0,
        message,
      });
    };

    // 0. Maintenance
    await ensureNoTransaction();
    if (platform.isDesktop) {
      try {
        await cleanupOrphanedSyncRows(db);
      } catch {
        // Best-effort maintenance.
      }
    }

    // 1. Remote directory skeleton
    progress("检查远程目录...");
    for (const dir of [BOOKS_DIR, THREADS_DIR, CHAT_DIR, PROFILE_DIR, SESSIONS_DIR]) {
      try {
        await backend.ensureDirectory?.(dir);
      } catch (error) {
        // Flaky tunnels fail individual MKCOLs; per-file self-heal retries
        // later, so a missed directory must not abort the whole sync.
        console.warn(`[PerBookSync] ensureDirectory ${dir} failed (continuing):`, error);
      }
    }

    // 2. Index (pull) and legacy migration
    const rawRemoteIndex = await backend.getJSON<unknown>(INDEX_PATH);
    let legacyImported = false;
    if (!isPerBookIndex(rawRemoteIndex)) {
      const migration = await importLegacySnapshots(backend, progress, forceApply);
      legacyImported = migration.imported;
      changes += migration.applied;
    }
    const remoteIndex = isPerBookIndex(rawRemoteIndex) ? rawRemoteIndex : emptyIndex();

    // 3. Books — pull
    const annotationMarkers = (await localAnnotationMarkers(db)).byBook;
    const bookRows = await tableRows(db, "books");
    const localBooksById = new Map<string, Row>();
    for (const row of bookRows) localBooksById.set(String(row.id), row);

    // Books whose remote file turned out to be behind the index while this device
    // still holds newer data — the push phase must re-upload them (see the pull loop).
    const repairBooks = new Set<string>();
    // One remote read per book per run: the push phase asks for the same file
    // twice for books with pending deletions (deletion check + repair check), which
    // are both real network reads now that responses are forced uncacheable. The
    // entry is dropped whenever we upload the file ourselves.
    const bookFileReads = new Map<string, BookSyncFile | null>();
    const readBookFile = async (bookId: string): Promise<BookSyncFile | null> => {
      if (bookFileReads.has(bookId)) return bookFileReads.get(bookId) ?? null;
      const file = await backend
        .getJSON<BookSyncFile>(`${BOOKS_DIR}/${bookId}.json`)
        .catch(() => null);
      bookFileReads.set(bookId, file);
      return file;
    };
    progress("拉取书籍数据...");
    let pullFailures = 0;
    for (const [bookId, entry] of Object.entries(remoteIndex.books ?? {})) {
      const localRow = localBooksById.get(bookId);
      const localB = Number(localRow?.updated_at ?? 0);
      const localA = annotationMarkers.get(bookId) ?? 0;

      // Remote deletion wins when newer than anything local.
      if (entry.d !== undefined && entry.d >= Math.max(localB, localA) && localRow) {
        const { deleteBook } = await import("../db/database");
        await withDatabaseLockRetry(
          async () => {
            await ensureNoTransaction();
            await deleteBook(bookId);
          },
          "apply remote book deletion",
        );
        localBooksById.delete(bookId);
        changes++;
        continue;
      }

      // Compare the book row and the annotations SEPARATELY. `books.updated_at`
      // is bumped by purely local actions — opening a book stamps
      // `last_opened_at` through updateBook — so a device that merely opened the
      // book has a book row newer than the index's `b` while its annotations may
      // still be far behind `a`. Folding both into one max let that device report
      // "in sync" and skip the pull forever, freezing its annotations.
      const remoteBookNewer = (entry.b ?? 0) > localB;
      const remoteAnnotationsNewer = (entry.a ?? 0) > localA;
      if (!localRow && !remoteBookNewer && !remoteAnnotationsNewer) continue;
      if (localRow && !remoteBookNewer && !remoteAnnotationsNewer && !forceApply) {
        console.log(
          `[PerBookSync] book ${bookId} in sync (book remote=${entry.b ?? 0} local=${localB}, annotations remote=${entry.a ?? 0} local=${localA})`,
        );
        continue;
      }
      console.log(
        `[PerBookSync] book ${bookId} pull (book ${entry.b ?? 0}/${localB}, annotations ${entry.a ?? 0}/${localA}, localRow=${Boolean(localRow)})`,
      );

      try {
        const file = await backend.getJSON<BookSyncFile>(`${BOOKS_DIR}/${bookId}.json`);
        if (!file || file.schemaVersion !== 1) {
          console.warn(`[PerBookSync] Missing/invalid book file for ${bookId}; skipping`);
          continue;
        }
        // Diagnostics: what the remote file actually holds. A file whose book row
        // is older than the index entry means the remote served a stale body.
        const deletedCounts = (file.deleted ?? {}) as Record<string, DeletedMap>;
        console.log(
          `[PerBookSync] file ${bookId}: schema=${file.schemaVersion}` +
            ` rows(h=${(file.highlights ?? []).length},n=${(file.notes ?? []).length},b=${(file.bookmarks ?? []).length})` +
            ` deleted(h=${Object.keys(deletedCounts.highlights ?? {}).length},n=${Object.keys(deletedCounts.notes ?? {}).length},b=${Object.keys(deletedCounts.bookmarks ?? {}).length})` +
            ` book.updated_at=${Number(file.book?.updated_at ?? 0)} writer=${String(file.writerDeviceId ?? "?")}` +
            ` index(b=${entry.b ?? 0},a=${entry.a ?? 0})`,
        );
        progress(`应用书籍 ${String(file.book?.title ?? bookId).slice(0, 24)}...`);
        changes += await applyBookFile(db, file, forceApply, deviceId);

        // A file that is behind its own index advertises data the file does not
        // contain: the remote copy was lost (a peer read a stale body and merged it
        // back, an upload failed, or a cache served an old version). Nothing repairs
        // that on its own — the device owning the newer markers sees "the index
        // already has my markers" and skips its push. So if THIS device holds data
        // newer than the file, force a re-upload of this book.
        const fileMarkers = bookFileMarkers(file);
        const indexAhead = (entry.b ?? 0) > fileMarkers.b || (entry.a ?? 0) > fileMarkers.a;
        if (indexAhead) {
          const weAreAhead = localB > fileMarkers.b || localA > fileMarkers.a;
          const ownerNote = weAreAhead
            ? "this device has newer data and will re-upload to repair it"
            : "nothing newer locally, waiting for the device holding those markers";
          console.warn(
            `[PerBookSync] book ${bookId} remote file is behind the index (index b=${entry.b ?? 0}/a=${entry.a ?? 0} vs file b=${fileMarkers.b}/a=${fileMarkers.a}); ${ownerNote}`,
          );
          if (weAreAhead) repairBooks.add(bookId);
        }
        await sleep(0);
      } catch (error) {
        pullFailures++;
        console.warn(`[PerBookSync] Failed to pull book ${bookId} (will retry next sync):`, error);
      }
    }

    // 4. Books — push (read-merge-write)
    console.log("[PBT] phase4 books-push receiveOnly=", receiveOnly);
    const refreshed = await localAnnotationMarkers(db);
    const refreshedMarkers = refreshed.byBook;
    const pendingIndexBooks: Record<string, BookIndexEntry> = {};
    if (!receiveOnly) {
      progress("上传书籍数据...");
      const liveBooks = await tableRows(db, "books");
      let processed = 0;
      let pushFailures = 0;
      for (const row of liveBooks) {
        const bookId = String(row.id);
        const entry = remoteIndex.books?.[bookId];
        const markerB = Number(row.updated_at ?? 0);
        const markerA = refreshedMarkers.get(bookId) ?? 0;
        const markersSatisfied =
          entry !== undefined &&
          markerB <= (entry.b ?? 0) &&
          markerA <= (entry.a ?? 0) &&
          entry.d === undefined;
        // Markers satisfied does not mean "nothing to upload": a book with local
        // deletions can be marker-satisfied when a peer's later push moved the
        // index past our tombstone timestamp, and those deletions still have to
        // reach the peers. The extra remote read happens only for books that are
        // otherwise in sync and still carry an active tombstone.
        const repairPushBase = repairBooks.has(bookId);
        const unchangedLocally =
          markersSatisfied &&
          (!refreshed.withPendingDeletions.has(bookId) ||
            (await remoteHasOurDeletions(
              () => readBookFile(bookId),
              await bookAnnotationTombstones(db, bookId),
            )));
        let repairPush = repairPushBase;

        // Self-heal for "the index advertises data the file does not contain", the
        // state left behind when a peer read a stale body and merged it back (or a
        // cache/proxy served an old version): the device that owns the newest
        // markers sees the index already carrying them and skips its push, so
        // nothing would ever repair the file. Verify before skipping — but only for
        // books where this device owns annotations (a handful per library), so the
        // extra read stays cheap. The pull loop reports the same condition when the
        // index is newer than the file.
        if (unchangedLocally && !forceApply && !repairPush && markerA > 0 && (entry?.a ?? 0) === markerA) {
          const remoteFile = await readBookFile(bookId);
          // A failed read proves nothing about the file — skip the check instead of
          // treating "unknown" as "empty".
          if (remoteFile) {
            const fileMarkers = bookFileMarkers(remoteFile);
            if (fileMarkers.a < markerA || fileMarkers.b < markerB) {
              repairPush = true;
              console.warn(
                `[PerBookSync] book ${bookId} remote file is behind the index it advertises (index b=${markerB}/a=${markerA} vs file b=${fileMarkers.b}/a=${fileMarkers.a}); re-uploading this device's data to repair it`,
              );
            }
          }
        }

        if (unchangedLocally && !forceApply && !repairPush) {
          console.log(`[PerBookSync] book ${bookId} push skipped (in sync)`);
          continue;
        }
        console.log(
          repairPush
            ? `[PerBookSync] book ${bookId} push (repair: remote file was behind the index) (localB=${markerB}, localA=${markerA}, remote=${JSON.stringify(entry)})`
            : `[PerBookSync] book ${bookId} push (localB=${markerB}, localA=${markerA}, remote=${JSON.stringify(entry)})`,
        );

        const local = await loadLocalBookState(db, bookId, refreshedMarkers);
        if (!local) continue;
        try {
          // Reuse this run's read when it succeeded; otherwise fetch for real and
          // let a failure abort the push. Writing a file built without the peer's
          // rows would delete the peer's data, so this read must not be replaced by
          // a "null on failure" cache hit.
          const remoteFile =
            bookFileReads.get(bookId) ??
            (await backend.getJSON<BookSyncFile>(`${BOOKS_DIR}/${bookId}.json`));
          const file = buildBookFile(local, remoteFile, deviceId);
          await backend.putJSON(`${BOOKS_DIR}/${bookId}.json`, file);
          bookFileReads.delete(bookId);
          pendingIndexBooks[bookId] = mergeIndexEntry(entry, {
          b: markerB,
          a: markerA,
          d:
            row.deleted_at === null || row.deleted_at === undefined
              ? undefined
              : Number(row.deleted_at),
        });
        processed++;
        changes++;
        if (processed % 5 === 0) {
          progress(`上传书籍数据 (${processed})...`);
          await sleep(0);
        }
        } catch (error) {
          pushFailures++;
          console.warn(
            `[PerBookSync] Failed to push book ${bookId} (will retry next sync):`,
            error,
          );
        }
      }

      // Book tombstones → index
      const bookTombstonesMap = await tableTombstones(db, "books");
      for (const [id, deletedAt] of Object.entries(bookTombstonesMap)) {
        const entry = remoteIndex.books?.[id];
        if (entry?.d !== undefined && entry.d >= deletedAt) continue;
        pendingIndexBooks[id] = mergeIndexEntry(entry, { d: deletedAt });
      }
    }

    // 5. Threads — thread rows only (small files, index markers)
    progress("同步会话元数据...");
    const threadRows = await tableRows(db, "threads");
    const threadMarkers = new Map<string, number>();
    for (const row of threadRows) {
      threadMarkers.set(String(row.id), Number(row.updated_at ?? 0));
    }
    const threadTombstonesMap = await tableTombstones(db, "threads");
    const pendingIndexThreads: Record<string, ThreadIndexEntry> = {};

    for (const [threadId, entry] of Object.entries(remoteIndex.threads ?? {})) {
      const localT = threadMarkers.get(threadId) ?? 0;
      if (entry.d !== undefined && entry.d >= localT && threadMarkers.has(threadId)) {
        const { deleteThread } = await import("../db/database");
        await withDatabaseLockRetry(
          async () => {
            await ensureNoTransaction();
            await deleteThread(threadId);
          },
          "apply remote thread deletion",
        );
        threadMarkers.delete(threadId);
        changes++;
        continue;
      }
      if (entry.t === undefined || entry.t <= localT) continue;
      const file = await backend.getJSON<ThreadRowFile>(`${THREADS_DIR}/${threadId}.json`);
      if (!file || file.schemaVersion !== 1) continue;
      await withDatabaseLockRetry(
        async () => {
          await ensureNoTransaction();
          await upsertRecord(db, "threads", file.thread, "id");
        },
        "apply thread row",
      );
      changes++;
      await sleep(0);
    }

    if (!receiveOnly) {
      for (const thread of threadRows) {
        const threadId = String(thread.id);
        const entry = remoteIndex.threads?.[threadId];
        const markerT = Number(thread.updated_at ?? 0);
        if (entry?.t !== undefined && markerT <= entry.t) continue;
        const remote = await backend.getJSON<ThreadRowFile>(`${THREADS_DIR}/${threadId}.json`);
        const file: ThreadRowFile = {
          schemaVersion: 1,
          threadId,
          thread: mergeItemRows([thread], remote?.thread ? [remote.thread] : undefined, "updated_at")[0],
          writerDeviceId: deviceId,
          updatedAt: Date.now(),
        };
        await backend.putJSON(`${THREADS_DIR}/${threadId}.json`, file);
        pendingIndexThreads[threadId] = mergeIndexEntry(entry, { t: markerT });
        changes++;
        await sleep(0);
      }
      for (const [id, deletedAt] of Object.entries(threadTombstonesMap)) {
        const entry = remoteIndex.threads?.[id];
        if (entry?.d !== undefined && entry.d >= deletedAt) continue;
        pendingIndexThreads[id] = mergeIndexEntry(entry, { d: deletedAt });
      }
    }

    // 6. Chat messages — daily files
    progress("同步聊天记录...");
    {
      const pulledDay = (await getMetadata(CHAT_PULLED_DAY_KEY)) ?? "";
      const mergedDaysRaw = await getMetadata(CHAT_MERGED_DAYS_KEY);
      const mergedDayVersions: Record<string, number> = mergedDaysRaw
        ? JSON.parse(mergedDaysRaw)
        : {};

      // Messages we deleted locally (active tombstones). Used twice: to refuse
      // re-creating a message a day file still carries, and to announce our
      // deletions to the peers (see the push phase below).
      const localMessageDeletions = await tableTombstones(db, "messages");

      // Pull: every remote day file that is past our cursor, or whose file
      // changed under the cursor (offline devices write old days).
      const dayEntries = await backend
        .listDir(CHAT_DIR)
        .catch(() => [] as RemoteFile[]);
      const dayFiles = dayEntries
        .filter((e) => !e.isDirectory && /^\d{4}-\d{2}-\d{2}\.json$/.test(e.name))
        .map((e) => ({ day: e.name.replace(/\.json$/, ""), lastModified: e.lastModified }))
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

      for (const { day, lastModified } of dayFiles) {
        const pastCursor = day > pulledDay;
        // Cheap up-front filter for the days under our cursor: the PROPFIND
        // listing already carries lastModified, so most unchanged days can be
        // skipped without downloading the file at all.
        //
        // lastModified is only a hint — it has second granularity and comes
        // from the server clock — so it can produce a false negative when a
        // write lands in the same second as the recorded version. The
        // authoritative check is the payload's own `updatedAt`, which is read
        // below from the body we already fetched. A day skipped here is one
        // whose modified time is not newer than the version we applied, which
        // is the same conclusion the payload check would reach.
        const mergedVersion = mergedDayVersions[day] ?? 0;
        if (!pastCursor && lastModified > 0 && lastModified <= mergedVersion) continue;

        const file = await backend.getJSON<ChatDayFile>(`${CHAT_DIR}/${day}.json`);
        if (!file || file.schemaVersion !== 1) continue;
        // Now that the body is in hand, confirm against the real version.
        if (!pastCursor && !(file.updatedAt > mergedVersion)) continue;
        await withDatabaseLockRetry(
          async () => {
            await ensureNoTransaction();
            for (const message of file.messages ?? []) {
              const rows = await db.select<{ created_at: number }>(
                "SELECT created_at FROM messages WHERE id = ?",
                [String(message.id)],
              );
              if (rows.length === 0) {
                // A day file written before our deletion still lists the row —
                // never resurrect something we deleted locally.
                const localDeletedAt = localMessageDeletions[String(message.id)];
                if (
                  localDeletedAt !== undefined &&
                  localDeletedAt >= Number(message.created_at ?? 0)
                ) {
                  continue;
                }
                try {
                  await upsertRecord(db, "messages", message, "id");
                  changes++;
                } catch (error) {
                  if (!isForeignKeyConstraintError(error)) throw error;
                }
              } else if (Number(message.created_at ?? 0) > Number(rows[0].created_at ?? 0)) {
                await upsertRecord(db, "messages", message, "id");
              }
            }
            await applyTombstoneMap(db, "messages", file.deleted, undefined, forceApply, deviceId);
          },
          "apply chat day file",
        );
        mergedDayVersions[day] = file.updatedAt;
        if (day > pulledDay) {
          await setMetadata(CHAT_PULLED_DAY_KEY, day);
        }
        await setMetadata(CHAT_MERGED_DAYS_KEY, JSON.stringify(mergedDayVersions));
        await sleep(0);
      }

      // Push: day files containing messages created after our last push, plus
      // the day files that have to announce a local deletion.
      if (!receiveOnly) {
        const pushedAt = legacyImported
          ? 0
          : Number((await getMetadata(CHAT_PUSHED_AT_KEY)) ?? 0);
        const newMessages = await db
          .select<Row>("SELECT * FROM messages WHERE created_at > ?", [pushedAt])
          .catch(() => [] as Row[]);
        const byDay = new Map<string, Row[]>();
        for (const message of newMessages) {
          const day = dayKeyOf(Number(message.created_at ?? Date.now()));
          const list = byDay.get(day) ?? [];
          list.push(message);
          byDay.set(day, list);
        }

        // A message tombstone carries no day of its own, so it is announced in
        // the day file of the moment it was deleted; the peer then refuses to
        // re-create that id from whichever day file still lists it.
        const deletionByDay = new Map<string, DeletedMap>();
        for (const [id, deletedAt] of Object.entries(localMessageDeletions)) {
          const day = dayKeyOf(deletedAt);
          const map = deletionByDay.get(day) ?? {};
          map[id] = deletedAt;
          deletionByDay.set(day, map);
        }

        const pushDays = new Set<string>([...byDay.keys(), ...deletionByDay.keys()]);
        for (const day of pushDays) {
          const localMessages = byDay.get(day) ?? [];
          const remote = await backend.getJSON<ChatDayFile>(`${CHAT_DIR}/${day}.json`);
          const deleted = mergeDeletedMap(remote?.deleted, deletionByDay.get(day));
          const file: ChatDayFile = {
            schemaVersion: 1,
            date: day,
            messages: dropDeletedRows(
              mergeItemRows(localMessages, remote?.messages, "created_at"),
              deleted,
              "created_at",
            ),
            deleted: deleted && Object.keys(deleted).length > 0 ? deleted : undefined,
            updatedAt: Date.now(),
          };
          await backend.putJSON(`${CHAT_DIR}/${day}.json`, file);
          mergedDayVersions[day] = file.updatedAt;
          changes += localMessages.length + Object.keys(deletionByDay.get(day) ?? {}).length;
          await sleep(0);
        }
        if (pushDays.size > 0) {
          await setMetadata(CHAT_MERGED_DAYS_KEY, JSON.stringify(mergedDayVersions));
        }
        await setMetadata(CHAT_PUSHED_AT_KEY, String(Date.now()));
      }
    }

    // 7. Profile files — one uniform single-table file per table
    console.log("[PBT] phase7 profile receiveOnly=", receiveOnly);
    {
      progress("同步标签与技能...");
      const profileTables = ["tags", "book_tags", "book_groups", "skills"];
      for (const table of profileTables) {
        const path = `${PROFILE_DIR}/${table}.json`;
        const remote = await backend.getJSON<ProfileSyncFile>(path);

        // Pull: apply the peer's rows (last writer wins) and its deletions, so a
        // tag / group / skill created or deleted on another device lands here
        // too. Rows whose parent is missing locally (book_tags pointing at a book
        // or tag this device does not have) are skipped instead of failing.
        if (remote) {
          await withDatabaseLockRetry(
            async () => {
              await ensureNoTransaction();
              for (const row of remote.rows ?? []) {
                const existing = await db
                  .select<{ updated_at: number }>(
                    `SELECT updated_at FROM ${table} WHERE id = ?`,
                    [String(row.id)],
                  )
                  .catch(() => [] as { updated_at: number }[]);
                const state = existing[0]
                  ? { timestamp: Number(existing[0].updated_at ?? 0), deletedAt: null }
                  : undefined;
                if (!forceApply && !shouldApplyRemoteRecord(row, "updated_at", state)) continue;
                try {
                  await upsertRecord(db, table, row, "id");
                  changes++;
                } catch (error) {
                  if (!isForeignKeyConstraintError(error)) throw error;
                }
              }
              changes += await applyTombstoneMap(
                db,
                table,
                remote.deleted,
                undefined,
                forceApply,
                deviceId,
              );
            },
            `apply ${table} profile file`,
          );
        }

        if (receiveOnly) continue;

        // Push: read-merge-write. Rows the merged tombstone map declares deleted
        // are dropped from the file — otherwise a peer that still has the row
        // keeps shipping it back and the deletion never converges.
        const localRows = await tableRows(db, table);
        const rows = mergeItemRows(localRows, remote?.rows, "updated_at");
        const localDeleted = await tableTombstones(db, table);
        const deleted = mergeDeletedMap(remote?.deleted, localDeleted);
        const file: ProfileSyncFile = {
          schemaVersion: 1,
          rows: dropDeletedRows(rows, deleted),
          deleted: deleted && Object.keys(deleted).length > 0 ? deleted : undefined,
          updatedAt: Date.now(),
        };
        await backend.putJSON(path, file);
        changes += rows.length;
        await sleep(0);
      }
    }

    // 8. Reading sessions — monthly shards
    progress("同步阅读统计...");
    const lastSync = legacyImported ? 0 : await getLastSyncTimestamp();
    const changedSessions = await db
      .select<Row>("SELECT * FROM reading_sessions WHERE updated_at > ?", [lastSync])
      .catch(() => [] as Row[]);
    if (!receiveOnly) {
      const byMonth = new Map<string, Row[]>();
      for (const session of changedSessions) {
        const startedAt = Number(session.started_at ?? session.updated_at ?? 0);
        const month = monthKeyOf(startedAt || Number(session.updated_at ?? Date.now()));
        const list = byMonth.get(month) ?? [];
        list.push(session);
        byMonth.set(month, list);
      }
      for (const [month, sessions] of byMonth) {
        const path = `${SESSIONS_DIR}/${month}.json`;
        const remote = await backend.getJSON<SessionShardFile>(path);
        const merged = mergeItemRows(sessions, remote?.sessions, "updated_at");
        const file: SessionShardFile = {
          schemaVersion: 1,
          month,
          sessions: merged,
          updatedAt: Date.now(),
        };
        await backend.putJSON(path, file);
        changes += sessions.length;
        await sleep(0);
      }
    }
    const shardEntries = await backend
      .listDir(SESSIONS_DIR)
      .catch(() => [] as RemoteFile[]);
    for (const shard of shardEntries) {
      if (shard.isDirectory || !shard.name.endsWith(".json")) continue;
      const file = await backend.getJSON<SessionShardFile>(
        shard.path || `${SESSIONS_DIR}/${shard.name}`,
      );
      if (!file || file.schemaVersion !== 1) continue;
      await withDatabaseLockRetry(
        async () => {
          await ensureNoTransaction();
          for (const session of file.sessions ?? []) {
            const rows = await db.select<{ updated_at: number }>(
              "SELECT updated_at FROM reading_sessions WHERE id = ?",
              [String(session.id)],
            );
            if (rows.length === 0) {
              try {
                await upsertRecord(db, "reading_sessions", session, "id");
                changes++;
              } catch (error) {
                if (!isForeignKeyConstraintError(error)) throw error;
              }
            } else if (Number(session.updated_at ?? 0) > Number(rows[0].updated_at ?? 0)) {
              await upsertRecord(db, "reading_sessions", session, "id");
            }
          }
        },
        "apply session shard",
      );
      await sleep(0);
    }

    // 9. Index — fresh read, union, write
    console.log("[PBT] phase9 index receiveOnly=", receiveOnly);
    if (!receiveOnly) {
      const freshRemote = (await backend.getJSON<SyncIndexFile>(INDEX_PATH)) ?? emptyIndex();
      const books: Record<string, BookIndexEntry> = { ...(freshRemote.books ?? {}) };
      for (const [id, entry] of Object.entries(pendingIndexBooks)) {
        books[id] = mergeIndexEntry(books[id], entry);
      }
      const threads: Record<string, ThreadIndexEntry> = { ...(freshRemote.threads ?? {}) };
      for (const [id, entry] of Object.entries(pendingIndexThreads)) {
        threads[id] = mergeIndexEntry(threads[id], entry);
      }
      const indexFile: SyncIndexFile = {
        schemaVersion: 2,
        updatedAt: Date.now(),
        books,
        threads,
      };
      await backend.putJSON(INDEX_PATH, indexFile);
    }

    // 10. Book files and covers (unchanged engine)
    let filesUploaded = 0;
    let filesDownloaded = 0;
    let filesUploadFailed = 0;
    let filesDownloadFailed = 0;
    progress("同步书籍和封面文件...");
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
        (fileProgress) => {
          onProgress?.(fileProgress);
        },
        { ...defaultFileOptions, ...options.fileSyncOptions },
      );
      filesUploaded = fileResult.filesUploaded;
      filesDownloaded = fileResult.filesDownloaded;
      filesUploadFailed = fileResult.filesUploadFailed;
      filesDownloadFailed = fileResult.filesDownloadFailed;
    } catch (e) {
      console.warn("[PerBookSync] File sync failed (non-fatal):", e);
      filesUploadFailed = Math.max(filesUploadFailed, 1);
    }

    await setLastSyncTimestamp(Date.now());

    onProgress?.({
      phase: "database",
      operation: receiveOnly ? "download" : "upload",
      completedFiles: 0,
      totalFiles: 0,
      message: "同步完成",
    });
    return {
      success: true,
      changes,
      filesUploaded,
      filesDownloaded,
      filesUploadFailed,
      filesDownloadFailed,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[PerBookSync] Sync failed:", error);
    return {
      success: false,
      changes: 0,
      filesUploaded: 0,
      filesDownloaded: 0,
      filesUploadFailed: 0,
      filesDownloadFailed: 0,
      error,
    };
  }
}
