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
 * Backward compatibility: intentionally none for cloud sync — devices on the
 * old engine keep using per-device snapshots among themselves; a device
 * switched to this engine starts from an empty remote layout and re-pushes
 * the full library once. LAN sync keeps the old snapshot protocol and is
 * unaffected.
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
  getLastSyncTimestamp,
  localizeSyncedBookRecord,
  setLastSyncTimestamp,
  shouldApplyRemoteRecord,
  upsertRecord,
  withDatabaseLockRetry,
} from "./simple-sync";
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

/** Batched annotation markers for every book that has any annotation. */
async function localAnnotationMarkers(
  db: Awaited<ReturnType<typeof getDB>>,
): Promise<Map<string, number>> {
  const markers = new Map<string, number>();
  for (const table of ANNOTATION_TABLES) {
    try {
      const rows = await db.select<{ book_id: string; max_ts: number }>(
        `SELECT book_id, MAX(updated_at) AS max_ts FROM ${table} GROUP BY book_id`,
      );
      for (const row of rows) {
        markers.set(row.book_id, Math.max(markers.get(row.book_id) ?? 0, row.max_ts));
      }
    } catch {
      // Table may not exist on very old schemas.
    }
  }
  return markers;
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
  for (const [id, deletedAt] of Object.entries(deleted ?? {})) {
    try {
      const rows = await db.select<{ updated_at: number }>(
        `SELECT updated_at FROM ${tableName} WHERE id = ?`,
        [id],
      );
      if (rows.length === 0) continue;
      const localTs = rows[0]?.updated_at ?? 0;
      if (!forceApply && deletedAt < localTs) {
        // Local row was edited after the remote deletion — keep it; it will
        // re-sync as a resurrection.
        continue;
      }
      await db.execute(`DELETE FROM ${tableName} WHERE id = ?`, [id]);
      applied++;
      try {
        await db.execute(
          "INSERT OR REPLACE INTO sync_tombstones (id, table_name, deleted_at, device_id, book_id) VALUES (?, ?, ?, ?, ?)",
          [id, tableName, deletedAt, deviceId, bookId ?? null],
        );
      } catch {
        // Tombstone table may not exist on older schemas.
      }
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
    highlights: mergeItemRows(local.highlights, remote?.highlights, "updated_at"),
    notes: mergeItemRows(local.notes, remote?.notes, "updated_at"),
    bookmarks: mergeItemRows(local.bookmarks, remote?.bookmarks, "updated_at"),
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

    if (forceApply || shouldApplyRemoteRecord(bookRow, "updated_at", localState)) {
      const localized = Number(bookRow.deleted_at ?? 0)
        ? bookRow
        : localizeSyncedBookRecord(bookRow);
      await upsertRecord(db, "books", localized, "id");
      applied++;
    }

    for (const table of ANNOTATION_TABLES) {
      const items = (file[table] ?? []) as Row[];
      for (const item of items) {
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
          } catch (error) {
            if (isForeignKeyConstraintError(error)) {
              console.warn(
                `[PerBookSync] Skipping orphaned ${table}/${String(item.id)}: ${String(error)}`,
              );
            } else {
              throw error;
            }
          }
        }
      }

      applied += await applyTombstoneMap(
        db,
        table,
        file.deleted?.[table],
        file.bookId,
        forceApply,
        deviceId,
      );
    }
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
      await backend.ensureDirectory?.(dir);
    }

    // 2. Index (pull)
    const remoteIndex = (await backend.getJSON<SyncIndexFile>(INDEX_PATH)) ?? emptyIndex();

    // 3. Books — pull
    const annotationMarkers = await localAnnotationMarkers(db);
    const bookRows = await tableRows(db, "books");
    const localBooksById = new Map<string, Row>();
    for (const row of bookRows) localBooksById.set(String(row.id), row);

    progress("拉取书籍数据...");
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

      const remoteMax = Math.max(entry.b ?? 0, entry.a ?? 0);
      const localMax = Math.max(localB, localA);
      if (!localRow && remoteMax === 0) continue;
      if (localRow && remoteMax <= localMax && !forceApply) {
        console.log(`[PerBookSync] book ${bookId} in sync (remote=${remoteMax}, local=${localMax})`);
        continue;
      }
      console.log(
        `[PerBookSync] book ${bookId} pull (remote=${remoteMax}, local=${localMax}, localRow=${Boolean(localRow)})`,
      );

      const file = await backend.getJSON<BookSyncFile>(`${BOOKS_DIR}/${bookId}.json`);
      if (!file || file.schemaVersion !== 1) {
        console.warn(`[PerBookSync] Missing/invalid book file for ${bookId}; skipping`);
        continue;
      }
      progress(`应用书籍 ${String(file.book?.title ?? bookId).slice(0, 24)}...`);
      changes += await applyBookFile(db, file, forceApply, deviceId);
      await sleep(0);
    }

    // 4. Books — push (read-merge-write)
    console.log("[PBT] phase4 books-push receiveOnly=", receiveOnly);
    const refreshedMarkers = await localAnnotationMarkers(db);
    const pendingIndexBooks: Record<string, BookIndexEntry> = {};
    if (!receiveOnly) {
      progress("上传书籍数据...");
      const liveBooks = await tableRows(db, "books");
      let processed = 0;
      for (const row of liveBooks) {
        const bookId = String(row.id);
        const entry = remoteIndex.books?.[bookId];
        const markerB = Number(row.updated_at ?? 0);
        const markerA = refreshedMarkers.get(bookId) ?? 0;
        const unchangedLocally =
          entry !== undefined &&
          markerB <= (entry.b ?? 0) &&
          markerA <= (entry.a ?? 0) &&
          entry.d === undefined;
        if (unchangedLocally && !forceApply) {
          console.log(`[PerBookSync] book ${bookId} push skipped (in sync)`);
          continue;
        }
        console.log(
          `[PerBookSync] book ${bookId} push (localB=${markerB}, localA=${markerA}, remote=${JSON.stringify(entry)})`,
        );

        const local = await loadLocalBookState(db, bookId, refreshedMarkers);
        if (!local) continue;
        const remoteFile = await backend.getJSON<BookSyncFile>(`${BOOKS_DIR}/${bookId}.json`);
        const file = buildBookFile(local, remoteFile, deviceId);
        await backend.putJSON(`${BOOKS_DIR}/${bookId}.json`, file);
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

      // Pull: every remote day file that is past our cursor, or whose file
      // version changed under the cursor (offline devices write old days).
      const dayEntries = await backend
        .listDir(CHAT_DIR)
        .catch(() => [] as RemoteFile[]);
      const dayFiles = dayEntries
        .filter((e) => !e.isDirectory && /^\d{4}-\d{2}-\d{2}\.json$/.test(e.name))
        .map((e) => e.name.replace(/\.json$/, ""))
        .sort();

      for (const day of dayFiles) {
        const version = (await backend.getJSON<ChatDayFile>(`${CHAT_DIR}/${day}.json`))
          ?.updatedAt;
        const pastCursor = day > pulledDay;
        const changedUnderCursor =
          !pastCursor &&
          version !== undefined &&
          version > (mergedDayVersions[day] ?? 0);
        if (!pastCursor && !changedUnderCursor) continue;

        const file = await backend.getJSON<ChatDayFile>(`${CHAT_DIR}/${day}.json`);
        if (!file || file.schemaVersion !== 1) continue;
        await withDatabaseLockRetry(
          async () => {
            await ensureNoTransaction();
            for (const message of file.messages ?? []) {
              const rows = await db.select<{ created_at: number }>(
                "SELECT created_at FROM messages WHERE id = ?",
                [String(message.id)],
              );
              if (rows.length === 0) {
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

      // Push: day files containing messages created after our last push.
      if (!receiveOnly) {
        const pushedAt = Number((await getMetadata(CHAT_PUSHED_AT_KEY)) ?? 0);
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
        for (const [day, localMessages] of byDay) {
          const remote = await backend.getJSON<ChatDayFile>(`${CHAT_DIR}/${day}.json`);
          const file: ChatDayFile = {
            schemaVersion: 1,
            date: day,
            messages: mergeItemRows(localMessages, remote?.messages, "created_at"),
            deleted: remote?.deleted,
            updatedAt: Date.now(),
          };
          await backend.putJSON(`${CHAT_DIR}/${day}.json`, file);
          mergedDayVersions[day] = file.updatedAt;
          changes += localMessages.length;
          await sleep(0);
        }
        if (byDay.size > 0) {
          await setMetadata(CHAT_MERGED_DAYS_KEY, JSON.stringify(mergedDayVersions));
        }
        await setMetadata(CHAT_PUSHED_AT_KEY, String(Date.now()));
      }
    }

    // 7. Profile files — one uniform single-table file per table
    console.log("[PBT] phase7 profile receiveOnly=", receiveOnly);
    if (!receiveOnly) {
      progress("同步标签与技能...");
      const profileTables = ["tags", "book_tags", "book_groups", "skills"];
      for (const table of profileTables) {
        const path = `${PROFILE_DIR}/${table}.json`;
        const remote = await backend.getJSON<ProfileSyncFile>(path);
        const localRows = await tableRows(db, table);
        const rows = mergeItemRows(localRows, remote?.rows, "updated_at");
        const localDeleted = await tableTombstones(db, table);
        const deleted = mergeDeletedMap(remote?.deleted, localDeleted);
        const file: ProfileSyncFile = {
          schemaVersion: 1,
          rows,
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
    const lastSync = await getLastSyncTimestamp();
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
