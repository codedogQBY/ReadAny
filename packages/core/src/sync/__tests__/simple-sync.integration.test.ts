import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ISyncBackend, RemoteFile } from "../sync-backend";

type Row = Record<string, unknown>;

const dbMocks = vi.hoisted(() => ({
  currentDb: null as FakeSyncDb | null,
  currentDeviceId: "device-a",
  getDB: vi.fn(),
  ensureNoTransaction: vi.fn(),
  cleanupOrphanedSyncRows: vi.fn(),
  getDeviceId: vi.fn(),
}));

vi.mock("../../db/database", () => ({
  getDB: dbMocks.getDB,
  ensureNoTransaction: dbMocks.ensureNoTransaction,
  cleanupOrphanedSyncRows: dbMocks.cleanupOrphanedSyncRows,
  getDeviceId: dbMocks.getDeviceId,
}));

vi.mock("../../db/write-retry", () => ({
  runSerializedDbTask: vi.fn(async (operation: () => Promise<unknown>) => operation()),
}));

vi.mock("../../services/platform", () => ({
  getPlatformService: vi.fn(() => ({ isDesktop: false })),
}));

const syncFileMocks = vi.hoisted(() => ({
  syncFiles: vi.fn(async () => ({ filesUploaded: 0, filesDownloaded: 0 })),
}));

vi.mock("../sync-files", () => syncFileMocks);

const { applyChanges, collectChanges, runSimpleSync } = await import("../simple-sync");

const TABLE_COLUMNS: Record<string, string[]> = {
  book_groups: ["id", "name", "sort_order", "created_at", "updated_at"],
  books: [
    "id",
    "file_path",
    "format",
    "title",
    "author",
    "added_at",
    "updated_at",
    "deleted_at",
    "progress",
    "is_vectorized",
    "vectorize_progress",
    "sync_status",
  ],
  highlights: [
    "id",
    "book_id",
    "cfi",
    "text",
    "color",
    "note",
    "chapter_title",
    "created_at",
    "updated_at",
  ],
  notes: [
    "id",
    "book_id",
    "highlight_id",
    "cfi",
    "title",
    "content",
    "chapter_title",
    "tags",
    "created_at",
    "updated_at",
  ],
  bookmarks: ["id", "book_id", "cfi", "label", "chapter_title", "created_at", "updated_at"],
  threads: [
    "id",
    "book_id",
    "title",
    "memory_summary",
    "memory_updated_at",
    "memory_message_count",
    "created_at",
    "updated_at",
  ],
  messages: ["id", "thread_id", "role", "content", "created_at"],
  skills: ["id", "name", "description", "created_at", "updated_at"],
  tags: ["id", "name", "updated_at"],
  book_tags: ["id", "book_id", "tag_id", "updated_at"],
  reading_sessions: [
    "id",
    "book_id",
    "started_at",
    "ended_at",
    "total_active_time",
    "pages_read",
    "characters_read",
    "state",
    "updated_at",
  ],
};

