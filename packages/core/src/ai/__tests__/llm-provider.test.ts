import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIEndpoint } from "../../types";
import { getEndpointFetch } from "../llm-provider";

const originalFetch = globalThis.fetch;

function makeEndpoint(overrides: Partial<AIEndpoint> = {}): AIEndpoint {
  return {
    id: "endpoint-1",
    name: "Test",
    provider: "custom",
    apiKey: "test-key",
    baseUrl: "https://api.example.com/v1/chat/completions",
    useExactRequestUrl: true,
    models: ["test-model"],
    modelsFetched: true,
    ...overrides,
  };
}

function makeToolCall(extraContent?: Record<string, unknown>) {
  return {
    id: "call_1",
    type: "function",
    function: {
      name: "getCurrentChapter",
      arguments: "{}",
    },
    ...(extraContent ? { extra_content: extraContent } : {}),
  };
}

function getFirstToolCall(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages as Array<Record<string, unknown>>;
  const toolCalls = messages[0].tool_calls as Array<Record<string, unknown>>;
  return toolCalls[0];
}

async function captureRequestBody(
  endpoint: AIEndpoint,
  model: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let capturedBody = "";
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body === "string") {
      capturedBody = init.body;
    } else if (input instanceof Request) {
      capturedBody = await input.clone().text();
    }

    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const endpointFetch = getEndpointFetch(endpoint, model);
  await endpointFetch(endpoint.baseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return JSON.parse(capturedBody) as Record<string, unknown>;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getEndpointFetch Gemini thought signatures", () => {
  it("adds a Gemini thought signature bypass for gemini-3 OpenAI-compatible tool calls", async () => {
    const patchedBody = await captureRequestBody(
      makeEndpoint({ models: ["gemini-3-flash-preview"] }),
      "gemini-3-flash-preview",
      {
        messages: [
          {
            role: "assistant",
            content: "",
            tool_calls: [makeToolCall()],
          },
        ],
      },
    );

    const toolCall = getFirstToolCall(patchedBody);
    const extraContent = toolCall.extra_content as Record<string, Record<string, string>>;
    expect(extraContent.google.thought_signature).toBe("skip_thought_signature_validator");
  });

  it("preserves an existing Gemini thought signature", async () => {
    const patchedBody = await captureRequestBody(
      makeEndpoint({
        provider: "google",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      }),
      "gemini-3-flash-preview",
      {
        messages: [
          {
            role: "assistant",
            content: "",
            tool_calls: [
              makeToolCall({
                google: {
                  thought_signature: "real-signature",
                },
              }),
            ],
          },
        ],
      },
    );

    const toolCall = getFirstToolCall(patchedBody);
    const extraContent = toolCall.extra_content as Record<string, Record<string, string>>;
    expect(extraContent.google.thought_signature).toBe("real-signature");
  });

  it("does not modify non-Gemini OpenAI-compatible requests", async () => {
    const patchedBody = await captureRequestBody(
      makeEndpoint({
        baseUrl: "https://api.openai.com/v1/chat/completions",
        models: ["gpt-4o-mini"],
      }),
      "gpt-4o-mini",
      {
        messages: [
          {
            role: "assistant",
            content: "",
            tool_calls: [makeToolCall()],
          },
        ],
      },
    );

    const toolCall = getFirstToolCall(patchedBody);
    expect(toolCall.extra_content).toBeUndefined();
  });
});

describe("getEndpointFetch custom endpoint compatibility", () => {
  it("retries without token limit when a custom endpoint rejects max_completion_tokens over 100", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      let bodyText = "";
      if (typeof init?.body === "string") {
        bodyText = init.body;
      } else if (input instanceof Request) {
        bodyText = await input.clone().text();
      }
      requestBodies.push(JSON.parse(bodyText) as Record<string, unknown>);

      if (requestBodies.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: "参数错误超过100个",
              type: "invalid_request_error",
            },
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const endpoint = makeEndpoint();
    const endpointFetch = getEndpointFetch(endpoint, "gpt-5.5");
    const response = await endpointFetch(endpoint.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "总结我最近的阅读" }],
        max_completion_tokens: 4096,
        tools: [
          {
            type: "function",
            function: {
              name: "getReadingStats",
              parameters: {
                type: "object",
                properties: {
                  reasoning: { type: "string" },
                  days: { type: "number" },
                },
              },
            },
          },
        ],
      }),
    });

    expect(response.ok).toBe(true);
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.max_completion_tokens).toBe(4096);
    expect(requestBodies[1]?.max_completion_tokens).toBeUndefined();
    expect(requestBodies[1]?.messages).toEqual(requestBodies[0]?.messages);
    expect(requestBodies[1]?.tools).toEqual(requestBodies[0]?.tools);
  });
});
