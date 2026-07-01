import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHighlightNoteMarkdown } from "../../knowledge/document-utils";
import type { Highlight, KnowledgeDocument } from "../../types";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect, close: vi.fn() };

const coreMocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getDeviceId: vi.fn(),
  nextSyncVersion: vi.fn(),
  nextUpdatedAt: vi.fn(),
  insertTombstone: vi.fn(),
}));

const knowledgeMocks = vi.hoisted(() => ({
  getKnowledgeDocuments: vi.fn(),
  createKnowledgeDocument: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
  deleteKnowledgeDocument: vi.fn(),
  getKnowledgeLinks: vi.fn(),
  insertKnowledgeLink: vi.fn(),
}));

vi.mock("../db-core", () => coreMocks);
vi.mock("../knowledge-queries", () => knowledgeMocks);

const {
  getHighlights,
  getAllHighlights,
  ensureHighlightNoteKnowledgeDocuments,
  insertHighlight,
  updateHighlight,
  deleteHighlight,
  getHighlightStats,
} = await import("../highlight-queries");

const sampleHighlight: Highlight = {
  id: "hl-1",
  bookId: "book-1",
  cfi: "epubcfi(/6/2!/4/2/10)",
  text: "Important text",
  color: "yellow",
  note: "My note",
  chapterTitle: "Chapter 1",
  createdAt: 1000,
  updatedAt: 1000,
};

const sampleHighlightRow = {
  id: "hl-1",
  book_id: "book-1",
  cfi: "epubcfi(/6/2!/4/2/10)",
  text: "Important text",
  color: "yellow",
  note: "My note",
  chapter_title: "Chapter 1",
  created_at: 1000,
  updated_at: 1000,
};

