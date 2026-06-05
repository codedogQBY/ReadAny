import { describe, expect, it, vi } from "vitest";
import {
  buildChapterContextFromChunks,
  buildChapterContextFromExtractedChapter,
  buildContextToolEvents,
  createClaudeCodeStreamParser,
  executeReadAnyOpsDetailed,
  parseReadAnyOps,
  preExecuteReadAnyTools,
  resolveReadAnyBookReference,
  shouldAttachFullChapter,
  streamClaudeCodeAgent,
} from "../claude-code";

const { runClaudeCodeChatMock, ragSearchMock } = vi.hoisted(() => ({
  runClaudeCodeChatMock: vi.fn(),
  ragSearchMock: vi.fn(),
}));

vi.mock("../../services/platform", () => ({
  getPlatformService: () => ({
    runClaudeCodeChat: runClaudeCodeChatMock,
  }),
}));

vi.mock("../../rag", () => ({
  search: ragSearchMock,
}));

// Mock DB
vi.mock("../../db/database", () => {
  const mockBooks = [
    {
      id: "book-1",
      meta: { title: "斜目而视", author: "齐泽克", language: "zh-CN" },
      format: "epub",
      progress: 0.32,
      isVectorized: true,
      addedAt: 1700000000000,
      lastOpenedAt: 1715000000000,
    },
    {
      id: "book-2",
      meta: { title: "存在与时间", author: "海德格尔", language: "zh-CN" },
      format: "pdf",
      progress: 0,
      isVectorized: false,
      addedAt: 1700010000000,
      lastOpenedAt: 1700010000000,
    },
    {
      id: "book-3",
      meta: { title: "Being and Time", author: "Heidegger", language: "en" },
      format: "epub",
      progress: 1,
      isVectorized: true,
      addedAt: 1700020000000,
      lastOpenedAt: 1715000000000,
    },
  ];
  return {
    getBooks: vi.fn().mockResolvedValue(mockBooks),
    getBook: vi.fn().mockImplementation(async (id: string) => mockBooks.find((book) => book.id === id) || null),
    getBookMemory: vi.fn().mockResolvedValue(null),
    getChunks: vi.fn().mockResolvedValue([]),
    getAllHighlights: vi.fn().mockResolvedValue([
      { text: "关键在于...", note: "重要概念", bookId: "book-1", chapterTitle: "第一章", color: "yellow", createdAt: Date.now() },
    ]),
    getAllNotes: vi.fn().mockResolvedValue([
      { title: "读书笔记1", content: "这本书讨论了...", bookId: "book-1", chapterTitle: "第一章", tags: [], createdAt: Date.now() },
    ]),
    getReadingSessionsByDateRange: vi.fn().mockResolvedValue([
      { totalActiveTime: 1800000, pagesRead: 25 },
      { totalActiveTime: 3600000, pagesRead: 50 },
    ]),
    getSkills: vi.fn().mockResolvedValue([
      { id: "skill-1", name: "Smart Summary", description: "Summarize a chapter" },
    ]),
  };
});

