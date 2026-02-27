/**
 * Chat/conversation types
 * Enhanced with tool calling, reasoning, and citation support
 */

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
  createdAt: number;
}

export interface Thread {
  id: string;
  bookId?: string;
  title: string;
  messages: Message[];
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

export type AIProviderType = "openai" | "anthropic" | "google";

export interface AIEndpoint {
  id: string;
  name: string;
  provider: AIProviderType;
  apiKey: string;
  baseUrl: string;
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
