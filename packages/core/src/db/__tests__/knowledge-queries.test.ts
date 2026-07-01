import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeAttachment, KnowledgeCardTemplate, KnowledgeLink } from "../../types";
import type { EventMap } from "../../utils/event-bus";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect, close: vi.fn() };

const coreMocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getDeviceId: vi.fn(),
  nextSyncVersion: vi.fn(),
  nextUpdatedAt: vi.fn(),
  insertTombstone: vi.fn(),
  parseJSON: vi.fn((str: string | null | undefined, fallback: unknown) => {
    if (!str) return fallback;
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }),
}));

const idMocks = vi.hoisted(() => ({
  generateId: vi.fn(() => "generated-id"),
}));

vi.mock("../db-core", () => coreMocks);
vi.mock("../../utils/generate-id", () => idMocks);

const { eventBus } = await import("../../utils/event-bus");
const {
  createKnowledgeDocument,
  deleteKnowledgeAttachment,
  deleteKnowledgeDocument,
  deleteKnowledgeLink,
  disableKnowledgeCardTemplate,
  ensureBookHomeDocument,
  getKnowledgeBacklinks,
  getKnowledgeAttachments,
  getKnowledgeCardTemplates,
  getKnowledgeDocument,
  getKnowledgeDocuments,
  getKnowledgeLinks,
  insertKnowledgeAttachment,
  insertKnowledgeDocument,
  insertKnowledgeLink,
  searchKnowledgeDocuments,
  updateKnowledgeDocument,
  updateKnowledgeDocumentSummary,
  upsertKnowledgeCardTemplate,
} = await import("../knowledge-queries");

const docRow = {
  id: "doc-1",
  book_id: "book-1",
  parent_id: null,
  type: "book_home",
  title: "Book Home",
  content_json: '{"type":"doc","content":[]}',
  content_md: "# Book Home",
  content_schema_version: 1,
  excerpt: "Short",
  summary_md: "Compact durable memory",
  summary_source_fingerprint: "fnv1a32:12345678",
  summary_source_updated_at: 900,
  summary_updated_at: 950,
  tags: '["tag-a"]',
  source_kind: "book",
  source_id: "book-1",
  created_at: 1000,
  updated_at: 1000,
  deleted_at: null,
};

