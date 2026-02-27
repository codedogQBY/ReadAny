/**
 * Reading Agent — LangGraph-based intelligent reading assistant
 *
 * Architecture:
 * ┌─────────────┐     ┌──────────┐     ┌───────────┐
 * │  User Input  │────▶│  Router  │────▶│  Respond  │
 * └─────────────┘     └──────────┘     └───────────┘
 *                           │
 *                     ┌─────┼─────┐
 *                     ▼     ▼     ▼
 *                  [RAG] [Tool] [Summarize]
 *
 * The agent uses a state graph where:
 * - Router: classifies user intent (question, summary, analysis, search, general)
 * - RAG Node: retrieves relevant book content via LangChain tools
 * - Respond Node: final LLM call with all gathered context, streamed token by token
 *
 * Tool calling uses LangChain's bindTools() so the LLM can autonomously
 * decide when to call ragSearch, ragToc, ragContext tools.
 */
import type { AIConfig, Book, SemanticContext, Skill } from "@/types";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { Annotation, StateGraph, END } from "@langchain/langgraph/web";
import { z } from "zod";
import { createChatModel } from "../llm-provider";
import { buildSystemPrompt } from "../system-prompt";
import { getAvailableTools } from "../tools";

// --- Stream Event Types ---

export type AgentStreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown };

// --- State Definition ---

/** The agent's state flowing through the graph */
const AgentState = Annotation.Root({
  /** Chat messages (LangChain format) */
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  /** User's latest input */
  userInput: Annotation<string>({ default: () => "", reducer: (_, n) => n }),
  /** Classified user intent */
  intent: Annotation<"question" | "summary" | "analysis" | "search" | "general">({
    default: () => "general",
    reducer: (_, n) => n,
  }),
  /** Retrieved context from RAG */
  retrievedContext: Annotation<string>({ default: () => "", reducer: (_, n) => n }),
  /** Final response text */
  response: Annotation<string>({ default: () => "", reducer: (_, n) => n }),
  /** Book metadata for context */
  bookContext: Annotation<string>({ default: () => "", reducer: (_, n) => n }),
});

type AgentStateType = typeof AgentState.State;

// --- Graph Builder ---

export interface ReadingAgentOptions {
  aiConfig: AIConfig;
  book: Book | null;
  semanticContext: SemanticContext | null;
  enabledSkills: Skill[];
  isVectorized: boolean;
}

/**
 * Convert our ToolDefinition[] to LangChain DynamicStructuredTool[].
 */
function buildLangChainTools(options: ReadingAgentOptions): DynamicStructuredTool[] {
  const toolDefs = getAvailableTools({
    bookId: options.book?.id || null,
    isVectorized: options.isVectorized,
    enabledSkills: options.enabledSkills,
  });

  return toolDefs.map((td) => {
    // Build zod schema from our parameter definitions
    const schemaFields: Record<string, z.ZodTypeAny> = {};
    for (const [name, param] of Object.entries(td.parameters)) {
      let field: z.ZodTypeAny;
      switch (param.type) {
        case "number":
          field = z.number().describe(param.description);
          break;
        case "boolean":
          field = z.boolean().describe(param.description);
          break;
        case "string":
        default:
          field = z.string().describe(param.description);
          break;
      }
      schemaFields[name] = param.required ? field : field.optional();
    }

    return new DynamicStructuredTool({
      name: td.name,
      description: td.description,
      schema: z.object(schemaFields),
      func: async (args: Record<string, unknown>) => {
        const result = await td.execute(args);
        return JSON.stringify(result);
      },
    });
  });
}

/**
 * Build the LangGraph reading agent.
 * Returns a compiled graph that can be invoked or streamed.
 */