const SYNC_TABLES = Object.keys(TABLE_COLUMNS);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class FakeSyncDb {
  readonly tables = new Map<string, Map<string, Row>>();
  readonly syncMetadata = new Map<string, string>();
  readonly tombstones = new Map<string, { id: string; table_name: string; deleted_at: number }>();

  constructor() {
    for (const table of SYNC_TABLES) {
      this.tables.set(table, new Map());
    }
  }

  insert(table: string, row: Row): void {
    this.assertKnownTable(table);
    this.assertForeignKeys(table, row);
    this.tables.get(table)?.set(String(row.id), clone(row));
  }

  patch(table: string, id: string, updates: Row): void {
    const existing = this.get(table, id);
    if (!existing) throw new Error(`Missing ${table}/${id}`);
    this.insert(table, { ...existing, ...updates });
  }

  get(table: string, id: string): Row | undefined {
    return this.tables.get(table)?.get(id);
  }

  deleteWithTombstone(table: string, id: string, deletedAt: number): void {
    this.tables.get(table)?.delete(id);
    this.tombstones.set(`${table}:${id}`, { id, table_name: table, deleted_at: deletedAt });
  }

  exportRecords(): Record<string, Row[]> {
    return Object.fromEntries(
      SYNC_TABLES.map((table) => [
        table,
        [...(this.tables.get(table)?.values() ?? [])]
          .map((row) => sortRow(row))
          .sort((a, b) => String(a.id).localeCompare(String(b.id))),
      ]),
    );
  }

  async select<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const normalized = sql.replace(/\s+/g, " ").trim();

    const pragmaMatch = normalized.match(/^PRAGMA table_info\((\w+)\)$/);
    if (pragmaMatch) {
      return (TABLE_COLUMNS[pragmaMatch[1]] ?? []).map((name) => ({ name })) as T[];
    }

    if (normalized === "SELECT value FROM sync_metadata WHERE key = 'last_sync_at'") {
      const value = this.syncMetadata.get("last_sync_at");
      return (value === undefined ? [] : [{ value }]) as T[];
    }

    const changedRowsMatch = normalized.match(/^SELECT \* FROM (\w+) WHERE (\w+) > \?$/);
    if (changedRowsMatch) {
      const [, table, timestampCol] = changedRowsMatch;
      const since = Number(params[0]);
      return [...(this.tables.get(table)?.values() ?? [])]
        .filter((row) => Number(row[timestampCol] ?? 0) > since)
        .map((row) => clone(row)) as T[];
    }

    if (
      normalized.startsWith(
        "SELECT id, deleted_at FROM sync_tombstones WHERE table_name = ? AND deleted_at > ?",
      )
    ) {
      const [tableName, since] = params;
      return [...this.tombstones.values()]
        .filter((row) => row.table_name === tableName && row.deleted_at > Number(since))
        .filter((row) => !this.tables.get(row.table_name)?.has(row.id))
        .map(({ id, deleted_at }) => ({ id, deleted_at })) as T[];
    }

    if (
      normalized.startsWith(
        "SELECT id, deleted_at FROM sync_tombstones WHERE table_name = ? AND id IN",
      )
    ) {
      const [tableName, ...ids] = params.map(String);
      const idSet = new Set(ids);
      return [...this.tombstones.values()]
        .filter((row) => row.table_name === tableName && idSet.has(row.id))
        .map(({ id, deleted_at }) => ({ id, deleted_at })) as T[];
    }

    const stateMatch = normalized.match(
      /^SELECT (\w+) AS id, (\w+) AS timestamp(, deleted_at AS deleted_at)? FROM (\w+) WHERE (\w+) IN \(/,
    );
    if (stateMatch) {
      const [, pk, timestampCol, deletedAtSelect, table] = stateMatch;
      const ids = new Set(params.map(String));
      return [...(this.tables.get(table)?.values() ?? [])]
        .filter((row) => ids.has(String(row[pk])))
        .map((row) => ({
          id: row[pk],
          timestamp: row[timestampCol] ?? 0,
          ...(deletedAtSelect ? { deleted_at: row.deleted_at ?? null } : {}),
        })) as T[];
    }

    throw new Error(`Unexpected select: ${normalized}`);
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (normalized === "ROLLBACK") return;

    if (
      normalized === "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('last_sync_at', ?)"
    ) {
      this.syncMetadata.set("last_sync_at", String(params[0]));
      return;
    }

    if (normalized.startsWith("INSERT INTO sync_tombstones")) {
      const [id, tableName, deletedAt] = params;
      this.tombstones.set(`${String(tableName)}:${String(id)}`, {
        id: String(id),
        table_name: String(tableName),
        deleted_at: Number(deletedAt),
      });
      return;
    }

    const deleteMatch = normalized.match(/^DELETE FROM (\w+) WHERE (\w+) = \?$/);
    if (deleteMatch) {
      const [, table, pk] = deleteMatch;
      const id = String(params[0]);
      const row = this.tables.get(table)?.get(id);
      if (row && String(row[pk]) === id) {
        this.tables.get(table)?.delete(id);
        if (table === "books") {
          this.deleteBookDependents(id);
        }
      }
      return;
    }

    const insertMatch = normalized.match(
      /^INSERT INTO (\w+) \(([^)]+)\) VALUES \([^)]+\) ON CONFLICT\((\w+)\) DO (UPDATE SET .+|NOTHING)$/,
    );
    if (insertMatch) {
      const [, table, columnList, pk, conflictAction] = insertMatch;
      const columns = columnList.split(",").map((column) => column.trim());
      const record = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
      const key = String(record[pk]);
      const tableRows = this.tables.get(table);
      if (!tableRows) throw new Error(`Unknown table ${table}`);

      const existing = tableRows.get(key);
      if (existing && conflictAction === "NOTHING") return;

      const nextRow = existing ? { ...existing, ...record } : record;
      this.assertForeignKeys(table, nextRow);
      tableRows.set(key, clone(nextRow));
      return;
    }

    throw new Error(`Unexpected execute: ${normalized}`);
  }

  private assertKnownTable(table: string): void {
    if (!this.tables.has(table)) throw new Error(`Unknown table ${table}`);
  }

  private assertForeignKeys(table: string, row: Row): void {
    if (
      ["highlights", "notes", "bookmarks", "book_tags", "reading_sessions"].includes(table) &&
      row.book_id &&
      !this.tables.get("books")?.has(String(row.book_id))
    ) {
      throw new Error("FOREIGN KEY constraint failed");
    }

    if (
      table === "messages" &&
      row.thread_id &&
      !this.tables.get("threads")?.has(String(row.thread_id))
    ) {
      throw new Error("FOREIGN KEY constraint failed");
    }

    if (table === "book_tags" && row.tag_id && !this.tables.get("tags")?.has(String(row.tag_id))) {
      throw new Error("FOREIGN KEY constraint failed");
    }
  }

  private deleteBookDependents(bookId: string): void {
    for (const table of ["highlights", "notes", "bookmarks", "book_tags", "reading_sessions"]) {
      const rows = this.tables.get(table);
      for (const [id, row] of rows ?? []) {
        if (row.book_id === bookId) rows?.delete(id);
      }
    }
  }
}

