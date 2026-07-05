import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks ----
vi.mock("../../db/database", () => ({
  getBooks: vi.fn(),
  getBook: vi.fn(),
  getChunks: vi.fn(),
  getHighlights: vi.fn(),
  getNotes: vi.fn(),
  getAllHighlights: vi.fn(),
  getAllNotes: vi.fn(),
  getSkills: vi.fn(),
  getReadingSessionsByDateRange: vi.fn(),
  updateBook: vi.fn(),
  getGroups: vi.fn(),
  insertGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));

vi.mock("../../rag/search", () => ({
  search: vi.fn(),
}));

vi.mock("../../rag/chunker", () => ({
  estimateTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
}));

vi.mock("../../events/library-events", () => ({
  emitLibraryChanged: vi.fn(),
}));

vi.mock("../../stores/persist", () => ({
  debouncedSave: vi.fn(),
  loadFromFS: vi.fn(),
}));

vi.mock("../tools/context-tools", () => ({
  getContextTools: vi.fn(() => []),
}));

vi.mock("../skills/builtin-skills", () => ({
  getBuiltinSkills: vi.fn(() => []),
}));

import {
  deleteGroup,
  getAllHighlights,
  getAllNotes,
  getBook,
  getBooks,
  getChunks,
  getSkills as getDbSkills,
  getGroups,
  getHighlights,
  getNotes,
  getReadingSessionsByDateRange,
  insertGroup,
  updateBook,
  updateGroup,
} from "../../db/database";
import { emitLibraryChanged } from "../../events/library-events";
import { search } from "../../rag/search";
import { loadFromFS } from "../../stores/persist";
import { setFallbackContentProvider } from "../fallback-content-service";
import { getAvailableTools } from "../tools";

afterEach(() => {
  setFallbackContentProvider(null);
});

// ---- Helpers ----
function findTool(tools: ReturnType<typeof getAvailableTools>, name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

function makeChunk(overrides: Record<string, unknown> = {}) {
  return {
    id: "chunk-1",
    bookId: "book-1",
    chapterIndex: 0,
    chapterTitle: "Chapter 1",
    content: "Some chunk content for testing purposes.",
    startCfi: "/4/2[chap01]",
    endCfi: "/4/2[chap01end]",
    segmentCfis: [],
    ...overrides,
  };
}

function makeBook(overrides: Record<string, unknown> = {}) {
  return {
    id: "book-1",
    format: "epub",
    progress: 0.5,
    isVectorized: true,
    tags: [],
    addedAt: Date.now() - 86400000,
    lastOpenedAt: Date.now(),
    meta: {
      title: "Test Book",
      author: "Test Author",
      description: "A test book",
      subjects: ["fiction"],
      language: "en",
    },
    ...overrides,
  };
}

// ============================================
// getAvailableTools — assembly logic
// ============================================
describe("getAvailableTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFallbackContentProvider(null);
  });

  it("should return general tools when no bookId", () => {
    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const names = tools.map((t) => t.name);
    expect(names).toContain("listBooks");
    expect(names).toContain("searchAllHighlights");
    expect(names).toContain("searchAllNotes");
    expect(names).toContain("getReadingStats");
    expect(names).toContain("getSkills");
    expect(names).toContain("mindmap");
    expect(names).toContain("classifyBooks");
    expect(names).toContain("tagBooks");
    expect(names).toContain("manageBookTags");
    expect(names).toContain("updateBookMetadata");
    expect(names).toContain("manageBookGroups");
    // Should NOT have book-specific tools
    expect(names).not.toContain("ragSearch");
    expect(names).not.toContain("getAnnotations");
  });

  it("should register fallback exploration tools for non-vectorized books", () => {
    const tools = getAvailableTools({ bookId: "book-1", isVectorized: false, enabledSkills: [] });
    const names = tools.map((t) => t.name);

    expect(names).toContain("fallbackToc");
    expect(names).toContain("fallbackSearch");
    expect(names).toContain("fallbackChapterContext");
    expect(names).not.toContain("ragSearch");
  });

  it("should include annotations and validated citations for non-vectorized books", () => {
    const tools = getAvailableTools({ bookId: "book-1", isVectorized: false, enabledSkills: [] });
    const names = tools.map((t) => t.name);
    expect(names).toContain("getAnnotations");
    expect(names).toContain("addCitation");
    // No RAG tools without vectorization
    expect(names).not.toContain("ragSearch");
  });

  it("should include RAG and analysis tools when bookId + isVectorized", () => {
    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const names = tools.map((t) => t.name);
    expect(names).toContain("ragSearch");
    expect(names).toContain("ragToc");
    expect(names).toContain("ragContext");
    expect(names).toContain("summarize");
    expect(names).toContain("extractEntities");
    expect(names).toContain("analyzeArguments");
    expect(names).toContain("findQuotes");
    expect(names).toContain("compareSections");
    expect(names).toContain("getAnnotations");
    expect(names).toContain("addCitation");
  });

  it("should include custom skill tools", () => {
    const skill = {
      id: "custom-skill",
      name: "My Skill",
      description: "Does something",
      prompt: "Do the thing",
      enabled: true,
      builtIn: false,
      parameters: [
        { name: "input", type: "string" as const, description: "Input text", required: true },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [skill] });
    const skillTool = findTool(tools, "custom-skill");
    expect(skillTool).toBeDefined();
    expect(skillTool.description).toContain("My Skill");
    expect(skillTool.parameters).toHaveProperty("input");
    expect(skillTool.parameters).toHaveProperty("reasoning");
  });
});

