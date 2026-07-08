import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConfig } from "../../types";
import { streamReadingAgent } from "../agents/reading-agent";
import type { ToolDefinition } from "../tools";
import { getAvailableTools } from "../tools";

const createReactAgentMock = vi.hoisted(() => vi.fn());

vi.mock("@langchain/langgraph/prebuilt", () => ({
  createReactAgent: createReactAgentMock,
}));

vi.mock("../llm-provider", () => ({
  createChatModel: vi.fn(async () => ({
    stream: vi.fn(),
  })),
}));

const getReadingContextSnapshotMock = vi.hoisted(() => vi.fn(() => null));

vi.mock("../reading-context-service", () => ({
  getReadingContextSnapshot: getReadingContextSnapshotMock,
}));

function makeAIConfig(): AIConfig {
  return {
    endpoints: [
      {
        id: "endpoint-1",
        name: "Mock",
        provider: "custom",
        apiKey: "",
        baseUrl: "https://example.com/v1",
        models: ["mock-model"],
        modelsFetched: true,
      },
    ],
    activeEndpointId: "endpoint-1",
    activeModel: "mock-model",
    temperature: 0.7,
    maxTokens: 1000,
    slidingWindowSize: 8,
  };
}

beforeEach(() => {
  createReactAgentMock.mockReset();
  getReadingContextSnapshotMock.mockReset();
  getReadingContextSnapshotMock.mockReturnValue(null);
  vi.useRealTimers();
});

