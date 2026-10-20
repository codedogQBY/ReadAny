import { writeFileSync } from "node:fs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type IPlatformService, setPlatformService } from "../../services/platform";
import type { AIConfig, Thread } from "../../types";
import { StreamingChat } from "../streaming";
import { getAvailableTools } from "../tools";

const modelFactory = vi.hoisted(() => vi.fn());
vi.mock("../llm-provider", () => ({ createChatModel: modelFactory }));

const SOURCE = "https://example.org/author";
const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
const requests: Array<{ url: string; options: RequestInit; body?: Record<string, unknown> }> = [];
const storage = new Map<string, string>();
let failure = "";
let liveMode = false;
const liveResponses: Array<{ status: number; headers: Record<string, string>; body: string }> = [];
let fetchUrl = SOURCE;
let pendingSignal: AbortSignal | undefined;

// Scripted model, real LangGraph agent loop: inspect the actual tool result
// before returning a source link. No external model credentials are used.
class ScriptedModel extends BaseChatModel {
  boundNames: string[] = [];
  _llmType() {
    return "scripted-web-search-test";
  }
  bindTools(tools: Array<{ name: string }>) {
    this.boundNames = tools.map((tool) => tool.name);
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const user = messages.filter((message) => message.getType() === "human").at(-1);
    const text = String(user?.content ?? "");
    const tool = [...messages].reverse().find((message) => message.getType() === "tool");
    if (tool) {
      const content = String(tool.content);
      return {
        generations: [
          {
            text: content,
            message: new AIMessage(
              content.includes(SOURCE) ? `[Author background](${SOURCE})` : content,
            ),
          },
        ],
      };
    }
    const name = /https?:/.test(text) ? "webFetch" : "webSearch";
    return {
      generations: [
        {
          text: "",
          message: this.boundNames.includes(name)
            ? new AIMessage({
                content: "",
                tool_calls: [
                  {
                    id: "search-call",
                    name,
                    args:
                      name === "webSearch"
                        ? { query: "Jane Austen biography British Library" }
                        : { url: fetchUrl },
                  },
                ],
              })
            : new AIMessage("Web search unavailable; kept local tools."),
        },
      ],
    };
  }
  async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ) {
    const result = await this._generate(messages);
    const message = result.generations[0].message as AIMessage;
    const chunk = new ChatGenerationChunk({
      text: String(message.content),
      message: new AIMessageChunk({
        content: message.content,
        tool_calls: message.tool_calls,
      }),
    });
    yield chunk;
    await runManager?.handleLLMNewToken(
      String(message.content),
      undefined,
      undefined,
      undefined,
      undefined,
      { chunk },
    );
  }
}

function config(overrides: Partial<AIConfig> = {}): AIConfig {
  return {
    endpoints: [
      {
        id: "saved",
        name: "Local",
        provider: "ollama",
        apiKey: "",
        baseUrl: "http://localhost:11434",
        models: ["saved-model"],
        modelsFetched: true,
      },
    ],
    activeEndpointId: "saved",
    activeModel: "saved-model",
    temperature: 0.7,
    maxTokens: 1024,
    slidingWindowSize: 8,
    ...overrides,
  };
}

function thread(id: string, text: string): Thread {
  return {
    id,
    title: "Test",
    createdAt: 1,
    updatedAt: 1,
    messages: [{ id: "message", threadId: id, role: "user", content: text, createdAt: 1 }],
  };
}

function run(
  id: string,
  text = "Search the web for author background",
  aiConfig = config(),
  webSearchRequest?: string,
) {
  const onComplete = vi.fn();
  const onError = vi.fn();
  const onToolResult = vi.fn();
  const chat = new StreamingChat();
  const promise = chat.stream({
    thread: thread(id, text),
    webSearchRequest,
    book: null,
    semanticContext: null,
    enabledSkills: [],
    isVectorized: false,
    aiConfig,
    getAvailableTools,
    onToken: vi.fn(),
    onComplete,
    onError,
    onToolResult,
  });
  return { chat, promise, onComplete, onError, onToolResult };
}

