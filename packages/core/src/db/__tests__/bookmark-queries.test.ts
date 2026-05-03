import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bookmark } from "../../types";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect, close: vi.fn() };

const coreMocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getDeviceId: vi.fn(),
  nextSyncVersion: vi.fn(),
  insertTombstone: vi.fn(),
}));

vi.mock("../db-core", () => coreMocks);

const { getBookmarks, insertBookmark, deleteBookmark } = await import("../bookmark-queries");

const sampleBookmark: Bookmark = {
  id: "bm-1",
  bookId: "book-1",
  cfi: "epubcfi(/6/2!/4/2/10)",
  label: "Important part",
  chapterTitle: "Chapter 1",
  createdAt: 1000,
};

describe("bookmark-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getDB.mockResolvedValue(mockDb);
    coreMocks.getDeviceId.mockResolvedValue("device-1");
    coreMocks.nextSyncVersion.mockResolvedValue(1);
    coreMocks.insertTombstone.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getBookmarks", () => {
    it("returns mapped bookmarks for a specific book", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "bm-1",
          book_id: "book-1",
          cfi: "epubcfi(/6/2!/4/2/10)",
          label: "Important part",
          chapter_title: "Chapter 1",
          created_at: 1000,
        },
      ]);

      const bookmarks = await getBookmarks("book-1");
      expect(bookmarks).toHaveLength(1);
      expect(bookmarks[0].id).toBe("bm-1");
      expect(bookmarks[0].bookId).toBe("book-1");
      expect(bookmarks[0].cfi).toBe("epubcfi(/6/2!/4/2/10)");
      expect(bookmarks[0].label).toBe("Important part");
      expect(bookmarks[0].chapterTitle).toBe("Chapter 1");
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM bookmarks WHERE book_id = ? ORDER BY created_at DESC",
        ["book-1"],
      );
    });

    it("returns empty array when no bookmarks", async () => {
      mockSelect.mockResolvedValue([]);
      const bookmarks = await getBookmarks("book-1");
      expect(bookmarks).toEqual([]);
    });

    it("handles null label and chapter_title", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "bm-2",
          book_id: "book-1",
          cfi: "epubcfi(/6/4)",
          label: null,
          chapter_title: null,
          created_at: 2000,
        },
      ]);

      const bookmarks = await getBookmarks("book-1");
      expect(bookmarks[0].label).toBeUndefined();
      expect(bookmarks[0].chapterTitle).toBeUndefined();
    });
  });

  describe("insertBookmark", () => {
    it("inserts bookmark with updated_at sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);
      vi.spyOn(Date, "now").mockReturnValue(1500);

      await insertBookmark(sampleBookmark);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(coreMocks.getDeviceId).toHaveBeenCalled();
      expect(coreMocks.nextSyncVersion).toHaveBeenCalledWith(mockDb, "bookmarks");

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO bookmarks");
      expect(sql).toContain("updated_at");
      expect(params[0]).toBe("bm-1");
      expect(params[1]).toBe("book-1");
      expect(params[2]).toBe("epubcfi(/6/2!/4/2/10)");
      expect(params[3]).toBe("Important part");
      expect(params[5]).toBe(1000);
      expect(params[6]).toBe(1500);
    });
  });

  describe("deleteBookmark", () => {
    it("deletes bookmark and creates tombstone", async () => {
      mockExecute.mockResolvedValue(undefined);

      await deleteBookmark("bm-1");
      expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "bm-1", "bookmarks");
      expect(mockExecute).toHaveBeenCalledWith("DELETE FROM bookmarks WHERE id = ?", ["bm-1"]);
    });
  });
});