// ============================================
// listBooks tool
// ============================================
describe("listBooks tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return all books", async () => {
    vi.mocked(getBooks).mockResolvedValue([
      makeBook(),
      makeBook({ id: "book-2", meta: { title: "Book 2", author: "Author 2" } }),
    ] as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "listBooks");
    const result = (await tool.execute({ reasoning: "test" })) as any;

    expect(result.total).toBe(2);
    expect(result.books).toHaveLength(2);
    expect(result.books[0].title).toBe("Test Book");
  });

  it("should filter by search keyword", async () => {
    vi.mocked(getBooks).mockResolvedValue([
      makeBook({ id: "b1", meta: { title: "JavaScript Guide", author: "Alice" } }),
      makeBook({ id: "b2", meta: { title: "Python Cookbook", author: "Bob" } }),
    ] as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "listBooks");
    const result = (await tool.execute({ reasoning: "test", search: "python" })) as any;

    expect(result.total).toBe(1);
    expect(result.books[0].title).toBe("Python Cookbook");
  });

  it("should filter by reading status", async () => {
    vi.mocked(getBooks).mockResolvedValue([
      makeBook({ id: "b1", progress: 0 }),
      makeBook({ id: "b2", progress: 0.5 }),
      makeBook({ id: "b3", progress: 1 }),
    ] as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "listBooks");

    const unread = (await tool.execute({ reasoning: "test", status: "unread" })) as any;
    expect(unread.total).toBe(1);

    const reading = (await tool.execute({ reasoning: "test", status: "reading" })) as any;
    expect(reading.total).toBe(1);

    const completed = (await tool.execute({ reasoning: "test", status: "completed" })) as any;
    expect(completed.total).toBe(1);
  });

  it("should respect limit", async () => {
    const books = Array.from({ length: 30 }, (_, i) =>
      makeBook({ id: `b${i}`, meta: { title: `Book ${i}`, author: "A" } }),
    );
    vi.mocked(getBooks).mockResolvedValue(books as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "listBooks");
    const result = (await tool.execute({ reasoning: "test", limit: 5 })) as any;

    expect(result.showing).toBe(5);
    expect(result.total).toBe(30);
  });
});

// ============================================
// ragToc tool
// ============================================
describe("ragToc tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should extract unique chapters from chunks", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 0, chapterTitle: "Intro" }),
      makeChunk({ chapterIndex: 0, chapterTitle: "Intro" }),
      makeChunk({ chapterIndex: 1, chapterTitle: "Chapter 1" }),
      makeChunk({ chapterIndex: 2, chapterTitle: "Chapter 2" }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "ragToc");
    const result = (await tool.execute({})) as any;

    expect(result.totalChapters).toBe(3);
    expect(result.source).toBe("vector-index");
    expect(result.debug).toMatchObject({
      vectorChapterCount: 3,
      genericSectionCount: 0,
      preferOriginalToc: false,
      fallback: { attempted: false },
    });
    expect(result.chapters).toEqual([
      { index: 0, number: 1, title: "Intro" },
      { index: 1, number: 2, title: "Chapter 1" },
      { index: 2, number: 3, title: "Chapter 2" },
    ]);
  });

  it("rebuilds the TOC from the original book when indexed chunks only have generic section titles", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 1, chapterTitle: "Section 2" }),
      makeChunk({ chapterIndex: 2, chapterTitle: "Section 3" }),
    ] as any);
    vi.mocked(getBook).mockResolvedValue(makeBook({ isVectorized: true }) as any);
    setFallbackContentProvider({
      async getChapters() {
        return [
          { index: 0, title: "第1章 整洁代码", content: "chapter one" },
          { index: 1, title: "第2章 有意义的命名", content: "chapter two" },
        ];
      },
    });

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "ragToc");
    const result = (await tool.execute({})) as any;

    expect(result.source).toBe("original-file");
    expect(result.debug).toMatchObject({
      vectorChapterCount: 2,
      genericSectionCount: 2,
      preferOriginalToc: true,
      fallback: {
        attempted: true,
        chapterCount: 2,
        sampleTitles: ["第1章 整洁代码", "第2章 有意义的命名"],
      },
    });
    expect(result.chapters).toEqual([
      { index: 0, number: 1, title: "第1章 整洁代码" },
      { index: 1, number: 2, title: "第2章 有意义的命名" },
    ]);
  });

  it("returns visible diagnostics when generic section fallback fails", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 1, chapterTitle: "Section 2" }),
      makeChunk({ chapterIndex: 2, chapterTitle: "Section 3" }),
    ] as any);
    vi.mocked(getBook).mockResolvedValue(makeBook({ isVectorized: true }) as any);
    setFallbackContentProvider({
      async getChapters() {
        throw new Error("Original file is unavailable");
      },
    });

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "ragToc");
    const result = (await tool.execute({})) as any;

    expect(result.source).toBe("vector-index");
    expect(result.warning).toContain("rebuilding the TOC from the original book failed");
    expect(result.debug).toMatchObject({
      vectorChapterCount: 2,
      genericSectionCount: 2,
      preferOriginalToc: true,
      fallback: {
        attempted: true,
        error: "Original file is unavailable",
      },
    });
  });
});