class MemoryBackend implements ISyncBackend {
  readonly type = "webdav";
  readonly jsonFiles = new Map<string, unknown>();
  readonly unreadableJsonPaths = new Set<string>();

  async testConnection(): Promise<boolean> {
    return true;
  }

  async ensureDirectories(): Promise<void> {}

  async put(): Promise<void> {}

  async get(): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async getJSON<T>(path: string): Promise<T | null> {
    if (this.unreadableJsonPaths.has(path)) {
      throw new Error(`WebDAV GET failed for ${path}: 403 Forbidden`);
    }
    return this.jsonFiles.has(path) ? clone(this.jsonFiles.get(path) as T) : null;
  }

  async putJSON<T>(path: string, data: T): Promise<void> {
    this.jsonFiles.set(path, clone(data));
  }

  async listDir(path: string): Promise<RemoteFile[]> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    return [...this.jsonFiles.keys()]
      .filter((filePath) => filePath.startsWith(prefix))
      .map((filePath) => filePath.slice(prefix.length))
      .filter((name) => name && !name.includes("/"))
      .map((name) => ({
        name,
        path: `${prefix}${name}`,
        size: JSON.stringify(this.jsonFiles.get(`${prefix}${name}`)).length,
        lastModified: 0,
        isDirectory: false,
      }));
  }

  async delete(path: string): Promise<void> {
    this.jsonFiles.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.jsonFiles.has(path);
  }

  async move(fromPath: string, toPath: string): Promise<void> {
    const data = this.jsonFiles.get(fromPath);
    if (data === undefined) throw new Error(`MemoryBackend MOVE: source not found ${fromPath}`);
    if (this.jsonFiles.has(toPath)) {
      throw new Error(`MemoryBackend MOVE: destination exists ${toPath}`);
    }
    this.jsonFiles.set(toPath, data);
    this.jsonFiles.delete(fromPath);
  }

  async getDisplayName(): Promise<string> {
    return "Memory";
  }
}

