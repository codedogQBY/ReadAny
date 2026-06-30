import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AIConfig, AIEndpoint } from "../types";
import { providerRequiresApiKey } from "../utils";
import { formatApiHost } from "../utils/api";
import { logAIEndpointDebug, summarizeDebugText } from "./request-debug";

/**
 * Optional custom fetch for streaming support (e.g. expo/fetch in React Native).
 * Set via setStreamingFetch() before creating chat models.
 */
let _streamingFetch: typeof globalThis.fetch | undefined;

export function setStreamingFetch(fetchImpl: typeof globalThis.fetch) {
  _streamingFetch = fetchImpl;
}

function isRequestLike(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function isURLLike(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function resolveRequestUrl(input: RequestInfo | URL, exactUrl?: string): string {
  if (exactUrl) return exactUrl;
  if (isRequestLike(input)) return input.url;
  if (isURLLike(input)) return input.toString();
  return typeof input === "string" ? input : String(input);
}

function shouldSanitizeCustomHeaders(endpoint: AIEndpoint): boolean {
  return endpoint.provider === "custom";
}

function mergeRequestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers | undefined {
  const merged = new Headers();
  let hasHeaders = false;

  if (isRequestLike(input)) {
    for (const [key, value] of input.headers.entries()) {
      merged.set(key, value);
      hasHeaders = true;
    }
  }

  if (init?.headers) {
    for (const [key, value] of new Headers(init.headers).entries()) {
      merged.set(key, value);
      hasHeaders = true;
    }
  }

  return hasHeaders ? merged : undefined;
}

function sanitizeCustomHeaders(headers?: Headers): Headers | undefined {
  if (!headers) return undefined;

  const sanitized = new Headers();
  for (const key of ["accept", "authorization", "content-type"]) {
    const value = headers.get(key);
    if (value) sanitized.set(key, value);
  }

  return sanitized;
}

const GEMINI_THOUGHT_SIGNATURE_BYPASS = "skip_thought_signature_validator";

function shouldPatchGeminiThoughtSignatures(
  endpoint: AIEndpoint,
  model: string | undefined,
  requestUrl: string,
): boolean {
  const modelName = model?.toLowerCase() ?? "";
  const targetUrl = `${requestUrl} ${endpoint.baseUrl ?? ""}`.toLowerCase();

  return (
    endpoint.provider === "google" ||
    targetUrl.includes("generativelanguage.googleapis.com") ||
    modelName.startsWith("gemini-3")
  );
}

function hasGeminiThoughtSignature(toolCall: Record<string, unknown>): boolean {
  const extraContent = toolCall.extra_content;
  if (!extraContent || typeof extraContent !== "object") return false;

  const google = (extraContent as Record<string, unknown>).google;
  if (!google || typeof google !== "object") return false;

  return typeof (google as Record<string, unknown>).thought_signature === "string";
}

function patchGeminiThoughtSignatureBody(bodyText: string): string | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return undefined;
  }

  if (!payload || typeof payload !== "object") return undefined;

  const messages = (payload as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) return undefined;

  let changed = false;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;

    const messageRecord = message as Record<string, unknown>;
    if (messageRecord.role !== "assistant") continue;

    const toolCalls = messageRecord.tool_calls;
    if (!Array.isArray(toolCalls)) continue;

    const firstFunctionToolCall = toolCalls.find(
      (toolCall): toolCall is Record<string, unknown> =>
        Boolean(toolCall) &&
        typeof toolCall === "object" &&
        (toolCall as Record<string, unknown>).type === "function",
    );
    if (!firstFunctionToolCall || hasGeminiThoughtSignature(firstFunctionToolCall)) continue;

    const extraContent =
      typeof firstFunctionToolCall.extra_content === "object" &&
      firstFunctionToolCall.extra_content !== null
        ? { ...(firstFunctionToolCall.extra_content as Record<string, unknown>) }
        : {};
    const google =
      typeof extraContent.google === "object" && extraContent.google !== null
        ? { ...(extraContent.google as Record<string, unknown>) }
        : {};

    firstFunctionToolCall.extra_content = {
      ...extraContent,
      google: {
        ...google,
        thought_signature: GEMINI_THOUGHT_SIGNATURE_BYPASS,
      },
    };
    changed = true;
  }

  return changed ? JSON.stringify(payload) : undefined;
}

async function patchGeminiThoughtSignatureRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ input: RequestInfo | URL; init?: RequestInit } | undefined> {
  if (typeof init?.body === "string") {
    const body = patchGeminiThoughtSignatureBody(init.body);
    if (!body) return undefined;

    const headers = init.headers ? new Headers(init.headers) : undefined;
    headers?.delete("content-length");

    return {
      input,
      init: {
        ...init,
        ...(headers ? { headers } : {}),
        body,
      },
    };
  }

  if (!isRequestLike(input)) return undefined;

  let sourceBody: string;
  try {
    sourceBody = await input.clone().text();
  } catch {
    return undefined;
  }

  const body = patchGeminiThoughtSignatureBody(sourceBody);
  if (!body) return undefined;

  const headers = new Headers(input.headers);
  headers.delete("content-length");

  return {
    input: new Request(input, { body, headers }),
    init,
  };
}

export function getEndpointFetch(endpoint: AIEndpoint, model?: string): typeof globalThis.fetch {
  const exactUrl = endpoint.useExactRequestUrl ? endpoint.baseUrl?.trim() : "";
  const baseFetch = (_streamingFetch ?? globalThis.fetch).bind(globalThis);

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const finalInput = isRequestLike(input)
      ? exactUrl
        ? new Request(exactUrl, input)
        : input
      : exactUrl || input;
    const requestUrl = resolveRequestUrl(input, exactUrl || undefined);
    const requestMethod =
      init?.method || (isRequestLike(finalInput) ? finalInput.method : undefined) || "GET";
    let requestInput = finalInput;
    let requestInit = init;

    if (shouldSanitizeCustomHeaders(endpoint)) {
      const sanitizedHeaders = sanitizeCustomHeaders(mergeRequestHeaders(finalInput, init));
      if (sanitizedHeaders) {
        if (isRequestLike(requestInput)) {
          requestInput = new Request(requestInput, { headers: sanitizedHeaders });
          requestInit = init ? { ...init, headers: sanitizedHeaders } : undefined;
        } else {
          requestInit = { ...(init ?? {}), headers: sanitizedHeaders };
        }
      }
    }

    if (
      requestMethod.toUpperCase() === "POST" &&
      shouldPatchGeminiThoughtSignatures(endpoint, model, requestUrl)
    ) {
      const patched = await patchGeminiThoughtSignatureRequest(requestInput, requestInit);
      if (patched) {
        requestInput = patched.input;
        requestInit = patched.init;
      }
    }

    logAIEndpointDebug("request", endpoint, {
      action: "langchain-chat",
      method: requestMethod,
      requestUrl,
      model,
    });

    try {
      const response = await baseFetch(requestInput, requestInit);
      const contentType = response.headers.get("content-type");

      if (!response.ok) {
        let responseBodyPreview = "";
        let responseLength: number | undefined;

        try {
          const responseText = await response.clone().text();
          responseLength = responseText.length;
          responseBodyPreview = summarizeDebugText(responseText, 600);
        } catch (readError) {
          responseBodyPreview = summarizeDebugText(
            readError instanceof Error ? readError.message : String(readError),
            200,
          );
        }

        logAIEndpointDebug("error", endpoint, {
          action: "langchain-chat",
          method: requestMethod,
          requestUrl,
          model,
          status: response.status,
          statusText: response.statusText,
          contentType,
          responseLength,
          responseBodyPreview,
        });
        return response;
      }

      logAIEndpointDebug("response", endpoint, {
        action: "langchain-chat",
        method: requestMethod,
        requestUrl,
        model,
        status: response.status,
        statusText: response.statusText,
        contentType,
      });

      return response;
    } catch (error) {
      logAIEndpointDebug("error", endpoint, {
        action: "langchain-chat",
        method: requestMethod,
        requestUrl,
        model,
        responseBodyPreview: summarizeDebugText(
          error instanceof Error ? error.message : String(error),
          200,
        ),
      });
      throw error;
    }
  }) as typeof globalThis.fetch;
}

function getEndpointBaseUrl(endpoint: AIEndpoint): string | undefined {
  if (!endpoint.baseUrl) return undefined;
  return endpoint.useExactRequestUrl ? endpoint.baseUrl.trim() : formatApiHost(endpoint.baseUrl);
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
  deepThinking?: boolean;
}

export function resolveActiveEndpoint(config: AIConfig): {
  endpoint: AIEndpoint;
  model: string;
} {
  const endpoint = config.endpoints.find((ep) => ep.id === config.activeEndpointId);
  if (!endpoint) {
    throw new Error("No active AI endpoint configured. Go to Settings → AI to add one.");
  }
  if (providerRequiresApiKey(endpoint.provider) && !endpoint.apiKey) {
    throw new Error(`API key not set for endpoint "${endpoint.name}".`);
  }
  let model = config.activeModel;
  if (!model) {
    // Try to auto-select first available model from endpoint
    if (endpoint.models && endpoint.models.length > 0) {
      model = endpoint.models[0];
    } else if (providerRequiresApiKey(endpoint.provider) && !endpoint.apiKey) {
      throw new Error("API key not configured. Go to Settings → AI to set up your API key.");
    } else {
      throw new Error(
        "No models available. Go to Settings → AI and click 'Fetch Models' to get available models.",
      );
    }
  }
  return { endpoint, model };
}

