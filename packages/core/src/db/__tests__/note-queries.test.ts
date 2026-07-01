import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLegacyNoteMarkdown } from "../../knowledge/document-utils";
import type { KnowledgeDocument, Note } from "../../types";

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

const { getNotes, getAllNotes, ensureNoteKnowledgeDocuments, insertNote, updateNote, deleteNote } =
  await import("../note-queries");

const sampleNote: Note = {
  id: "note-1",
  bookId: "book-1",
  highlightId: "hl-1",
  cfi: "epubcfi(/6/2)",
  title: "My Note",
  content: "Note content here",
  chapterTitle: "Chapter 1",
  tags: ["important", "review"],
  createdAt: 1000,
  updatedAt: 1000,
};

const sampleNoteRow = {
  id: "note-1",
  book_id: "book-1",
  highlight_id: "hl-1",
  cfi: "epubcfi(/6/2)",
  title: "My Note",
  content: "Note content here",
  chapter_title: "Chapter 1",
  tags: '["important","review"]',
  created_at: 1000,
  updated_at: 1000,
};

function knowledgeDocument(overrides: Partial<KnowledgeDocument>): KnowledgeDocument {
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "standalone_note",
    title: "My Note",
    contentJson: { type: "doc", content: [] },
    contentMd: createLegacyNoteMarkdown(sampleNote),
    contentSchemaVersion: 1,
    tags: ["important", "review"],
    sourceKind: "note",
    sourceId: "note-1",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("note-queries", () => {
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

  describe("getNotes", () => {
    it("returns mapped notes for a specific book", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "note-1",
          book_id: "book-1",
          highlight_id: "hl-1",
          cfi: "epubcfi(/6/2)",
          title: "My Note",
          content: "Note content here",
          chapter_title: "Chapter 1",
          tags: '["important","review"]',
          created_at: 1000,
          updated_at: 1000,
        },
      ]);

      const notes = await getNotes("book-1");
      expect(notes).toHaveLength(1);
      expect(notes[0].id).toBe("note-1");
      expect(notes[0].bookId).toBe("book-1");
      expect(notes[0].highlightId).toBe("hl-1");
      expect(notes[0].title).toBe("My Note");
      expect(notes[0].tags).toEqual(["important", "review"]);
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM notes WHERE book_id = ? ORDER BY created_at DESC",
        ["book-1"],
      );
    });

    it("handles null optional fields", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "note-2",
          book_id: "book-1",
          highlight_id: null,
          cfi: null,
          title: "Simple Note",
          content: "Content",
          chapter_title: null,
          tags: "[]",
          created_at: 2000,
          updated_at: 2000,
        },
      ]);

      const notes = await getNotes("book-1");
      expect(notes[0].highlightId).toBeUndefined();
      expect(notes[0].cfi).toBeUndefined();
      expect(notes[0].chapterTitle).toBeUndefined();
    });

    it("returns notes sorted by book position", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "note-10",
          book_id: "book-1",
          highlight_id: null,
          cfi: "epubcfi(/6/10!/4/2)",
          title: "Later",
          content: "Later content",
          chapter_title: null,
          tags: "[]",
          created_at: 3000,
          updated_at: 3000,
        },
        {
          id: "note-2",
          book_id: "book-1",
          highlight_id: null,
          cfi: "epubcfi(/6/2!/4/2)",
          title: "Earlier",
          content: "Earlier content",
          chapter_title: null,
          tags: "[]",
          created_at: 1000,
          updated_at: 1000,
        },
      ]);

      const notes = await getNotes("book-1");
      expect(notes.map((note) => note.id)).toEqual(["note-2", "note-10"]);
    });
  });

  describe("getAllNotes", () => {
    it("respects limit parameter", async () => {
      mockSelect.mockResolvedValue([]);

      await getAllNotes(10);
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM notes ORDER BY created_at DESC LIMIT ?",
        [10],
      );
    });

    it("uses default limit of 50", async () => {
      mockSelect.mockResolvedValue([]);

      await getAllNotes();
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM notes ORDER BY created_at DESC LIMIT ?",
        [50],
      );
    });
  });

  describe("ensureNoteKnowledgeDocuments", () => {
    it("projects existing notes for a book", async () => {
      mockSelect.mockResolvedValue([sampleNoteRow]);

      const changedCount = await ensureNoteKnowledgeDocuments("book-1");

      expect(changedCount).toBe(2);
      expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining("WHERE book_id = ?"), [
        "book-1",
        500,
      ]);
      expect(knowledgeMocks.createKnowledgeDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          bookId: "book-1",
          type: "standalone_note",
          title: "My Note",
          contentMd: createLegacyNoteMarkdown(sampleNote),
          tags: ["important", "review"],
          sourceKind: "note",
          sourceId: "note-1",
        }),
      );
      expect(knowledgeMocks.insertKnowledgeLink).toHaveBeenCalledWith(
        expect.objectContaining({
          fromDocumentId: "doc-created",
          toKind: "highlight",
          toId: "hl-1",
          relation: "source",
          cfi: "epubcfi(/6/2)",
        }),
      );
    });

    it("does not rewrite current generated note documents", async () => {
      const existingDocument = knowledgeDocument({
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Note content here" }],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "_Source: Chapter 1_" }],
            },
          ],
        },
        excerpt: "Note content here Source: Chapter 1",
      });
      mockSelect.mockResolvedValue([sampleNoteRow]);
      knowledgeMocks.getKnowledgeDocuments.mockResolvedValue([existingDocument]);
      knowledgeMocks.getKnowledgeLinks.mockResolvedValue([
        {
          id: "link-1",
          fromDocumentId: "doc-1",
          toKind: "highlight",
          toId: "hl-1",
          relation: "source",
          cfi: "epubcfi(/6/2)",
          createdAt: 1,
          updatedAt: 1,
        },
      ]);

      const changedCount = await ensureNoteKnowledgeDocuments("book-1");

      expect(changedCount).toBe(0);
      expect(knowledgeMocks.updateKnowledgeDocument).not.toHaveBeenCalled();
    });
  });

  describe("insertNote", () => {
    it("inserts note with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      await insertNote(sampleNote);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(coreMocks.getDeviceId).toHaveBeenCalled();
      expect(coreMocks.nextSyncVersion).toHaveBeenCalledWith(mockDb, "notes");

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO notes");
      expect(params[0]).toBe("note-1");
      expect(params[1]).toBe("book-1");
      expect(params[2]).toBe("hl-1"); // highlightId
      expect(params[4]).toBe("My Note"); // title
      expect(params[7]).toBe('["important","review"]'); // tags serialized
      expect(knowledgeMocks.createKnowledgeDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          bookId: "book-1",
          type: "standalone_note",
          title: "My Note",
          contentMd: createLegacyNoteMarkdown(sampleNote),
          sourceKind: "note",
          sourceId: "note-1",
        }),
      );
    });
  });

  describe("updateNote", () => {
    it("updates title with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);
      mockSelect.mockResolvedValue([sampleNoteRow]);

      await updateNote("note-1", { title: "Updated Title" });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE notes SET");
      expect(sql).toContain("title = ?");
      expect(params).toContain("Updated Title");
    });

    it("updates content with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);
      mockSelect.mockResolvedValue([sampleNoteRow]);

      await updateNote("note-1", { content: "New content" });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("content = ?");
      expect(params).toContain("New content");
    });

    it("serializes tags as JSON", async () => {
      mockExecute.mockResolvedValue(undefined);
      mockSelect.mockResolvedValue([sampleNoteRow]);

      await updateNote("note-1", { tags: ["new-tag"] });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("tags = ?");
      expect(params).toContain('["new-tag"]');
    });

    it("always includes sync tracking fields", async () => {
      mockExecute.mockResolvedValue(undefined);
      mockSelect.mockResolvedValue([sampleNoteRow]);

      await updateNote("note-1", { title: "Test" });
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain("updated_at = ?");
      expect(sql).toContain("sync_version = ?");
      expect(sql).toContain("last_modified_by = ?");
    });

    it("updates a generated knowledge document when the legacy note changes", async () => {
      mockExecute.mockResolvedValue(undefined);
      mockSelect.mockResolvedValue([sampleNoteRow]);
      knowledgeMocks.getKnowledgeDocuments.mockResolvedValue([knowledgeDocument({})]);

      await updateNote("note-1", { content: "Updated content" });

      expect(knowledgeMocks.updateKnowledgeDocument).toHaveBeenCalledWith(
        "doc-1",
        expect.objectContaining({
          title: "My Note",
          contentMd: createLegacyNoteMarkdown({ ...sampleNote, content: "Updated content" }),
          sourceKind: "note",
          sourceId: "note-1",
        }),
      );
    });

    it("does not overwrite expanded knowledge documents when the legacy note changes", async () => {
      const expandedDocument = knowledgeDocument({
        contentMd: `${createLegacyNoteMarkdown(sampleNote)}\n\nUser expansion`,
      });
      mockExecute.mockResolvedValue(undefined);
      mockSelect.mockResolvedValue([sampleNoteRow]);
      knowledgeMocks.getKnowledgeDocuments.mockResolvedValue([expandedDocument]);

      await updateNote("note-1", { content: "Updated content" });

      expect(knowledgeMocks.updateKnowledgeDocument).not.toHaveBeenCalled();
      expect(knowledgeMocks.createKnowledgeDocument).not.toHaveBeenCalled();
    });

    it("deletes generated knowledge documents when the note is cleared", async () => {
      mockExecute.mockResolvedValue(undefined);
      mockSelect.mockResolvedValue([sampleNoteRow]);
      knowledgeMocks.getKnowledgeDocuments.mockResolvedValue([knowledgeDocument({})]);

      await updateNote("note-1", { title: "", content: "" });

      expect(knowledgeMocks.deleteKnowledgeDocument).toHaveBeenCalledWith("doc-1");
    });
  });

  describe("deleteNote", () => {
    it("deletes note and creates tombstone", async () => {
      mockExecute.mockResolvedValue(undefined);
      mockSelect.mockResolvedValue([]);

      await deleteNote("note-1");
      expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "note-1", "notes");
      expect(mockExecute).toHaveBeenCalledWith("DELETE FROM notes WHERE id = ?", ["note-1"]);
    });
  });
});