describe("streamReadingAgent tool registration", () => {
  it("registers fallback tools when only bookId is available", async () => {
    createReactAgentMock.mockReturnValue({
      streamEvents: vi.fn(() => ({
        [Symbol.asyncIterator]: async function* () {
          // no-op stream
        },
      })),
    });

    const events = streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: false,
        getAvailableTools,
      },
      "介绍一下这本书",
    );

    for await (const _event of events) {
      // drain stream
    }

    const call = createReactAgentMock.mock.calls[createReactAgentMock.mock.calls.length - 1]?.[0];
    const toolNames = (call.tools as ToolDefinition[]).map((tool) => tool.name);

    expect(toolNames).toContain("fallbackToc");
    expect(toolNames).toContain("fallbackSearch");
    expect(toolNames).toContain("fallbackChapterContext");
    expect(toolNames).toContain("addCitation");
  });

  it("returns a structured error when a tool execution times out", async () => {
    createReactAgentMock.mockReturnValue({
      streamEvents: vi.fn(() => ({
        [Symbol.asyncIterator]: async function* () {
          // no-op stream
        },
      })),
    });

    const tools: ToolDefinition[] = [
      {
        name: "slowTool",
        description: "A tool that never resolves",
        parameters: {},
        execute: () => new Promise(() => {}),
      },
    ];

    for await (const _event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: false,
        getAvailableTools: () => tools,
        toolTimeoutMs: 1_000,
      },
      "search",
    )) {
      // drain stream
    }

    const call = createReactAgentMock.mock.calls[createReactAgentMock.mock.calls.length - 1]?.[0];
    const registeredTool = (
      call.tools as Array<{ name: string; func: (input: unknown) => Promise<string> }>
    ).find((tool) => tool.name === "slowTool");

    expect(registeredTool).toBeDefined();
    if (!registeredTool) throw new Error("Expected slowTool to be registered");

    vi.useFakeTimers();
    const result = registeredTool.func({});
    const pending = expect(result).resolves.toBe(
      JSON.stringify({ error: 'Tool "slowTool" timed out after 1s' }),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await pending;
  });

  it("keeps tool-call turn text out of the final response before addCitation completes", async () => {
    createReactAgentMock.mockReturnValue({
      streamEvents: vi.fn(() => ({
        [Symbol.asyncIterator]: async function* () {
          yield {
            event: "on_chat_model_stream",
            data: {
              chunk: {
                content: "I should register the citation before answering.",
              },
            },
          };
          yield {
            event: "on_chat_model_end",
            data: {
              output: {
                tool_calls: [
                  {
                    name: "addCitation",
                    args: {
                      citationIndex: 1,
                      chapterTitle: "Chapter 1",
                      chapterIndex: 0,
                      cfi: "epubcfi(/6/2)",
                      quotedText: "source text",
                    },
                  },
                ],
              },
            },
          };
          yield {
            event: "on_tool_start",
            name: "addCitation",
            data: {
              input: {
                citationIndex: 1,
                chapterTitle: "Chapter 1",
                chapterIndex: 0,
                cfi: "epubcfi(/6/2)",
                quotedText: "source text",
              },
            },
          };
          yield {
            event: "on_tool_end",
            name: "addCitation",
            data: {
              output: JSON.stringify({
                type: "citation",
                bookId: "book-1",
                chapterTitle: "Chapter 1",
                chapterIndex: 0,
                cfi: "epubcfi(/6/2)",
                text: "source text",
                citationIndex: 1,
              }),
            },
          };
          yield {
            event: "on_chat_model_stream",
            data: {
              chunk: {
                content: "Final answer with a registered citation.[1]",
              },
            },
          };
          yield {
            event: "on_chat_model_end",
            data: {
              output: {},
            },
          };
        },
      })),
    });

    const events = [];
    for await (const event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: false,
        getAvailableTools,
      },
      "介绍一下这本书",
    )) {
      events.push(event);
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reasoning",
          content: "I should register the citation before answering.",
        }),
        expect.objectContaining({ type: "tool_call", name: "addCitation" }),
        expect.objectContaining({
          type: "citation",
          citation: expect.objectContaining({ citationIndex: 1 }),
        }),
        expect.objectContaining({
          type: "token",
          content: "Final answer with a registered citation.[1]",
        }),
      ]),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "token",
        content: "I should register the citation before answering.",
      }),
    );
  });

  it("emits Gemini OpenAI-compatible thought summaries from raw stream chunks", async () => {
    createReactAgentMock.mockReturnValue({
      streamEvents: vi.fn(() => ({
        [Symbol.asyncIterator]: async function* () {
          yield {
            event: "on_chat_model_stream",
            data: {
              chunk: {
                content: "",
                additional_kwargs: {
                  __raw_response: {
                    choices: [
                      {
                        delta: {
                          extra_content: {
                            google: {
                              thought_summary: "I should inspect the current chapter first.",
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          };
          yield {
            event: "on_chat_model_end",
            data: {
              output: {
                tool_calls: [{ name: "getCurrentChapter", args: {} }],
              },
            },
          };
        },
      })),
    });

    const events = [];
    for await (const event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: false,
        getAvailableTools,
      },
      "总结当前章节",
    )) {
      events.push(event);
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reasoning",
          content: "I should inspect the current chapter first.",
        }),
        expect.objectContaining({ type: "tool_call", name: "getCurrentChapter" }),
      ]),
    );
  });

  it("does not display Gemini thought signatures as reasoning text", async () => {
    createReactAgentMock.mockReturnValue({
      streamEvents: vi.fn(() => ({
        [Symbol.asyncIterator]: async function* () {
          yield {
            event: "on_chat_model_stream",
            data: {
              chunk: {
                content: "",
                additional_kwargs: {
                  __raw_response: {
                    choices: [
                      {
                        delta: {
                          extra_content: {
                            google: {
                              thought_signature: "encrypted-signature",
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          };
        },
      })),
    });

    const events = [];
    for await (const event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: false,
        getAvailableTools,
      },
      "总结当前章节",
    )) {
      events.push(event);
    }

    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "reasoning",
        content: "encrypted-signature",
      }),
    );
  });

  it("limits chapter reference resolution to three real attempts per turn", async () => {
    const resolveCalls: string[] = [];
    const resolveTool: ToolDefinition = {
      name: "resolveChapterReference",
      description: "Resolve chapter references",
      parameters: {
        query: { type: "string", description: "query", required: true },
      },
      execute: vi.fn(async (args) => {
        resolveCalls.push(String(args.query || ""));
        return {
          matched: false,
          confidence: 0.4,
          matchType: "weak",
          candidates: [
            {
              chapterIndex: 3,
              chapterTitle: "第3章",
              confidence: 0.4,
              matchType: "weak",
              reason: "weak textual similarity",
            },
          ],
          reason: "No reliable chapter reference found",
        };
      }),
    };

    let capturedTools: any[] = [];
    createReactAgentMock.mockImplementation((config) => {
      capturedTools = config.tools;
      return {
        streamEvents: vi.fn(() => ({
          [Symbol.asyncIterator]: async function* () {
            // no-op stream
          },
        })),
      };
    });

    for await (const event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: true,
        getAvailableTools: () => [resolveTool],
      },
      "张三疯那一章讲了什么",
    )) {
      void event;
    }

    const wrappedResolveTool = capturedTools.find(
      (tool) => tool.name === "resolveChapterReference",
    );
    expect(wrappedResolveTool).toBeDefined();

    const first = JSON.parse(await wrappedResolveTool.func({ query: "张三疯那一章讲了什么" }));
    const second = JSON.parse(await wrappedResolveTool.func({ query: "张三疯那一章讲了什么" }));
    const third = JSON.parse(await wrappedResolveTool.func({ query: "张三疯那一章讲了什么" }));

    expect(resolveCalls).toHaveLength(3);
    expect(resolveCalls[0]).toBe("张三疯那一章讲了什么");
    expect(resolveCalls[1]).toBe("张三疯");
    expect(resolveCalls[2]).toBe("张三疯");
    expect(first.matched).toBe(false);
    expect(second.matched).toBe(false);
    expect(third.matched).toBe(false);

    const fourth = JSON.parse(await wrappedResolveTool.func({ query: "张三疯那一章讲了什么" }));
    expect(fourth.attemptLimitReached).toBe(true);
    expect(fourth.notice).toBe("未能可靠定位章节，请补充更准确的章节名");
    expect(fourth.attemptedQueries).toEqual(["张三疯那一章讲了什么", "张三疯", "张三疯"]);
  });

  it("keeps RAG fallback available for current-page questions on indexed books", async () => {
    let capturedTools: any[] = [];
    createReactAgentMock.mockImplementation((config) => {
      capturedTools = config.tools;
      return {
        streamEvents: vi.fn(() => ({
          [Symbol.asyncIterator]: async function* () {
            // no-op stream
          },
        })),
      };
    });

    for await (const event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: true,
        getAvailableTools,
      },
      "我看到这里是什么意思",
    )) {
      void event;
    }

    const toolNames = capturedTools.map((tool) => tool.name);
    expect(toolNames).toContain("getCurrentChapter");
    expect(toolNames).toContain("getSurroundingContext");
    expect(toolNames).toContain("getReadingProgress");
    expect(toolNames).toContain("ragSearch");
    expect(toolNames).toContain("ragContext");
    expect(toolNames).not.toContain("resolveChapterReference");
    expect(toolNames.indexOf("getSurroundingContext")).toBeLessThan(toolNames.indexOf("ragSearch"));
  });

  it("does not misroute generic analysis requests into current-page-only tools", async () => {
    let capturedTools: any[] = [];
    createReactAgentMock.mockImplementation((config) => {
      capturedTools = config.tools;
      return {
        streamEvents: vi.fn(() => ({
          [Symbol.asyncIterator]: async function* () {
            // no-op stream
          },
        })),
      };
    });

    for await (const event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: true,
        getAvailableTools,
      },
      "帮我分析一下主角",
    )) {
      void event;
    }

    const toolNames = capturedTools.map((tool) => tool.name);
    expect(toolNames).toContain("ragSearch");
    expect(toolNames).toContain("ragContext");
    expect(toolNames).toContain("summarize");
    expect(toolNames).toContain("getCurrentChapter");
    expect(toolNames.indexOf("ragSearch")).toBeLessThan(toolNames.indexOf("getCurrentChapter"));
  });

  it("keeps indexed search and toc fallbacks for specific chapter requests", async () => {
    let capturedTools: any[] = [];
    createReactAgentMock.mockImplementation((config) => {
      capturedTools = config.tools;
      return {
        streamEvents: vi.fn(() => ({
          [Symbol.asyncIterator]: async function* () {
            // no-op stream
          },
        })),
      };
    });

    for await (const event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: true,
        getAvailableTools,
      },
      "第十二章里主角为什么离开",
    )) {
      void event;
    }

    const toolNames = capturedTools.map((tool) => tool.name);
    expect(toolNames).toContain("resolveChapterReference");
    expect(toolNames).toContain("ragSearch");
    expect(toolNames).toContain("ragToc");
    expect(toolNames).toContain("ragContext");
    expect(toolNames.indexOf("resolveChapterReference")).toBeLessThan(
      toolNames.indexOf("ragSearch"),
    );
  });

  it("routes library requests away from book-content tools", async () => {
    let capturedTools: any[] = [];
    createReactAgentMock.mockImplementation((config) => {
      capturedTools = config.tools;
      return {
        streamEvents: vi.fn(() => ({
          [Symbol.asyncIterator]: async function* () {
            // no-op stream
          },
        })),
      };
    });

    for await (const event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: true,
        getAvailableTools,
      },
      "帮我看看书库里有哪些标签",
    )) {
      void event;
    }

    const toolNames = capturedTools.map((tool) => tool.name);
    expect(toolNames).toContain("manageBookTags");
    expect(toolNames).toContain("listBooks");
    expect(toolNames).not.toContain("ragSearch");
    expect(toolNames).not.toContain("ragContext");
    expect(toolNames).not.toContain("summarize");
  });

  it("reuses duplicate search requests within the same turn", async () => {
    const searchCalls: string[] = [];
    const searchTool: ToolDefinition = {
      name: "ragSearch",
      description: "Search book content",
      parameters: {
        query: { type: "string", description: "query", required: true },
      },
      execute: vi.fn(async (args) => {
        searchCalls.push(String(args.query || ""));
        return {
          results: [{ content: "result", chapterIndex: 1, chapter: "第1章" }],
          totalResults: 1,
        };
      }),
    };

    let capturedTools: any[] = [];
    createReactAgentMock.mockImplementation((config) => {
      capturedTools = config.tools;
      return {
        streamEvents: vi.fn(() => ({
          [Symbol.asyncIterator]: async function* () {
            // no-op stream
          },
        })),
      };
    });

    for await (const event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: true,
        getAvailableTools: () => [searchTool],
      },
      "主角是谁",
    )) {
      void event;
    }

    const wrappedSearchTool = capturedTools.find((tool) => tool.name === "ragSearch");
    expect(wrappedSearchTool).toBeDefined();

    const first = JSON.parse(await wrappedSearchTool.func({ query: "主角是谁" }));
    const second = JSON.parse(await wrappedSearchTool.func({ query: "主角是谁" }));
    const third = JSON.parse(await wrappedSearchTool.func({ query: "主角是谁" }));

    expect(first.totalResults).toBe(1);
    expect(second.totalResults).toBe(1);
    expect(third.totalResults).toBe(1);
    expect(third.repeatedToolCall).toBe(true);
    expect(third.stopToolCalls).toBe(true);
    expect(third.instruction).toContain("Stop calling tools now");
    expect(searchCalls).toEqual(["主角是谁"]);
  });
});
