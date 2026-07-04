import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import i18n from "i18next";
import { z } from "zod";
/**
 * Reading Agent — AI-powered reading assistant using LangGraph ReAct agent
 *
 * Architecture:
 * 1. Uses LangGraph's createReactAgent for automatic tool-calling loop (no hard iteration limit)
 * 2. Uses getAvailableTools() to register all available tools
 * 3. Builds proper Zod schemas from ToolDefinition.parameters
 * 4. Real streaming via streamEvents API
 * 5. System prompt from system-prompt.ts
 */
import type { AIConfig, Book, SemanticContext, Skill } from "../../types";
import { createChatModel } from "../llm-provider";
import { buildSystemPrompt } from "../system-prompt";
import { ThinkTagStreamParser } from "../think-tag-parser";
import type { ToolDefinition, ToolParameter } from "../tools/tool-types";

// --- Stream Event Types ---

export type AgentStreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | {
      type: "reasoning";
      content: string;
      stepType: "thinking" | "planning" | "analyzing" | "deciding";
    }
  | {
      type: "citation";
      citation: {
        id: string;
        bookId: string;
        chapterTitle: string;
        chapterIndex: number;
        cfi: string;
        text: string;
        citationIndex?: number;
      };
    }
  | { type: "error"; error: string };

export interface ReadingAgentOptions {
  aiConfig: AIConfig;
  book: Book | null;
  bookId?: string | null;
  semanticContext: SemanticContext | null;
  enabledSkills: Skill[];
  isVectorized: boolean;
  deepThinking?: boolean;
  spoilerFree?: boolean;
  memorySummary?: string;
  /** Injected tool provider — returns available tools for the agent */
  getAvailableTools: (options: {
    bookId: string | null;
    isVectorized: boolean;
    enabledSkills: Skill[];
  }) => ToolDefinition[];
  /** Abort signal for immediate cancellation */
  signal?: AbortSignal;
}

// --- Build Zod schema from ToolDefinition.parameters ---

function buildZodSchema(
  parameters: Record<string, ToolParameter>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, param] of Object.entries(parameters)) {
    let fieldSchema: z.ZodTypeAny;

    switch (param.type) {
      case "number":
        fieldSchema = z.number().describe(param.description);
        break;
      case "boolean":
        fieldSchema = z.boolean().describe(param.description);
        break;
      default:
        fieldSchema = z.string().describe(param.description);
        break;
    }

    if (!param.required) {
      fieldSchema = fieldSchema.optional();
    }

    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

function countToolParameters(tools: ToolDefinition[]): number {
  return tools.reduce((sum, tool) => sum + Object.keys(tool.parameters ?? {}).length, 0);
}

// --- Tool Executor (error-safe wrapper) ---

async function executeTool(tool: ToolDefinition, args: Record<string, unknown>): Promise<unknown> {
  try {
    return await tool.execute(args);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function collectTextValues(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (!value || typeof value !== "object") return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextValues(item));
  }

  const record = value as Record<string, unknown>;
  const values: string[] = [];
  for (const key of ["text", "content", "summary", "value"]) {
    values.push(...collectTextValues(record[key]));
  }
  return values;
}

function extractGeminiThoughtSummariesFromRaw(rawResponse: unknown): string[] {
  if (!rawResponse || typeof rawResponse !== "object") return [];

  const summaries: string[] = [];
  const visit = (value: unknown, keyHint = "") => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, keyHint);
      return;
    }

    const record = value as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
    const key = keyHint.toLowerCase();
    const isThoughtSummary =
      type === "thought_summary" ||
      type === "thinking_summary" ||
      key === "thought_summary" ||
      key === "thinking_summary";

    if (isThoughtSummary) {
      summaries.push(
        ...collectTextValues(record.text ?? record.content ?? record.summary ?? value),
      );
    }

    for (const [childKey, childValue] of Object.entries(record)) {
      const normalizedKey = childKey.toLowerCase();
      if (normalizedKey === "thought_signature" || normalizedKey === "signature") continue;
      if (normalizedKey === "thought_summary" || normalizedKey === "thinking_summary") {
        summaries.push(...collectTextValues(childValue));
        continue;
      }
      visit(childValue, childKey);
    }
  };

  visit(rawResponse);
  return summaries.filter((summary) => summary.trim().length > 0);
}

// --- Main Agent Function ---

