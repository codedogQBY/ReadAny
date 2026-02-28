/**
 * AI Streaming service — handles streaming chat completions
 * Uses LangGraph reading agent for unified model support with tool calling.
 * Supports OpenAI-compatible, Anthropic Claude, and Google Gemini providers.
 */
import type { AIConfig, Book, SemanticContext, Skill, Thread } from "@/types";
import { streamReadingAgent } from "./agents/reading-agent";
import { processMessages } from "./message-pipeline";

export interface StreamingOptions {
  thread: Thread;
  book: Book | null;
  semanticContext: SemanticContext | null;
  enabledSkills: Skill[];
  isVectorized: boolean;
  aiConfig: AIConfig;
  deepThinking?: boolean;
  onToken: (token: string) => void;
  onComplete: (
    fullText: string,
    toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: unknown }>,
  ) => void;
  onError: (error: Error) => void;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
  onReasoning?: (content: string, type?: "thinking" | "planning" | "analyzing" | "deciding") => void;
}

export class StreamingChat {
  private aborted = false;

  async stream(options: StreamingOptions): Promise<void> {
    this.aborted = false;

    const { messages } = processMessages(
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

    const userInput = messages[messages.length - 1]?.content || "";
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    try {
      let fullText = "";
      const toolCalls: Array<{ name: string; args: Record<string, unknown>; result?: unknown }> =
        [];

      const stream = streamReadingAgent(
        {
          aiConfig: options.aiConfig,
          book: options.book,
          semanticContext: options.semanticContext,
          enabledSkills: options.enabledSkills,
          isVectorized: options.isVectorized,
          deepThinking: options.deepThinking,
        },
        userInput,
        history,
      );

      for await (const event of stream) {
        if (this.aborted) return;

        switch (event.type) {
          case "token":
            fullText += event.content;
            options.onToken(event.content);
            break;

          case "tool_call":
            options.onToolCall?.(event.name, event.args);
            toolCalls.push({ name: event.name, args: event.args });
            break;

          case "tool_result":
            options.onToolResult?.(event.name, event.result);
            // Find the last tool call with matching name that doesn't have a result yet
            const existingTc = [...toolCalls]
              .reverse()
              .find((tc) => tc.name === event.name && !tc.result);
            if (existingTc) existingTc.result = event.result;
            break;

          case "reasoning":
            options.onReasoning?.(event.content, event.stepType);
            break;

          case "citation":
            break;

          case "error":
            options.onError(new Error(event.error));
            break;
        }
      }

      if (!this.aborted) {
        options.onComplete(fullText, toolCalls.length > 0 ? toolCalls : undefined);
      }
    } catch (error) {
      if (this.aborted) return;
      options.onError(error as Error);
    }
  }

  abort(): void {
    this.aborted = true;
  }
}

export function createMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
