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
 * - RAG Node: retrieves relevant book content for context-grounded answers
 * - Tool Node: executes registered tools (highlight, navigate, translate, etc.)
 * - Summarize Node: generates summaries of chapters/sections
 * - Respond Node: final LLM call with all gathered context
 *
 * This is the foundation; individual nodes will be fleshed out as features are built.
 */
import type { AIConfig, Book, SemanticContext, Skill } from "@/types";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, StateGraph, END } from "@langchain/langgraph/web";
import { createChatModel } from "../llm-provider";
import { buildSystemPrompt } from "../system-prompt";

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
 * Build the LangGraph reading agent.
 * Returns a compiled graph that can be invoked or streamed.
 */
export async function buildReadingAgent(options: ReadingAgentOptions) {
  const { aiConfig, book, semanticContext, enabledSkills, isVectorized } = options;
  const llm = await createChatModel(aiConfig);

  // Build system prompt using existing logic
  const systemPrompt = buildSystemPrompt({
    book,
    semanticContext,
    enabledSkills,
    isVectorized,
    userLanguage: book?.meta.language || "",
  });

  // --- Node: Router ---
  async function routerNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    // Simple intent classification — can be upgraded to LLM-based routing later
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

  // --- Node: RAG Retrieval ---
  async function ragNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    if (!isVectorized || !book) {
      return { retrievedContext: "" };
    }

    // TODO: integrate with the existing RAG search system
    // For now, pass through semantic context
    const ctx = semanticContext
      ? `Current chapter: ${semanticContext.currentChapter}\nSurrounding text: ${semanticContext.surroundingText}`
      : "";

    return { retrievedContext: ctx };
  }

  // --- Node: Respond ---
  async function respondNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const messagesForLLM: BaseMessage[] = [
      new SystemMessage(systemPrompt),
    ];

    // Add retrieved context if any
    if (state.retrievedContext) {
      messagesForLLM.push(
        new SystemMessage(`Relevant book content:\n${state.retrievedContext}`),
      );
    }

    // Add conversation history
    messagesForLLM.push(...state.messages);

    const result = await llm.invoke(messagesForLLM);
    const responseText = typeof result.content === "string" ? result.content : "";

    return {
      response: responseText,
      messages: [new AIMessage(responseText)],
    };
  }

  // --- Conditional Edge: should we do RAG? ---
  function shouldRetrieve(state: AgentStateType): string {
    if (isVectorized && (state.intent === "question" || state.intent === "search" || state.intent === "analysis")) {
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

  return graph.compile();
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
  const agent = await buildReadingAgent(options);

  // Convert history to LangChain messages
  const messages: BaseMessage[] = history.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );
  messages.push(new HumanMessage(userInput));

  const result = await agent.invoke({
    messages,
    userInput,
  });

  return result.response;
}

/**
 * Stream the reading agent's response.
 * Yields text chunks as they arrive.
 */
export async function* streamReadingAgent(
  options: ReadingAgentOptions,
  userInput: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): AsyncGenerator<string> {
  const agent = await buildReadingAgent(options);

  const messages: BaseMessage[] = history.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );
  messages.push(new HumanMessage(userInput));

  const stream = await agent.stream({
    messages,
    userInput,
  });

  for await (const event of stream) {
    // The respond node emits the response
    if (event.respond?.response) {
      yield event.respond.response;
    }
  }
}
