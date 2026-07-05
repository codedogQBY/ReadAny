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
});