function sortRow(row: Row): Row {
  const {
    is_vectorized: _isVectorized,
    vectorize_progress: _vectorizeProgress,
    sync_status: _syncStatus,
    ...syncedRow
  } = row;
  return Object.fromEntries(Object.entries(syncedRow).sort(([a], [b]) => a.localeCompare(b)));
}

function bookRow(overrides: Row = {}): Row {
  return {
    id: "book-1",
    file_path: "books/book-1.epub",
    format: "epub",
    title: "Original",
    author: "Author",
    added_at: 1000,
    updated_at: 1000,
    deleted_at: null,
    progress: 0,
    is_vectorized: 1,
    vectorize_progress: 0.5,
    sync_status: "local",
    ...overrides,
  };
}

function groupRow(overrides: Row = {}): Row {
  return {
    id: "group-test",
    name: "测试分组",
    sort_order: 0,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  };
}

function highlightRow(overrides: Row = {}): Row {
  return {
    id: "hl-1",
    book_id: "book-1",
    cfi: "epubcfi(/6/2)",
    text: "Marked text",
    color: "yellow",
    note: null,
    chapter_title: "Chapter 1",
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  };
}

async function syncDevice(
  deviceId: string,
  db: FakeSyncDb,
  backend: ISyncBackend,
): Promise<Awaited<ReturnType<typeof runSimpleSync>>> {
  dbMocks.currentDeviceId = deviceId;
  dbMocks.currentDb = db;
  return runSimpleSync(backend);
}

