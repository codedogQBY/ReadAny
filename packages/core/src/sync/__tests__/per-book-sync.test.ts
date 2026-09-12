import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ISyncBackend, RemoteFile } from "../sync-backend";

type Row = Record<string, unknown>;

const TABLE_COLUMNS: Record<string, string[]> = {
  books: [
    "id",
    "title",
    "author",
    "file_path",
    "format",
    "cover_url",
    "updated_at",
    "deleted_at",
    "sync_status",
    "created_at",
    "added_at",
  ],
  highlights: ["id", "book_id", "text", "updated_at", "created_at"],
  notes: ["id", "book_id", "content", "updated_at", "created_at"],
  bookmarks: ["id", "book_id", "label", "updated_at", "created_at"],
  threads: ["id", "title", "updated_at", "created_at"],
  messages: ["id", "thread_id", "content", "created_at"],
  tags: ["id", "name", "updated_at", "created_at"],
  book_tags: ["id", "book_id", "tag_id", "updated_at"],
  book_groups: ["id", "name", "updated_at", "created_at"],
  skills: ["id", "name", "updated_at", "created_at"],
  reading_sessions: ["id", "book_id", "started_at", "updated_at"],
  sync_tombstones: ["id", "table_name", "deleted_at", "device_id", "book_id"],
};

const dbMocks = vi.hoisted(() => ({
  currentDb: null as FakePerBookDb | null,
  getDB: vi.fn(),
  ensureNoTransaction: vi.fn(async () => {}),
  cleanupOrphanedSyncRows: vi.fn(async () => {}),
  getDeviceId: vi.fn(async () => "device-a"),
  deleteBook: vi.fn(async (id: string) => {
    dbMocks.currentDb?.deleteBook(id);
  }),
  deleteThread: vi.fn(async (id: string) => {
    dbMocks.currentDb?.deleteThread(id);
  }),
}));

vi.mock("../../db/database", () => ({
  getDB: dbMocks.getDB,
  ensureNoTransaction: dbMocks.ensureNoTransaction,
  cleanupOrphanedSyncRows: dbMocks.cleanupOrphanedSyncRows,
  getDeviceId: dbMocks.getDeviceId,
  deleteBook: dbMocks.deleteBook,
  deleteThread: dbMocks.deleteThread,
}));

vi.mock("../../services/platform", () => ({
  getPlatformService: vi.fn(() => ({ isDesktop: false })),
}));

const syncFileMocks = vi.hoisted(() => ({
  syncFiles: vi.fn(async () => ({
    filesUploaded: 0,
    filesDownloaded: 0,
    filesUploadFailed: 0,
    filesDownloadFailed: 0,
  })),
}));

vi.mock("../sync-files", () => syncFileMocks);

const { runPerBookSync } = await import("../per-book-sync");

/** Minimal in-memory DB covering exactly the SQL shapes the engine issues. */
class FakePerBookDb {
  tables = new Map<string, Map<string, Row>>();
  tombstones = new Map<string, Row>();
  syncMetadata = new Map<string, string>();

  constructor() {
    for (const table of Object.keys(TABLE_COLUMNS)) {
      this.tables.set(table, new Map());
    }
  }

  table(name: string): Map<string, Row> {
    return this.tables.get(name) ?? new Map();
  }

  insert(table: string, row: Row): void {
    this.table(table).set(String(row.id), { ...row });
  }

  deleteBook(bookId: string): void {
    this.table("books").delete(bookId);
    for (const table of ["highlights", "notes", "bookmarks", "reading_sessions"]) {
      for (const [id, row] of [...this.table(table)]) {
        if (String(row.book_id) === bookId) this.table(table).delete(id);
      }
    }
    for (const [id, row] of [...this.table("messages")]) {
      if (this.threadsOf(String(row.thread_id)).length === 0) this.table("messages").delete(id);
    }
    for (const [id, row] of [...this.table("threads")]) {
      if (String(row.book_id ?? "") === bookId) this.table("threads").delete(id);
    }
  }

  private threadsOf(threadId: string): Row[] {
    return this.table("threads").size >= 0
      ? [...this.table("threads")].filter(([, row]) => String(row.id) === threadId).map(([, r]) => r)
      : [];
  }

  deleteThread(threadId: string): void {
    this.table("threads").delete(threadId);
    for (const [id, row] of [...this.table("messages")]) {
      if (String(row.thread_id) === threadId) this.table("messages").delete(id);
    }
  }

  async select<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const normalized = sql.replace(/\s+/g, " ").trim();