export async function createChatModel(
  config: AIConfig,
  options: LLMOptions = {},
): Promise<BaseChatModel> {
  const { endpoint, model } = resolveActiveEndpoint(config);
  return createChatModelFromEndpoint(endpoint, model, {
    temperature: options.temperature ?? config.temperature,
    maxTokens: options.maxTokens ?? config.maxTokens,
    streaming: options.streaming,
    deepThinking: options.deepThinking,
  });
}

export async function createChatModelFromEndpoint(
  endpoint: AIEndpoint,
  model: string,
  options: LLMOptions = {},
): Promise<BaseChatModel> {
  if (providerRequiresApiKey(endpoint.provider) && !endpoint.apiKey) {
    throw new Error(`API key not set for endpoint "${endpoint.name}".`);
  }
  if (!model) {
    throw new Error("No model specified. Go to Settings → AI to choose a model.");
  }

  const apiKey = endpoint.apiKey || "local-model";

  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 4096;
  const streaming = options.streaming ?? true;
  const endpointFetch = getEndpointFetch(endpoint, model);

  switch (endpoint.provider) {
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");

      const anthropicConfig: Record<string, unknown> = {
        model,
        apiKey,
        temperature: options.deepThinking ? 1 : temperature,
        maxTokens,
        streaming,
        clientOptions: {
          ...(endpoint.baseUrl ? { baseURL: endpoint.baseUrl } : {}),
          fetch: endpointFetch,
        },
      };

      // Enable extended thinking when deepThinking is requested
      if (options.deepThinking) {
        anthropicConfig.thinking = {
          type: "enabled",
          budget_tokens: Math.min(maxTokens, 10000),
        };
      }

      return new ChatAnthropic(anthropicConfig as ConstructorParameters<typeof ChatAnthropic>[0]);
    }

    case "google": {
      // Use OpenAI-compatible endpoint for Gemini — this allows injecting
      // custom fetch (required for streaming on React Native/Android where
      // globalThis.fetch doesn't support response.body streaming).
      // Gemini's OpenAI-compatible endpoint: https://generativelanguage.googleapis.com/v1beta/openai
      const { ChatOpenAI } = await import("@langchain/openai");

      // Ensure the base URL ends with /v1beta/openai for Google's OpenAI-compatible API
      let geminiBaseUrl: string;
      if (endpoint.useExactRequestUrl && endpoint.baseUrl) {
        geminiBaseUrl = endpoint.baseUrl.trim();
      } else {
        const rawBase = (endpoint.baseUrl || "https://generativelanguage.googleapis.com").replace(
          /\/+$/,
          "",
        );
        geminiBaseUrl = rawBase.includes("/v1beta/openai") ? rawBase : `${rawBase}/v1beta/openai`;
      }

      return new ChatOpenAI({
        model,
        apiKey,
        configuration: {
          baseURL: geminiBaseUrl,
          fetch: endpointFetch,
        },
        __includeRawResponse: true,
        modelKwargs: {
          extra_body: {
            google: {
              thinking_config: {
                thinking_level: "low",
                include_thoughts: true,
              },
            },
          },
        },
        temperature,
        maxTokens,
        streaming,
      });
    }

    case "deepseek": {
      const { ChatDeepSeek } = await import("@langchain/deepseek");

      // Create a subclass that fixes the missing reasoning_content issue.
      // Bug: @langchain/deepseek stores reasoning_content in additional_kwargs
      // when receiving, but doesn't inject it back when sending requests.
      // DeepSeek API requires reasoning_content on every assistant message
      // during tool-calling loops, or it returns a 400 error.
      class ChatDeepSeekFixed extends ChatDeepSeek {
        private _reasoningMap = new Map<number, string>();

        // biome-ignore lint: override needs any
        async _generate(messages: any[], options: any, runManager?: any) {
          this._buildReasoningMap(messages);
          return super._generate(messages, options, runManager);
        }

        // biome-ignore lint: override needs any
        async *_streamResponseChunks(messages: any[], options: any, runManager?: any) {
          this._buildReasoningMap(messages);
          yield* super._streamResponseChunks(messages, options, runManager);
        }

        // biome-ignore lint: override needs any
        // @ts-expect-error -- overloaded signature; runtime type is correct
        async completionWithRetry(request: any, requestOptions?: any) {
          // Inject reasoning_content into assistant messages in the API request
          if (request.messages && this._reasoningMap.size > 0) {
            let assistantIdx = 0;
            for (const msg of request.messages) {
              if (msg.role === "assistant") {
                const reasoning = this._reasoningMap.get(assistantIdx);
                if (reasoning !== undefined) {
                  msg.reasoning_content = reasoning;
                }
                assistantIdx++;
              }
            }
          }
          return super.completionWithRetry(request, requestOptions);
        }

        // biome-ignore lint: messages is BaseMessage[]
        private _buildReasoningMap(messages: any[]) {
          this._reasoningMap.clear();
          let assistantIdx = 0;
          for (const msg of messages) {
            if (
              msg._getType?.() === "ai" ||
              msg.constructor?.name === "AIMessage" ||
              msg.constructor?.name === "AIMessageChunk"
            ) {
              const reasoning = msg.additional_kwargs?.reasoning_content;
              if (typeof reasoning === "string") {
                this._reasoningMap.set(assistantIdx, reasoning);
              }
              assistantIdx++;
            }
          }
        }
      }

      return new ChatDeepSeekFixed({
        model,
        apiKey,
        configuration: {
          ...(endpoint.baseUrl ? { baseURL: getEndpointBaseUrl(endpoint) } : {}),
          fetch: endpointFetch,
        },
        temperature,
        maxTokens,
        streaming,
      } as ConstructorParameters<typeof ChatDeepSeek>[0]);
    }

    default: {
      const isDeepSeek =
        endpoint.baseUrl?.includes("deepseek") ||
        model?.toLowerCase().includes("deepseek") ||
        model?.toLowerCase().includes("reasoner");

      if (isDeepSeek) {
        const { ChatDeepSeek } = await import("@langchain/deepseek");

        class ChatDeepSeekFixed extends ChatDeepSeek {
          private _reasoningMap = new Map<number, string>();

          // biome-ignore lint: override needs any
          async _generate(messages: any[], options: any, runManager?: any) {
            this._buildReasoningMap(messages);
            return super._generate(messages, options, runManager);
          }

          // biome-ignore lint: override needs any
          async *_streamResponseChunks(messages: any[], options: any, runManager?: any) {
            this._buildReasoningMap(messages);
            yield* super._streamResponseChunks(messages, options, runManager);
          }

          // biome-ignore lint: override needs any
          // @ts-expect-error -- overloaded signature; runtime type is correct
          async completionWithRetry(request: any, requestOptions?: any) {
            if (request.messages && this._reasoningMap.size > 0) {
              let assistantIdx = 0;
              for (const msg of request.messages) {
                if (msg.role === "assistant") {
                  const reasoning = this._reasoningMap.get(assistantIdx);
                  if (reasoning !== undefined) {
                    msg.reasoning_content = reasoning;
                  }
                  assistantIdx++;
                }
              }
            }
            return super.completionWithRetry(request, requestOptions);
          }

          // biome-ignore lint: messages is BaseMessage[]
          private _buildReasoningMap(messages: any[]) {
            this._reasoningMap.clear();
            let assistantIdx = 0;
            for (const msg of messages) {
              if (
                msg._getType?.() === "ai" ||
                msg.constructor?.name === "AIMessage" ||
                msg.constructor?.name === "AIMessageChunk"
              ) {
                const reasoning = msg.additional_kwargs?.reasoning_content;
                if (typeof reasoning === "string") {
                  this._reasoningMap.set(assistantIdx, reasoning);
                }
                assistantIdx++;
              }
            }
          }
        }

        return new ChatDeepSeekFixed({
          model,
          apiKey,
          configuration: {
            ...(endpoint.baseUrl ? { baseURL: getEndpointBaseUrl(endpoint) } : {}),
            fetch: endpointFetch,
          },
          temperature,
          maxTokens,
          streaming,
        } as ConstructorParameters<typeof ChatDeepSeek>[0]);
      }

      const { ChatOpenAI } = await import("@langchain/openai");

      // For Ollama / LM Studio, pass `think: true` so reasoning models
      // (e.g. Qwen3, DeepSeek-R1) return their thinking process.
      const isLocalProvider = endpoint.provider === "ollama" || endpoint.provider === "lmstudio";

      return new ChatOpenAI({
        model,
        apiKey,
        configuration: {
          baseURL: getEndpointBaseUrl(endpoint),
          fetch: endpointFetch,
        },
        temperature,
        maxTokens,
        streaming,
        ...(isLocalProvider ? { modelKwargs: { think: true } } : {}),
      });
    }
  }
}