describe("simple sync convergence", () => {
  let now = 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    dbMocks.getDB.mockImplementation(async () => dbMocks.currentDb);
    dbMocks.getDeviceId.mockImplementation(async () => dbMocks.currentDeviceId);
    dbMocks.ensureNoTransaction.mockResolvedValue(undefined);
    dbMocks.cleanupOrphanedSyncRows.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    dbMocks.currentDb = null;
    dbMocks.currentDeviceId = "device-a";
  });

  it("converges two devices after bootstrapping and interleaved edits", async () => {
    const backend = new MemoryBackend();
    const deviceA = new FakeSyncDb();
    const deviceB = new FakeSyncDb();

    deviceA.insert("books", bookRow());
    deviceA.insert("highlights", highlightRow());

    now = 1100;
    await syncDevice("device-a", deviceA, backend);

    now = 1200;
    await syncDevice("device-b", deviceB, backend);
    expect(deviceB.exportRecords()).toEqual(deviceA.exportRecords());

    now = 1300;
    deviceB.patch("books", "book-1", { title: "Remote title", updated_at: now });

    now = 1400;
    await syncDevice("device-b", deviceB, backend);

    now = 1500;
    deviceA.patch("highlights", "hl-1", { text: "Local highlight", updated_at: now });

    now = 1600;
    await syncDevice("device-a", deviceA, backend);

    now = 1700;
    await syncDevice("device-b", deviceB, backend);

    expect(deviceA.get("books", "book-1")?.title).toBe("Remote title");
    expect(deviceB.get("highlights", "hl-1")?.text).toBe("Local highlight");
    expect(deviceB.exportRecords()).toEqual(deviceA.exportRecords());
  });

  it("applies parent tables before child tables even when remote JSON keys are child-first", async () => {
    const target = new FakeSyncDb();
    dbMocks.currentDb = target;
    dbMocks.currentDeviceId = "device-local";

    const result = await applyChanges({
      deviceId: "device-remote",
      timestamp: now,
      since: 0,
      tables: {
        highlights: {
          records: [highlightRow()],
          deletedIds: [],
        },
        books: {
          records: [bookRow()],
          deletedIds: [],
        },
      },
    });

    expect(result).toEqual({ applied: 2, skipped: 0 });
    expect(target.get("books", "book-1")).toBeTruthy();
    expect(target.get("highlights", "hl-1")).toBeTruthy();
  });

  it("localizes synced book file paths and keeps remote books downloadable", async () => {
    const target = new FakeSyncDb();
    dbMocks.currentDb = target;
    dbMocks.currentDeviceId = "device-local";

    const result = await applyChanges({
      deviceId: "device-remote",
      timestamp: now,
      since: 0,
      tables: {
        books: {
          records: [
            bookRow({
              file_path: "file:///data/user/0/com.readany.app/files/books/source-device.epub",
              sync_status: "local",
            }),
          ],
          deletedIds: [],
        },
      },
    });

    expect(result).toEqual({ applied: 1, skipped: 0 });
    expect(target.get("books", "book-1")?.file_path).toBe("books/book-1.epub");
    expect(target.get("books", "book-1")?.sync_status).toBe("remote");
  });

  it("keeps a newer local record when an older remote tombstone arrives", async () => {
    const target = new FakeSyncDb();
    target.insert("books", bookRow({ updated_at: 2500 }));
    target.insert("highlights", highlightRow({ updated_at: 2500, text: "Local newer" }));
    dbMocks.currentDb = target;
    dbMocks.currentDeviceId = "device-local";

    const result = await applyChanges({
      deviceId: "device-remote",
      timestamp: now,
      since: 0,
      tables: {
        highlights: {
          records: [],
          deletedIds: ["hl-1"],
          deletedTimestamps: { "hl-1": 2000 },
        },
      },
    });

    expect(result).toEqual({ applied: 0, skipped: 1 });
    expect(target.get("highlights", "hl-1")?.text).toBe("Local newer");
  });

  it("ignores a stale tombstone when the same payload still contains a live record", async () => {
    const target = new FakeSyncDb();
    dbMocks.currentDb = target;
    dbMocks.currentDeviceId = "device-local";

    const result = await applyChanges({
      deviceId: "device-remote",
      timestamp: now,
      since: 0,
      tables: {
        books: {
          records: [bookRow({ updated_at: 1000 })],
          deletedIds: ["book-1"],
          deletedTimestamps: { "book-1": 2000 },
        },
      },
    });

    expect(result).toEqual({ applied: 1, skipped: 1 });
    expect(target.get("books", "book-1")?.title).toBe("Original");
  });

  it("does not upload stale tombstones for records that still exist locally", async () => {
    const source = new FakeSyncDb();
    source.insert("books", bookRow({ updated_at: 1000 }));
    source.tombstones.set("books:book-1", {
      id: "book-1",
      table_name: "books",
      deleted_at: 2000,
    });
    dbMocks.currentDb = source;
    dbMocks.currentDeviceId = "device-source";

    const payload = await collectChanges(0);

    expect(payload.tables.books?.records).toHaveLength(1);
    expect(payload.tables.books?.deletedIds).toEqual([]);
  });

  it("keeps a remote group tombstone from being resurrected by an older device snapshot", async () => {
    const target = new FakeSyncDb();
    dbMocks.currentDb = target;
    dbMocks.currentDeviceId = "device-local";

    const deleted = await applyChanges({
      deviceId: "device-a",
      timestamp: 3000,
      since: 0,
      tables: {
        book_groups: {
          records: [],
          deletedIds: ["group-test"],
          deletedTimestamps: { "group-test": 3000 },
        },
      },
    });

    const staleRecord = await applyChanges({
      deviceId: "device-b",
      timestamp: 2000,
      since: 0,
      tables: {
        book_groups: {
          records: [groupRow({ updated_at: 2000 })],
          deletedIds: [],
        },
      },
    });

    expect(deleted).toEqual({ applied: 1, skipped: 0 });
    expect(staleRecord).toEqual({ applied: 0, skipped: 1 });
    expect(target.get("book_groups", "group-test")).toBeUndefined();
    expect(target.tombstones.get("book_groups:group-test")?.deleted_at).toBe(3000);
  });

  it("uploads a refreshed snapshot after receiving remote-only changes", async () => {
    const backend = new MemoryBackend();
    const deviceB = new FakeSyncDb();
    deviceB.syncMetadata.set("last_sync_at", "2000");

    backend.jsonFiles.set("/readany/sync/device-a.json", {
      deviceId: "device-a",
      timestamp: 1000,
      since: 0,
      tables: {
        books: {
          records: [bookRow({ updated_at: 1000 })],
          deletedIds: [],
        },
      },
    });

    now = 3000;
    const result = await syncDevice("device-b", deviceB, backend);

    expect(result.success).toBe(true);
    expect(result.changes).toBe(1);
    expect(backend.jsonFiles.has("/readany/sync/device-device-b.json")).toBe(true);
    expect(
      (
        backend.jsonFiles.get("/readany/sync/device-device-b.json") as {
          tables: Record<string, unknown>;
        }
      ).tables,
    ).toHaveProperty("books");
  });

  it("downloads remote snapshots using the listed path", async () => {
    class AliasPathBackend extends MemoryBackend {
      async listDir(path: string): Promise<RemoteFile[]> {
        const files = await super.listDir(path);
        return files.map((file) =>
          file.name === "device-a.json" ? { ...file, path: "/logical/device-a.json" } : file,
        );
      }

      async getJSON<T>(path: string): Promise<T | null> {
        if (path === "/logical/device-a.json") {
          return super.getJSON<T>("/readany/sync/device-a.json");
        }
        if (path === "/readany/sync/device-a.json") {
          throw new Error("should use listed path");
        }
        return super.getJSON<T>(path);
      }
    }

    const backend = new AliasPathBackend();
    const deviceB = new FakeSyncDb();

    backend.jsonFiles.set("/readany/sync/device-a.json", {
      deviceId: "device-a",
      timestamp: 1000,
      since: 0,
      tables: {
        books: {
          records: [bookRow({ updated_at: 1000 })],
          deletedIds: [],
        },
      },
    });

    now = 3000;
    const result = await syncDevice("device-b", deviceB, backend);

    expect(result.success).toBe(true);
    expect(deviceB.get("books", "book-1")).toBeTruthy();
  });

  it("downloads remote snapshots from the device index when directory listing is empty", async () => {
    class EmptyListBackend extends MemoryBackend {
      async listDir(): Promise<RemoteFile[]> {
        return [];
      }
    }

    const backend = new EmptyListBackend();
    const deviceB = new FakeSyncDb();

    backend.jsonFiles.set("/readany/sync/index.json", {
      version: 1,
      updatedAt: 1000,
      devices: {
        "device-a": {
          path: "/readany/sync/device-a.json",
          timestamp: 1000,
        },
      },
    });
    backend.jsonFiles.set("/readany/sync/device-a.json", {
      deviceId: "device-a",
      timestamp: 1000,
      since: 0,
      tables: {
        books: {
          records: [bookRow({ updated_at: 1000 })],
          deletedIds: [],
        },
      },
    });

    now = 3000;
    const result = await syncDevice("device-b", deviceB, backend);

    expect(result.success).toBe(true);
    expect(deviceB.get("books", "book-1")).toBeTruthy();
    expect(backend.jsonFiles.get("/readany/sync/index.json")).toMatchObject({
      devices: {
        "device-a": {
          path: "/readany/sync/device-a.json",
        },
        "device-b": {
          path: "/readany/sync/device-device-b.json",
        },
      },
    });
  });

  it("skips unreadable remote device snapshots and continues syncing", async () => {
    const backend = new MemoryBackend();
    const local = new FakeSyncDb();
    local.insert("books", bookRow({ title: "Local", updated_at: 3000 }));

    backend.jsonFiles.set("/readany/sync/device-locked.json", {
      deviceId: "locked",
      timestamp: 1000,
      since: 0,
      tables: {
        books: {
          records: [bookRow({ id: "remote-book", title: "Locked remote", updated_at: 1000 })],
          deletedIds: [],
        },
      },
    });
    backend.unreadableJsonPaths.add("/readany/sync/device-locked.json");

    now = 4000;
    const result = await syncDevice("device-local", local, backend);

    expect(result.success).toBe(true);
    expect(local.get("books", "remote-book")).toBeUndefined();
    expect(backend.jsonFiles.has("/readany/sync/device-device-local.json")).toBe(true);
  });
});