describe("preExecuteReadAnyTools", () => {
  it("detects library_query intent from Chinese keywords", async () => {
    const result = await preExecuteReadAnyTools({
      userInput: "我的书库有哪些书？",
      book: null,
    });
    expect(result.intent).toBe("library_query");
    expect(result.librarySummary).toBeDefined();
    expect(result.librarySummary).toContain("书库详情");
    expect(result.librarySummary).toContain("斜目而视");
    expect(result.librarySummary).toContain("存在与时间");
  });

  it("detects reading_stats intent", async () => {
    const result = await preExecuteReadAnyTools({
      userInput: "我的阅读统计如何？",
      book: null,
    });
    expect(result.intent).toBe("reading_stats");
    expect(result.statsSummary).toBeDefined();
    expect(result.statsSummary).toContain("阅读统计");
    expect(result.statsSummary).toContain("3 本书");
  });

  it("detects highlight_note intent", async () => {
    const result = await preExecuteReadAnyTools({
      userInput: "看看我的笔记",
      book: null,
    });
    expect(result.intent).toBe("highlight_note");
    expect(result.notesSummary).toBeDefined();
    expect(result.notesSummary).toContain("关键在于");
  });

  it("returns general intent for unrelated queries", async () => {
    const result = await preExecuteReadAnyTools({
      userInput: "今天天气怎么样",
      book: null,
    });
    expect(result.intent).toBe("general");
  });

  it("always provides librarySummary even for non-library queries", async () => {
    const result = await preExecuteReadAnyTools({
      userInput: "解释一下存在主义",
      book: null,
    });
    expect(result.librarySummary).toBeDefined();
    expect(result.librarySummary).toContain("书库概况：共 3 本书");
  });

  it("filters books by reading status", async () => {
    const result = await preExecuteReadAnyTools({
      userInput: "我在读哪些书？",
      book: null,
    });
    expect(result.intent).toBe("library_query");
    expect(result.librarySummary).toContain("斜目而视");
    expect(result.librarySummary).not.toContain("存在与时间");
    expect(result.librarySummary).not.toContain("Being and Time");
  });
});

// Test buildContextToolEvents behavior
describe("buildContextToolEvents", () => {
  it("only emits chapter event when chapterContext is available", () => {
    const events = buildContextToolEvents({
      requestedFullChapter: true,
      chapterContext: {
        chapterTitle: "第一章",
        chapterIndex: 0,
        content: "正文内容",
        source: "chunks",
        chunks: [{ content: "正文内容", cfi: "cfi-1", chapterTitle: "第一章", chapterIndex: 0 }],
        totalTokens: 100,
      },
      bookMemory: null,
    });
    expect(events).toHaveLength(2); // tool_call + tool_result
    const toolCall = events[0] as { type: string; name: string; args: Record<string, unknown> };
    expect(toolCall.name).toBe("getCurrentChapter");
  });

  it("skips chapter event when chapterContext is null", () => {
    const events = buildContextToolEvents({
      requestedFullChapter: true,
      chapterContext: null,
      bookMemory: null,
    });
    expect(events).toHaveLength(0);
  });
});

describe("Claude Code stream parser", () => {
  it("emits only text deltas from cumulative partial assistant messages", () => {
    const parser = createClaudeCodeStreamParser();

    const first = parser.parseLine(
      JSON.stringify({
        type: "assistant",
        message: { id: "msg-1", content: [{ type: "text", text: "Hello" }] },
      }),
    );
    const second = parser.parseLine(
      JSON.stringify({
        type: "assistant",
        message: { id: "msg-1", content: [{ type: "text", text: "Hello, world" }] },
      }),
    );

    expect(first).toEqual([{ type: "token", content: "Hello" }]);
    expect(second).toEqual([{ type: "token", content: ", world" }]);
  });

  it("maps Claude Code stream_event text and thinking deltas", () => {
    const parser = createClaudeCodeStreamParser();

    const text = parser.parseLine(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "OK" },
        },
      }),
    );
    const thinking = parser.parseLine(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "Checking context" },
        },
      }),
    );

    expect(text).toEqual([{ type: "token", content: "OK" }]);
    expect(thinking).toEqual([
      { type: "reasoning", content: "Checking context", stepType: "thinking" },
    ]);
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "assistant",
          message: { id: "msg-actual", content: [{ type: "text", text: "OK" }] },
        }),
      ),
    ).toEqual([]);
  });

  it("maps Claude Code tool use and tool result content to existing stream events", () => {
    const parser = createClaudeCodeStreamParser();

    const toolCall = parser.parseLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg-2",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "WebSearch",
              input: { query: "Looking Awry Zizek" },
            },
          ],
        },
      }),
    );
    const toolResult = parser.parseLine(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "Search complete",
            },
          ],
        },
      }),
    );

    expect(toolCall).toEqual([
      { type: "tool_call", name: "WebSearch", args: { query: "Looking Awry Zizek" } },
    ]);
    expect(toolResult).toEqual([
      { type: "tool_result", name: "WebSearch", result: "Search complete" },
    ]);
  });
});

