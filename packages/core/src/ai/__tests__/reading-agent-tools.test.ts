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
});

function mockEmptyAgentStream(): void {
  createReactAgentMock.mockReturnValue({
    streamEvents: vi.fn(() => ({
      [Symbol.asyncIterator]: async function* () {
        // no-op stream
      },
    })),
  });
}

function extractAvailableToolNames(prompt: string): string[] {
  const availableToolsSection = prompt.match(/## Available Tools\n\n([\s\S]*?)(?:\n\n---\n\n|$)/)?.[1];
  if (!availableToolsSection) return [];

  return Array.from(availableToolsSection.matchAll(/^- \*\*([A-Za-z][A-Za-z0-9_]*)\*\*/gm), (match) =>
    match[1],
  );
}

async function captureAgentRegistration(
  options: Partial<Parameters<typeof streamReadingAgent>[0]> = {},
) {
  mockEmptyAgentStream();

  for await (const _event of streamReadingAgent(
    {
      aiConfig: makeAIConfig(),
      book: null,
      bookId: null,
      semanticContext: null,
      enabledSkills: [],
      isVectorized: false,
      getAvailableTools,
      ...options,
    },
    "帮我分析一下",
  )) {
    // drain stream
  }

  return createReactAgentMock.mock.calls[createReactAgentMock.mock.calls.length - 1]?.[0];
}

function expectPromptToolsToMatchRegisteredTools(call: {
  prompt: string;
  tools: ToolDefinition[];
}): void {
  const promptToolNames = extractAvailableToolNames(call.prompt).sort();
  const registeredToolNames = call.tools.map((tool) => tool.name).sort();

  expect(promptToolNames).toEqual(registeredToolNames);
}

describe("streamReadingAgent tool registration", () => {
  it("passes annotation context into the agent system prompt", async () => {
    mockEmptyAgentStream();

    for await (const _event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: false,
        annotationContext:
          "- [highlight] Learning without thought is labor lost.\n  id: hl-1\n  cfi: epubcfi(/6/4)",
        getAvailableTools,
      },
      "结合我的标注讲讲",
    )) {
      // drain stream
    }

    const call = createReactAgentMock.mock.calls[createReactAgentMock.mock.calls.length - 1]?.[0];

    expect(call.prompt).toContain("Annotation Context");
    expect(call.prompt).toContain("id: hl-1");
    expect(call.prompt).toContain("epubcfi(/6/4)");
  });

  it("passes knowledge context into the agent system prompt", async () => {
    mockEmptyAgentStream();

    for await (const _event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: false,
        knowledgeContext:
          "- [summary] Memory Map\n  id: summary-1\n  path: Knowledge base / Themes / Memory Map",
        getAvailableTools,
      },
      "结合我的笔记讲讲",
    )) {
      // drain stream
    }

    const call = createReactAgentMock.mock.calls[createReactAgentMock.mock.calls.length - 1]?.[0];

    expect(call.prompt).toContain("Knowledge Base Context");
    expect(call.prompt).toContain("id: summary-1");
    expect(call.prompt).toContain("Knowledge base / Themes / Memory Map");
  });

  it("registers fallback tools when only bookId is available", async () => {
    mockEmptyAgentStream();

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

  it("keeps knowledge summary compression in both the prompt and registered tools", async () => {
    mockEmptyAgentStream();

    for await (const _event of streamReadingAgent(
      {
        aiConfig: makeAIConfig(),
        book: null,
        bookId: "book-1",
        semanticContext: null,
        enabledSkills: [],
        isVectorized: false,
        getAvailableTools,
      },
      "帮我整理这本书的知识库",
    )) {
      // drain stream
    }

    const call = createReactAgentMock.mock.calls[createReactAgentMock.mock.calls.length - 1]?.[0];
    const toolNames = (call.tools as ToolDefinition[]).map((tool) => tool.name);

    expect(toolNames).toContain("compressKnowledgeDocumentSummary");
    expect(call.prompt).toContain("- **compressKnowledgeDocumentSummary**");
    expect(call.prompt).toContain("Knowledge memory safety");
  });

  it("keeps the no-book prompt tool list aligned with registered tools", async () => {
    const call = await captureAgentRegistration();

    expectPromptToolsToMatchRegisteredTools(call);
    expect(call.prompt).not.toContain("- **fallbackToc**");
    expect(call.prompt).not.toContain("- **ragSearch**");
    expect(call.tools.map((tool: ToolDefinition) => tool.name)).not.toContain("addCitation");
  });

  it("keeps the non-indexed book prompt tool list aligned with registered tools", async () => {
    const call = await captureAgentRegistration({
      bookId: "book-1",
      isVectorized: false,
    });
    const toolNames = call.tools.map((tool: ToolDefinition) => tool.name);

    expectPromptToolsToMatchRegisteredTools(call);
    expect(toolNames).toContain("fallbackToc");
    expect(toolNames).toContain("fallbackSearch");
    expect(toolNames).toContain("fallbackChapterContext");
    expect(toolNames).toContain("addCitation");
    expect(toolNames).not.toContain("ragSearch");
    expect(call.prompt).not.toContain("- **ragSearch**");
  });

  it("keeps the indexed book prompt tool list aligned with registered tools", async () => {
    const call = await captureAgentRegistration({
      bookId: "book-1",
      isVectorized: true,
    });
    const toolNames = call.tools.map((tool: ToolDefinition) => tool.name);

    expectPromptToolsToMatchRegisteredTools(call);
    expect(toolNames).toContain("ragSearch");
    expect(toolNames).toContain("ragToc");
    expect(toolNames).toContain("ragContext");
    expect(toolNames).toContain("addCitation");
    expect(toolNames).not.toContain("fallbackToc");
    expect(call.prompt).not.toContain("- **fallbackToc**");
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
