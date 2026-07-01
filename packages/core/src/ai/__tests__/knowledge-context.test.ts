import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeCardTemplate, KnowledgeDocument } from "../../types";
import { buildKnowledgePromptContext, loadKnowledgePromptContext } from "../knowledge-context";

const dbMocks = vi.hoisted(() => ({
  getKnowledgeBacklinks: vi.fn(),
  getKnowledgeDocuments: vi.fn(),
  getKnowledgeLinks: vi.fn(),
  searchKnowledgeDocuments: vi.fn(),
  getKnowledgeCardTemplates: vi.fn(),
}));

vi.mock("../../db/database", () => dbMocks);

function doc(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "standalone_note",
    title: "Document",
    contentJson: { type: "doc", content: [] },
    contentMd: "Document body",
    contentSchemaVersion: 1,
    tags: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getKnowledgeCardTemplates.mockResolvedValue([]);
  dbMocks.getKnowledgeLinks.mockResolvedValue([]);
  dbMocks.getKnowledgeBacklinks.mockResolvedValue([]);
});

const readingPromptTemplate: KnowledgeCardTemplate = {
  id: "template-reading-question",
  name: "Reading Prompt",
  version: 4,
  schemaJson: {
    cardType: "custom:template-reading-question",
    title: "Reading Prompt",
    markdown: "Prompt:\nResponse:",
    attrs: {
      data: { kind: "prompt" },
    },
  },
  builtIn: false,
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
};