describe("ReadAny operation protocol", () => {
  it("resolves a model-provided book title to the real ReadAny book id", async () => {
    await expect(resolveReadAnyBookReference("Being and Time", null)).resolves.toBe("book-3");
  });

  it("parses readany blocks that use a book title containing spaces", () => {
    const ops = parseReadAnyOps(
      [
        "让我用书库内置的语义搜索来查找论文的结果和讨论部分。",
        "",
        "```readany",
        "search-book: Microsoft Word - 07-p2088-1905-0681=模拟结果 焊缝熔深 匙孔演化 结论",
        "list-highlights: Microsoft Word - 07-p2088-1905-0681",
        "list-notes: Microsoft Word - 07-p2088-1905-0681",
        "```",
      ].join("\n"),
    );

    expect(ops).toEqual([
      {
        action: "searchBook",
        params: {
          bookId: "Microsoft Word - 07-p2088-1905-0681",
          query: "模拟结果 焊缝熔深 匙孔演化 结论",
        },
      },
      {
        action: "listData",
        params: { type: "highlights", bookId: "Microsoft Word - 07-p2088-1905-0681" },
      },
      {
        action: "listData",
        params: { type: "notes", bookId: "Microsoft Word - 07-p2088-1905-0681" },
      },
    ]);
  });

  it("continues Claude Code after executing requested ReadAny operations", async () => {
    runClaudeCodeChatMock
      .mockImplementationOnce(async (_request, handlers) => {
        handlers.onStdoutLine(
          JSON.stringify({
            type: "assistant",
            message: {
              id: "first",
              content: [
                {
                  type: "text",
                  text: "让我先查看技能。\n```readany\nlist-skills\n```",
                },
              ],
            },
          }),
        );
      })
      .mockImplementationOnce(async (_request, handlers) => {
        handlers.onStdoutLine(
          JSON.stringify({
            type: "assistant",
            message: {
              id: "second",
              content: [{ type: "text", text: "根据工具结果，最终回答如下。" }],
            },
          }),
        );
      });

    const events = [];
    for await (const event of streamClaudeCodeAgent(
      {
        thread: { id: "thread-1", title: "test", messages: [], createdAt: 1, updatedAt: 1 },
        book: null,
        semanticContext: null,
        isVectorized: false,
      },
      "请列出技能后继续回答",
    )) {
      events.push(event);
    }

    expect(runClaudeCodeChatMock).toHaveBeenCalledTimes(2);
    expect(runClaudeCodeChatMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ tools: ["WebSearch", "WebFetch"] }),
    );
    expect(events).toContainEqual({ type: "tool_call", name: "listData", args: { type: "skills" } });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_result", name: "listData" }),
    );
    expect(events).toContainEqual({ type: "token", content: "根据工具结果，最终回答如下。" });
  });

  it("returns complete matched chunks without 300-character truncation", async () => {
    const longContent = `RESULTS:${"x".repeat(1200)}:CONCLUSION`;
    ragSearchMock.mockResolvedValueOnce([
      {
        score: 0.91,
        chunk: {
          id: "chunk-1",
          bookId: "book-3",
          chapterIndex: 8,
          chapterTitle: "Results and discussion",
          content: longContent,
          cfi: "",
          createdAt: Date.now(),
        },
      },
    ]);

    const [result] = await executeReadAnyOpsDetailed([
      {
        action: "searchBook",
        params: { bookId: "Being and Time", query: "results conclusion" },
      },
    ]);

    expect(result.result).toContain(longContent);
    expect(result.result).not.toContain("...");
  });
});

