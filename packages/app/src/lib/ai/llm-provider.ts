/**
 * LLM Provider Factory — creates LangChain ChatModel instances from AIConfig
 *
 * Supports:
 * - OpenAI-compatible endpoints (OpenAI, Ollama, vLLM, DeepSeek, etc.)
 * - Anthropic Claude (native API with extended thinking support)
 * - Google Gemini (native API)
 */
import type { AIConfig, AIEndpoint } from "@/types";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

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
  const endpoint = config.endpoints.find(
    (ep) => ep.id === config.activeEndpointId,
  );
  if (!endpoint) {
    throw new Error("No active AI endpoint configured. Go to Settings → AI to add one.");
  }
  if (!endpoint.apiKey) {
    throw new Error(`API key not set for endpoint "${endpoint.name}".`);
  }
  const model = config.activeModel;
  if (!model) {
    throw new Error("No model selected. Go to Settings → AI to choose a model.");
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
  if (!endpoint.apiKey) {
    throw new Error(`API key not set for endpoint "${endpoint.name}".`);
  }

  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 4096;
  const streaming = options.streaming ?? true;

  switch (endpoint.provider) {
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      
      return new ChatAnthropic({
        model,
        apiKey: endpoint.apiKey,
        temperature,
        maxTokens,
        streaming,
        clientOptions: endpoint.baseUrl
          ? { baseURL: endpoint.baseUrl }
          : undefined,
      });
    }

    case "google": {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      
      return new ChatGoogleGenerativeAI({
        model,
        apiKey: endpoint.apiKey,
        temperature,
        maxOutputTokens: maxTokens,
        streaming,
      });
    }

    case "openai":
    default: {
      const { ChatOpenAI } = await import("@langchain/openai");
      
      return new ChatOpenAI({
        model,
        apiKey: endpoint.apiKey,
        configuration: {
          baseURL: endpoint.baseUrl || undefined,
        },
        temperature,
        maxTokens,
        streaming,
      });
    }
  }
}
