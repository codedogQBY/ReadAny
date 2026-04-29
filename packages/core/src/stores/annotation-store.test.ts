import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HighlightWithBook } from "../db/database";
import type { Highlight } from "../types";
import { eventBus } from "../utils/event-bus";

const dbMocks = vi.hoisted(() => ({
  insertHighlight: vi.fn(),
  updateHighlight: vi.fn(),
  deleteHighlight: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  insertNote: vi.fn(),
  insertBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
  getHighlights: vi.fn(),
  getNotes: vi.fn(),
  getBookmarks: vi.fn(),
  getAllHighlights: vi.fn(),
  getAllHighlightsWithBooks: vi.fn(),
  getHighlightStats: vi.fn(),
}));

vi.mock("../db/database", () => dbMocks);

const { useAnnotationStore } = await import("./annotation-store");

const baseHighlight: Highlight = {
  id: "hl-1",
  bookId: "book-1",
  cfi: "epubcfi(/6/2[chapter]!/4/2/10)",
  text: "Selected text",
  color: "yellow",
  note: "Original note",
  chapterTitle: "Chapter 1",
  createdAt: 100,
  updatedAt: 100,
};

const baseHighlightWithBook: HighlightWithBook = {
  ...baseHighlight,
  bookTitle: "Book Title",
  bookAuthor: "Author",
  bookCoverUrl: "cover.jpg",
};

const baseStats = {
  totalHighlights: 1,
  highlightsWithNotes: 1,
  totalBooks: 1,
  colorDistribution: { yellow: 1 },
  recentCount: 1,
};

function resetAnnotationStore() {
  useAnnotationStore.setState({
    highlights: [],
    highlightsWithBooks: [],
    notes: [],
    bookmarks: [],
    stats: null,
  });
}

describe("useAnnotationStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAnnotationStore();
    dbMocks.insertHighlight.mockResolvedValue(undefined);
    dbMocks.updateHighlight.mockResolvedValue(undefined);
    dbMocks.deleteHighlight.mockResolvedValue(undefined);
    dbMocks.getAllHighlightsWithBooks.mockResolvedValue([baseHighlightWithBook]);
    dbMocks.getHighlightStats.mockResolvedValue(baseStats);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds a highlight and refreshes derived state", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    useAnnotationStore.getState().addHighlight(baseHighlight);

    expect(useAnnotationStore.getState().highlights).toEqual([baseHighlight]);

    await vi.waitFor(() => {
      expect(dbMocks.insertHighlight).toHaveBeenCalledWith(baseHighlight);
      expect(useAnnotationStore.getState().highlightsWithBooks).toEqual([baseHighlightWithBook]);
      expect(useAnnotationStore.getState().stats).toEqual(baseStats);
    });

    expect(emitSpy).toHaveBeenCalledWith("annotation:added", {
      bookId: "book-1",
      annotationId: "hl-1",
      type: "highlight",
    });
  });

  it("updates a highlight and re-syncs derived highlight data", async () => {
    useAnnotationStore.setState({
      highlights: [baseHighlight],
      highlightsWithBooks: [baseHighlightWithBook],
      stats: baseStats,
    });

    const refreshed = [
      {
        ...baseHighlightWithBook,
        note: "Updated note",
        updatedAt: 200,
      },
    ];
    const refreshedStats = {
      ...baseStats,
      recentCount: 2,
    };

    dbMocks.getAllHighlightsWithBooks.mockResolvedValue(refreshed);
    dbMocks.getHighlightStats.mockResolvedValue(refreshedStats);

    useAnnotationStore.getState().updateHighlight("hl-1", {
      note: "Updated note",
      updatedAt: 200,
    });

    expect(useAnnotationStore.getState().highlights[0]?.note).toBe("Updated note");
    expect(useAnnotationStore.getState().highlightsWithBooks[0]?.note).toBe("Updated note");

    await vi.waitFor(() => {
      expect(dbMocks.updateHighlight).toHaveBeenCalledWith("hl-1", {
        note: "Updated note",
        updatedAt: 200,
      });
      expect(useAnnotationStore.getState().highlightsWithBooks).toEqual(refreshed);
      expect(useAnnotationStore.getState().stats).toEqual(refreshedStats);
    });
  });

  it("removes a highlight and emits a removal event", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    useAnnotationStore.setState({
      highlights: [baseHighlight],
      highlightsWithBooks: [baseHighlightWithBook],
      stats: baseStats,
    });

    dbMocks.getAllHighlightsWithBooks.mockResolvedValue([]);
    dbMocks.getHighlightStats.mockResolvedValue({
      ...baseStats,
      totalHighlights: 0,
      highlightsWithNotes: 0,
      totalBooks: 0,
      colorDistribution: {},
      recentCount: 0,
    });

    useAnnotationStore.getState().removeHighlight("hl-1");

    expect(useAnnotationStore.getState().highlights).toEqual([]);
    expect(useAnnotationStore.getState().highlightsWithBooks).toEqual([]);

    await vi.waitFor(() => {
      expect(dbMocks.deleteHighlight).toHaveBeenCalledWith("hl-1");
      expect(useAnnotationStore.getState().stats?.totalHighlights).toBe(0);
    });

    expect(emitSpy).toHaveBeenCalledWith("annotation:removed", {
      id: "hl-1",
      type: "highlight",
    });
  });

  it("changes highlight color in both local collections and persists the update", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T10:00:00.000Z"));

    useAnnotationStore.setState({
      highlights: [baseHighlight],
      highlightsWithBooks: [baseHighlightWithBook],
      stats: baseStats,
    });

    const expectedUpdatedAt = Date.now();
    dbMocks.getAllHighlightsWithBooks.mockResolvedValue([
      {
        ...baseHighlightWithBook,
        color: "blue",
        updatedAt: expectedUpdatedAt,
      },
    ]);

    useAnnotationStore.getState().changeHighlightColor("hl-1", "blue");

    expect(useAnnotationStore.getState().highlights[0]?.color).toBe("blue");
    expect(useAnnotationStore.getState().highlightsWithBooks[0]?.color).toBe("blue");
    expect(useAnnotationStore.getState().highlights[0]?.updatedAt).toBe(expectedUpdatedAt);

    await vi.waitFor(() => {
      expect(dbMocks.updateHighlight).toHaveBeenCalledWith("hl-1", { color: "blue" });
      expect(useAnnotationStore.getState().highlightsWithBooks[0]?.color).toBe("blue");
    });

    vi.useRealTimers();
  });
});