function knowledgeDocument(overrides: Partial<KnowledgeDocument>): KnowledgeDocument {
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "highlight_note",
    title: "My note",
    contentJson: { type: "doc", content: [] },
    contentMd: createHighlightNoteMarkdown(sampleHighlight),
    contentSchemaVersion: 1,
    tags: [],
    sourceKind: "highlight",
    sourceId: "hl-1",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("highlight-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getDB.mockResolvedValue(mockDb);
    coreMocks.getDeviceId.mockResolvedValue("device-1");
    coreMocks.nextSyncVersion.mockResolvedValue(1);
    coreMocks.nextUpdatedAt.mockResolvedValue(2000);
    coreMocks.insertTombstone.mockResolvedValue(undefined);
    mockSelect.mockResolvedValue([]);
    knowledgeMocks.getKnowledgeDocuments.mockResolvedValue([]);
    knowledgeMocks.createKnowledgeDocument.mockImplementation(async () =>
      knowledgeDocument({ id: "doc-created" }),
    );
    knowledgeMocks.updateKnowledgeDocument.mockResolvedValue(undefined);
    knowledgeMocks.deleteKnowledgeDocument.mockResolvedValue(undefined);
    knowledgeMocks.getKnowledgeLinks.mockResolvedValue([]);
    knowledgeMocks.insertKnowledgeLink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getHighlights", () => {
    it("returns highlights for a specific book", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "hl-1",
          book_id: "book-1",
          cfi: "epubcfi(/6/2!/4/2/10)",
          text: "Important text",
          color: "yellow",
          note: "My note",
          chapter_title: "Chapter 1",
          created_at: 1000,
          updated_at: 1000,
        },
      ]);

      const highlights = await getHighlights("book-1");
      expect(highlights).toHaveLength(1);
      expect(highlights[0].id).toBe("hl-1");
      expect(highlights[0].bookId).toBe("book-1");
      expect(highlights[0].color).toBe("yellow");
    });

    it("returns highlights sorted by book position", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "hl-10",
          book_id: "book-1",
          cfi: "epubcfi(/6/10!/4/2)",
          text: "Later text",
          color: "yellow",
          note: null,
          chapter_title: null,
          created_at: 3000,
          updated_at: 3000,
        },
        {
          id: "hl-2",
          book_id: "book-1",
          cfi: "epubcfi(/6/2!/4/2)",
          text: "Earlier text",
          color: "yellow",
          note: null,
          chapter_title: null,
          created_at: 1000,
          updated_at: 1000,
        },
      ]);

      const highlights = await getHighlights("book-1");
      expect(highlights.map((highlight) => highlight.id)).toEqual(["hl-2", "hl-10"]);
    });
  });

  describe("getAllHighlights", () => {
    it("respects limit parameter", async () => {
      mockSelect.mockResolvedValue([]);

      await getAllHighlights(10);
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM highlights ORDER BY created_at DESC LIMIT ?",
        [10],
      );
    });

    it("uses default limit of 50", async () => {
      mockSelect.mockResolvedValue([]);

      await getAllHighlights();
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM highlights ORDER BY created_at DESC LIMIT ?",
        [50],
      );
    });
  });

  describe("ensureHighlightNoteKnowledgeDocuments", () => {
    it("projects existing highlight notes for a book", async () => {
      mockSelect.mockResolvedValue([sampleHighlightRow]);

      const changedCount = await ensureHighlightNoteKnowledgeDocuments("book-1");

      expect(changedCount).toBe(2);
      expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining("WHERE book_id = ?"), [
        "book-1",
        500,
      ]);
      expect(knowledgeMocks.createKnowledgeDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          bookId: "book-1",
          type: "highlight_note",
          contentMd: createHighlightNoteMarkdown(sampleHighlight),
          sourceKind: "highlight",
          sourceId: "hl-1",
        }),
      );
      expect(knowledgeMocks.insertKnowledgeLink).toHaveBeenCalledWith(
        expect.objectContaining({
          fromDocumentId: "doc-created",
          toKind: "highlight",
          toId: "hl-1",
          relation: "source",
          cfi: "epubcfi(/6/2!/4/2/10)",
        }),
      );
    });

    it("does not rewrite a current generated highlight note document", async () => {
      const existingDocument = knowledgeDocument({
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "My note" }],
            },
            {
              type: "blockquote",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Important text" }],
                },
              ],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "_Source: Chapter 1_" }],
            },
          ],
        },
        excerpt: "My note Important text Source: Chapter 1",
      });
      mockSelect.mockResolvedValue([sampleHighlightRow]);
      knowledgeMocks.getKnowledgeDocuments.mockResolvedValue([existingDocument]);
      knowledgeMocks.getKnowledgeLinks.mockResolvedValue([
        {
          id: "link-1",
          fromDocumentId: "doc-1",
          toKind: "highlight",
          toId: "hl-1",
          relation: "source",
          cfi: "epubcfi(/6/2!/4/2/10)",
          createdAt: 1,
          updatedAt: 1,
        },
      ]);

      const changedCount = await ensureHighlightNoteKnowledgeDocuments("book-1");

      expect(changedCount).toBe(0);
      expect(knowledgeMocks.updateKnowledgeDocument).not.toHaveBeenCalled();
    });
  });

  describe("insertHighlight", () => {
    it("inserts highlight with sync tracking and projects note into knowledge", async () => {
      mockExecute.mockResolvedValue(undefined);

      await insertHighlight(sampleHighlight);
      expect(mockExecute).toHaveBeenCalledTimes(1);

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO highlights");
      expect(params[0]).toBe("hl-1");
      expect(params[1]).toBe("book-1");
      expect(params[4]).toBe("yellow");
      expect(knowledgeMocks.createKnowledgeDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          bookId: "book-1",
          type: "highlight_note",
          title: "My note",
          contentMd: createHighlightNoteMarkdown(sampleHighlight),
          sourceKind: "highlight",
          sourceId: "hl-1",
        }),
      );
    });

    it("does not create a knowledge document for empty notes", async () => {
      mockExecute.mockResolvedValue(undefined);

      await insertHighlight({ ...sampleHighlight, note: "  " });
      expect(knowledgeMocks.createKnowledgeDocument).not.toHaveBeenCalled();
    });
  });

  describe("updateHighlight", () => {
    it("updates color with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateHighlight("hl-1", { color: "blue" });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE highlights SET");
      expect(sql).toContain("color = ?");
      expect(params).toContain("blue");
    });

    it("can set note to null", async () => {
      mockExecute.mockResolvedValue(undefined);
      mockSelect.mockResolvedValue([sampleHighlightRow]);

      await updateHighlight("hl-1", { note: undefined });
      const [, params] = mockExecute.mock.calls[0];
      expect(params).toContain(null);
    });

    it("updates a generated highlight note document when the legacy note changes", async () => {
      const existingDocument = knowledgeDocument({});
      mockExecute.mockResolvedValue(undefined);
      mockSelect.mockResolvedValue([sampleHighlightRow]);
      knowledgeMocks.getKnowledgeDocuments.mockResolvedValue([existingDocument]);

      await updateHighlight("hl-1", { note: "Updated note" });

      expect(knowledgeMocks.updateKnowledgeDocument).toHaveBeenCalledWith(
        "doc-1",
        expect.objectContaining({
          title: "Updated note",
          contentMd: createHighlightNoteMarkdown({
            ...sampleHighlight,
            note: "Updated note",
          }),
        }),
      );
    });

    it("does not overwrite expanded knowledge documents when the legacy note changes", async () => {
      const expandedDocument = knowledgeDocument({
        contentMd: `${createHighlightNoteMarkdown(sampleHighlight)}\n\nUser expansion`,
      });
      mockExecute.mockResolvedValue(undefined);
      mockSelect.mockResolvedValue([sampleHighlightRow]);
      knowledgeMocks.getKnowledgeDocuments.mockResolvedValue([expandedDocument]);

      await updateHighlight("hl-1", { note: "Updated note" });

      expect(knowledgeMocks.updateKnowledgeDocument).not.toHaveBeenCalled();
      expect(knowledgeMocks.createKnowledgeDocument).not.toHaveBeenCalled();
    });

    it("deletes generated highlight note documents when the note is cleared", async () => {
      mockExecute.mockResolvedValue(undefined);
      mockSelect.mockResolvedValue([sampleHighlightRow]);
      knowledgeMocks.getKnowledgeDocuments.mockResolvedValue([knowledgeDocument({})]);

      await updateHighlight("hl-1", { note: undefined });

      expect(knowledgeMocks.deleteKnowledgeDocument).toHaveBeenCalledWith("doc-1");
    });
  });

  describe("deleteHighlight", () => {
    it("deletes highlight and creates tombstone", async () => {
      mockExecute.mockResolvedValue(undefined);

      await deleteHighlight("hl-1");
      expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "hl-1", "highlights");
      expect(mockExecute).toHaveBeenCalledWith("DELETE FROM highlights WHERE id = ?", ["hl-1"]);
    });
  });

  describe("getHighlightStats", () => {
    it("returns aggregated statistics", async () => {
      mockSelect
        .mockResolvedValueOnce([{ count: 10 }]) // total
        .mockResolvedValueOnce([{ count: 3 }]) // with notes
        .mockResolvedValueOnce([{ count: 5 }]) // distinct books
        .mockResolvedValueOnce([
          // color distribution
          { color: "yellow", count: 6 },
          { color: "blue", count: 4 },
        ])
        .mockResolvedValueOnce([{ count: 2 }]); // recent

      const stats = await getHighlightStats();
      expect(stats.totalHighlights).toBe(10);
      expect(stats.highlightsWithNotes).toBe(3);
      expect(stats.totalBooks).toBe(5);
      expect(stats.colorDistribution).toEqual({ yellow: 6, blue: 4 });
      expect(stats.recentCount).toBe(2);
    });
  });
});
