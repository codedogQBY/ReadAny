import type { AIConfig, AIEndpoint, Book, SemanticContext, Skill, Thread } from "@/types";
/**
 * AI Streaming service — handles streaming chat completions
 * Uses Vercel AI SDK's streamText for unified model support.
 * Supports OpenAI-compatible, Anthropic Claude, and Google Gemini providers.
 */
import { streamText } from "ai";
import { processMessages } from "./message-pipeline";
import { getAvailableTools } from "./tools";

export interface StreamingOptions {
  thread: Thread;
  book: Book | null;
  semanticContext: SemanticContext | null;
  enabledSkills: Skill[];
  isVectorized: boolean;
  aiConfig: AIConfig;
  onToken: (token: string) => void;
  onComplete: (
    fullText: string,
    toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: unknown }>,
  ) => void;
  onError: (error: Error) => void;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
}

/** Resolve the active endpoint and model from AIConfig */
function resolveEndpoint(config: AIConfig) {
  const endpoint = config.endpoints.find((ep) => ep.id === config.activeEndpointId);
  if (!endpoint) throw new Error("No active AI endpoint configured");
  if (!endpoint.apiKey) throw new Error("API key not set for the active endpoint");
  if (!config.activeModel) throw new Error("No model selected");
  return { endpoint, model: config.activeModel };
}

/**
 * Create a Vercel AI SDK provider + model based on the endpoint's provider type.
 * Uses dynamic imports to avoid bundling unused SDKs.
 */
async function createAIModel(endpoint: AIEndpoint, model: string) {
  switch (endpoint.provider) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const provider = createAnthropic({
        apiKey: endpoint.apiKey,
        baseURL: endpoint.baseUrl || undefined,
        headers: {
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      return provider(model);
    }

    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const provider = createGoogleGenerativeAI({
        apiKey: endpoint.apiKey,
        baseURL: endpoint.baseUrl || undefined,
      });
      return provider(model);
    }

    case "openai":
    default: {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const provider = createOpenAI({
        apiKey: endpoint.apiKey,
        baseURL: endpoint.baseUrl || undefined,
      });
      return provider(model);
    }
  }
}

export class StreamingChat {
  private abortController: AbortController | null = null;

  /** Start a streaming chat completion */
  async stream(options: StreamingOptions): Promise<void> {
    this.abortController = new AbortController();

    const { endpoint, model } = resolveEndpoint(options.aiConfig);

    // Process messages through the pipeline
    const { systemPrompt, messages } = processMessages(
      options.thread,
      {
        book: options.book,
        semanticContext: options.semanticContext,
        enabledSkills: options.enabledSkills,
        isVectorized: options.isVectorized,
        userLanguage: options.book?.meta.language || "",
      },
      { slidingWindowSize: options.aiConfig.slidingWindowSize },
    );

    // Get available tools
    const toolDefs = getAvailableTools({
      bookId: options.book?.id || null,
      isVectorized: options.isVectorized,
      enabledSkills: options.enabledSkills,
    });

    // Store tool definitions for potential manual execution
    void toolDefs;

    // Create the AI model using the appropriate provider SDK
    const aiModel = await createAIModel(endpoint, model);

    try {
      const result = streamText({
        model: aiModel,
        system: systemPrompt,
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        temperature: options.aiConfig.temperature,
        maxTokens: options.aiConfig.maxTokens,
        abortSignal: this.abortController.signal,
      });

      let fullText = "";

      for await (const part of result.textStream) {
        fullText += part;
        options.onToken(part);
      }

      options.onComplete(fullText);
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return; // User cancelled
      }
      options.onError(error as Error);
    }
  }

  /** Abort the current stream */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}

/** Create a new message ID */
export function createMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a new thread ID */
export function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