    const pragma = normalized.match(/^PRAGMA table_info\((\w+)\)$/);
    if (pragma) {
      return (TABLE_COLUMNS[pragma[1]] ?? []).map((name) => ({ name })) as T[];
    }

    const metadataSelect = normalized.match(
      /^SELECT value FROM sync_metadata WHERE key = ('[^']+'|\?)$/,
    );
    if (metadataSelect) {
      const rawKey = metadataSelect[1];
      const key = rawKey === "?" ? String(params[0]) : rawKey.slice(1, -1);
      const value = this.syncMetadata.get(key);
      return (value === undefined ? [] : [{ value }]) as T[];
    }

    const byIdMatch = normalized.match(/^SELECT (\*|\w+) FROM (\w+) WHERE id = \?$/);
    if (byIdMatch) {
      const [, column, table] = byIdMatch;
      const row = this.table(table).get(String(params[0]));
      if (!row) return [];
      return (column === "*" ? [{ ...row }] : [{ [column]: row[column] }]) as T[];
    }

    const allRowsMatch = normalized.match(/^SELECT \* FROM (\w+)$/);
    if (allRowsMatch) {
      return [...this.table(allRowsMatch[1]).values()].map((row) => ({ ...row })) as T[];
    }

    const byColumnMatch = normalized.match(/^SELECT \* FROM (\w+) WHERE (\w+) = \?$/);
    if (byColumnMatch) {
      const [, table, column] = byColumnMatch;
      return [...this.table(table).values()]
        .filter((row) => String(row[column] ?? "") === String(params[0]))
        .map((row) => ({ ...row })) as T[];
    }

    const groupMarkers = normalized.match(
      /^SELECT book_id, MAX\(updated_at\) AS max_ts FROM (\w+) GROUP BY book_id$/,
    );
    if (groupMarkers) {
      const acc = new Map<string, number>();
      for (const row of this.table(groupMarkers[1]).values()) {
        const bookId = String(row.book_id);
        acc.set(bookId, Math.max(acc.get(bookId) ?? 0, Number(row.updated_at ?? 0)));
      }
      return [...acc].map(([book_id, max_ts]) => ({ book_id, max_ts })) as T[];
    }

    const tombstonesForBook = normalized.match(
      /^SELECT t\.id, t\.deleted_at FROM sync_tombstones t WHERE t\.book_id = \? AND t\.table_name = '(\w+)' AND NOT EXISTS \(SELECT 1 FROM \w+ WHERE id = t\.id\)$/,
    );
    if (tombstonesForBook) {
      const table = tombstonesForBook[1];
      const bookId = String(params[0]);
      return [...this.tombstones.values()]
        .filter(
          (row) => row.book_id === bookId && row.table_name === table && !this.table(table).has(String(row.id)),
        )
        .map((row) => ({ id: row.id, deleted_at: row.deleted_at })) as T[];
    }

    const tableTombstones = normalized.match(
      /^SELECT t\.id, t\.deleted_at FROM sync_tombstones t WHERE t\.table_name = '(\w+)' AND NOT EXISTS \(SELECT 1 FROM \w+ WHERE id = t\.id\)$/,
    );
    if (tableTombstones) {
      const table = tableTombstones[1];
      return [...this.tombstones.values()]
        .filter((row) => row.table_name === table && !this.table(table).has(String(row.id)))
        .map((row) => ({ id: row.id, deleted_at: row.deleted_at })) as T[];
    }

    if (normalized === "SELECT * FROM reading_sessions WHERE updated_at > ?") {
      const since = Number(params[0]);
      return [...this.table("reading_sessions").values()]
        .filter((row) => Number(row.updated_at ?? 0) > since)
        .map((row) => ({ ...row })) as T[];
    }

    if (normalized === "SELECT * FROM messages WHERE created_at > ?") {
      const since = Number(params[0]);
      return [...this.table("messages").values()]
        .filter((row) => Number(row.created_at ?? 0) > since)
        .map((row) => ({ ...row })) as T[];
    }

    throw new Error(`Unexpected select: ${normalized}`);
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    const normalized = sql.replace(/\s+/g, " ").trim();

    const metadataSet = normalized.match(
      /^INSERT OR REPLACE INTO sync_metadata \(key, value\) VALUES \((?:'[^']+'|\?), (?:'[^']+'|\?)\)$/,
    );
    if (metadataSet) {
      const values = [...normalized.matchAll(/(?:'([^']+)'|\?)/g)].map((m, i) =>
        m[1] !== undefined ? m[1] : String(params[i]),
      );
      this.syncMetadata.set(values[0], values[1]);
      return;
    }