export async function buildReadingAgent(options: ReadingAgentOptions) {
  const { aiConfig, book, semanticContext, enabledSkills, isVectorized } = options;
  const baseLlm = await createChatModel(aiConfig);

  // Build LangChain tools from our tool definitions
  const langchainTools = buildLangChainTools(options);

  // Bind tools to LLM so it can autonomously decide to call them
  const llm = langchainTools.length > 0
    ? baseLlm.bindTools!(langchainTools)
    : baseLlm;

  // Build system prompt using existing logic
  const systemPrompt = buildSystemPrompt({
    book,
    semanticContext,
    enabledSkills,
    isVectorized,
    userLanguage: book?.meta.language || "",
  });

  // Map tool name → tool for execution
  const toolMap = new Map(langchainTools.map((t) => [t.name, t]));

  // --- Node: Router ---
  async function routerNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const input = state.userInput.toLowerCase();
    let intent: AgentStateType["intent"] = "general";

    if (/summar|概括|总结|摘要/.test(input)) {
      intent = "summary";
    } else if (/analy|分析|论证|观点/.test(input)) {
      intent = "analysis";
    } else if (/search|find|查找|搜索|在.*中找/.test(input)) {
      intent = "search";
    } else if (/\?|？|what|how|why|who|when|where|explain|为什么|怎么|什么|谁|哪/.test(input)) {
      intent = "question";
    }

    return { intent };
  }

  // --- Node: RAG Retrieval (via tool calling) ---
  async function ragNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    if (!isVectorized || !book) {
      // No vector index — just pass through semantic context if available
      const ctx = semanticContext
        ? `Current chapter: ${semanticContext.currentChapter}\nSurrounding text: ${semanticContext.surroundingText}`
        : "";
      return { retrievedContext: ctx };
    }

    // Use LLM with bound tools to do RAG retrieval
    const ragMessages: BaseMessage[] = [
      new SystemMessage(
        `You are a RAG retrieval assistant. Based on the user's question, use the available tools to search the book for relevant content. Call ragSearch with an appropriate query. Return ONLY the tool calls, no text response.`
      ),
      new HumanMessage(state.userInput),
    ];

    try {
      const response = await llm.invoke(ragMessages);
      let retrievedContext = "";

      // Check if the LLM made tool calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        const newMessages: BaseMessage[] = [...ragMessages, response];

        for (const toolCall of response.tool_calls) {
          const tool = toolMap.get(toolCall.name);
          if (tool) {
            const result = await tool.invoke(toolCall.args);
            retrievedContext += `\n\n[${toolCall.name}] Results:\n${result}`;
            newMessages.push(
              new ToolMessage({
                content: typeof result === "string" ? result : JSON.stringify(result),
                tool_call_id: toolCall.id || toolCall.name,
              }),
            );
          }
        }
      }

      // Also include semantic context if available
      if (semanticContext) {
        retrievedContext = `Current chapter: ${semanticContext.currentChapter}\nSurrounding text: ${semanticContext.surroundingText}\n${retrievedContext}`;
      }

      return { retrievedContext };
    } catch {
      // Fallback to semantic context
      const ctx = semanticContext
        ? `Current chapter: ${semanticContext.currentChapter}\nSurrounding text: ${semanticContext.surroundingText}`
        : "";
      return { retrievedContext: ctx };
    }
  }

  // --- Node: Respond ---
  async function respondNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const messagesForLLM: BaseMessage[] = [new SystemMessage(systemPrompt)];

    // Add retrieved context if any
    if (state.retrievedContext) {
      messagesForLLM.push(
        new SystemMessage(`Relevant book content:\n${state.retrievedContext}`),
      );
    }

    // Add conversation history
    messagesForLLM.push(...state.messages);

    const result = await baseLlm.invoke(messagesForLLM);
    const responseText = typeof result.content === "string" ? result.content : "";

    return {
      response: responseText,
      messages: [new AIMessage(responseText)],
    };
  }

  // --- Conditional Edge: should we do RAG? ---
  function shouldRetrieve(state: AgentStateType): string {
    if (
      isVectorized &&
      (state.intent === "question" || state.intent === "search" || state.intent === "analysis")
    ) {
      return "rag";
    }
    return "respond";
  }

  // --- Build Graph ---
  const graph = new StateGraph(AgentState)
    .addNode("router", routerNode)
    .addNode("rag", ragNode)
    .addNode("respond", respondNode)
    .addEdge("__start__", "router")
    .addConditionalEdges("router", shouldRetrieve, {
      rag: "rag",
      respond: "respond",
    })
    .addEdge("rag", "respond")
    .addEdge("respond", END);

  return { graph: graph.compile(), baseLlm, systemPrompt, toolMap };
}

