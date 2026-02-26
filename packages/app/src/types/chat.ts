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

export type AIModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "claude-sonnet-4-20250514"
  | "claude-haiku-4-20250414";

export interface AIConfig {
  model: AIModel;
  apiKey: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
  slidingWindowSize: number; // default 8
}