describe("buildKnowledgePromptContext", () => {
  it("includes document ids, vault paths, tags, and compact durable summaries", () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Themes",
      contentMd: "",
      createdAt: 90,
      updatedAt: 90,
    });
    const summary = doc({
      id: "summary-1",
      parentId: "folder-1",
      type: "summary",
      title: "Memory Map",
      summaryMd: "## Durable Memory\n- Power, ritual, and time.",
      tags: ["theme", "review"],
      createdAt: 110,
      updatedAt: 120,
    });

    const context = buildKnowledgePromptContext([folder, summary]);

    expect(context).toContain("not the full vault");
    expect(context).toContain("[summary] Memory Map");
    expect(context).toContain("id: summary-1");
    expect(context).toContain("path: Knowledge base / Themes / Memory Map");
    expect(context).toContain("tags: theme, review");
    expect(context).toContain("Power, ritual, and time.");
    expect(context).not.toContain("[folder] Themes");
  });

  it("prioritizes book home and compact summaries over newer low-signal notes", () => {
    const home = doc({
      id: "home-1",
      type: "book_home",
      title: "Book Home",
      summaryMd: "The central reading workspace.",
      updatedAt: 20,
    });
    const recentNote = doc({
      id: "recent-1",
      title: "Recent Scratch",
      excerpt: "A short scratch note.",
      updatedAt: 999,
    });

    const context = buildKnowledgePromptContext([recentNote, home], { maxDocuments: 1 });

    expect(context).toContain("[book_home] Book Home");
    expect(context).not.toContain("Recent Scratch");
  });

  it("prioritizes documents that match the current question", () => {
    const home = doc({
      id: "home-1",
      type: "book_home",
      title: "Book Home",
      summaryMd: "The central reading workspace.",
      updatedAt: 20,
    });
    const relevantNote = doc({
      id: "relevant-1",
      title: "Tea Ceremony Notes",
      excerpt: "Ritual timing and shared attention.",
      updatedAt: 10,
    });

    const context = buildKnowledgePromptContext([home, relevantNote], {
      query: "tea ceremony",
      maxDocuments: 1,
    });

    expect(context).toContain("Tea Ceremony Notes");
    expect(context).not.toContain("Book Home");
  });

  it("prioritizes documents whose vault path matches the current question", () => {
    const home = doc({
      id: "home-1",
      type: "book_home",
      title: "Book Home",
      summaryMd: "The central reading workspace.",
      updatedAt: 20,
    });
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Themes",
      contentMd: "",
      updatedAt: 10,
    });
    const childNote = doc({
      id: "child-1",
      parentId: "folder-1",
      title: "Reading Thread",
      excerpt: "Shared attention and ritual timing.",
      updatedAt: 10,
    });

    const context = buildKnowledgePromptContext([home, folder, childNote], {
      query: "themes",
      maxDocuments: 1,
    });

    expect(context).toContain("Reading Thread");
    expect(context).toContain("path: Knowledge base / Themes / Reading Thread");
    expect(context).not.toContain("Book Home");
  });

  it("keeps outgoing links and backlinks visible in bounded prompt snapshots", () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Themes",
      contentMd: "",
    });
    const source = doc({
      id: "source-1",
      parentId: "folder-1",
      title: "Source Note",
      excerpt: "Original interpretation.",
    });
    const target = doc({
      id: "target-1",
      parentId: "folder-1",
      title: "Related Idea",
      excerpt: "Related interpretation.",
    });
    const backlinkSource = doc({
      id: "backlink-1",
      parentId: "folder-1",
      title: "Earlier Note",
      excerpt: "Earlier context.",
    });

    const context = buildKnowledgePromptContext([folder, source, target, backlinkSource], {
      maxDocuments: 1,
      query: "source",
      relationContextByDocumentId: new Map([
        [
          "source-1",
          {
            outgoing: ["related -> Knowledge base / Themes / Related Idea"],
            backlinks: ["references <- Knowledge base / Themes / Earlier Note"],
          },
        ],
      ]),
    });

    expect(context).toContain("[standalone_note] Source Note");
    expect(context).toContain("links: related -> Knowledge base / Themes / Related Idea");
    expect(context).toContain("backlinks: references <- Knowledge base / Themes / Earlier Note");
  });

  it("keeps the prompt snapshot bounded", () => {
    const context = buildKnowledgePromptContext(
      [
        doc({
          id: "long-1",
          title: "Long Note",
          summaryMd: "x".repeat(5000),
        }),
      ],
      { maxChars: 700 },
    );

    expect(context).toBeTruthy();
    expect(context?.length).toBeLessThanOrEqual(700);
    expect(context).toContain("Long Note");
    expect(context).toContain("...");
  });

  it("projects ReadAny cards from canonical JSON with synced templates", () => {
    const context = buildKnowledgePromptContext(
      [
        doc({
          id: "custom-card-doc",
          title: "Custom Card Note",
          contentMd: "Stale markdown fallback",
          contentJson: {
            type: "doc",
            content: [
              {
                type: "readanyCard",
                attrs: {
                  cardType: "custom:template-reading-question",
                  version: 1,
                  title: "Prompt",
                  markdown: "Question: What changed?",
                },
              },
            ],
          },
        }),
      ],
      { cardTemplates: [readingPromptTemplate] },
    );

    expect(context).toContain("[standalone_note] Custom Card Note");
    expect(context).toContain("Question: What changed?");
    expect(context).not.toContain("Stale markdown fallback");
  });

  it("includes structured custom card fields in AI context previews", () => {
    const conceptTemplate: KnowledgeCardTemplate = {
      id: "template-concept",
      name: "Concept",
      version: 1,
      schemaJson: {
        cardType: "custom:template-concept",
        title: "Concept",
        markdown: "Definition:",
        fields: [
          { key: "term", label: "Term", type: "text" },
          { key: "confidence", label: "Confidence", type: "number" },
          { key: "source", label: "Source", type: "text", required: true },
        ],
      },
      builtIn: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
    };

    const context = buildKnowledgePromptContext(
      [
        doc({
          id: "structured-card-doc",
          title: "Structured Card Note",
          contentMd: "Stale markdown fallback",
          contentJson: {
            type: "doc",
            content: [
              {
                type: "readanyCard",
                attrs: {
                  cardType: "custom:template-concept",
                  version: 1,
                  title: "Attention",
                  markdown: "Definition: directed perception",
                  data: {
                    term: "Attention",
                    confidence: 0.92,
                  },
                },
              },
            ],
          },
        }),
      ],
      { cardTemplates: [conceptTemplate] },
    );

    expect(context).toContain("[standalone_note] Structured Card Note");
    expect(context).toContain("Definition: directed perception");
    expect(context).toContain("Term: Attention");
    expect(context).toContain("Confidence: 0.92");
    expect(context).toContain("Source: Missing required value");
    expect(context).not.toContain("Stale markdown fallback");
  });

  it("keeps unsupported and future ReadAny cards readable in AI context without raw data", () => {
    const context = buildKnowledgePromptContext(
      [
        doc({
          id: "fallback-card-doc",
          title: "Fallback Card Note",
          contentMd: "Stale markdown fallback",
          contentJson: {
            type: "doc",
            content: [
              {
                type: "readanyCard",
                attrs: {
                  cardType: "customMetric",
                  version: 3,
                  title: "Reading score",
                  text: "Focus: 92%",
                  sourceTitle: "Chapter 4",
                  cfi: "epubcfi(/6/4)",
                  data: { private: "<json>" },
                },
              },
              {
                type: "readanyCard",
                attrs: {
                  cardType: "aiSummary",
                  version: 99,
                  title: "Future summary",
                  markdown: "Readable fallback body.",
                },
              },
            ],
          },
        }),
      ],
      { maxChars: 1400 },
    );

    expect(context).toContain("[standalone_note] Fallback Card Note");
    expect(context).toContain("Reading score");
    expect(context).toContain("Focus: 92%");
    expect(context).toContain("ReadAny card: customMetric v3");
    expect(context).toContain("Future summary");
    expect(context).toContain("Readable fallback body.");
    expect(context).not.toContain("Stale markdown fallback");
    expect(context).not.toContain("private");
    expect(context).not.toContain("<json>");
  });
});