// ============================================
// ragSearch tool — token budget truncation
// ============================================
describe("ragSearch tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should truncate results within token budget", async () => {
    // Each result has ~100 chars → ~25 tokens. Budget is 4000 tokens.
    const results = Array.from({ length: 200 }, (_, i) => ({
      chunk: {
        content: "x".repeat(100),
        chapterTitle: `Ch ${i}`,
        chapterIndex: i,
        startCfi: `/4/${i}`,
      },
      score: 0.9 - i * 0.001,
      matchType: "hybrid",
      highlights: [],
    }));
    vi.mocked(search).mockResolvedValue(results as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "ragSearch");
    const result = (await tool.execute({ query: "test" })) as any;

    // Should have stopped before all 200 results
    expect(result.returnedResults).toBeLessThan(200);
    expect(result.totalTokens).toBeLessThanOrEqual(4000);
    expect(result.tokenBudget).toBe(4000);
  });

  it("should pass search parameters correctly", async () => {
    vi.mocked(search).mockResolvedValue([]);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "ragSearch");
    await tool.execute({ query: "machine learning", mode: "vector", topK: 10 });

    expect(search).toHaveBeenCalledWith({
      query: "machine learning",
      bookId: "book-1",
      mode: "vector",
      topK: 10,
      threshold: 0.3,
    });
  });
});

// ============================================
// ragContext tool — token budget
// ============================================
describe("ragContext tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return chunks for the specified chapter", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 0, content: "Chunk A" }),
      makeChunk({ chapterIndex: 0, content: "Chunk B" }),
      makeChunk({ chapterIndex: 1, content: "Other chapter" }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "ragContext");
    const result = (await tool.execute({ chapterIndex: 0 })) as any;

    expect(result.chapterIndex).toBe(0);
    expect(result.context).toContain("Chunk A");
    expect(result.context).toContain("Chunk B");
    expect(result.context).not.toContain("Other chapter");
  });

  it("should truncate to token budget", async () => {
    // Each chunk ~1600 tokens; budget is 3000
    const bigChunks = Array.from({ length: 5 }, (_, i) =>
      makeChunk({ chapterIndex: 0, content: "x".repeat(6400), id: `chunk-${i}` }),
    );
    vi.mocked(getChunks).mockResolvedValue(bigChunks as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "ragContext");
    const result = (await tool.execute({ chapterIndex: 0, range: 2 })) as any;

    expect(result.totalTokens).toBeLessThanOrEqual(3000);
    expect(result.tokenBudget).toBe(3000);
  });
});

// ============================================
// summarize tool
// ============================================
describe("summarize tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should summarize a chapter", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 1, chapterTitle: "Ch 1", content: "Content of chapter 1" }),
      makeChunk({ chapterIndex: 2, chapterTitle: "Ch 2", content: "Content of chapter 2" }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "summarize");
    const result = (await tool.execute({ scope: "chapter", chapterIndex: 1 })) as any;

    expect(result.scope).toBe("chapter");
    expect(result.chapterTitle).toBe("Ch 1");
    expect(result.content).toContain("Content of chapter 1");
  });

  it("should return error for non-existent chapter", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 0, content: "Content" }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "summarize");
    const result = (await tool.execute({ scope: "chapter", chapterIndex: 99 })) as any;

    expect(result.error).toContain("not found");
  });

  it("should summarize full book", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 0, chapterTitle: "Intro", content: "Intro content" }),
      makeChunk({ chapterIndex: 1, chapterTitle: "Ch 1", content: "Ch 1 content" }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "summarize");
    const result = (await tool.execute({ scope: "book" })) as any;

    expect(result.scope).toBe("book");
    expect(result.totalChapters).toBe(2);
    expect(result.chapters).toHaveLength(2);
  });

  it("should return error for invalid scope", async () => {
    vi.mocked(getChunks).mockResolvedValue([] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "summarize");
    const result = (await tool.execute({ scope: "invalid" })) as any;

    expect(result.error).toBeDefined();
  });
});

// ============================================
// extractEntities tool
// ============================================
describe("extractEntities tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should extract from specific chapter", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 0, chapterTitle: "Ch 0", content: "Alice met Bob" }),
      makeChunk({ chapterIndex: 1, chapterTitle: "Ch 1", content: "Charlie arrived" }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "extractEntities");
    const result = (await tool.execute({ chapterIndex: 0, entityType: "characters" })) as any;

    expect(result.content).toContain("Alice met Bob");
    expect(result.content).not.toContain("Charlie");
    expect(result.entityType).toBe("characters");
  });

  it("should return error when no content found", async () => {
    vi.mocked(getChunks).mockResolvedValue([] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "extractEntities");
    const result = (await tool.execute({ chapterIndex: 99 })) as any;

    expect(result.error).toBe("No content found");
  });

  it("should sample from all chapters when no chapterIndex", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 0, chapterTitle: "Ch 0", content: "Content 0" }),
      makeChunk({ chapterIndex: 1, chapterTitle: "Ch 1", content: "Content 1" }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "extractEntities");
    const result = (await tool.execute({ entityType: "all" })) as any;

    expect(result.content).toContain("Content 0");
    expect(result.content).toContain("Content 1");
  });
});

// ============================================
// analyzeArguments tool
// ============================================
describe("analyzeArguments tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should analyze arguments for a chapter", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 0, content: "The author argues..." }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "analyzeArguments");
    const result = (await tool.execute({ chapterIndex: 0, focusType: "main" })) as any;

    expect(result.focusType).toBe("main");
    expect(result.content).toContain("The author argues");
    expect(result.instruction).toContain("main arguments");
  });

  it("should return error for empty content", async () => {
    vi.mocked(getChunks).mockResolvedValue([] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "analyzeArguments");
    const result = (await tool.execute({ chapterIndex: 99 })) as any;

    expect(result.error).toBe("No content found");
  });
});