describe("Claude Code reading context", () => {
  it("rebuilds a full chapter from chunks in numeric chunk order", () => {
    const context = buildChapterContextFromChunks(
      [
        makeChunk({ id: "book-1-0-10", content: "tenth" }),
        makeChunk({ id: "book-1-0-2", content: "second" }),
        makeChunk({ id: "book-1-0-0", content: "first" }),
      ],
      0,
    );

    expect(context?.content).toBe("first\n\nsecond\n\ntenth");
    expect(context?.chunks).toHaveLength(3);
    expect(context?.totalTokens).toBeGreaterThan(0);
  });

  it("builds a full chapter context from extracted local book text when chunks are missing", () => {
    const context = buildChapterContextFromExtractedChapter({
      index: 3,
      title: "\u5e8f \u8a00",
      content: "\u7b2c\u4e00\u6bb5\n\n\u7b2c\u4e8c\u6bb5",
      segments: [
        { text: "\u7b2c\u4e00\u6bb5", cfi: "epubcfi(/6/8!/4/2)" },
        { text: "\u7b2c\u4e8c\u6bb5", cfi: "epubcfi(/6/8!/4/4)" },
      ],
    });

    expect(context).toMatchObject({
      chapterTitle: "\u5e8f \u8a00",
      chapterIndex: 3,
      content: "\u7b2c\u4e00\u6bb5\n\n\u7b2c\u4e8c\u6bb5",
      source: "file",
    });
    expect(context?.chunks).toEqual([
      {
        chapterTitle: "\u5e8f \u8a00",
        chapterIndex: 3,
        content: "\u7b2c\u4e00\u6bb5",
        cfi: "epubcfi(/6/8!/4/2)",
      },
      {
        chapterTitle: "\u5e8f \u8a00",
        chapterIndex: 3,
        content: "\u7b2c\u4e8c\u6bb5",
        cfi: "epubcfi(/6/8!/4/4)",
      },
    ]);
  });

  it("emits visible context tool events before the Claude Code call", () => {
    const events = buildContextToolEvents({
      requestedFullChapter: true,
      chapterContext: {
        chapterTitle: "\u5e8f \u8a00",
        chapterIndex: 3,
        content: "\u6b63\u6587",
        chunks: [],
        totalTokens: 8,
        source: "file",
      },
      bookMemory: {
        bookId: "book-1",
        summary: "\u8bfb\u8005\u5173\u6ce8\u62c9\u5eb7",
        focus: [],
        openQuestions: [],
        recentQuestions: [],
        totalMessages: 2,
        lastCompactedAt: 0,
        compactedMessageCount: 0,
        updatedAt: 1,
      },
    });

    expect(events).toEqual([
      { type: "tool_call", name: "readBookMemory", args: { bookId: "book-1" } },
      {
        type: "tool_result",
        name: "readBookMemory",
        result: expect.objectContaining({ totalMessages: 2 }),
      },
      {
        type: "tool_call",
        name: "getCurrentChapter",
        args: { chapterIndex: 3, requestedFullChapter: true },
      },
      {
        type: "tool_result",
        name: "getCurrentChapter",
        result: expect.objectContaining({ source: "file", totalTokens: 8 }),
      },
    ]);
  });

  it("attaches full chapter for chapter-level reading requests and selected quote requests", () => {
    expect(shouldAttachFullChapter("\u603b\u7ed3\u8fd9\u4e00\u7ae0", [])).toBe(true);
    expect(shouldAttachFullChapter("\u5173\u4e8e\u4ee5\u4e0b\u6587\u672c", [])).toBe(true);
    expect(
      shouldAttachFullChapter("analyze this quote", [
        { id: "q1", text: "quote", source: "preface" },
      ]),
    ).toBe(true);
    expect(shouldAttachFullChapter("hello", [])).toBe(false);
  });
});

function makeChunk(
  overrides: Partial<{
    id: string;
    bookId: string;
    chapterIndex: number;
    chapterTitle: string;
    content: string;
    tokenCount: number;
    startCfi: string;
    endCfi: string;
  }>,
) {
  return {
    id: "book-1-0-0",
    bookId: "book-1",
    chapterIndex: 0,
    chapterTitle: "Preface",
    content: "content",
    tokenCount: 1,
    startCfi: "cfi-0",
    endCfi: "cfi-1",
    ...overrides,
  };
}