    if (normalized.startsWith("INSERT OR REPLACE INTO sync_tombstones")) {
      const [id, tableName, deletedAt, deviceId, bookId] = params;
      this.tombstones.set(`${String(tableName)}:${String(id)}`, {
        id: String(id),
        table_name: String(tableName),
        deleted_at: Number(deletedAt),
        device_id: String(deviceId),
        book_id: bookId === null || bookId === undefined ? null : String(bookId),
      });
      return;
    }

    const deleteMatch = normalized.match(/^DELETE FROM (\w+) WHERE id = \?$/);
    if (deleteMatch) {
      this.table(deleteMatch[1]).delete(String(params[0]));
      return;
    }

    const upsert = normalized.match(
      /^INSERT INTO (\w+) \(([^)]+)\) VALUES \([^)]+\) ON CONFLICT\((\w+)\) DO (UPDATE SET .+|NOTHING)$/,
    );
    if (upsert) {
      const [, table, columnList, pk] = upsert;
      const columns = columnList.split(",").map((c) => c.trim());
      const row: Row = {};
      columns.forEach((column, i) => {
        row[column] = params[i];
      });
      this.table(table).set(String(row[pk]), row);
      return;
    }

    throw new Error(`Unexpected execute: ${normalized}`);
  }
}

/** Scriptable fake backend recording every JSON payload it receives. */
class FakeBackend implements ISyncBackend {
  readonly type = "webdav" as const;
  files = new Map<string, unknown>();
  listedDirs: string[] = [];

  constructor(initial?: Record<string, unknown>) {
    if (initial) for (const [path, value] of Object.entries(initial)) this.files.set(path, value);
  }