// ============================================
// findQuotes tool
// ============================================
describe("findQuotes tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should find quotes with token budget", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 0, content: "A beautiful sentence here." }),
      makeChunk({ chapterIndex: 0, content: "Another great passage." }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "findQuotes");
    const result = (await tool.execute({ quoteType: "beautiful", maxQuotes: 3 })) as any;

    expect(result.quoteType).toBe("beautiful");
    expect(result.maxQuotes).toBe(3);
    expect(result.content).toContain("beautiful sentence");
    expect(result.instruction).toContain("beautiful");
  });
});

// ============================================
// compareSections tool
// ============================================
describe("compareSections tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should compare two chapters", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 0, chapterTitle: "Intro", content: "Intro content" }),
      makeChunk({ chapterIndex: 1, chapterTitle: "Conclusion", content: "Conclusion content" }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "compareSections");
    const result = (await tool.execute({
      chapterIndex1: 0,
      chapterIndex2: 1,
      compareType: "themes",
    })) as any;

    expect(result.chapter1.title).toBe("Intro");
    expect(result.chapter2.title).toBe("Conclusion");
    expect(result.compareType).toBe("themes");
  });

  it("should return error if chapter not found", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 0, content: "Content" }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "compareSections");
    const result = (await tool.execute({ chapterIndex1: 0, chapterIndex2: 99 })) as any;

    expect(result.error).toBe("One or both chapters not found");
  });
});

// ============================================
// fallback content tools
// ============================================
describe("fallback content tools", () => {
  beforeEach(() => vi.clearAllMocks());

  function registerFallbackChapters() {
    vi.mocked(getBook).mockResolvedValue(makeBook({ isVectorized: false }) as any);
    setFallbackContentProvider({
      async getChapters() {
        return [
          {
            index: 0,
            title: "Chapter 1",
            content:
              "Opening paragraph.\n\nThe target passage explains how fallback citations find their position.",
            segments: [
              { text: "Opening paragraph.", cfi: "epubcfi(/6/2!/4/2)" },
              {
                text: "The target passage explains how fallback citations find their position.",
                cfi: "epubcfi(/6/2!/4/4)",
              },
            ],
          },
        ];
      },
    });
  }

  it("returns a segment CFI for fallback search matches", async () => {
    registerFallbackChapters();

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "fallbackSearch");
    const result = (await tool.execute({ query: "target passage", topK: 1 })) as any;

    expect(result.results[0].chapterTitle).toBe("Chapter 1");
    expect(result.results[0].cfi).toBe("epubcfi(/6/2!/4/4)");
    expect(result.results[0].cfiPrecision).toBe("segment");
  });

  it("registers fallback citations only when quoted text resolves to a segment CFI", async () => {
    registerFallbackChapters();
    vi.mocked(getChunks).mockResolvedValue([]);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "addCitation");
    const result = (await tool.execute({
      citationIndex: 1,
      chapterTitle: "Chapter 1",
      chapterIndex: 0,
      cfi: "",
      quotedText: "target passage explains",
      reasoning: "fallback source",
    })) as any;

    expect(result.type).toBe("citation");
    expect(result.cfi).toBe("epubcfi(/6/2!/4/4)");
  });

  it("rejects fallback citations that cannot be resolved", async () => {
    registerFallbackChapters();
    vi.mocked(getChunks).mockResolvedValue([]);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "addCitation");
    const result = (await tool.execute({
      citationIndex: 1,
      chapterTitle: "Chapter 1",
      chapterIndex: 0,
      cfi: "epubcfi(/fake)",
      quotedText: "not in this chapter",
      reasoning: "fallback source",
    })) as any;

    expect(result.error).toContain("Could not resolve a precise CFI");
  });
});

// ============================================
// getAnnotations tool
// ============================================
describe("getAnnotations tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return highlights and notes", async () => {
    vi.mocked(getHighlights).mockResolvedValue([
      { text: "Important text", note: "My note", chapterTitle: "Ch 1", color: "yellow" },
    ] as any);
    vi.mocked(getNotes).mockResolvedValue([
      { title: "Note 1", content: "Note content", chapterTitle: "Ch 1" },
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "getAnnotations");
    const result = (await tool.execute({ type: "all" })) as any;

    expect(result.highlights).toHaveLength(1);
    expect(result.highlights[0].text).toBe("Important text");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].title).toBe("Note 1");
  });

  it("should return only highlights when type is 'highlights'", async () => {
    vi.mocked(getHighlights).mockResolvedValue([
      { text: "Highlight", chapterTitle: "Ch 1", color: "blue" },
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "getAnnotations");
    const result = (await tool.execute({ type: "highlights" })) as any;

    expect(result.highlights).toHaveLength(1);
    expect(result.notes).toBeUndefined();
  });

  it("should return only notes when type is 'notes'", async () => {
    vi.mocked(getNotes).mockResolvedValue([
      { title: "My Note", content: "Content", chapterTitle: "Ch 1" },
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "getAnnotations");
    const result = (await tool.execute({ type: "notes" })) as any;

    expect(result.notes).toHaveLength(1);
    expect(result.highlights).toBeUndefined();
  });
});

