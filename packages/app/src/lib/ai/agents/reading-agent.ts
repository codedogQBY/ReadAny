/**
 * Reading Agent — AI-powered reading assistant
 *
 * Architecture:
 * 1. Uses getAvailableTools() to register ALL tools (RAG, analysis, context)
 * 2. Builds proper Zod schemas from ToolDefinition.parameters
 * 3. Uses ToolMessage (not HumanMessage) for tool results
 * 4. Real streaming via model.stream() for final responses
 * 5. System prompt from system-prompt.ts (not hardcoded)
 */
import type { AIConfig, Book, SemanticContext, Skill } from "@/types";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
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

// --- Tool Executor ---

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

    // P0: Register ALL tools via getAvailableTools (not just context tools)
    const { getAvailableTools } = await import("../tools");
    const tools = getAvailableTools({
      bookId: book?.id || null,
      isVectorized,
      enabledSkills,
    });
    const toolMap = new Map<string, ToolDefinition>();
    for (const tool of tools) {
      toolMap.set(tool.name, tool);
    }

    // P1: Use proper system prompt from system-prompt.ts
    const systemPrompt = buildSystemPrompt({
      book,
      semanticContext,
      enabledSkills,
      isVectorized,
      userLanguage: "zh-CN",
    });
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...history.map((h) =>
        h.role === "user" ? new HumanMessage(h.content) : new AIMessage(h.content),
      ),
      new HumanMessage(userInput),
    ];

    // P1: Build proper Zod schemas from ToolDefinition.parameters
    const { DynamicStructuredTool } = await import("@langchain/core/tools");
    const langChainTools = Array.from(toolMap.values()).map((tool) => {
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

    // If no tools available, stream directly without binding tools
    if (langChainTools.length === 0) {
      const stream = await model.stream(messages);
      for await (const chunk of stream) {
        const content = typeof chunk.content === "string" ? chunk.content : "";
        if (content) {
          yield { type: "token", content };
        }
      }
      return;
    }

    // Bind tools to model
    const modelWithTools = model.bindTools?.(langChainTools) ?? model;

    // First call - let AI decide if it needs tools
    let response = await modelWithTools.invoke(messages);

    // Tool call loop
    let iterationCount = 0;
    const maxIterations = 5;

    while (
      response.tool_calls &&
      response.tool_calls.length > 0 &&
      iterationCount < maxIterations
    ) {
      iterationCount++;

      // P1: Push the AI response (with tool_calls) into messages
      messages.push(response);

      // Process each tool call
      for (const toolCall of response.tool_calls) {
        const toolName = toolCall.name;
        const toolArgs = toolCall.args as Record<string, unknown>;
        const toolCallId = toolCall.id || `${toolName}-${Date.now()}`;
        const tool = toolMap.get(toolName);

        yield { type: "tool_call", name: toolName, args: toolArgs };

        if (tool) {
          const result = await executeTool(tool, toolArgs);
          yield { type: "tool_result", name: toolName, result };

          // P1: Use ToolMessage with correct tool_call_id
          messages.push(
            new ToolMessage({
              content: JSON.stringify(result),
              tool_call_id: toolCallId,
              name: toolName,
            }),
          );
        } else {
          // Tool not found — still need to send a ToolMessage to avoid format error
          messages.push(
            new ToolMessage({
              content: JSON.stringify({ error: `Tool "${toolName}" not found` }),
              tool_call_id: toolCallId,
              name: toolName,
            }),
          );
        }
      }

      // Continue conversation with tool results
      response = await modelWithTools.invoke(messages);
    }

    // P2: Real streaming for final response
    // If the last response already has content (no more tool calls), stream it
    // Otherwise use model.stream() for a fresh streaming response
    if (response.tool_calls && response.tool_calls.length > 0) {
      // Hit max iterations — still have tool calls, just output what we have
      const content =
        typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      if (content) {
        yield { type: "token", content };
      }
    } else if (response.content) {
      // We got a non-tool-call response from invoke().
      // Re-stream: add the tool results to messages, then stream the final answer.
      // But since we already have the response, let's stream it properly.
      // The response was from invoke() so we simulate streaming from the buffered content.
      // For true streaming on the final response, we re-call with stream().
      messages.push(response);

      // Remove the last AI message and re-stream
      messages.pop();
      const stream = await modelWithTools.stream(messages);
      for await (const chunk of stream) {
        const content = typeof chunk.content === "string" ? chunk.content : "";
        if (content) {
          yield { type: "token", content };
        }
      }
    }
  } catch (error) {
    yield { type: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

// --- Legacy exports for compatibility ---

export { buildSystemPrompt };
