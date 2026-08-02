/**
 * Chat/conversation types
 * Enhanced with tool calling, reasoning, and citation support
 */

/** A piece of selected text attached as context to the chat input */
export interface AttachedQuote {
  id: string;
  text: string;
  /** Optional source info, e.g. chapter title */
  source?: string;
}

export type MessageRole = "user" | "assistant" | "system";

export interface Citation {
  id: string;
  bookId: string;
  chapterTitle: string;
  chapterIndex: number;
  cfi: string;
  href?: string;
  text: string;
  location?: {
    start: number;
    end: number;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "running" | "completed" | "error";
  error?: string;
  duration?: number;
  reasoning?: string;
}

export interface ReasoningStep {
  id: string;
  type: "thinking" | "planning" | "analyzing" | "deciding";
  content: string;
  timestamp: number;
}

export interface Message {
  id: string;
  threadId: string;
  role: MessageRole;
  content: string;
  citations?: Citation[];
  toolCalls?: ToolCall[];
  reasoning?: ReasoningStep[];
  partsOrder?: PartsOrderEntry[];
  createdAt: number;
}

/** Records the order of parts as they appeared during streaming */
export interface PartsOrderEntry {
  type: "text" | "quote" | "reasoning" | "tool_call" | "citation" | "mindmap";
  id: string;
  /** For text parts, stores the text content so we can reconstruct separate text segments */
  text?: string;
  source?: string;
  bookId?: string;
  chapterTitle?: string;
  chapterIndex?: number;
  cfi?: string;
  citationIndex?: number;
  title?: string;
  markdown?: string;
}

export interface Thread {
  id: string;
  bookId?: string;
  title: string;
  messages: Message[];
  memorySummary?: string;
  memoryUpdatedAt?: number;
  memoryMessageCount?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReadingContext {
  bookId: string;
  bookTitle: string;
  currentChapter: {
    index: number;
    title: string;
    href: string;
  };
  currentPosition: {
    cfi: string;
    percentage: number;
    page?: number;
  };
  selection?: {
    text: string;
    cfi: string;
    chapterIndex: number;
    chapterTitle: string;
  };
  surroundingText: string;
  recentHighlights: Array<{
    text: string;
    cfi: string;
    note?: string;
  }>;
  operationType: "reading" | "highlighting" | "searching" | "navigating" | "selecting";
  timestamp: number;
}

export interface SemanticContext {
  currentChapter: string;
  currentPosition: string;
  surroundingText: string;
  recentHighlights: string[];
  operationType: "reading" | "highlighting" | "searching" | "navigating";
}

export type AIProviderType =
  | "openai"
  | "atlascloud"
  | "anthropic"
  | "google"
  | "deepseek"
  | "ollama"
  | "lmstudio"
  | "openrouter"
  | "siliconflow"
  | "moonshot"
  | "zhipu"
  | "aliyun"
  | "volces"
  | "baichuan"
  | "minimax"
  | "groq"
  | "together"
  | "fireworks"
  | "xai"
  | "mistral"
  | "perplexity"
  | "aihubmix"
  | "custom";

export interface AIEndpoint {
  id: string;
  name: string;
  provider: AIProviderType;
  apiKey: string;
  baseUrl: string;
  useExactRequestUrl?: boolean;
  models: string[];
  modelsFetched: boolean;
  modelsFetching?: boolean;
}

export interface AIConfig {
  endpoints: AIEndpoint[];
  activeEndpointId: string;
  activeModel: string;
  temperature: number;
  maxTokens: number;
  slidingWindowSize: number;
}

export type AIModel = string;

export interface VectorModelConfig {
  id: string;
  name: string;
  url: string;
  modelId: string;
  apiKey: string;
  description?: string;
  dimension?: number;
}

export type StreamEventType =
  | "token"
  | "tool_call"
  | "tool_result"
  | "reasoning"
  | "citation"
  | "error"
  | "done";

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  toolCall?: ToolCall;
  reasoning?: ReasoningStep;
  citation?: Citation;
  error?: string;
}