// ============================================
// addCitation tool — CFI refinement
// ============================================
describe("addCitation tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return citation metadata with refined CFI", async () => {
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({
        chapterIndex: 0,
        content: "First paragraph.\n\nSecond paragraph with target text here.",
        startCfi: "/4/2",
        endCfi: "/4/2end",
        segmentCfis: ["/4/2/1", "/4/2/3"],
      }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "addCitation");
    const result = (await tool.execute({
      citationIndex: 1,
      chapterTitle: "Chapter 1",
      chapterIndex: 0,
      cfi: "/4/2",
      quotedText: "target text here",
      reasoning: "test",
    })) as any;

    expect(result.type).toBe("citation");
    expect(result.citationIndex).toBe(1);
    expect(result.bookId).toBe("book-1");
    expect(result.cfi).toBeDefined();
  });

  it("should fallback to AI-provided CFI when refinement fails", async () => {
    vi.mocked(getChunks).mockRejectedValue(new Error("DB error"));

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "addCitation");
    const result = (await tool.execute({
      citationIndex: 1,
      chapterTitle: "Chapter 1",
      chapterIndex: 0,
      cfi: "/4/2/original",
      quotedText: "some text",
      reasoning: "test",
    })) as any;

    expect(result.cfi).toBe("/4/2/original");
  });

  it("should use endCfi when quote is in second half (no segmentCfis)", async () => {
    const longContent = "A".repeat(200) + "target text";
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({
        chapterIndex: 0,
        content: longContent,
        startCfi: "/4/start",
        endCfi: "/4/end",
        segmentCfis: [],
      }),
    ] as any);

    const tools = getAvailableTools({ bookId: "book-1", isVectorized: true, enabledSkills: [] });
    const tool = findTool(tools, "addCitation");
    const result = (await tool.execute({
      citationIndex: 1,
      chapterTitle: "Ch 1",
      chapterIndex: 0,
      cfi: "/4/start",
      quotedText: "target text",
      reasoning: "test",
    })) as any;

    expect(result.cfi).toBe("/4/end");
  });
});

// ============================================
// searchAllHighlights tool
// ============================================
describe("searchAllHighlights tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return highlights with book titles", async () => {
    vi.mocked(getAllHighlights).mockResolvedValue([
      {
        text: "Important",
        bookId: "b1",
        chapterTitle: "Ch 1",
        color: "yellow",
        createdAt: Date.now(),
      },
    ] as any);
    vi.mocked(getBooks).mockResolvedValue([
      makeBook({ id: "b1", meta: { title: "My Book" } }),
    ] as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "searchAllHighlights");
    const result = (await tool.execute({ reasoning: "test" })) as any;

    expect(result.highlights[0].bookTitle).toBe("My Book");
    expect(result.highlights[0].text).toBe("Important");
  });

  it("should filter by days", async () => {
    const now = Date.now();
    vi.mocked(getAllHighlights).mockResolvedValue([
      { text: "Recent", bookId: "b1", createdAt: now - 86400000, color: "yellow" }, // 1 day ago
      { text: "Old", bookId: "b1", createdAt: now - 86400000 * 60, color: "blue" }, // 60 days ago
    ] as any);
    vi.mocked(getBooks).mockResolvedValue([makeBook({ id: "b1" })] as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "searchAllHighlights");
    const result = (await tool.execute({ reasoning: "test", days: 7 })) as any;

    expect(result.total).toBe(1);
    expect(result.highlights[0].text).toBe("Recent");
  });
});

// ============================================
// getReadingStats tool
// ============================================
describe("getReadingStats tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should calculate reading statistics", async () => {
    vi.mocked(getBooks).mockResolvedValue([
      makeBook({ id: "b1", progress: 0.5 }),
      makeBook({ id: "b2", progress: 1 }),
      makeBook({ id: "b3", progress: 0 }),
    ] as any);
    vi.mocked(getReadingSessionsByDateRange).mockResolvedValue([
      { totalActiveTime: 600000, pagesRead: 20 }, // 10 min
      { totalActiveTime: 1200000, pagesRead: 40 }, // 20 min
    ] as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "getReadingStats");
    const result = (await tool.execute({ reasoning: "test" })) as any;

    expect(result.library.totalBooks).toBe(3);
    expect(result.library.inProgress).toBe(1);
    expect(result.library.completed).toBe(1);
    expect(result.recentActivity.totalSessions).toBe(2);
    expect(result.recentActivity.totalReadingMinutes).toBe(30);
    expect(result.recentActivity.totalPagesRead).toBe(60);
  });
});