export async function* streamReadingAgent(
  options: ReadingAgentOptions,
  userInput: string,
  history: Array<{ role: "user" | "assistant"; content: string; reasoning?: string }> = [],
): AsyncGenerator<AgentStreamEvent> {
  const {
    aiConfig,
    book,
    bookId,
    semanticContext,
    enabledSkills,
    isVectorized,
    deepThinking,
    spoilerFree,
    memorySummary,
    getAvailableTools,
    signal,
  } = options;

  // Helper to check if aborted
  const isAborted = () => signal?.aborted ?? false;

  try {
    // Early abort check
    if (isAborted()) return;

    // Create chat model
    const model = await createChatModel(aiConfig, {
      temperature: deepThinking ? 1 : 0.7,
      maxTokens: aiConfig.maxTokens,
      streaming: true,
      deepThinking,
    });

    // Check abort after async operation
    if (isAborted()) return;

    // Register all available tools via injected getAvailableTools.
    const effectiveBookId = book?.id || bookId || null;
    const tools = getAvailableTools({
      bookId: effectiveBookId,
      isVectorized,
      enabledSkills,
    });
    console.log(
      "[ReadingAgent] tools",
      JSON.stringify({
        registered: tools.length,
        parameters: countToolParameters(tools),
        names: tools.map((tool) => tool.name),
      }),
    );

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
      book,
      bookId: effectiveBookId,
      semanticContext,
      enabledSkills,
      isVectorized,
      userLanguage: i18n.language || "en",
      spoilerFree,
      memorySummary,
    });

    // Build input messages (history + user input, without system — handled by agent prompt)
    // For DeepSeek reasoner, we must include reasoning_content in assistant messages
    // to avoid 400 errors during multi-turn tool-calling conversations.
    const activeEndpoint = aiConfig.endpoints.find((e) => e.id === aiConfig.activeEndpointId);
    const isDeepSeek =
      activeEndpoint?.provider === "deepseek" ||
      activeEndpoint?.baseUrl?.includes("deepseek") ||
      aiConfig.activeModel?.toLowerCase().includes("deepseek") ||
      aiConfig.activeModel?.toLowerCase().includes("reasoner");

    const inputMessages: BaseMessage[] = [
      ...history.map((h) => {
        if (h.role === "user") {
          return new HumanMessage(h.content);
        }
        // For DeepSeek, include reasoning_content in additional_kwargs
        if (isDeepSeek && h.reasoning) {
          return new AIMessage({
            content: h.content,
            additional_kwargs: { reasoning_content: h.reasoning },
          });
        }
        return new AIMessage(h.content);
      }),
      new HumanMessage(userInput),
    ];

    // If no tools available, stream directly without agent graph
    if (tools.length === 0) {
      const { SystemMessage } = await import("@langchain/core/messages");
      const allMessages = [new SystemMessage(systemPrompt), ...inputMessages];
      const stream = await model.stream(allMessages);
      const thinkTagParser = new ThinkTagStreamParser();
      const emittedGeminiThoughtSummaries = new Set<string>();
      for await (const chunk of stream) {
        for (const summary of extractGeminiThoughtSummariesFromRaw(
          chunk.additional_kwargs?.__raw_response,
        )) {
          if (emittedGeminiThoughtSummaries.has(summary)) continue;
          emittedGeminiThoughtSummaries.add(summary);
          yield { type: "reasoning", content: summary, stepType: "thinking" };
        }

        const content = chunk.content;
        if (typeof content === "string" && content) {
          for (const event of thinkTagParser.push(content)) {
            if (event.type === "token") {
              yield { type: "token", content: event.content };
            } else {
              yield { type: "reasoning", content: event.content, stepType: "thinking" };
            }
          }
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && typeof block.text === "string" && block.text) {
              for (const event of thinkTagParser.push(block.text)) {
                if (event.type === "token") {
                  yield { type: "token", content: event.content };
                } else {
                  yield { type: "reasoning", content: event.content, stepType: "thinking" };
                }
              }
            } else if (block.type === "thinking") {
              const thinkingContent = [block.text, block.thinking, block.content].find(
                (value): value is string => typeof value === "string" && value.length > 0,
              );
              if (thinkingContent) {
                yield { type: "reasoning", content: thinkingContent, stepType: "thinking" };
              }
            }
          }
        }

        const reasoningContent = chunk.additional_kwargs?.reasoning_content;
        if (typeof reasoningContent === "string" && reasoningContent) {
          yield { type: "reasoning", content: reasoningContent, stepType: "thinking" };
        }
      }
      for (const event of thinkTagParser.flush()) {
        if (event.type === "token") {
          yield { type: "token", content: event.content };
        } else {
          yield { type: "reasoning", content: event.content, stepType: "thinking" };
        }
      }
      return;
    }

    // Build LangChain tools with proper Zod schemas
    const { DynamicStructuredTool } = await import("@langchain/core/tools");
    const langChainTools = tools.map((tool) => {
      const schema = buildZodSchema(tool.parameters);
      return new DynamicStructuredTool({
        name: tool.name,
        description: tool.description,
        schema,
        func: async (input) => {
          return JSON.stringify(await executeTool(tool, input as Record<string, unknown>));
        },
      });
    });

    // Create LangGraph ReAct agent — handles tool-calling loop automatically
    const agent = createReactAgent({
      llm: model,
      tools: langChainTools,
      prompt: systemPrompt,
    });

    // Stream events from the agent graph
    // recursionLimit=50 allows up to ~25 tool-calling rounds (2 graph steps per round)
    // This supports analyzing all chapters of a book in one conversation turn
    const eventStream = agent.streamEvents(
      { messages: inputMessages },
      { version: "v2", recursionLimit: 200 },
    );

    // Track tool calls already emitted (from streaming chunks or on_chat_model_end)
    // so we can deduplicate against on_tool_start events.
    let pendingEarlyToolCalls = 0;

    // Accumulate tool_call_chunks from streaming to emit tool_call as early as possible.
    // Key: chunk index, Value: { name accumulated so far, args accumulated so far }
    const streamingToolCalls = new Map<number, { name: string; args: string; emitted: boolean }>();

    // Helper to race iterator next() against abort signal
    const raceNext = async (iterator: AsyncIterator<unknown>): Promise<IteratorResult<unknown>> => {
      if (isAborted()) {
        return { done: true, value: undefined };
      }
      const abortPromise = new Promise<IteratorResult<unknown>>((resolve) => {
        const onAbort = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve({ done: true, value: undefined });
        };
        signal?.addEventListener("abort", onAbort);
      });
      return Promise.race([iterator.next(), abortPromise]);
    };

    const iterator = eventStream[Symbol.asyncIterator]();
    let eventResult = await raceNext(iterator);
    let turnTextBuffer = "";
    const emittedGeminiThoughtSummaries = new Set<string>();

    function* flushBufferedTurnText(hasToolCalls: boolean): Generator<AgentStreamEvent> {
      if (!turnTextBuffer) return;
      const parser = new ThinkTagStreamParser();
      const events = [...parser.push(turnTextBuffer), ...parser.flush()];
      turnTextBuffer = "";
      for (const event of events) {
        if (event.type === "reasoning") {
          yield { type: "reasoning", content: event.content, stepType: "thinking" };
        } else if (hasToolCalls) {
          yield { type: "reasoning", content: event.content, stepType: "thinking" };
        } else {
          yield { type: "token", content: event.content };
        }
      }
    }

    while (!eventResult.done) {
      const event = eventResult.value as any;
      // Check for abort at each iteration
      if (isAborted()) return;

      // Token streaming from model
      if (event.event === "on_chat_model_stream") {
        const chunk = event.data?.chunk;
        if (chunk) {
          for (const summary of extractGeminiThoughtSummariesFromRaw(
            chunk.additional_kwargs?.__raw_response,
          )) {
            if (emittedGeminiThoughtSummaries.has(summary)) continue;
            emittedGeminiThoughtSummaries.add(summary);
            yield { type: "reasoning", content: summary, stepType: "thinking" };
          }

          const content = chunk.content;

          // Buffer normal text until the model turn ends. If the same turn also
          // calls tools, that text is tool-planning chatter rather than final
          // answer text and must not be streamed into the response body.
          if (typeof content === "string" && content) {
            turnTextBuffer += content;
          } else if (Array.isArray(content)) {
            // Handle Anthropic-style content blocks (text + thinking)
            for (const block of content) {
              if (block.type === "text" && typeof block.text === "string" && block.text) {
                turnTextBuffer += block.text;
              } else if (block.type === "thinking") {
                // Anthropic may return thinking content in different fields
                // Try block.text first (most common), then block.thinking, then block.content
                const thinkingContent = [block.text, block.thinking, block.content].find(
                  (value): value is string => typeof value === "string" && value.length > 0,
                );
                if (thinkingContent) {
                  yield { type: "reasoning", content: thinkingContent, stepType: "thinking" };
                }
              }
            }
          }

          // Handle DeepSeek reasoning_content from @langchain/deepseek
          // ChatDeepSeek puts reasoning_content in additional_kwargs.reasoning_content
          const reasoningContent = chunk.additional_kwargs?.reasoning_content;
          if (typeof reasoningContent === "string" && reasoningContent) {
            yield { type: "reasoning", content: reasoningContent, stepType: "thinking" };
          }

          // Detect tool_call_chunks in streaming and emit tool_call as soon as we have the name.
          // This eliminates the delay between the last text token and on_chat_model_end.
          const toolCallChunks = chunk.tool_call_chunks;
          if (Array.isArray(toolCallChunks)) {
            for (const tcc of toolCallChunks) {
              const idx = tcc.index ?? 0;
              let entry = streamingToolCalls.get(idx);
              if (!entry) {
                entry = { name: "", args: "", emitted: false };
                streamingToolCalls.set(idx, entry);
              }
              if (tcc.name) entry.name += tcc.name;
              if (tcc.args) entry.args += tcc.args;

              // Emit as soon as we have a tool name (don't wait for full args)
              if (entry.name && !entry.emitted) {
                entry.emitted = true;
                pendingEarlyToolCalls++;
                yield {
                  type: "tool_call" as const,
                  name: entry.name,
                  args: {}, // args will arrive later; show pending UI immediately
                };
              }
            }
          }
        }
      }

      // When LLM finishes a turn, emit any tool_calls that weren't already
      // emitted from streaming chunks (e.g. non-OpenAI models that don't
      // send tool_call_chunks).
      if (event.event === "on_chat_model_end") {
        const output = event.data?.output;
        const toolCalls =
          output?.tool_calls ?? output?.additional_kwargs?.tool_calls ?? ([] as unknown[]);
        const hasToolCalls =
          (Array.isArray(toolCalls) && toolCalls.length > 0) ||
          [...streamingToolCalls.values()].some((entry) => entry.emitted);

        for (const flushedEvent of flushBufferedTurnText(hasToolCalls)) {
          yield flushedEvent;
        }

        // Clear streaming accumulator for the next LLM turn
        streamingToolCalls.clear();

        if (output) {
          if (Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              // Check if already emitted from streaming chunks
              if (pendingEarlyToolCalls > 0) {
                // Already emitted — skip but don't decrement yet (that's for on_tool_start)
                continue;
              }
              let args: Record<string, unknown>;
              try {
                args = (typeof tc.args === "string" ? JSON.parse(tc.args) : tc.args) as Record<
                  string,
                  unknown
                >;
              } catch {
                args = {};
              }
              pendingEarlyToolCalls++;
              yield {
                type: "tool_call" as const,
                name: tc.name,
                args,
              };
            }
          }
        }
      }

      // Tool call started — skip if already emitted earlier
      if (event.event === "on_tool_start") {
        if (pendingEarlyToolCalls > 0) {
          pendingEarlyToolCalls--;
        } else {
          // Fallback: emit if not already emitted (e.g. non-OpenAI model)
          yield {
            type: "tool_call",
            name: event.name,
            args: (event.data?.input as Record<string, unknown>) ?? {},
          };
        }
      }

      // Tool call completed
      if (event.event === "on_tool_end") {
        let result: unknown = event.data?.output;
        // ToolMessage objects need to have their content extracted
        const resultContent = (result as any)?.content ?? (result as any)?.lc_kwargs?.content;
        if (resultContent !== undefined) {
          result = resultContent;
        }
        try {
          if (typeof result === "string") result = JSON.parse(result);
        } catch {
          /* keep as string */
        }

        // Emit citation event for addCitation tool results
        if (event.name === "addCitation" && result && typeof result === "object") {
          const citationData = result as Record<string, unknown>;
          if (citationData.type === "citation") {
            yield {
              type: "citation",
              citation: {
                id: `citation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                bookId: citationData.bookId as string,
                chapterTitle: citationData.chapterTitle as string,
                chapterIndex: citationData.chapterIndex as number,
                cfi: citationData.cfi as string,
                text: citationData.text as string,
                citationIndex: citationData.citationIndex as number | undefined,
              },
            };
          }
        }

        yield { type: "tool_result", name: event.name, result };
      }

      // Get next event
      eventResult = await raceNext(iterator);
    }
  } catch (error) {
    console.error("[ReadingAgent] Error:", error);
    if (error instanceof Error) {
      console.error("[ReadingAgent] Stack:", error.stack);
    }
    yield { type: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

// --- Legacy exports for compatibility ---

export { buildSystemPrompt };