/**
 * Run the reading agent with a user message and conversation history.
 * Returns the agent's response text.
 */
export async function runReadingAgent(
  options: ReadingAgentOptions,
  userInput: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<string> {
  const { graph } = await buildReadingAgent(options);

  const messages: BaseMessage[] = history.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );
  messages.push(new HumanMessage(userInput));

  const result = await graph.invoke({
    messages,
    userInput,
  });

  return result.response;
}

/**
 * Stream the reading agent's response.
 * Yields structured events: token chunks, tool calls, and tool results.
 */
export async function* streamReadingAgent(
  options: ReadingAgentOptions,
  userInput: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): AsyncGenerator<AgentStreamEvent> {
  const { baseLlm, systemPrompt, toolMap } = await buildReadingAgent(options);

  const { isVectorized, book, semanticContext } = options;

  // Convert history to LangChain messages
  const chatMessages: BaseMessage[] = history.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );
  chatMessages.push(new HumanMessage(userInput));

  // --- Simple intent classification ---
  const input = userInput.toLowerCase();
  let needsRag = false;
  if (isVectorized && book) {
    if (
      /summar|概括|总结|摘要/.test(input) ||
      /analy|分析|论证|观点/.test(input) ||
      /search|find|查找|搜索|在.*中找/.test(input) ||
      /\?|？|what|how|why|who|when|where|explain|为什么|怎么|什么|谁|哪/.test(input)
    ) {
      needsRag = true;
    }
  }

  // --- RAG retrieval phase ---
  let retrievedContext = "";

  if (needsRag && toolMap.size > 0) {
    try {
      const llmWithTools = baseLlm.bindTools!(Array.from(toolMap.values()));
      const ragMessages: BaseMessage[] = [
        new SystemMessage(
          `You are a RAG retrieval assistant. Based on the user's question, use the available tools to search the book for relevant content. Call ragSearch with an appropriate query. Return ONLY the tool calls, no text response.`,
        ),
        new HumanMessage(userInput),
      ];

      const ragResponse = await llmWithTools.invoke(ragMessages);

      if (ragResponse.tool_calls && ragResponse.tool_calls.length > 0) {
        for (const toolCall of ragResponse.tool_calls) {
          yield { type: "tool_call", name: toolCall.name, args: toolCall.args as Record<string, unknown> };

          const tool = toolMap.get(toolCall.name);
          if (tool) {
            const result = await tool.invoke(toolCall.args);
            retrievedContext += `\n\n[${toolCall.name}] Results:\n${result}`;

            let parsedResult: unknown;
            try {
              parsedResult = JSON.parse(typeof result === "string" ? result : JSON.stringify(result));
            } catch {
              parsedResult = result;
            }
            yield { type: "tool_result", name: toolCall.name, result: parsedResult };
          }
        }
      }
    } catch {
      // Fallback — no RAG results
    }
  }

  // Add semantic context
  if (semanticContext) {
    const scCtx = `Current chapter: ${semanticContext.currentChapter}\nSurrounding text: ${semanticContext.surroundingText}`;
    retrievedContext = retrievedContext ? `${scCtx}\n${retrievedContext}` : scCtx;
  }

  // --- Final response phase (streamed) ---
  const finalMessages: BaseMessage[] = [new SystemMessage(systemPrompt)];

  if (retrievedContext) {
    finalMessages.push(
      new SystemMessage(`Relevant book content:\n${retrievedContext}`),
    );
  }

  finalMessages.push(...chatMessages);

  // Stream the response token by token
  const stream = await baseLlm.stream(finalMessages);

  for await (const chunk of stream) {
    const text = typeof chunk.content === "string" ? chunk.content : "";
    if (text) {
      yield { type: "token", content: text };
    }
  }
}