// ============================================
// classifyBooks tool
// ============================================
describe("classifyBooks tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return uncategorized books with content info", async () => {
    vi.mocked(getBooks).mockResolvedValue([
      makeBook({ id: "b1", tags: [] }),
      makeBook({ id: "b2", tags: ["fiction"] }),
    ] as any);
    vi.mocked(getChunks).mockResolvedValue([
      makeChunk({ chapterIndex: 0, chapterTitle: "Intro", content: "Sample text" }),
    ] as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "classifyBooks");
    const result = (await tool.execute({ reasoning: "test" })) as any;

    expect(result.uncategorizedCount).toBe(1);
    expect(result.uncategorizedBooks[0].id).toBe("b1");
    expect(result.existingTags).toContain("fiction");
  });

  it("should return specific book when bookId provided", async () => {
    vi.mocked(getBooks).mockResolvedValue([makeBook({ id: "b1" })] as any);
    vi.mocked(getBook).mockResolvedValue(makeBook({ id: "b1" }) as any);
    vi.mocked(getChunks).mockResolvedValue([makeChunk({ content: "Content" })] as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "classifyBooks");
    const result = (await tool.execute({ reasoning: "test", bookId: "b1" })) as any;

    expect(result.book).toBeDefined();
    expect(result.book.id).toBe("b1");
  });

  it("should return error if specific book not found", async () => {
    vi.mocked(getBooks).mockResolvedValue([] as any);
    vi.mocked(getBook).mockResolvedValue(null as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "classifyBooks");
    const result = (await tool.execute({ reasoning: "test", bookId: "nonexistent" })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

// ============================================
// tagBooks tool
// ============================================
describe("tagBooks tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should merge tags and update books", async () => {
    vi.mocked(getBook).mockResolvedValue(makeBook({ id: "b1", tags: ["existing"] }) as any);
    vi.mocked(updateBook).mockResolvedValue(undefined);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "tagBooks");
    const result = (await tool.execute({
      reasoning: "test",
      assignments: JSON.stringify([{ bookId: "b1", tags: ["sci-fi", "existing"] }]),
    })) as any;

    expect(result.taggedCount).toBe(1);
    expect(result.results[0].success).toBe(true);
    // Tags should be deduplicated
    expect(updateBook).toHaveBeenCalledWith("b1", { tags: ["existing", "sci-fi"] });
    expect(emitLibraryChanged).toHaveBeenCalled();
  });

  it("should handle book not found", async () => {
    vi.mocked(getBook).mockResolvedValue(null as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "tagBooks");
    const result = (await tool.execute({
      reasoning: "test",
      assignments: JSON.stringify([{ bookId: "nonexistent", tags: ["tag1"] }]),
    })) as any;

    expect(result.taggedCount).toBe(0);
    expect(result.results[0].success).toBe(false);
  });
});

// ============================================
// updateBookMetadata tool
// ============================================
describe("updateBookMetadata tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should update editable book metadata", async () => {
    vi.mocked(getBook).mockResolvedValue(makeBook({ id: "b1", tags: ["old"] }) as any);
    vi.mocked(updateBook).mockResolvedValue(undefined);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "updateBookMetadata");
    const result = (await tool.execute({
      reasoning: "test",
      bookId: "b1",
      updates: JSON.stringify({
        title: "New Title",
        author: "New Author",
        publisher: "ReadAny Press",
        tags: ["literature", "classic"],
        rating: 4.5,
      }),
    })) as any;

    expect(result.success).toBe(true);
    expect(result.changedFields).toEqual(["title", "author", "publisher", "rating", "tags"]);
    expect(updateBook).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({
        tags: ["literature", "classic"],
        meta: expect.objectContaining({
          title: "New Title",
          author: "New Author",
          publisher: "ReadAny Press",
          rating: 4.5,
        }),
      }),
    );
    expect(emitLibraryChanged).toHaveBeenCalled();
  });

  it("should validate group when updating groupId", async () => {
    vi.mocked(getBook).mockResolvedValue(makeBook({ id: "b1" }) as any);
    vi.mocked(getGroups).mockResolvedValue([
      { id: "g1", name: "Fiction", sortOrder: 1, createdAt: 1, updatedAt: 1 },
    ] as any);
    vi.mocked(updateBook).mockResolvedValue(undefined);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "updateBookMetadata");
    const result = (await tool.execute({
      reasoning: "test",
      bookId: "b1",
      updates: JSON.stringify({ groupId: "g1" }),
    })) as any;

    expect(result.success).toBe(true);
    expect(updateBook).toHaveBeenCalledWith("b1", { groupId: "g1" });
  });

  it("should reject unknown groupId", async () => {
    vi.mocked(getBook).mockResolvedValue(makeBook({ id: "b1" }) as any);
    vi.mocked(getGroups).mockResolvedValue([] as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "updateBookMetadata");
    const result = (await tool.execute({
      reasoning: "test",
      bookId: "b1",
      updates: JSON.stringify({ groupId: "missing" }),
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Group not found");
    expect(updateBook).not.toHaveBeenCalled();
  });
});

// ============================================
// manageBookGroups tool
// ============================================
describe("manageBookGroups tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("list: should return groups with book counts", async () => {
    vi.mocked(getGroups).mockResolvedValue([
      { id: "g1", name: "Fiction", sortOrder: 1, createdAt: 1, updatedAt: 1 },
    ] as any);
    vi.mocked(getBooks).mockResolvedValue([
      makeBook({ id: "b1", groupId: "g1" }),
      makeBook({ id: "b2", groupId: undefined }),
    ] as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "manageBookGroups");
    const result = (await tool.execute({ reasoning: "test", action: "list" })) as any;

    expect(result.success).toBe(true);
    expect(result.groups[0]).toMatchObject({ id: "g1", name: "Fiction", bookCount: 1 });
    expect(result.uncategorizedCount).toBe(1);
  });

  it("create: should create a group", async () => {
    const group = { id: "g1", name: "Fiction", sortOrder: 1, createdAt: 1, updatedAt: 1 };
    vi.mocked(getGroups).mockResolvedValue([] as any);
    vi.mocked(insertGroup).mockResolvedValue(group as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "manageBookGroups");
    const result = (await tool.execute({
      reasoning: "test",
      action: "create",
      name: "Fiction",
    })) as any;

    expect(result.success).toBe(true);
    expect(insertGroup).toHaveBeenCalledWith({ name: "Fiction" });
    expect(emitLibraryChanged).toHaveBeenCalled();
  });

  it("moveBooks: should move books into a group", async () => {
    vi.mocked(getGroups).mockResolvedValue([
      { id: "g1", name: "Fiction", sortOrder: 1, createdAt: 1, updatedAt: 1 },
    ] as any);
    vi.mocked(getBook).mockResolvedValue(makeBook({ id: "b1" }) as any);
    vi.mocked(updateBook).mockResolvedValue(undefined);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "manageBookGroups");
    const result = (await tool.execute({
      reasoning: "test",
      action: "moveBooks",
      groupId: "g1",
      bookIds: JSON.stringify(["b1"]),
    })) as any;

    expect(result.success).toBe(true);
    expect(result.movedCount).toBe(1);
    expect(updateBook).toHaveBeenCalledWith("b1", { groupId: "g1" });
  });

  it("rename/delete: should update group records", async () => {
    vi.mocked(getGroups).mockResolvedValue([
      { id: "g1", name: "Old", sortOrder: 1, createdAt: 1, updatedAt: 1 },
    ] as any);
    vi.mocked(updateGroup).mockResolvedValue(undefined);
    vi.mocked(deleteGroup).mockResolvedValue(undefined);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "manageBookGroups");
    const renamed = (await tool.execute({
      reasoning: "test",
      action: "rename",
      groupId: "g1",
      name: "New",
    })) as any;
    const deleted = (await tool.execute({
      reasoning: "test",
      action: "delete",
      groupId: "g1",
    })) as any;

    expect(renamed.success).toBe(true);
    expect(deleted.success).toBe(true);
    expect(updateGroup).toHaveBeenCalledWith("g1", { name: "New" });
    expect(deleteGroup).toHaveBeenCalledWith("g1");
  });
});

