import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "../../types";

// --- Mock db-core ---
const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockClose = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect, close: mockClose };

const coreMocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getLocalDB: vi.fn(),
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

const dependencyMocks = vi.hoisted(() => ({
  deleteThreadsByBookId: vi.fn(),
  deleteChunks: vi.fn(),
}));

const eventBusMocks = vi.hoisted(() => ({
  emit: vi.fn(),
}));

vi.mock("../db-core", () => coreMocks);
vi.mock("../thread-queries", () => ({
  deleteThreadsByBookId: dependencyMocks.deleteThreadsByBookId,
}));
vi.mock("../chunk-queries", () => ({ deleteChunks: dependencyMocks.deleteChunks }));
vi.mock("../../utils/event-bus", () => ({ eventBus: eventBusMocks }));

const { getBooks, getBook, getDeletedBookByFileHash, insertBook, updateBook, deleteBook } =
  await import("../book-queries");

const sampleBook: Book = {
  id: "book-1",
  filePath: "/path/to/book.epub",
  format: "epub",
  meta: {
    title: "Test Book",
    author: "Test Author",
    publisher: "Test Publisher",
    language: "en",
  },
  addedAt: 1000,
  updatedAt: 2000,
  progress: 0.5,
  isVectorized: false,
  vectorizeProgress: 0,
  tags: ["fiction"],
  syncStatus: "local",
};

