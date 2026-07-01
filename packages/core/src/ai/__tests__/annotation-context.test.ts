import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Highlight, Note } from "../../types";
import { buildAnnotationPromptContext, loadAnnotationPromptContext } from "../annotation-context";

const dbMocks = vi.hoisted(() => ({
  getHighlights: vi.fn(),
  getNotes: vi.fn(),
}));

vi.mock("../../db/database", () => dbMocks);

function highlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: "highlight-1",
    bookId: "book-1",
    cfi: "epubcfi(/6/2)",
    text: "A highlighted sentence about memory.",
    color: "yellow",
    chapterTitle: "Chapter 1",
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    bookId: "book-1",
    title: "Reading Note",
    content: "A saved annotation note.",
    chapterTitle: "Chapter 1",
    tags: ["memory"],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildAnnotationPromptContext", () => {
  it("includes bounded highlight and note context with stable ids and source positions", () => {
    const context = buildAnnotationPromptContext({
      highlights: [
        highlight({
          id: "hl-1",
          cfi: "epubcfi(/6/4)",
          text: "Learning without thought is labor lost.",
          note: "Modern meaning: study and reflection need each other.",
        }),
      ],
      notes: [
        note({
          id: "note-1",
          cfi: "epubcfi(/6/8)",
          title: "Modern Interpretation",
          content: "Translate classical phrasing into modern meaning.",
          tags: ["translation", "classic"],
        }),
      ],
    });

    expect(context).toContain("not the full annotation set");
    expect(context).toContain("[highlight] Learning without thought is labor lost.");
    expect(context).toContain("id: hl-1");
    expect(context).toContain("cfi: epubcfi(/6/4)");
    expect(context).toContain("Modern meaning");
    expect(context).toContain("[note] Modern Interpretation");
    expect(context).toContain("tags: translation, classic");
  });

  it("prioritizes annotations that match the current question", () => {
    const context = buildAnnotationPromptContext(
      {
        highlights: [
          highlight({
            id: "recent-1",
            text: "A very recent unrelated highlight.",
            updatedAt: 900,
          }),
          highlight({
            id: "match-1",
            text: "A quiet note about tea ceremony timing.",
            updatedAt: 100,
          }),
        ],
        notes: [],
      },
      { query: "tea ceremony", maxHighlights: 1 },
    );

    expect(context).toContain("id: match-1");
    expect(context).not.toContain("recent-1");
  });

  it("keeps annotation snapshots bounded", () => {
    const context = buildAnnotationPromptContext(
      {
        highlights: [
          highlight({
            id: "long-1",
            text: "x".repeat(5000),
          }),
        ],
        notes: [],
      },
      { maxChars: 700 },
    );

    expect(context).toBeTruthy();
    expect(context!.length).toBeLessThanOrEqual(700);
    expect(context).toContain("long-1");
    expect(context).toContain("...");
  });
});

describe("loadAnnotationPromptContext", () => {
  it("loads current-book annotations and formats a bounded prompt context", async () => {
    dbMocks.getHighlights.mockResolvedValue([
      highlight({ id: "hl-1", text: "A highlighted idea." }),
    ]);
    dbMocks.getNotes.mockResolvedValue([
      note({ id: "note-1", title: "Saved Note", content: "My own note." }),
    ]);

    const context = await loadAnnotationPromptContext({ bookId: "book-1" });

    expect(dbMocks.getHighlights).toHaveBeenCalledWith("book-1");
    expect(dbMocks.getNotes).toHaveBeenCalledWith("book-1");
    expect(context).toContain("A highlighted idea.");
    expect(context).toContain("Saved Note");
  });

  it("does not query without a current book", async () => {
    await expect(loadAnnotationPromptContext({ bookId: null })).resolves.toBeUndefined();
    expect(dbMocks.getHighlights).not.toHaveBeenCalled();
    expect(dbMocks.getNotes).not.toHaveBeenCalled();
  });

  it("keeps AI streaming usable when annotation lookup fails", async () => {
    dbMocks.getHighlights.mockRejectedValue(new Error("database busy"));
    dbMocks.getNotes.mockResolvedValue([]);

    await expect(loadAnnotationPromptContext({ bookId: "book-1" })).resolves.toBeUndefined();
  });
});