// ============================================
// manageBookTags tool
// ============================================
describe("manageBookTags tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create: should create new tags", async () => {
    vi.mocked(loadFromFS).mockResolvedValue(["existing-tag"]);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "manageBookTags");
    const result = (await tool.execute({
      reasoning: "test",
      action: "create",
      tags: JSON.stringify(["new-tag", "existing-tag"]),
    })) as any;

    expect(result.success).toBe(true);
    expect(result.createdTags).toEqual(["new-tag"]);
  });

  it("rename: should rename tag across all books", async () => {
    vi.mocked(getBooks).mockResolvedValue([
      makeBook({ id: "b1", tags: ["old-tag", "keep"] }),
      makeBook({ id: "b2", tags: ["other"] }),
    ] as any);
    vi.mocked(updateBook).mockResolvedValue(undefined);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "manageBookTags");
    const result = (await tool.execute({
      reasoning: "test",
      action: "rename",
      tag: "old-tag",
      newTag: "new-tag",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.affectedBooks).toBe(1);
    expect(updateBook).toHaveBeenCalledWith("b1", { tags: ["new-tag", "keep"] });
  });

  it("delete: should delete tags from all books", async () => {
    vi.mocked(getBooks).mockResolvedValue([
      makeBook({ id: "b1", tags: ["tag-to-delete", "keep"] }),
      makeBook({ id: "b2", tags: ["tag-to-delete"] }),
    ] as any);
    vi.mocked(updateBook).mockResolvedValue(undefined);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "manageBookTags");
    const result = (await tool.execute({
      reasoning: "test",
      action: "delete",
      tags: JSON.stringify(["tag-to-delete"]),
    })) as any;

    expect(result.success).toBe(true);
    expect(result.affectedBooks).toBe(2);
    expect(result.deletedTags).toEqual(["tag-to-delete"]);
  });

  it("removeFromBook: should remove tags from specific book", async () => {
    vi.mocked(getBook).mockResolvedValue(
      makeBook({ id: "b1", tags: ["tag1", "tag2", "tag3"] }) as any,
    );
    vi.mocked(updateBook).mockResolvedValue(undefined);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "manageBookTags");
    const result = (await tool.execute({
      reasoning: "test",
      action: "removeFromBook",
      bookId: "b1",
      tags: JSON.stringify(["tag1", "tag3"]),
    })) as any;

    expect(result.success).toBe(true);
    expect(result.remainingTags).toEqual(["tag2"]);
  });

  it("setBookTags: should replace all tags of a book", async () => {
    vi.mocked(getBook).mockResolvedValue(makeBook({ id: "b1", tags: ["old"] }) as any);
    vi.mocked(updateBook).mockResolvedValue(undefined);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "manageBookTags");
    const result = (await tool.execute({
      reasoning: "test",
      action: "setBookTags",
      bookId: "b1",
      tags: JSON.stringify(["new1", "new2"]),
    })) as any;

    expect(result.success).toBe(true);
    expect(result.tags).toEqual(["new1", "new2"]);
  });

  it("should return error for unknown action", async () => {
    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "manageBookTags");
    const result = (await tool.execute({ reasoning: "test", action: "invalid" })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown action");
  });
});

