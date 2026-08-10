import i18n from "i18next";
/**
 * AI Streaming service — handles streaming chat completions
 * Uses LangGraph reading agent for unified model support with tool calling.
 * Supports OpenAI-compatible, Anthropic Claude, and Google Gemini providers.
 */
import type { AIConfig, Book, SemanticContext, Skill, Thread } from "../types";
import { streamReadingAgent } from "./agents/reading-agent";
import { processMessages } from "./message-pipeline";
import { getToolResultError } from "./tool-result";
import type { ToolDefinition } from "./tools/tool-types";

export interface StreamingOptions {
  thread: Thread;
  book: Book | null;
  bookId?: string | null;
  semanticContext: SemanticContext | null;
  enabledSkills: Skill[];
  isVectorized: boolean;
  aiConfig: AIConfig;
  deepThinking?: boolean;
  spoilerFree?: boolean;
  /** Injected tool provider */
  getAvailableTools: (options: {
    bookId: string | null;
    isVectorized: boolean;
    enabledSkills: Skill[];
  }) => ToolDefinition[];
  onToken: (token: string) => void;
  onComplete: (
    fullText: string,
    toolCalls?: Array<{
      name: string;
      args: Record<string, unknown>;
      result?: unknown;
      error?: string;
    }>,
  ) => void;
  onAbort?: (
    fullText: string,
    toolCalls?: Array<{
      name: string;
      args: Record<string, unknown>;
      result?: unknown;
      error?: string;
    }>,
  ) => void;
  onError: (error: Error) => void;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
  onReasoning?: (
    content: string,
    type?: "thinking" | "planning" | "analyzing" | "deciding",
  ) => void;
  onCitation?: (citation: {
    id: string;
    bookId: string;
    chapterTitle: string;
    chapterIndex: number;
    cfi: string;
    text: string;
    citationIndex?: number;
  }) => void;
}

export class StreamingChat {
  private abortController: AbortController | null = null;

  async stream(options: StreamingOptions): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const { messages } = processMessages(
      options.thread,
      {
        book: options.book,
        bookId: options.book?.id || options.bookId || options.thread.bookId || null,
        semanticContext: options.semanticContext,
        enabledSkills: options.enabledSkills,
        isVectorized: options.isVectorized,
        userLanguage: i18n.language || options.book?.meta.language || "en",
        memorySummary: options.thread.memorySummary,
      },
      { slidingWindowSize: options.aiConfig.slidingWindowSize },
    );

    const userInput = messages[messages.length - 1]?.content || "";
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      reasoning: m.reasoning,
    }));

    try {
      let fullText = "";
      const toolCalls: Array<{
        name: string;
        args: Record<string, unknown>;
        result?: unknown;
        error?: string;
      }> = [];

      const stream = streamReadingAgent(
        {
          aiConfig: options.aiConfig,
          book: options.book,
          bookId: options.book?.id || options.bookId || options.thread.bookId || null,
          semanticContext: options.semanticContext,
          enabledSkills: options.enabledSkills,
          isVectorized: options.isVectorized,
          deepThinking: options.deepThinking,
          spoilerFree: options.spoilerFree,
          memorySummary: options.thread.memorySummary,
          getAvailableTools: options.getAvailableTools,
          signal,
        },
        userInput,
        history,
      );

      // Helper to race iterator next() against abort signal
      const raceNext = async (
        iterator: AsyncIterator<unknown>,
      ): Promise<IteratorResult<unknown>> => {
        if (signal.aborted) {
          return { done: true, value: undefined };
        }
        let onAbort: (() => void) | undefined;
        const abortPromise = new Promise<IteratorResult<unknown>>((resolve) => {
          const handler = () => {
            signal.removeEventListener("abort", handler);
            resolve({ done: true, value: undefined });
          };
          onAbort = handler;
          signal.addEventListener("abort", handler);
        });
        try {
          return await Promise.race([iterator.next(), abortPromise]);
        } finally {
          // iterator.next() usually wins. Remove its unused abort listener so a
          // long conversation does not accumulate one listener per event.
          if (onAbort) signal.removeEventListener("abort", onAbort);
        }
      };

      const iterator = stream[Symbol.asyncIterator]();
      let eventResult = await raceNext(iterator);

      while (!eventResult.done) {
        const event = eventResult.value as any;

        if (signal.aborted) {
          options.onAbort?.(fullText, toolCalls.length > 0 ? toolCalls : undefined);
          return;
        }

        switch (event.type) {
          case "token":
            fullText += event.content;
            options.onToken(event.content);
            break;

          case "tool_call":
            options.onToolCall?.(event.name, event.args);
            toolCalls.push({ name: event.name, args: event.args });
            break;

          case "tool_result": {
            options.onToolResult?.(event.name, event.result);
            const existingTc = [...toolCalls]
              .reverse()
              .find((tc) => tc.name === event.name && tc.result === undefined);
            if (existingTc) {
              existingTc.result = event.result;
              existingTc.error = getToolResultError(event.result) || undefined;
            }
            break;
          }

          case "reasoning":
            options.onReasoning?.(event.content, event.stepType);
            break;

          case "citation":
            options.onCitation?.(event.citation);
            break;

          case "error":
            options.onError(new Error(event.error));
            return;
        }

        eventResult = await raceNext(iterator);
      }

      // If loop exited due to abort, call onAbort
      if (signal.aborted) {
        options.onAbort?.(fullText, toolCalls.length > 0 ? toolCalls : undefined);
      } else {
        const incompleteToolCalls = toolCalls.filter((toolCall) => toolCall.result === undefined);
        if (incompleteToolCalls.length > 0) {
          options.onError(
            new Error(
              "The response stream ended before its tool call completed. Please try again.",
            ),
          );
          return;
        }
        options.onComplete(fullText, toolCalls.length > 0 ? toolCalls : undefined);
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      console.error("[StreamingChat] Error:", error);
      if (error instanceof Error) {
        console.error("[StreamingChat] Stack:", error.stack);
      }
      options.onError(error as Error);
    }
  }

  abort(): void {
    this.abortController?.abort();
  }
}

export function createMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
