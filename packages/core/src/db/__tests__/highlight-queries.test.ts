import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Highlight } from "../../types";

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

vi.mock("../db-core", () => coreMocks);

const {
  getHighlights,
  getAllHighlights,
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

describe("highlight-queries", () => {
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

  describe("insertHighlight", () => {
    it("inserts highlight with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      await insertHighlight(sampleHighlight);
      expect(mockExecute).toHaveBeenCalledTimes(1);

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO highlights");
      expect(params[0]).toBe("hl-1");
      expect(params[1]).toBe("book-1");
      expect(params[4]).toBe("yellow");
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

      await updateHighlight("hl-1", { note: undefined });
      const [, params] = mockExecute.mock.calls[0];
      expect(params).toContain(null);
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
