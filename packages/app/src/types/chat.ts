/** Chat/conversation types */

export type MessageRole = "user" | "assistant" | "system";

export interface Citation {
  chapterTitle: string;
  cfi: string;
  text: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "running" | "completed" | "error";
}

export interface Message {
  id: string;
  threadId: string;
  role: MessageRole;
  content: string;
  citations?: Citation[];
  toolCalls?: ToolCall[];
  createdAt: number;
}

export interface Thread {
  id: string;
  bookId?: string; // undefined for standalone chat
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface SemanticContext {
  currentChapter: string;
  currentPosition: string;
  surroundingText: string;
  recentHighlights: string[];
  operationType: "reading" | "highlighting" | "searching" | "navigating";
}

/** Supported AI provider types */
export type AIProviderType = "openai" | "anthropic" | "google";

/** A single AI service endpoint (e.g. OpenAI, Anthropic Claude, Google Gemini, local Ollama, etc.) */
export interface AIEndpoint {
  id: string;
  name: string;
  /** Provider type — determines API format and SDK used */
  provider: AIProviderType;
  apiKey: string;
  /** Base URL — required for openai-compatible, optional for anthropic/google */
  baseUrl: string;
  /** Dynamically fetched or manually added model list */
  models: string[];
  /** Whether models have been fetched successfully */
  modelsFetched: boolean;
  /** Whether currently fetching models */
  modelsFetching?: boolean;
}

/** Global AI configuration */
export interface AIConfig {
  /** All configured endpoints */
  endpoints: AIEndpoint[];
  /** Currently active endpoint ID */
  activeEndpointId: string;
  /** Currently selected model ID (from active endpoint's models) */
  activeModel: string;
  /** Generation parameters */
  temperature: number;
  maxTokens: number;
  slidingWindowSize: number; // default 8
}

// Keep backward compat alias — some code still references AIModel
export type AIModel = string;

/** A configured vector/embedding model endpoint */
export interface VectorModelConfig {
  id: string;
  /** Display name, e.g. "OpenAI Embedding" */
  name: string;
  /** Full embeddings API URL, e.g. https://api.openai.com/v1/embeddings */
  url: string;
  /** Model ID sent in the request, e.g. text-embedding-3-small */
  modelId: string;
  /** API key (Bearer token) */
  apiKey: string;
  /** Optional description */
  description?: string;
  /** Detected embedding dimension */
  dimension?: number;
}