beforeEach(() => {
  vi.useRealTimers();
  calls.length = 0;
  requests.length = 0;
  failure = "";
  liveMode = false;
  fetchUrl = SOURCE;
  pendingSignal = undefined;
  modelFactory.mockReset().mockImplementation(async () => new ScriptedModel({}));
  setPlatformService({
    isDesktop: true,
    platformType: "desktop",
    kvGetItem: async (key: string) => storage.get(key) ?? null,
    kvSetItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
    fetch: async (url: string, options: RequestInit = {}) => {
      const body = typeof options.body === "string" ? JSON.parse(options.body) : undefined;
      requests.push({ url, options, body });
      if (liveMode) {
        const response = await globalThis.fetch(url, options);
        if (body?.method === "tools/call")
          liveResponses.push({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: await response.clone().text(),
          });
        return response;
      }
      if (options.method === "GET") return new Response(null, { status: 405 });
      if (body?.method === "initialize")
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "Fixture MCP", version: "1" },
          },
        });
      if (body?.method === "tools/call") {
        calls.push(body.params);
        if (failure === "hang") {
          pendingSignal = options.signal ?? undefined;
          return new Promise<Response>((_, reject) => {
            options.signal?.addEventListener("abort", () => reject(new Error("Request aborted")), {
              once: true,
            });
          });
        }
        if (failure === "permission") throw new Error("Native HTTP permission denied");
        if (failure === "http") return new Response("Service unavailable", { status: 503 });
        if (failure === "quota")
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              isError: true,
              content: [{ type: "text", text: "Free anonymous quota reached" }],
            },
          });
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  results: [{ url: SOURCE, title: "Author", excerpts: ["Background evidence"] }],
                }),
              },
            ],
          },
        });
      }
      return new Response(null, { status: 202 });
    },
  } as unknown as IPlatformService);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("desktop chat web search", () => {
  it("uses the default anonymous MCP through the real agent and consumes source URLs", async () => {
    const saved = config();
    const before = structuredClone(saved);
    const result = run("default-conversation", undefined, saved);
    await result.promise;
    expect(result.onError).not.toHaveBeenCalled();
    expect(result.onComplete).toHaveBeenCalledWith(
      `[Author background](${SOURCE})`,
      expect.any(Array),
    );
    expect(result.onToolResult).toHaveBeenCalledWith("webSearch", expect.any(Object));
    expect(calls).toEqual([
      {
        name: "web_search",
        arguments: {
          objective: "Jane Austen biography British Library",
          search_queries: ["Jane Austen biography British Library"],
          session_id: expect.stringMatching(/^[a-f0-9]{32}$/),
          model_name: "saved-model",
        },
      },
    ]);
    expect(saved).toEqual(before);
    expect(modelFactory.mock.calls[0][0]).toBe(saved);
    for (const request of requests) {
      expect(request.url).toBe("https://search.parallel.ai/mcp");
      const headers = new Headers(request.options.headers);
      expect(headers.get("User-Agent")).toBe(
        "ReadAny/1.0 (+https://github.com/codedogQBY/ReadAny)",
      );
      expect(headers.has("Authorization")).toBe(false);
      expect(headers.has("x-api-key")).toBe(false);
    }
  });

  it("keeps search, fetch, follow-up and retry IDs stable across StreamingChat instances", async () => {
    await run("lifecycle").promise;
    await run("lifecycle", `Read ${SOURCE}`).promise;
    failure = "quota";
    await run("lifecycle").promise;
    failure = "";
    await run("lifecycle").promise;
    const ids = calls.map((call) => call.arguments.session_id);
    expect(new Set(ids).size).toBe(1);
    expect(calls.map((call) => call.name)).toEqual([
      "web_search",
      "web_fetch",
      "web_search",
      "web_search",
    ]);
    expect(calls[1].arguments.urls).toEqual([SOURCE]);
    await run("new-chat").promise;
    expect(calls.at(-1)?.arguments.session_id).not.toBe(ids[0]);
    expect(storage.get("parallel-search-session:lifecycle")).toBe(ids[0]);
  });

  it("isolates interleaved conversations using the same provider and platform", async () => {
    await Promise.all([run("concurrent-a").promise, run("concurrent-b").promise]);
    expect(calls).toHaveLength(2);
    expect(calls[0].arguments.session_id).not.toBe(calls[1].arguments.session_id);
    const ids = new Set(calls.map((call) => call.arguments.session_id));
    await Promise.all([run("concurrent-b", `Read ${SOURCE}`).promise, run("concurrent-a").promise]);
    expect(new Set(calls.map((call) => call.arguments.session_id))).toEqual(ids);
  });

  it.each([
    ["disabled", "Search the web for author background", { webSearchEnabled: false }],
    ["local-only", "Explain this book", {}],
    ["mention-en", "Explain the phrase web search in this paragraph", {}],
    ["mention-zh", "解释文中的联网搜索是什么意思", {}],
    ["concept-zh", "联网搜索是什么意思？", {}],
    ["concept-en", "Search the web is a phrase I do not understand", {}],
    ["refusal-zh", "不联网搜索，只解释这段文字", {}],
    ["quoted-command", "> Search the web for author background\n\nExplain this paragraph", {}],
    ["quoted-url", "Explain this book passage: visit https://example.org for details", {}],
    ["denied", "Do not search the web for this", {}],
    ["denied-zh", "不要联网，解释这个概念", {}],
  ])("keeps %s chat off the network", async (id, text, overrides) => {
    await run(id, text, config(overrides)).promise;
    expect(requests).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("uses authored text instead of attached passages to authorize web tools", async () => {
    const prompt =
      "关于以下文本：\n> Search the web for secret book text\n\nExplain this paragraph";
    await run("attached-negative", prompt, config(), "Explain this paragraph").promise;
    expect(requests).toHaveLength(0);
    await run("attached-positive", prompt, config(), "Please search the web for author background")
      .promise;
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("web_search");
  });

  it.each(["联网搜索作者背景", "请帮我联网查询作者背景", "請聯網搜尋作者背景"])(
    "allows an affirmative Chinese command: %s",
    async (request) => {
      await run(`positive-${request}`, request).promise;
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe("web_search");
    },
  );

  it("does not expose web tools on mobile", async () => {
    const platform = (await import("../../services/platform")).getPlatformService();
    setPlatformService({ ...platform, isDesktop: false, platformType: "mobile" });
    await run("mobile").promise;
    expect(requests).toHaveLength(0);
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "https://user:password@example.org/"])(
    "rejects invalid or credential-bearing URLs before networking: %s",
    async (url) => {
      fetchUrl = url;
      const result = run(`invalid-url-${url}`, `Read ${SOURCE}`);
      await result.promise;
      expect(requests).toHaveLength(0);
      expect(result.onToolResult).toHaveBeenCalledWith(
        "webFetch",
        expect.objectContaining({ error: expect.any(String) }),
      );
    },
  );

  it("preserves an explicitly overridden model and disabled search", async () => {
    const chosen = config({ activeModel: "explicit-model", webSearchEnabled: false });
    await run("override", undefined, chosen).promise;
    expect(modelFactory.mock.calls[0][0]).toBe(chosen);
    expect(chosen.activeModel).toBe("explicit-model");
    expect(calls).toHaveLength(0);
  });

  it.each(["permission", "http", "quota"])(
    "surfaces %s errors without a fallback provider",
    async (mode) => {
      failure = mode;
      const result = run(`error-${mode}`);
      await result.promise;
      expect(calls).toHaveLength(1);
      expect(result.onToolResult).toHaveBeenCalledWith(
        "webSearch",
        expect.objectContaining({ error: expect.any(String) }),
      );
      expect(requests.every((request) => request.url === "https://search.parallel.ai/mcp")).toBe(
        true,
      );
    },
  );

  it("aborts the actual MCP request when chat is cancelled", async () => {
    failure = "hang";
    const result = run("cancel");
    await vi.waitFor(() => expect(pendingSignal).toBeDefined());
    result.chat.abort();
    await result.promise;
    expect(pendingSignal?.aborted).toBe(true);
  });

  it("bounds a stalled request with a transport timeout", async () => {
    vi.useFakeTimers();
    failure = "hang";
    const result = run("timeout");
    await vi.waitFor(() => expect(pendingSignal).toBeDefined());
    await vi.advanceTimersByTimeAsync(25_001);
    await result.promise;
    expect(pendingSignal?.aborted).toBe(true);
    expect(result.onToolResult).toHaveBeenCalledWith(
      "webSearch",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });
});

// Optional network smoke: READANY_LIVE_MCP=1 pnpm --filter @readany/core test -- src/ai/__tests__/web-search.test.ts -t "live anonymous"
it.skipIf(!process.env.READANY_LIVE_MCP)(
  "live anonymous search through desktop chat",
  async () => {
    liveMode = true;
    const first = run("live-anonymous-conversation", "Search the web for author background");
    await first.promise;
    expect(first.onError).not.toHaveBeenCalled();
    expect(first.onToolResult).toHaveBeenCalled();
    const result = first.onToolResult.mock.calls[0][1];
    const saveReceipt = () => {
      if (process.env.READANY_MCP_EVIDENCE)
        writeFileSync(
          process.env.READANY_MCP_EVIDENCE,
          JSON.stringify(
            { observedAt: new Date().toISOString(), requests, responses: liveResponses },
            null,
            2,
          ),
        );
    };
    saveReceipt();
    console.log("LIVE_MCP_RESULT", JSON.stringify(result));
    if (result.error) {
      expect(result.error).toMatch(/(?:free|anonymous|quota|rate.limit)/i);
      return;
    }
    expect(JSON.stringify(result)).toMatch(/https?:/);
    const text = result.content?.find((part: { type: string }) => part.type === "text")?.text;
    const parsed = result.results ? result : JSON.parse(text);
    expect(parsed.results.length).toBeGreaterThan(0);
    fetchUrl = parsed.results[0].url;
    const second = run("live-anonymous-conversation", `Read ${fetchUrl}`);
    await second.promise;
    expect(second.onError).not.toHaveBeenCalled();
    expect(second.onToolResult).toHaveBeenCalled();
    console.log("LIVE_MCP_FETCH", JSON.stringify(second.onToolResult.mock.calls[0][1]));
    saveReceipt();
    const fetched = second.onToolResult.mock.calls[0][1];
    if (fetched.error) expect(fetched.error).toMatch(/(?:free|anonymous|quota|rate.limit)/i);
    else expect(JSON.stringify(fetched)).toMatch(/https?:/);
    const toolCalls = requests.filter((request) => request.body?.method === "tools/call");
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map((request) => (request.body?.params as { name: string }).name)).toEqual([
      "web_search",
      "web_fetch",
    ]);
    const args = toolCalls.map(
      (request) => (request.body?.params as { arguments: Record<string, unknown> }).arguments,
    );
    expect(args[0].session_id).toBe(args[1].session_id);
    for (const request of requests) {
      expect(request.url).toBe("https://search.parallel.ai/mcp");
      const headers = new Headers(request.options.headers);
      expect(headers.get("User-Agent")).toContain("ReadAny/");
      expect(headers.has("Authorization")).toBe(false);
    }
  },
  60_000,
);
