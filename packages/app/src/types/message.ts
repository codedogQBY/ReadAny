/**
 * Message Part Types - Inspired by OpenCode's Part system
 * 
 * Messages are composed of multiple Parts, each with its own type and state.
 * This enables real-time streaming of individual parts (reasoning, tools, text).
 */

export type PartStatus = "pending" | "running" | "completed" | "error";

export interface BasePart {
  id: string;
  type: string;
  status: PartStatus;
  createdAt: number;
  updatedAt?: number;
}

export interface TextPart extends BasePart {
  type: "text";
  text: string;
}

export interface ReasoningPart extends BasePart {
  type: "reasoning";
  text: string;
  thinkingType?: "thinking" | "planning" | "analyzing" | "deciding";
}

export interface ToolCallPart extends BasePart {
  type: "tool_call";
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  reasoning?: string;
}

export interface CitationPart extends BasePart {
  type: "citation";
  bookId: string;
  chapterTitle: string;
  chapterIndex: number;
  cfi: string;
  text: string;
}

/** A user-attached quote from selected text (used in user messages) */
export interface QuotePart extends BasePart {
  type: "quote";
  text: string;
  /** Optional source info, e.g. chapter title */
  source?: string;
}

export type Part = TextPart | ReasoningPart | ToolCallPart | CitationPart | QuotePart;

export interface MessageV2 {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  parts: Part[];
  createdAt: number;
  updatedAt?: number;
}

export interface ThreadV2 {
  id: string;
  bookId?: string;
  title: string;
  messages: MessageV2[];
  createdAt: number;
  updatedAt: number;
}

export type StreamEventType =
  | "part:created"
  | "part:updated"
  | "part:delta"
  | "part:completed"
  | "message:completed"
  | "error";

export interface StreamEvent {
  type: StreamEventType;
  threadId: string;
  messageId: string;
  partId?: string;
  part?: Part;
  delta?: string;
  field?: string;
  error?: string;
}

export function createTextPart(text: string): TextPart {
  return {
    id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "text",
    text,
    status: "completed",
    createdAt: Date.now(),
  };
}

export function createReasoningPart(text: string, thinkingType?: ReasoningPart["thinkingType"]): ReasoningPart {
  return {
    id: `reasoning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "reasoning",
    text,
    thinkingType,
    status: "running",
    createdAt: Date.now(),
  };
}

export function createToolCallPart(name: string, args: Record<string, unknown>, reasoning?: string): ToolCallPart {
  return {
    id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "tool_call",
    name,
    args,
    reasoning,
    status: "running",
    createdAt: Date.now(),
  };
}

export function createCitationPart(
  bookId: string,
  chapterTitle: string,
  chapterIndex: number,
  cfi: string,
  text: string
): CitationPart {
  return {
    id: `citation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "citation",
    bookId,
    chapterTitle,
    chapterIndex,
    cfi,
    text,
    status: "completed",
    createdAt: Date.now(),
  };
}

export function isTextPart(part: Part): part is TextPart {
  return part.type === "text";
}

export function isReasoningPart(part: Part): part is ReasoningPart {
  return part.type === "reasoning";
}

export function isToolCallPart(part: Part): part is ToolCallPart {
  return part.type === "tool_call";
}

export function isCitationPart(part: Part): part is CitationPart {
  return part.type === "citation";
}

export function isQuotePart(part: Part): part is QuotePart {
  return part.type === "quote";
}

export function createQuotePart(text: string, source?: string): QuotePart {
  return {
    id: `quote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "quote",
    text,
    source,
    status: "completed",
    createdAt: Date.now(),
  };
}
