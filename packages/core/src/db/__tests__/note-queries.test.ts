import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../../types";

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

vi.mock("../db-core", () => coreMocks);

const { getNotes, getAllNotes, insertNote, updateNote, deleteNote } = await import(
  "../note-queries"
);

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

describe("note-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getDB.mockResolvedValue(mockDb);
    coreMocks.getDeviceId.mockResolvedValue("device-1");
    coreMocks.nextSyncVersion.mockResolvedValue(1);
    coreMocks.nextUpdatedAt.mockResolvedValue(2000);
    coreMocks.insertTombstone.mockResolvedValue(undefined);
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
    });
  });

  describe("updateNote", () => {
    it("updates title with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateNote("note-1", { title: "Updated Title" });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE notes SET");
      expect(sql).toContain("title = ?");
      expect(params).toContain("Updated Title");
    });

    it("updates content with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateNote("note-1", { content: "New content" });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("content = ?");
      expect(params).toContain("New content");
    });

    it("serializes tags as JSON", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateNote("note-1", { tags: ["new-tag"] });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("tags = ?");
      expect(params).toContain('["new-tag"]');
    });

    it("always includes sync tracking fields", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateNote("note-1", { title: "Test" });
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain("updated_at = ?");
      expect(sql).toContain("sync_version = ?");
      expect(sql).toContain("last_modified_by = ?");
    });
  });

  describe("deleteNote", () => {
    it("deletes note and creates tombstone", async () => {
      mockExecute.mockResolvedValue(undefined);

      await deleteNote("note-1");
      expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "note-1", "notes");
      expect(mockExecute).toHaveBeenCalledWith("DELETE FROM notes WHERE id = ?", ["note-1"]);
    });
  });
});
