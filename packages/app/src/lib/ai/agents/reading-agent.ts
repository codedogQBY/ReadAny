/**
 * Reading Agent — AI-powered reading assistant using LangGraph ReAct agent
 *
 * Architecture:
 * 1. Uses LangGraph's createReactAgent for automatic tool-calling loop (no hard iteration limit)
 * 2. Uses getAvailableTools() to register ALL tools (RAG, analysis, context)
 * 3. Builds proper Zod schemas from ToolDefinition.parameters
 * 4. Real streaming via streamEvents API
 * 5. System prompt from system-prompt.ts
 */
import type { AIConfig, Book, SemanticContext, Skill } from "@/types";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createChatModel } from "../llm-provider";
import { buildSystemPrompt } from "../system-prompt";
import type { ToolDefinition, ToolParameter } from "../tools";

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
  | { type: "citation"; citation: { id: string; chapterTitle: string; text: string; cfi: string } }
  | { type: "error"; error: string };

export interface ReadingAgentOptions {
  aiConfig: AIConfig;
  book: Book | null;
  semanticContext: SemanticContext | null;
  enabledSkills: Skill[];
  isVectorized: boolean;
  deepThinking?: boolean;
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

// --- Main Agent Function ---

export async function* streamReadingAgent(
  options: ReadingAgentOptions,
  userInput: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): AsyncGenerator<AgentStreamEvent> {
  const { aiConfig, book, semanticContext, enabledSkills, isVectorized, deepThinking } = options;

  try {
    // Create chat model
    const model = await createChatModel(aiConfig, {
      temperature: deepThinking ? 1 : 0.7,
      maxTokens: aiConfig.maxTokens,
      streaming: true,
      deepThinking,
    });

    // Register ALL tools via getAvailableTools
    const { getAvailableTools } = await import("../tools");
    const tools = getAvailableTools({
      bookId: book?.id || null,
      isVectorized,
      enabledSkills,
    });

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
      book,
      semanticContext,
      enabledSkills,
      isVectorized,
      userLanguage: "zh-CN",
    });

    // Build input messages (history + user input, without system — handled by agent prompt)
    const inputMessages: BaseMessage[] = [
      ...history.map((h) =>
        h.role === "user" ? new HumanMessage(h.content) : new AIMessage(h.content),
      ),
      new HumanMessage(userInput),
    ];

    // If no tools available, stream directly without agent graph
    if (tools.length === 0) {
      const { SystemMessage } = await import("@langchain/core/messages");
      const allMessages = [new SystemMessage(systemPrompt), ...inputMessages];
      const stream = await model.stream(allMessages);
      for await (const chunk of stream) {
        const content = typeof chunk.content === "string" ? chunk.content : "";
        if (content) {
          yield { type: "token", content };
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
    const { createReactAgent } = await import("@langchain/langgraph/prebuilt");
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
      { version: "v2", recursionLimit: 50 },
    );

    for await (const event of eventStream) {
      // Token streaming from model (works for both intermediate reasoning and final response)
      if (event.event === "on_chat_model_stream") {
        const chunk = event.data?.chunk;
        if (!chunk) continue;

        const content = chunk.content;
        if (typeof content === "string" && content) {
          yield { type: "token", content };
        } else if (Array.isArray(content)) {
          // Handle Anthropic-style content blocks (text + thinking)
          for (const block of content) {
            if (block.type === "text" && block.text) {
              yield { type: "token", content: block.text };
            } else if (block.type === "thinking" && block.thinking) {
              yield { type: "reasoning", content: block.thinking, stepType: "thinking" };
            }
          }
        }
      }

      // Tool call started
      if (event.event === "on_tool_start") {
        yield {
          type: "tool_call",
          name: event.name,
          args: (event.data?.input as Record<string, unknown>) ?? {},
        };
      }

      // Tool call completed
      if (event.event === "on_tool_end") {
        let result: unknown = event.data?.output;
        try {
          if (typeof result === "string") result = JSON.parse(result);
        } catch {
          /* keep as string */
        }
        yield { type: "tool_result", name: event.name, result };
      }
    }
  } catch (error) {
    yield { type: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

// --- Legacy exports for compatibility ---

export { buildSystemPrompt };