describe("book-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getDB.mockResolvedValue(mockDb);
    coreMocks.getLocalDB.mockResolvedValue(mockDb);
    coreMocks.getDeviceId.mockResolvedValue("device-1");
    coreMocks.nextSyncVersion.mockResolvedValue(1);
    coreMocks.nextUpdatedAt.mockResolvedValue(3000);
    coreMocks.insertTombstone.mockResolvedValue(undefined);
    dependencyMocks.deleteThreadsByBookId.mockResolvedValue(undefined);
    dependencyMocks.deleteChunks.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getBooks", () => {
    it("returns mapped books from database rows", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "/path/to/book.epub",
          format: "epub",
          title: "Test Book",
          author: "Test Author",
          publisher: null,
          language: "en",
          isbn: null,
          description: null,
          cover_url: null,
          publish_date: null,
          subjects: null,
          total_pages: 100,
          total_chapters: 10,
          added_at: 1000,
          last_opened_at: 2000,
          updated_at: 2000,
          deleted_at: null,
          progress: 0.5,
          current_cfi: "epubcfi(/6/2)",
          is_vectorized: 0,
          vectorize_progress: 0,
          tags: '["fiction"]',
          file_hash: null,
          sync_status: "local",
        },
      ]);

      const books = await getBooks();
      expect(books).toHaveLength(1);
      expect(books[0].id).toBe("book-1");
      expect(books[0].meta.title).toBe("Test Book");
      expect(books[0].progress).toBe(0.5);
      expect(books[0].isVectorized).toBe(false);
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM books WHERE deleted_at IS NULL ORDER BY last_opened_at DESC, added_at DESC",
      );
    });

    it("returns empty array when no books", async () => {
      mockSelect.mockResolvedValue([]);
      const books = await getBooks();
      expect(books).toEqual([]);
    });

    it("can include deleted books when explicitly requested", async () => {
      mockSelect.mockResolvedValue([]);
      await getBooks({ includeDeleted: true });
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM books ORDER BY last_opened_at DESC, added_at DESC",
      );
    });
  });

  describe("getBook", () => {
    it("returns a single book by id", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "/path/to/book.epub",
          format: "epub",
          title: "Test Book",
          author: "Test Author",
          publisher: null,
          language: null,
          isbn: null,
          description: null,
          cover_url: null,
          publish_date: null,
          subjects: null,
          total_pages: 0,
          total_chapters: 0,
          added_at: 1000,
          last_opened_at: null,
          updated_at: 1000,
          deleted_at: null,
          progress: 0,
          current_cfi: null,
          is_vectorized: 0,
          vectorize_progress: 0,
          tags: "[]",
          file_hash: null,
          sync_status: "local",
        },
      ]);

      const book = await getBook("book-1");
      expect(book).not.toBeNull();
      expect(book?.id).toBe("book-1");
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM books WHERE id = ? AND deleted_at IS NULL",
        ["book-1"],
      );
    });

    it("returns null when book not found", async () => {
      mockSelect.mockResolvedValue([]);
      const book = await getBook("nonexistent");
      expect(book).toBeNull();
    });

    it("can look up a previously deleted book by file hash", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "/path/to/book.epub",
          format: "epub",
          title: "Deleted Book",
          author: "Test Author",
          publisher: null,
          language: null,
          isbn: null,
          description: null,
          cover_url: null,
          publish_date: null,
          subjects: null,
          total_pages: 0,
          total_chapters: 0,
          added_at: 1000,
          last_opened_at: null,
          updated_at: 2000,
          deleted_at: 2500,
          progress: 0.3,
          current_cfi: null,
          is_vectorized: 0,
          vectorize_progress: 0,
          tags: "[]",
          file_hash: "hash-1",
          sync_status: "local",
        },
      ]);

      const book = await getDeletedBookByFileHash("hash-1");
      expect(book?.id).toBe("book-1");
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM books WHERE file_hash = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 1",
        ["hash-1"],
      );
    });
  });

  describe("insertBook", () => {
    it("inserts book with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      await insertBook(sampleBook);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(coreMocks.getDeviceId).toHaveBeenCalled();
      expect(coreMocks.nextSyncVersion).toHaveBeenCalledWith(mockDb, "books");

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO books");
      expect(params[0]).toBe("book-1");
      expect(params[1]).toBe("/path/to/book.epub");
    });
  });

  describe("updateBook", () => {
    it("updates specified fields with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateBook("book-1", { progress: 0.8, currentCfi: "epubcfi(/6/4)" });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE books SET");
      expect(sql).toContain("progress = ?");
      expect(sql).toContain("current_cfi = ?");
      expect(params).toContain(0.8);
      expect(params).toContain("epubcfi(/6/4)");
      expect(eventBusMocks.emit).toHaveBeenCalledWith("book:updated", {
        bookId: "book-1",
        changedFields: ["progress", "currentCfi"],
      });
    });

    it("does nothing when no updates provided", async () => {
      await updateBook("book-1", {});
      expect(mockExecute).not.toHaveBeenCalled();
      expect(eventBusMocks.emit).not.toHaveBeenCalled();
    });
  });

  describe("deleteBook", () => {
    it("soft-deletes book and preserves notes + reading stats when requested", async () => {
      mockExecute.mockResolvedValue(undefined);

      await deleteBook("book-1", { preserveData: true });

      expect(mockSelect).not.toHaveBeenCalledWith("SELECT id FROM highlights WHERE book_id = ?", [
        "book-1",
      ]);
      expect(mockExecute).not.toHaveBeenCalledWith("DELETE FROM highlights WHERE book_id = ?", [
        "book-1",
      ]);
      expect(mockExecute).not.toHaveBeenCalledWith("DELETE FROM notes WHERE book_id = ?", [
        "book-1",
      ]);
      expect(mockExecute).not.toHaveBeenCalledWith("DELETE FROM bookmarks WHERE book_id = ?", [
        "book-1",
      ]);
      expect(mockExecute).not.toHaveBeenCalledWith(
        "DELETE FROM reading_sessions WHERE book_id = ?",
        ["book-1"],
      );
      expect(mockExecute).not.toHaveBeenCalledWith("DELETE FROM books WHERE id = ?", ["book-1"]);
      expect(dependencyMocks.deleteThreadsByBookId).toHaveBeenCalledWith("book-1");
      expect(dependencyMocks.deleteChunks).toHaveBeenCalledWith("book-1");
      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("UPDATE books"), [
        expect.any(Number),
        3000,
        1,
        "device-1",
        "book-1",
      ]);
    });

    it("hard-deletes everything when preserveData is not requested", async () => {
      mockExecute.mockResolvedValue(undefined);
      mockSelect
        .mockResolvedValueOnce([{ id: "hl-1" }])
        .mockResolvedValueOnce([{ id: "note-1" }])
        .mockResolvedValueOnce([{ id: "bm-1" }]);

      await deleteBook("book-1");

      expect(mockExecute).toHaveBeenCalledWith("DELETE FROM highlights WHERE book_id = ?", [
        "book-1",
      ]);
      expect(mockExecute).toHaveBeenCalledWith("DELETE FROM notes WHERE book_id = ?", ["book-1"]);
      expect(mockExecute).toHaveBeenCalledWith("DELETE FROM bookmarks WHERE book_id = ?", [
        "book-1",
      ]);
      expect(mockExecute).toHaveBeenCalledWith("DELETE FROM reading_sessions WHERE book_id = ?", [
        "book-1",
      ]);
      expect(mockExecute).toHaveBeenCalledWith("DELETE FROM books WHERE id = ?", ["book-1"]);
      expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "hl-1", "highlights");
      expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "note-1", "notes");
      expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "bm-1", "bookmarks");
      expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "book-1", "books");
    });
  });
});