describe("loadKnowledgePromptContext", () => {
  it("loads current-book knowledge documents and formats a bounded prompt context", async () => {
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      doc({
        id: "review-1",
        type: "review",
        title: "Reading Review",
        excerpt: "This is the user's own review.",
      }),
    ]);
    dbMocks.searchKnowledgeDocuments.mockResolvedValue([]);

    const context = await loadKnowledgePromptContext({ bookId: "book-1" });

    expect(dbMocks.getKnowledgeDocuments).toHaveBeenCalledWith({ bookId: "book-1", limit: 5000 });
    expect(dbMocks.searchKnowledgeDocuments).not.toHaveBeenCalled();
    expect(dbMocks.getKnowledgeCardTemplates).toHaveBeenCalled();
    expect(context).toContain("Reading Review");
    expect(context).toContain("This is the user's own review.");
  });

  it("loads card templates before building AI context previews", async () => {
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      doc({
        id: "custom-card-doc",
        title: "Custom Card Note",
        contentMd: "Stale markdown fallback",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "readanyCard",
              attrs: {
                cardType: "custom:template-reading-question",
                version: 1,
                title: "Prompt",
                markdown: "Question: What changed?",
              },
            },
          ],
        },
      }),
    ]);
    dbMocks.searchKnowledgeDocuments.mockResolvedValue([]);
    dbMocks.getKnowledgeCardTemplates.mockResolvedValue([readingPromptTemplate]);

    const context = await loadKnowledgePromptContext({ bookId: "book-1" });

    expect(dbMocks.getKnowledgeCardTemplates).toHaveBeenCalled();
    expect(context).toContain("Question: What changed?");
    expect(context).not.toContain("Stale markdown fallback");
  });

  it("keeps knowledge context available when card template loading fails", async () => {
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      doc({
        id: "review-1",
        type: "review",
        title: "Reading Review",
        excerpt: "This is the user's own review.",
      }),
    ]);
    dbMocks.searchKnowledgeDocuments.mockResolvedValue([]);
    dbMocks.getKnowledgeCardTemplates.mockRejectedValue(new Error("template table busy"));

    const context = await loadKnowledgePromptContext({ bookId: "book-1" });

    expect(context).toContain("Reading Review");
    expect(context).toContain("This is the user's own review.");
  });

  it("merges question-related search matches with the full vault path context", async () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Characters",
      contentMd: "",
    });
    const searched = doc({
      id: "match-1",
      parentId: "folder-1",
      title: "Ada Notes",
      excerpt: "Ada's promise changes the ending.",
      updatedAt: 1,
    });

    dbMocks.getKnowledgeDocuments.mockResolvedValue([folder]);
    dbMocks.searchKnowledgeDocuments.mockResolvedValue([searched]);

    const context = await loadKnowledgePromptContext({
      bookId: "book-1",
      query: "Ada promise",
      maxDocuments: 1,
    });

    expect(dbMocks.searchKnowledgeDocuments).toHaveBeenCalledWith({
      bookId: "book-1",
      query: "ada promise",
      limit: 12,
    });
    expect(context).toContain("Ada Notes");
    expect(context).toContain("path: Knowledge base / Characters / Ada Notes");
  });

  it("loads outgoing links and backlinks for the bounded knowledge prompt context", async () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Themes",
      contentMd: "",
    });
    const source = doc({
      id: "source-1",
      parentId: "folder-1",
      title: "Source Note",
      excerpt: "Original interpretation.",
    });
    const target = doc({
      id: "target-1",
      parentId: "folder-1",
      title: "Related Idea",
      excerpt: "Related interpretation.",
    });
    const backlinkSource = doc({
      id: "backlink-1",
      parentId: "folder-1",
      title: "Earlier Note",
      excerpt: "Earlier context.",
    });

    dbMocks.getKnowledgeDocuments.mockResolvedValue([folder, source, target, backlinkSource]);
    dbMocks.searchKnowledgeDocuments.mockResolvedValue([]);
    dbMocks.getKnowledgeLinks.mockImplementation(async (documentId: string) =>
      documentId === "source-1"
        ? [
            {
              id: "link-out",
              fromDocumentId: "source-1",
              toKind: "document",
              toId: "target-1",
              relation: "related",
              label: "Compare with",
              cfi: "epubcfi(/6/10)",
              createdAt: 1000,
              updatedAt: 1000,
            },
          ]
        : [],
    );
    dbMocks.getKnowledgeBacklinks.mockImplementation(async (documentId: string) =>
      documentId === "source-1"
        ? [
            {
              link: {
                id: "link-back",
                fromDocumentId: "backlink-1",
                toKind: "document",
                toId: "source-1",
                relation: "references",
                label: "Earlier mention",
                cfi: "epubcfi(/6/2)",
                createdAt: 1000,
                updatedAt: 1000,
              },
              fromDocument: backlinkSource,
            },
          ]
        : [],
    );

    const context = await loadKnowledgePromptContext({
      bookId: "book-1",
      query: "source",
      maxDocuments: 1,
    });

    expect(dbMocks.getKnowledgeLinks).toHaveBeenCalledWith("source-1");
    expect(dbMocks.getKnowledgeBacklinks).toHaveBeenCalledWith("source-1", 3);
    expect(context).toContain(
      "links: related -> Knowledge base / Themes / Related Idea (Compare with; cfi: epubcfi(/6/10))",
    );
    expect(context).toContain(
      "backlinks: references <- Knowledge base / Themes / Earlier Note (Earlier mention; cfi: epubcfi(/6/2))",
    );
  });

  it("does not query when no current book is attached", async () => {
    await expect(loadKnowledgePromptContext({ bookId: null })).resolves.toBeUndefined();
    expect(dbMocks.getKnowledgeDocuments).not.toHaveBeenCalled();
    expect(dbMocks.getKnowledgeCardTemplates).not.toHaveBeenCalled();
  });

  it("keeps AI streaming usable when the knowledge lookup fails", async () => {
    dbMocks.getKnowledgeDocuments.mockRejectedValue(new Error("database busy"));

    await expect(loadKnowledgePromptContext({ bookId: "book-1" })).resolves.toBeUndefined();
  });
});
