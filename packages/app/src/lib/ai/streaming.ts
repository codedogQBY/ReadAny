import type { AIConfig, Book, SemanticContext, Skill, Thread } from "@/types";
import { createOpenAI } from "@ai-sdk/openai";
/**
 * AI Streaming service — handles streaming chat completions
 * Uses Vercel AI SDK's streamText for unified model support
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

export class StreamingChat {
  private abortController: AbortController | null = null;

  /** Start a streaming chat completion */
  async stream(options: StreamingOptions): Promise<void> {
    this.abortController = new AbortController();

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

    // Create the provider
    const provider = createOpenAI({
      apiKey: options.aiConfig.apiKey,
      baseURL: options.aiConfig.baseUrl,
    });

    try {
      const result = streamText({
        model: provider(options.aiConfig.model),
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
