import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConfig, Thread } from "../../types";

const streamReadingAgentMock = vi.hoisted(() => vi.fn());
const loadAnnotationPromptContextMock = vi.hoisted(() => vi.fn());
const loadKnowledgePromptContextMock = vi.hoisted(() => vi.fn());

vi.mock("../agents/reading-agent", () => ({
  streamReadingAgent: streamReadingAgentMock,
}));

vi.mock("../annotation-context", () => ({
  loadAnnotationPromptContext: loadAnnotationPromptContextMock,
}));

vi.mock("../knowledge-context", () => ({
  loadKnowledgePromptContext: loadKnowledgePromptContextMock,
}));

const { StreamingChat } = await import("../streaming");

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

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    bookId: "book-1",
    title: "Reading chat",
    messages: [
      {
        id: "message-1",
        threadId: "thread-1",
        role: "user",
        content: "结合我的茶道笔记讲讲",
        createdAt: 1,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadAnnotationPromptContextMock.mockResolvedValue(
    "- [highlight] Tea ritual\n  id: hl-1\n  cfi: epubcfi(/6/2)",
  );
  loadKnowledgePromptContextMock.mockResolvedValue(
    "- [summary] Tea Ceremony Notes\n  id: doc-1\n  path: Knowledge base / Themes / Tea Ceremony Notes",
  );
  streamReadingAgentMock.mockImplementation(async function* () {
    yield { type: "token", content: "ok" };
  });
});

describe("StreamingChat knowledge context orchestration", () => {
  it("loads question-prioritized annotation and knowledge context before invoking the agent", async () => {
    const chat = new StreamingChat();
    const onToken = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    await chat.stream({
      thread: makeThread(),
      book: null,
      semanticContext: null,
      enabledSkills: [],
      isVectorized: false,
      aiConfig: makeAIConfig(),
      getAvailableTools: vi.fn(() => []),
      onToken,
      onComplete,
      onError,
    });

    expect(loadAnnotationPromptContextMock).toHaveBeenCalledWith({
      bookId: "book-1",
      query: "结合我的茶道笔记讲讲",
    });
    expect(loadKnowledgePromptContextMock).toHaveBeenCalledWith({
      bookId: "book-1",
      query: "结合我的茶道笔记讲讲",
    });
    expect(streamReadingAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: "book-1",
        annotationContext: "- [highlight] Tea ritual\n  id: hl-1\n  cfi: epubcfi(/6/2)",
        knowledgeContext:
          "- [summary] Tea Ceremony Notes\n  id: doc-1\n  path: Knowledge base / Themes / Tea Ceremony Notes",
      }),
      "结合我的茶道笔记讲讲",
      [],
    );
    expect(onToken).toHaveBeenCalledWith("ok");
    expect(onComplete).toHaveBeenCalledWith("ok", undefined);
    expect(onError).not.toHaveBeenCalled();
  });
});