describe("knowledge-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1234);
    coreMocks.getDB.mockResolvedValue(mockDb);
    coreMocks.getDeviceId.mockResolvedValue("device-1");
    coreMocks.nextSyncVersion.mockResolvedValue(7);
    coreMocks.nextUpdatedAt.mockResolvedValue(2345);
    coreMocks.insertTombstone.mockResolvedValue(undefined);
    mockSelect.mockResolvedValue([]);
    mockExecute.mockResolvedValue(undefined);
    eventBus.clear("knowledge:card-templates-changed");
  });

  afterEach(() => {
    eventBus.clear("knowledge:card-templates-changed");
    vi.restoreAllMocks();
  });

  it("maps a knowledge document row", async () => {
    mockSelect.mockResolvedValue([docRow]);

    const doc = await getKnowledgeDocument("doc-1");

    expect(doc).toMatchObject({
      id: "doc-1",
      bookId: "book-1",
      type: "book_home",
      title: "Book Home",
      contentJson: { type: "doc", content: [] },
      contentMd: "# Book Home",
      summaryMd: "Compact durable memory",
      summarySourceFingerprint: "fnv1a32:12345678",
      summarySourceUpdatedAt: 900,
      summaryUpdatedAt: 950,
      tags: ["tag-a"],
      sourceKind: "book",
      sourceId: "book-1",
    });
    expect(mockSelect).toHaveBeenCalledWith(
      "SELECT * FROM knowledge_documents WHERE id = ? LIMIT 1",
      ["doc-1"],
    );
  });

  it("filters knowledge documents by book, type, source, and limit", async () => {
    mockSelect.mockResolvedValue([]);

    await getKnowledgeDocuments({
      bookId: "book-1",
      parentId: null,
      type: "book_home",
      sourceKind: "book",
      sourceId: "book-1",
      limit: 5,
    });

    const [sql, params] = mockSelect.mock.calls[0];
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).toContain("book_id = ?");
    expect(sql).toContain("parent_id IS NULL");
    expect(sql).toContain("type = ?");
    expect(sql).toContain("source_kind = ?");
    expect(sql).toContain("source_id = ?");
    expect(params).toEqual(["book-1", "book_home", "book", "book-1", 5]);
  });

  it("searches knowledge documents across title, excerpt, content, and tags", async () => {
    mockSelect.mockResolvedValue([docRow]);

    const docs = await searchKnowledgeDocuments({
      query: "Deep 100%",
      bookId: "book-1",
      type: "standalone_note",
      limit: 3,
    });

    const [sql, params] = mockSelect.mock.calls[0];
    expect(docs).toHaveLength(1);
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).toContain("book_id = ?");
    expect(sql).toContain("type = ?");
    expect(sql).toContain("LOWER(title) LIKE ? ESCAPE '\\'");
    expect(sql).toContain("LOWER(summary_md) LIKE ? ESCAPE '\\'");
    expect(sql).toContain("LOWER(content_md) LIKE ? ESCAPE '\\'");
    expect(params).toEqual([
      "book-1",
      "standalone_note",
      "%deep%",
      "%deep%",
      "%deep%",
      "%deep%",
      "%deep%",
      "%100\\%%",
      "%100\\%%",
      "%100\\%%",
      "%100\\%%",
      "%100\\%%",
      3,
    ]);
  });

  it("creates a knowledge document with defaults and sync tracking", async () => {
    mockExecute.mockResolvedValue(undefined);

    const doc = await createKnowledgeDocument({
      bookId: "book-1",
      type: "book_home",
      title: "  Book Home  ",
      sourceKind: "book",
      sourceId: "book-1",
    });

    expect(doc).toMatchObject({
      id: "generated-id",
      title: "Book Home",
      contentJson: { type: "doc", content: [] },
      contentMd: "",
      contentSchemaVersion: 1,
      tags: [],
      createdAt: 1234,
      updatedAt: 1234,
    });

    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain("INSERT INTO knowledge_documents");
    expect(params[0]).toBe("generated-id");
    expect(params[1]).toBe("book-1");
    expect(params[5]).toBe('{"type":"doc","content":[]}');
    expect(params[19]).toBe(7);
    expect(params[20]).toBe("device-1");
  });

  it("ensures book home document by returning the existing document first", async () => {
    mockSelect.mockResolvedValue([docRow]);

    const doc = await ensureBookHomeDocument("book-1", "Fallback");

    expect(doc.id).toBe("doc-1");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("inserts a provided knowledge document", async () => {
    mockExecute.mockResolvedValue(undefined);

    await insertKnowledgeDocument({
      id: "doc-2",
      bookId: "book-1",
      type: "standalone_note",
      title: "Manual",
      contentJson: { type: "doc" },
      contentMd: "Manual",
      contentSchemaVersion: 1,
      tags: ["x"],
      createdAt: 1000,
      updatedAt: 1000,
    });

    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain("INSERT INTO knowledge_documents");
    expect(params[0]).toBe("doc-2");
    expect(params[13]).toBe('["x"]');
  });

  it("updates content, nullable fields, and sync tracking", async () => {
    await updateKnowledgeDocument("doc-1", {
      title: "Updated",
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      contentMd: "Updated",
      excerpt: undefined,
      tags: ["new"],
      sourceKind: undefined,
    });

    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain("title = ?");
    expect(sql).toContain("content_json = ?");
    expect(sql).toContain("content_md = ?");
    expect(sql).toContain("summary_md = NULL");
    expect(sql).toContain("summary_source_fingerprint = NULL");
    expect(sql).toContain("summary_source_updated_at = NULL");
    expect(sql).toContain("summary_updated_at = NULL");
    expect(sql).toContain("excerpt = ?");
    expect(sql).toContain("source_kind = ?");
    expect(sql).toContain("updated_at = ?");
    expect(sql).toContain("sync_version = ?");
    expect(params).toContain("Updated");
    expect(params).toContain('{"type":"doc","content":[{"type":"paragraph"}]}');
    expect(params).toContain('["new"]');
    expect(params).toContain(2345);
    expect(params).toContain(7);
    expect(params).toContain("device-1");
  });

  it("keeps compact summary state when only moving documents", async () => {
    await updateKnowledgeDocument("doc-1", {
      parentId: "folder-1",
    });

    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain("parent_id = ?");
    expect(sql).not.toContain("summary_md = NULL");
    expect(sql).not.toContain("summary_source_fingerprint = NULL");
    expect(params).toContain("folder-1");
  });

  it("updates compact summary state without writing back to legacy notes", async () => {
    await updateKnowledgeDocumentSummary("doc-1", {
      summaryMd: "  ## Memory\n- Keep this.  ",
      sourceFingerprint: "fnv1a32:abcdef12",
      sourceUpdatedAt: 3000,
      compressedAt: 4000,
    });

    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain("summary_md = ?");
    expect(sql).toContain("summary_source_fingerprint = ?");
    expect(sql).toContain("summary_source_updated_at = ?");
    expect(sql).toContain("summary_updated_at = ?");
    expect(sql).toContain("sync_version = ?");
    expect(params).toEqual([
      "## Memory\n- Keep this.",
      "fnv1a32:abcdef12",
      3000,
      4000,
      2345,
      7,
      "device-1",
      "doc-1",
    ]);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("writes projection document edits back to their legacy source", async () => {
    mockSelect
      .mockResolvedValueOnce([
        {
          ...docRow,
          type: "highlight_note",
          title: "New note",
          content_md: `New note

> Quoted source

_Source: Chapter 1_`,
          source_kind: "highlight",
          source_id: "hl-1",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "hl-1",
          text: "Quoted source",
          note: "Old note",
          chapter_title: "Chapter 1",
        },
      ]);

    await updateKnowledgeDocument("doc-1", {
      title: "New note",
      contentMd: `New note

> Quoted source

_Source: Chapter 1_`,
    });

    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockExecute).toHaveBeenNthCalledWith(2, expect.stringContaining("UPDATE highlights"), [
      "New note",
      2345,
      7,
      "device-1",
      "hl-1",
    ]);
  });

  it("deletes a knowledge document with a tombstone", async () => {
    mockSelect
      .mockResolvedValueOnce([{ id: "link-out-1" }, { id: "link-out-2" }, { id: "link-in-1" }])
      .mockResolvedValueOnce([{ id: "att-1" }]);

    await deleteKnowledgeDocument("doc-1");

    expect(mockSelect).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("to_kind = 'document'"),
      ["doc-1", "doc-1"],
    );
    expect(mockSelect).toHaveBeenNthCalledWith(
      2,
      "SELECT id FROM knowledge_attachments WHERE document_id = ?",
      ["doc-1"],
    );
    expect(coreMocks.insertTombstone).toHaveBeenCalledWith(
      mockDb,
      "link-out-1",
      "knowledge_links",
    );
    expect(coreMocks.insertTombstone).toHaveBeenCalledWith(
      mockDb,
      "link-out-2",
      "knowledge_links",
    );
    expect(coreMocks.insertTombstone).toHaveBeenCalledWith(
      mockDb,
      "link-in-1",
      "knowledge_links",
    );
    expect(coreMocks.insertTombstone).toHaveBeenCalledWith(
      mockDb,
      "att-1",
      "knowledge_attachments",
    );
    expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "doc-1", "knowledge_documents");
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("to_kind = 'document'"),
      ["doc-1", "doc-1"],
    );
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      "DELETE FROM knowledge_attachments WHERE document_id = ?",
      ["doc-1"],
    );
    expect(mockExecute).toHaveBeenNthCalledWith(
      3,
      "DELETE FROM knowledge_documents WHERE id = ?",
      ["doc-1"],
    );
  });

  it("maps and inserts knowledge links", async () => {
    mockSelect.mockResolvedValue([
      {
        id: "link-1",
        from_document_id: "doc-1",
        to_kind: "highlight",
        to_id: "hl-1",
        relation: "source",
        label: "Quote",
        cfi: "epubcfi(/6/2)",
        created_at: 1000,
        updated_at: 1000,
      },
    ]);

    const links = await getKnowledgeLinks("doc-1");
    expect(links[0]).toMatchObject({
      id: "link-1",
      fromDocumentId: "doc-1",
      toKind: "highlight",
      relation: "source",
      cfi: "epubcfi(/6/2)",
    });

    const link: KnowledgeLink = {
      id: "link-2",
      fromDocumentId: "doc-1",
      toKind: "document",
      toId: "doc-2",
      relation: "related",
      createdAt: 1000,
      updatedAt: 1000,
    };
    await insertKnowledgeLink(link);
    expect(mockExecute.mock.calls[0][0]).toContain("INSERT INTO knowledge_links");

    await deleteKnowledgeLink("link-2");
    expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "link-2", "knowledge_links");
  });

  it("maps backlinks with their source documents", async () => {
    mockSelect.mockResolvedValue([
      {
        id: "link-1",
        from_document_id: "doc-source",
        to_kind: "document",
        to_id: "doc-target",
        relation: "related",
        label: "Related idea",
        cfi: null,
        created_at: 1000,
        updated_at: 2000,
        document_id: "doc-source",
        document_book_id: "book-1",
        document_parent_id: null,
        document_type: "standalone_note",
        document_title: "Source note",
        document_content_json: '{"type":"doc","content":[]}',
        document_content_md: "Source body",
        document_content_schema_version: 1,
        document_excerpt: "Source body",
        document_tags: '["idea"]',
        document_source_kind: "book",
        document_source_id: "book-1",
        document_created_at: 900,
        document_updated_at: 1800,
        document_deleted_at: null,
      },
    ]);

    const backlinks = await getKnowledgeBacklinks("doc-target", 5);

    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].link).toMatchObject({
      id: "link-1",
      fromDocumentId: "doc-source",
      toKind: "document",
      toId: "doc-target",
      relation: "related",
    });
    expect(backlinks[0].fromDocument).toMatchObject({
      id: "doc-source",
      type: "standalone_note",
      title: "Source note",
      tags: ["idea"],
    });
    expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining("kl.to_kind = 'document'"), [
      "doc-target",
      5,
    ]);
  });

  it("maps and inserts knowledge attachments", async () => {
    mockSelect.mockResolvedValue([
      {
        id: "att-1",
        document_id: "doc-1",
        kind: "image",
        file_name: "cover.png",
        mime_type: "image/png",
        local_path: "/tmp/cover.png",
        remote_path: "/readany/data/knowledge/cover.png",
        size: 12,
        hash: "hash",
        created_at: 1000,
        updated_at: 1000,
      },
    ]);

    const attachments = await getKnowledgeAttachments("doc-1");
    expect(attachments[0]).toMatchObject({
      id: "att-1",
      documentId: "doc-1",
      kind: "image",
      fileName: "cover.png",
      size: 12,
    });

    const attachment: KnowledgeAttachment = {
      id: "att-2",
      documentId: "doc-1",
      kind: "file",
      fileName: "note.bin",
      size: 1,
      createdAt: 1000,
      updatedAt: 1000,
    };
    await insertKnowledgeAttachment(attachment);
    expect(mockExecute.mock.calls[0][0]).toContain("INSERT INTO knowledge_attachments");

    await deleteKnowledgeAttachment("att-2");
    expect(coreMocks.insertTombstone).toHaveBeenCalledWith(
      mockDb,
      "att-2",
      "knowledge_attachments",
    );
  });

  it("maps and upserts card templates", async () => {
    const events: EventMap["knowledge:card-templates-changed"][] = [];
    const unsubscribe = eventBus.on("knowledge:card-templates-changed", (event) => {
      events.push(event);
    });

    mockSelect.mockResolvedValue([
      {
        id: "card-quote",
        name: "Quote",
        version: 1,
        schema_json: '{"type":"object"}',
        built_in: 1,
        enabled: 1,
        created_at: 1000,
        updated_at: 1000,
      },
    ]);

    const templates = await getKnowledgeCardTemplates();
    expect(templates[0]).toMatchObject({
      id: "card-quote",
      schemaJson: { type: "object" },
      builtIn: true,
      enabled: true,
    });
    expect(mockSelect.mock.calls[0][0]).toContain("WHERE enabled = 1");

    mockSelect.mockClear();
    mockSelect.mockResolvedValue([
      {
        id: "card-archive",
        name: "Archived card",
        version: 2,
        schema_json: '{"cardType":"custom:card-archive"}',
        built_in: 0,
        enabled: 0,
        created_at: 1000,
        updated_at: 1200,
      },
    ]);
    const archivedTemplates = await getKnowledgeCardTemplates({ includeDisabled: true });
    expect(mockSelect.mock.calls[0][0]).not.toContain("WHERE enabled = 1");
    expect(archivedTemplates[0]).toMatchObject({
      id: "card-archive",
      schemaJson: { cardType: "custom:card-archive" },
      builtIn: false,
      enabled: false,
    });

    const template: KnowledgeCardTemplate = {
      id: "card-review",
      name: "Review",
      version: 1,
      schemaJson: { type: "object" },
      builtIn: false,
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
    };
    await upsertKnowledgeCardTemplate(template);
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain("INSERT INTO knowledge_card_templates");
    expect(sql).toContain("ON CONFLICT(id) DO UPDATE");
    expect(params[3]).toBe('{"type":"object"}');
    expect(events).toEqual([
      {
        action: "upsert",
        templateId: "card-review",
        timestamp: 1234,
      },
    ]);
    unsubscribe();
  });

  it("soft-disables user card templates for sync-safe template management", async () => {
    const events: EventMap["knowledge:card-templates-changed"][] = [];
    const unsubscribe = eventBus.on("knowledge:card-templates-changed", (event) => {
      events.push(event);
    });

    await disableKnowledgeCardTemplate("card-review");

    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain("UPDATE knowledge_card_templates");
    expect(sql).toContain("enabled = 0");
    expect(sql).toContain("built_in = 0");
    expect(params[3]).toBe("card-review");
    expect(events).toEqual([
      {
        action: "disable",
        templateId: "card-review",
        timestamp: 1234,
      },
    ]);
    unsubscribe();
  });
});