  async ensureDirectories(): Promise<void> {}
  async ensureDirectory(): Promise<void> {}
  async testConnection(): Promise<boolean> {
    return true;
  }
  async listDir(path: string): Promise<RemoteFile[]> {
    this.listedDirs.push(path);
    return [...this.files.keys()]
      .filter((filePath) => filePath.startsWith(`${path}/`))
      .map((filePath) => ({
        name: filePath.slice(path.length + 1),
        path: filePath,
        size: 0,
        lastModified: 0,
        isDirectory: false,
      }));
  }
  async getJSON<T>(path: string): Promise<T | null> {
    return (this.files.get(path) as T) ?? null;
  }
  async putJSON(path: string, data: unknown): Promise<void> {
    this.files.set(path, data);
  }
  async put(): Promise<void> {}
  async get(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async getWithProgress(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async getJSONBinary(): Promise<Uint8Array | null> {
    return null;
  }
  async delete(): Promise<void> {}
  async exists(): Promise<boolean> {
    return false;
  }
  async move(): Promise<void> {}
  async getDisplayName(): Promise<string> {
    return "fake";
  }
}

function seedBook(db: FakePerBookDb, id: string, updatedAt: number, title = "Book"): void {
  db.insert("books", { id, title, author: "", file_path: "", format: "epub", updated_at: updatedAt });
}

const T1 = 1_700_000_000_000;
const T2 = T1 + 60_000;
const T3 = T1 + 120_000;

describe("runPerBookSync (per-book cloud engine)", () => {
  let db: FakePerBookDb;

  beforeEach(() => {
    db = new FakePerBookDb();
    dbMocks.currentDb = db;
    dbMocks.getDB.mockResolvedValue(db);
    dbMocks.getDeviceId.mockResolvedValue("device-a");
  });

  afterEach(() => {
    dbMocks.currentDb = null;
    vi.restoreAllMocks();
  });

  it("pulls a remote book file and applies book plus annotations", async () => {
    seedBook(db, "book-1", T1);
    db.insert("highlights", { id: "hl-local", book_id: "book-1", text: "old", updated_at: T1 });

    const backend = new FakeBackend({
      "/readany/sync/index.json": {
        schemaVersion: 2,
        updatedAt: T2,
        books: { "book-1": { b: T2, a: T2 } },
        threads: {},
      },
      "/readany/sync/books/book-1.json": {
        schemaVersion: 1,
        bookId: "book-1",
        book: { id: "book-1", title: "Book", updated_at: T2 },
        highlights: [
          { id: "hl-local", book_id: "book-1", text: "updated", updated_at: T2 },
          { id: "hl-new", book_id: "book-1", text: "new", updated_at: T2 },
        ],
        notes: [],
        bookmarks: [],
        writerDeviceId: "device-b",
        updatedAt: T2,
      },
    });

    const result = await runPerBookSync(backend);

    expect(result.success).toBe(true);
    expect(db.table("books").get("book-1")?.updated_at).toBe(T2);
    expect(db.table("highlights").get("hl-new")?.text).toBe("new");
    expect(db.table("highlights").get("hl-local")?.text).toBe("updated");
    expect(backend.files.get("/readany/sync/index.json")).toMatchObject({
      books: { "book-1": { b: T2, a: T2 } },
    });
  });

  it("skips books whose markers already match the remote index", async () => {
    seedBook(db, "book-1", T2);
    const backend = new FakeBackend({
      "/readany/sync/index.json": {
        schemaVersion: 2,
        updatedAt: T2,
        books: { "book-1": { b: T2, a: T2 } },
        threads: {},
      },
      "/readany/sync/books/book-1.json": {
        schemaVersion: 1,
        bookId: "book-1",
        book: { id: "book-1", updated_at: T2 },
        highlights: [],
        notes: [],
        bookmarks: [],
        writerDeviceId: "device-b",
        updatedAt: T2,
      },
    });
    const getSpy = vi.spyOn(backend, "getJSON");

    const result = await runPerBookSync(backend);

    expect(result.success).toBe(true);
    expect(getSpy).not.toHaveBeenCalledWith("/readany/sync/books/book-1.json");
  });

  it("deletes the local book when the remote index carries a newer tombstone", async () => {
    seedBook(db, "book-1", T1);
    db.insert("highlights", { id: "hl-1", book_id: "book-1", text: "x", updated_at: T1 });

    const backend = new FakeBackend({
      "/readany/sync/index.json": {
        schemaVersion: 2,
        updatedAt: T3,
        books: { "book-1": { d: T3 } },
        threads: {},
      },
    });

    const result = await runPerBookSync(backend);

    expect(result.success).toBe(true);
    expect(db.table("books").has("book-1")).toBe(false);
    expect(db.table("highlights").has("hl-1")).toBe(false);
    expect(dbMocks.deleteBook).toHaveBeenCalledWith("book-1");
  });

  it("pushes changed books read-merge-write and updates the index", async () => {
    seedBook(db, "book-1", T3);
    db.insert("highlights", { id: "hl-2", book_id: "book-1", text: "local new", updated_at: T3 });

    const backend = new FakeBackend({
      "/readany/sync/index.json": {
        schemaVersion: 2,
        updatedAt: T2,
        books: { "book-1": { b: T2, a: T1 } },
        threads: {},
      },
      "/readany/sync/books/book-1.json": {
        schemaVersion: 1,
        bookId: "book-1",
        book: { id: "book-1", title: "Book", updated_at: T2 },
        highlights: [
          { id: "hl-2", book_id: "book-1", text: "remote old", updated_at: T1 },
          { id: "hl-remote-only", book_id: "book-1", text: "remote only", updated_at: T2 },
        ],
        notes: [],
        bookmarks: [],
        writerDeviceId: "device-b",
        updatedAt: T2,
      },
    });

    const result = await runPerBookSync(backend);

    expect(result.success).toBe(true);
    const pushed = backend.files.get("/readany/sync/books/book-1.json") as {
      highlights: Array<{ id: string; text: string }>;
    };
    const texts = pushed.highlights.map((h) => h.text).sort();
    expect(texts).toEqual(["local new", "remote only"]);
    expect(backend.files.get("/readany/sync/index.json")).toMatchObject({
      books: { "book-1": { b: T3, a: T3 } },
    });
  });

  it("pulls chat day files past the cursor and advances the cursor", async () => {
    const backend = new FakeBackend({
      "/readany/sync/index.json": { schemaVersion: 2, updatedAt: T2, books: {}, threads: {} },
      "/readany/sync/chat/2026-09-01.json": {
        schemaVersion: 1,
        date: "2026-09-01",
        messages: [{ id: "msg-1", thread_id: "th-1", content: "hello", created_at: T1 }],
        updatedAt: T1,
      },
      "/readany/sync/chat/2026-09-05.json": {
        schemaVersion: 1,
        date: "2026-09-05",
        messages: [{ id: "msg-2", thread_id: "th-1", content: "later", created_at: T2 }],
        updatedAt: T2,
      },
    });
    await db.execute("INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)", [
      "perbook:chat-pulled-day",
      "2026-08-31",
    ]);

    const result = await runPerBookSync(backend);

    expect(result.success).toBe(true);
    expect(db.table("messages").get("msg-1")?.content).toBe("hello");
    expect(db.table("messages").get("msg-2")?.content).toBe("later");
    expect(db.syncMetadata.get("perbook:chat-pulled-day")).toBe("2026-09-05");
  });
});
