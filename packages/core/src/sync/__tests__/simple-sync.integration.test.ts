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
  knowledge_documents: [
    "id",
    "book_id",
    "parent_id",
    "type",
    "title",
    "content_json",
    "content_md",
    "content_schema_version",
    "excerpt",
    "summary_md",
    "summary_source_fingerprint",
    "summary_source_updated_at",
    "summary_updated_at",
    "tags",
    "source_kind",
    "source_id",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  knowledge_links: [
    "id",
    "from_document_id",
    "to_kind",
    "to_id",
    "relation",
    "label",
    "cfi",
    "created_at",
    "updated_at",
  ],
  knowledge_attachments: [
    "id",
    "document_id",
    "kind",
    "file_name",
    "mime_type",
    "local_path",
    "remote_path",
    "size",
    "hash",
    "created_at",
    "updated_at",
  ],
  knowledge_card_templates: [
    "id",
    "name",
    "version",
    "schema_json",
    "built_in",
    "enabled",
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

    const existsMatch = normalized.match(/^SELECT (\w+) FROM (\w+) WHERE (\w+) = \? LIMIT 1$/);
    if (existsMatch) {
      const [, selectedColumn, table, pk] = existsMatch;
      const row = this.tables.get(table)?.get(String(params[0]));
      return row && String(row[pk]) === String(params[0])
        ? ([{ [selectedColumn]: row[selectedColumn] }] as T[])
        : [];
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
      [
        "highlights",
        "notes",
        "knowledge_documents",
        "bookmarks",
        "book_tags",
        "reading_sessions",
      ].includes(table) &&
      row.book_id &&
      !this.tables.get("books")?.has(String(row.book_id))
    ) {
      throw new Error("FOREIGN KEY constraint failed");
    }

    if (
      table === "knowledge_documents" &&
      row.parent_id &&
      !this.tables.get("knowledge_documents")?.has(String(row.parent_id))
    ) {
      throw new Error("FOREIGN KEY constraint failed");
    }

    if (
      table === "knowledge_links" &&
      row.from_document_id &&
      !this.tables.get("knowledge_documents")?.has(String(row.from_document_id))
    ) {
      throw new Error("FOREIGN KEY constraint failed");
    }

    if (
      table === "knowledge_attachments" &&
      row.document_id &&
      !this.tables.get("knowledge_documents")?.has(String(row.document_id))
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
    for (const table of [
      "highlights",
      "notes",
      "knowledge_documents",
      "bookmarks",
      "book_tags",
      "reading_sessions",
    ]) {
      const rows = this.tables.get(table);
      for (const [id, row] of rows ?? []) {
        if (row.book_id === bookId) {
          rows?.delete(id);
          if (table === "knowledge_documents") {
            this.deleteKnowledgeDocumentDependents(id);
          }
        }
      }
    }
  }

  private deleteKnowledgeDocumentDependents(documentId: string): void {
    for (const table of ["knowledge_links", "knowledge_attachments"]) {
      const rows = this.tables.get(table);
      for (const [id, row] of rows ?? []) {
        if (
          row.from_document_id === documentId ||
          (row.to_kind === "document" && row.to_id === documentId) ||
          row.document_id === documentId
        ) {
          rows?.delete(id);
        }
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

function knowledgeDocumentRow(overrides: Row = {}): Row {
  return {
    id: "doc-1",
    book_id: "book-1",
    parent_id: null,
    type: "book_home",
    title: "Book home",
    content_json: '{"type":"doc","content":[]}',
    content_md: "# Book home",
    content_schema_version: 1,
    excerpt: "Book home",
    summary_md: "Compact durable memory",
    summary_source_fingerprint: "fnv1a32:12345678",
    summary_source_updated_at: 900,
    summary_updated_at: 950,
    tags: "[]",
    source_kind: "book",
    source_id: "book-1",
    created_at: 1000,
    updated_at: 1000,
    deleted_at: null,
    ...overrides,
  };
}

function knowledgeLinkRow(overrides: Row = {}): Row {
  return {
    id: "knowledge-link-1",
    from_document_id: "doc-1",
    to_kind: "highlight",
    to_id: "hl-1",
    relation: "source",
    label: "Source highlight",
    cfi: "epubcfi(/6/2)",
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  };
}

function knowledgeAttachmentRow(overrides: Row = {}): Row {
  return {
    id: "knowledge-attachment-1",
    document_id: "doc-1",
    kind: "image",
    file_name: "quote.png",
    mime_type: "image/png",
    local_path: "knowledge/quote.png",
    remote_path: "/readany/data/knowledge/quote.png",
    size: 10,
    hash: "hash-1",
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  };
}

function knowledgeCardTemplateRow(overrides: Row = {}): Row {
  return {
    id: "card-quote",
    name: "Quote card",
    version: 1,
    schema_json: '{"type":"object"}',
    built_in: 1,
    enabled: 1,
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

  it("skips knowledge links whose document target is missing", async () => {
    const target = new FakeSyncDb();
    target.insert("books", bookRow());
    target.insert(
      "knowledge_documents",
      knowledgeDocumentRow({
        id: "doc-source",
        type: "standalone_note",
        title: "Source",
        source_kind: null,
        source_id: null,
      }),
    );
    dbMocks.currentDb = target;
    dbMocks.currentDeviceId = "device-local";

    const result = await applyChanges({
      deviceId: "device-remote",
      timestamp: now,
      since: 0,
      tables: {
        knowledge_links: {
          records: [
            knowledgeLinkRow({
              id: "stale-doc-link",
              from_document_id: "doc-source",
              to_kind: "document",
              to_id: "doc-missing",
              updated_at: 1500,
            }),
          ],
          deletedIds: [],
        },
      },
    });

    expect(result).toEqual({ applied: 0, skipped: 1 });
    expect(target.get("knowledge_links", "stale-doc-link")).toBeUndefined();
  });

  it("skips knowledge links whose source document is missing", async () => {
    const target = new FakeSyncDb();
    target.insert("books", bookRow());
    dbMocks.currentDb = target;
    dbMocks.currentDeviceId = "device-local";

    const result = await applyChanges({
      deviceId: "device-remote",
      timestamp: now,
      since: 0,
      tables: {
        knowledge_links: {
          records: [
            knowledgeLinkRow({
              id: "stale-source-link",
              from_document_id: "doc-missing",
              to_kind: "highlight",
              to_id: "hl-1",
              updated_at: 1500,
            }),
          ],
          deletedIds: [],
        },
      },
    });

    expect(result).toEqual({ applied: 0, skipped: 1 });
    expect(target.get("knowledge_links", "stale-source-link")).toBeUndefined();
  });

  it("skips knowledge attachments whose document is missing", async () => {
    const target = new FakeSyncDb();
    target.insert("books", bookRow());
    dbMocks.currentDb = target;
    dbMocks.currentDeviceId = "device-local";

    const result = await applyChanges({
      deviceId: "device-remote",
      timestamp: now,
      since: 0,
      tables: {
        knowledge_attachments: {
          records: [
            knowledgeAttachmentRow({
              id: "stale-attachment",
              document_id: "doc-missing",
              updated_at: 1500,
            }),
          ],
          deletedIds: [],
        },
      },
    });

    expect(result).toEqual({ applied: 0, skipped: 1 });
    expect(target.get("knowledge_attachments", "stale-attachment")).toBeUndefined();
  });

  it("syncs knowledge documents, links, attachments, and card templates", async () => {
    const backend = new MemoryBackend();
    const deviceA = new FakeSyncDb();
    const deviceB = new FakeSyncDb();

    deviceA.insert("books", bookRow());
    deviceA.insert("highlights", highlightRow());
    deviceA.insert("knowledge_documents", knowledgeDocumentRow());
    deviceA.insert("knowledge_links", knowledgeLinkRow());
    deviceA.insert("knowledge_attachments", knowledgeAttachmentRow());
    deviceA.insert("knowledge_card_templates", knowledgeCardTemplateRow());

    now = 1100;
    await syncDevice("device-a", deviceA, backend);
    const deviceASnapshot = backend.jsonFiles.get("/readany/sync/device-device-a.json") as {
      tables?: Record<string, { records?: Row[] }>;
    };
    expect(deviceASnapshot.tables?.knowledge_attachments?.records?.[0]).not.toHaveProperty(
      "local_path",
    );

    now = 1200;
    const result = await syncDevice("device-b", deviceB, backend);

    expect(result.success).toBe(true);
    expect(deviceB.get("knowledge_documents", "doc-1")).toMatchObject({
      title: "Book home",
      summary_md: "Compact durable memory",
      summary_source_fingerprint: "fnv1a32:12345678",
      source_kind: "book",
    });
    expect(deviceB.get("knowledge_links", "knowledge-link-1")).toMatchObject({
      from_document_id: "doc-1",
      to_kind: "highlight",
    });
    expect(deviceB.get("knowledge_attachments", "knowledge-attachment-1")).toMatchObject({
      document_id: "doc-1",
      file_name: "quote.png",
    });
    expect(deviceB.get("knowledge_attachments", "knowledge-attachment-1")).not.toHaveProperty(
      "local_path",
    );
    expect(deviceB.get("knowledge_card_templates", "card-quote")).toMatchObject({
      name: "Quote card",
      built_in: 1,
    });
  });

  it("preserves rich knowledge editor JSON through sync apply", async () => {
    const backend = new MemoryBackend();
    const deviceA = new FakeSyncDb();
    const deviceB = new FakeSyncDb();
    const richContentJson = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Reading thread" }],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Preserve the task" }],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Cite " },
            {
              type: "readanySourceReference",
              attrs: {
                label: "Chapter 1",
                sourceId: "hl-1",
                cfi: "epubcfi(/6/2)",
              },
            },
          ],
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "aiSummary",
            version: 1,
            title: "AI memory",
            markdown: "Durable summary",
            data: { citations: [{ cfi: "epubcfi(/6/2)", text: "Marked text" }] },
          },
        },
        {
          type: "image",
          attrs: {
            attachmentId: "knowledge-attachment-1",
            src: "readany-attachment://knowledge-attachment-1",
            alt: "quote.png",
          },
        },
      ],
    });
    const richContentMd = [
      "## Reading thread",
      "",
      "- [x] Preserve the task",
      "",
      "Cite [Chapter 1](readany://cfi/epubcfi%28%2F6%2F2%29?sourceId=hl-1)",
      "",
      ":::readany-card type=\"aiSummary\" version=\"1\" title=\"AI memory\" data=\"%7B%22citations%22%3A%5B%7B%22cfi%22%3A%22epubcfi(%2F6%2F2)%22%2C%22text%22%3A%22Marked%20text%22%7D%5D%7D\"",
      "Durable summary",
      ":::",
      "",
      "![quote.png](readany-attachment://knowledge-attachment-1)",
    ].join("\n");

    deviceA.insert("books", bookRow());
    deviceA.insert("highlights", highlightRow());
    deviceA.insert(
      "knowledge_documents",
      knowledgeDocumentRow({
        content_json: richContentJson,
        content_md: richContentMd,
        excerpt: "Reading thread Preserve the task",
        tags: '["source","ai"]',
      }),
    );
    deviceA.insert("knowledge_attachments", knowledgeAttachmentRow());

    now = 1100;
    await syncDevice("device-a", deviceA, backend);

    now = 1200;
    const result = await syncDevice("device-b", deviceB, backend);

    expect(result.success).toBe(true);
    expect(deviceB.get("knowledge_documents", "doc-1")).toMatchObject({
      content_json: richContentJson,
      content_md: richContentMd,
      tags: '["source","ai"]',
    });
  });

  it("syncs custom card template updates without losing existing card documents", async () => {
    const backend = new MemoryBackend();
    const deviceA = new FakeSyncDb();
    const deviceB = new FakeSyncDb();
    const customTemplate = knowledgeCardTemplateRow({
      id: "template-reading-question",
      name: "Reading question",
      version: 1,
      schema_json: JSON.stringify({
        cardType: "custom:template-reading-question",
        title: "Reading question",
      }),
      built_in: 0,
      enabled: 1,
    });
    const documentContentJson = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "custom:template-reading-question",
            version: 1,
            title: "Question",
            markdown: "What changed after the conflict?",
            data: { kind: "prompt" },
          },
        },
      ],
    });
    const documentContentMd = [
      ':::readany-card type="custom:template-reading-question" version="1" title="Question" data="%7B%22kind%22%3A%22prompt%22%7D"',
      "What changed after the conflict?",
      ":::",
    ].join("\n");

    deviceA.insert("books", bookRow());
    deviceA.insert(
      "knowledge_documents",
      knowledgeDocumentRow({
        content_json: documentContentJson,
        content_md: documentContentMd,
        excerpt: "What changed after the conflict?",
      }),
    );
    deviceA.insert("knowledge_card_templates", customTemplate);

    now = 1100;
    await syncDevice("device-a", deviceA, backend);

    now = 1200;
    await syncDevice("device-b", deviceB, backend);
    expect(deviceB.get("knowledge_card_templates", "template-reading-question")).toMatchObject({
      enabled: 1,
      version: 1,
    });

    now = 1300;
    deviceB.patch("knowledge_card_templates", "template-reading-question", {
      name: "Reading question archive",
      version: 2,
      schema_json: JSON.stringify({
        cardType: "custom:template-reading-question",
        title: "Reading question archive",
        fields: [{ key: "answer", label: "Answer" }],
      }),
      enabled: 0,
      updated_at: now,
    });

    now = 1400;
    await syncDevice("device-b", deviceB, backend);

    now = 1500;
    const result = await syncDevice("device-a", deviceA, backend);

    expect(result.success).toBe(true);
    expect(deviceA.get("knowledge_card_templates", "template-reading-question")).toMatchObject({
      name: "Reading question archive",
      version: 2,
      enabled: 0,
      updated_at: 1300,
    });
    expect(deviceA.get("knowledge_card_templates", "template-reading-question")?.schema_json).toBe(
      JSON.stringify({
        cardType: "custom:template-reading-question",
        title: "Reading question archive",
        fields: [{ key: "answer", label: "Answer" }],
      }),
    );
    expect(deviceA.get("knowledge_documents", "doc-1")).toMatchObject({
      content_json: documentContentJson,
      content_md: documentContentMd,
    });
  });

  it("syncs knowledge vault folder moves without flattening child documents", async () => {
    const backend = new MemoryBackend();
    const deviceA = new FakeSyncDb();
    const deviceB = new FakeSyncDb();

    deviceA.insert("books", bookRow());
    deviceA.insert("knowledge_documents", knowledgeDocumentRow({ id: "home", title: "Home" }));
    deviceA.insert(
      "knowledge_documents",
      knowledgeDocumentRow({
        id: "folder-a",
        parent_id: null,
        type: "folder",
        title: "Chapter Notes",
        source_kind: null,
        source_id: null,
      }),
    );
    deviceA.insert(
      "knowledge_documents",
      knowledgeDocumentRow({
        id: "folder-b",
        parent_id: null,
        type: "folder",
        title: "Research",
        source_kind: null,
        source_id: null,
      }),
    );
    deviceA.insert(
      "knowledge_documents",
      knowledgeDocumentRow({
        id: "note-child",
        parent_id: "folder-a",
        type: "standalone_note",
        title: "Question Log",
        source_kind: null,
        source_id: null,
      }),
    );

    now = 1100;
    await syncDevice("device-a", deviceA, backend);

    now = 1200;
    await syncDevice("device-b", deviceB, backend);
    expect(deviceB.get("knowledge_documents", "note-child")).toMatchObject({
      parent_id: "folder-a",
    });

    now = 1300;
    deviceB.patch("knowledge_documents", "folder-a", {
      parent_id: "folder-b",
      updated_at: now,
    });

    now = 1400;
    await syncDevice("device-b", deviceB, backend);

    now = 1500;
    const result = await syncDevice("device-a", deviceA, backend);

    expect(result.success).toBe(true);
    expect(deviceA.get("knowledge_documents", "folder-a")).toMatchObject({
      parent_id: "folder-b",
    });
    expect(deviceA.get("knowledge_documents", "folder-b")).toMatchObject({
      parent_id: null,
    });
    expect(deviceA.get("knowledge_documents", "note-child")).toMatchObject({
      parent_id: "folder-a",
      title: "Question Log",
    });
    expect(deviceA.exportRecords().knowledge_documents).toEqual(
      deviceB.exportRecords().knowledge_documents,
    );
  });

  it("keeps synced knowledge document dependency tombstones from being resurrected", async () => {
    const backend = new MemoryBackend();
    const deviceA = new FakeSyncDb();
    const deviceB = new FakeSyncDb();

    deviceA.insert("books", bookRow());
    deviceA.insert("highlights", highlightRow());
    deviceA.insert(
      "knowledge_documents",
      knowledgeDocumentRow({
        id: "doc-delete",
        type: "standalone_note",
        title: "Delete Candidate",
        source_kind: null,
        source_id: null,
        updated_at: 1100,
      }),
    );
    deviceA.insert(
      "knowledge_documents",
      knowledgeDocumentRow({
        id: "doc-source",
        type: "standalone_note",
        title: "Source Note",
        source_kind: null,
        source_id: null,
        updated_at: 1100,
      }),
    );
    deviceA.insert(
      "knowledge_links",
      knowledgeLinkRow({
        id: "link-delete",
        from_document_id: "doc-delete",
      }),
    );
    deviceA.insert(
      "knowledge_links",
      knowledgeLinkRow({
        id: "incoming-link-delete",
        from_document_id: "doc-source",
        to_kind: "document",
        to_id: "doc-delete",
      }),
    );
    deviceA.insert(
      "knowledge_attachments",
      knowledgeAttachmentRow({
        id: "attachment-delete",
        document_id: "doc-delete",
      }),
    );

    now = 1100;
    await syncDevice("device-a", deviceA, backend);

    now = 1200;
    await syncDevice("device-b", deviceB, backend);
    expect(deviceB.get("knowledge_documents", "doc-delete")).toMatchObject({
      title: "Delete Candidate",
    });
    expect(deviceB.get("knowledge_documents", "doc-source")).toMatchObject({
      title: "Source Note",
    });
    expect(deviceB.get("knowledge_links", "link-delete")).toMatchObject({
      from_document_id: "doc-delete",
    });
    expect(deviceB.get("knowledge_links", "incoming-link-delete")).toMatchObject({
      from_document_id: "doc-source",
      to_id: "doc-delete",
    });
    expect(deviceB.get("knowledge_attachments", "attachment-delete")).toMatchObject({
      document_id: "doc-delete",
    });

    now = 1300;
    deviceB.deleteWithTombstone("knowledge_links", "link-delete", now);
    deviceB.deleteWithTombstone("knowledge_links", "incoming-link-delete", now);
    deviceB.deleteWithTombstone("knowledge_attachments", "attachment-delete", now);
    deviceB.deleteWithTombstone("knowledge_documents", "doc-delete", now);

    now = 1400;
    await syncDevice("device-b", deviceB, backend);

    now = 1500;
    const result = await syncDevice("device-a", deviceA, backend);

    expect(result.success).toBe(true);
    expect(deviceA.get("knowledge_documents", "doc-delete")).toBeUndefined();
    expect(deviceA.get("knowledge_documents", "doc-source")).toMatchObject({
      title: "Source Note",
    });
    expect(deviceA.get("knowledge_links", "link-delete")).toBeUndefined();
    expect(deviceA.get("knowledge_links", "incoming-link-delete")).toBeUndefined();
    expect(deviceA.get("knowledge_attachments", "attachment-delete")).toBeUndefined();
    expect(deviceA.tombstones.get("knowledge_documents:doc-delete")?.deleted_at).toBe(1300);
    expect(deviceA.tombstones.get("knowledge_links:link-delete")?.deleted_at).toBe(1300);
    expect(deviceA.tombstones.get("knowledge_links:incoming-link-delete")?.deleted_at).toBe(1300);
    expect(deviceA.tombstones.get("knowledge_attachments:attachment-delete")?.deleted_at).toBe(
      1300,
    );

    now = 1600;
    await syncDevice("device-b", deviceB, backend);

    expect(deviceB.get("knowledge_documents", "doc-delete")).toBeUndefined();
    expect(deviceB.get("knowledge_documents", "doc-source")).toMatchObject({
      title: "Source Note",
    });
    expect(deviceB.get("knowledge_links", "link-delete")).toBeUndefined();
    expect(deviceB.get("knowledge_links", "incoming-link-delete")).toBeUndefined();
    expect(deviceB.get("knowledge_attachments", "attachment-delete")).toBeUndefined();
    expect(deviceB.tombstones.get("knowledge_documents:doc-delete")?.deleted_at).toBe(1300);
    expect(deviceB.tombstones.get("knowledge_links:link-delete")?.deleted_at).toBe(1300);
    expect(deviceB.tombstones.get("knowledge_links:incoming-link-delete")?.deleted_at).toBe(1300);
    expect(deviceB.tombstones.get("knowledge_attachments:attachment-delete")?.deleted_at).toBe(
      1300,
    );
    expect(deviceA.exportRecords().knowledge_documents).toEqual(
      deviceB.exportRecords().knowledge_documents,
    );
    expect(deviceA.exportRecords().knowledge_links).toEqual(deviceB.exportRecords().knowledge_links);
    expect(deviceA.exportRecords().knowledge_attachments).toEqual(
      deviceB.exportRecords().knowledge_attachments,
    );
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