// ============================================
// mindmap tool — including mermaid conversion
// ============================================
describe("mindmap tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return mindmap with markdown format", async () => {
    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "mindmap");

    const markdown = "# Main\n## Branch 1\n### Sub 1\n- Item A\n## Branch 2";
    const result = (await tool.execute({ reasoning: "test", title: "Test Map", markdown })) as any;

    expect(result.type).toBe("mindmap");
    expect(result.title).toBe("Test Map");
    expect(result.markdown).toBe(markdown);
    expect(result.stats.nodeCount).toBe(5);
  });

  it("should convert mermaid syntax to markmap markdown", async () => {
    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "mindmap");

    const mermaidInput = "mindmap\n  Root\n    Branch 1\n      Leaf A\n    Branch 2";
    const result = (await tool.execute({
      reasoning: "test",
      title: "Test",
      markdown: mermaidInput,
    })) as any;

    expect(result.type).toBe("mindmap");
    // Should have been converted — no longer starts with "mindmap"
    expect(result.markdown).not.toContain("mindmap");
    expect(result.markdown).toContain("#");
  });

  it("should convert ```mermaid code fence format", async () => {
    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "mindmap");

    const mermaidFenced = "```mermaid\nmindmap\n  Root\n    A\n    B\n```";
    const result = (await tool.execute({
      reasoning: "test",
      title: "Test",
      markdown: mermaidFenced,
    })) as any;

    expect(result.markdown).not.toContain("```mermaid");
    expect(result.markdown).toContain("#");
  });
});

// ============================================
// getSkills tool
// ============================================
describe("getSkills tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return matching skills", async () => {
    const { getBuiltinSkills } = await import("../skills/builtin-skills");
    vi.mocked(getBuiltinSkills).mockReturnValue([
      {
        id: "mindmap",
        name: "思维导图",
        description: "Generate mindmap",
        prompt: "...",
        parameters: [],
        enabled: true,
        builtIn: true,
      },
      {
        id: "summary",
        name: "摘要",
        description: "Generate summary",
        prompt: "...",
        parameters: [],
        enabled: true,
        builtIn: true,
      },
    ] as any);
    vi.mocked(getDbSkills).mockResolvedValue([]);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "getSkills");
    const result = (await tool.execute({ reasoning: "test", task: "思维导图" })) as any;

    expect(result.found).toBeGreaterThan(0);
    expect(result.skills[0].id).toBe("mindmap");
  });

  it("should return all available skills when no match", async () => {
    const { getBuiltinSkills } = await import("../skills/builtin-skills");
    vi.mocked(getBuiltinSkills).mockReturnValue([
      {
        id: "skill1",
        name: "Skill 1",
        description: "Desc",
        prompt: "...",
        parameters: [],
        enabled: true,
        builtIn: true,
      },
    ] as any);
    vi.mocked(getDbSkills).mockResolvedValue([]);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "getSkills");
    const result = (await tool.execute({ reasoning: "test", task: "nonexistent" })) as any;

    expect(result.found).toBe(0);
    expect(result.availableSkills).toBeDefined();
  });
});

// ============================================
// searchAllNotes tool
// ============================================
describe("searchAllNotes tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should combine notes and highlight notes", async () => {
    vi.mocked(getAllNotes).mockResolvedValue([
      {
        title: "Note 1",
        content: "Content 1",
        bookId: "b1",
        chapterTitle: "Ch 1",
        tags: ["tag1"],
        createdAt: Date.now(),
      },
    ] as any);
    vi.mocked(getAllHighlights).mockResolvedValue([
      {
        text: "Highlighted text with a note",
        note: "My annotation",
        bookId: "b1",
        chapterTitle: "Ch 1",
        createdAt: Date.now(),
      },
    ] as any);
    vi.mocked(getBooks).mockResolvedValue([makeBook({ id: "b1" })] as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "searchAllNotes");
    const result = (await tool.execute({ reasoning: "test" })) as any;

    expect(result.total).toBe(2);
    const types = result.notes.map((n: any) => n.type);
    expect(types).toContain("note");
    expect(types).toContain("highlight_note");
  });

  it("should filter by book title", async () => {
    vi.mocked(getAllNotes).mockResolvedValue([
      { title: "Note", content: "C", bookId: "b1", createdAt: Date.now() },
      { title: "Note", content: "C", bookId: "b2", createdAt: Date.now() },
    ] as any);
    vi.mocked(getAllHighlights).mockResolvedValue([] as any);
    vi.mocked(getBooks).mockResolvedValue([
      makeBook({ id: "b1", meta: { title: "JavaScript Guide" } }),
      makeBook({ id: "b2", meta: { title: "Python Cookbook" } }),
    ] as any);

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [] });
    const tool = findTool(tools, "searchAllNotes");
    const result = (await tool.execute({ reasoning: "test", bookTitle: "Python" })) as any;

    expect(result.total).toBe(1);
    expect(result.notes[0].bookTitle).toBe("Python Cookbook");
  });
});

// ============================================
// skillToTool (tested via getAvailableTools)
// ============================================
describe("skillToTool conversion", () => {
  it("should convert skill to tool and return skill metadata on execute", async () => {
    const skill = {
      id: "my-skill",
      name: "My Custom Skill",
      description: "Does awesome things",
      prompt: "Follow these steps...",
      enabled: true,
      builtIn: false,
      parameters: [
        { name: "topic", type: "string" as const, description: "The topic", required: true },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const tools = getAvailableTools({ bookId: null, isVectorized: false, enabledSkills: [skill] });
    const tool = findTool(tools, "my-skill");

    expect(tool.description).toContain("My Custom Skill");
    expect(tool.parameters.topic).toBeDefined();

    const result = (await tool.execute({ reasoning: "test", topic: "AI" })) as any;
    expect(result.skillId).toBe("my-skill");
    expect(result.skillPrompt).toBe("Follow these steps...");
    expect(result.args.topic).toBe("AI");
  });
});
