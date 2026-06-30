/**
 * Chat utility functions shared between ChatPage and ChatPanel
 */
import type { PartsOrderEntry, ReasoningStep, ToolCall } from "../types/chat";
import type { MessageV2, Part } from "../types/message";

type ChatMessageLike = {
  id: string;
  threadId: string;
  role: MessageV2["role"];
  content?: string;
  citations?: unknown[];
  toolCalls?: ToolCall[];
  reasoning?: ReasoningStep[];
  partsOrder?: PartsOrderEntry[];
  parts?: Part[];
  createdAt: number;
};

function parseToolResult(result: unknown): Record<string, unknown> | null {
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return result && typeof result === "object" ? (result as Record<string, unknown>) : null;
}

function findCitationIndexFromToolCalls(
  entry: PartsOrderEntry,
  toolCalls: ToolCall[] | undefined,
): number | undefined {
  if (!toolCalls) return undefined;
  for (const tc of toolCalls) {
    if (tc.name !== "addCitation") continue;
    const result = parseToolResult(tc.result);
    if (!result || result.type !== "citation") continue;
    const matches =
      result.cfi === entry.cfi &&
      result.text === entry.text &&
      result.chapterTitle === entry.chapterTitle &&
      result.chapterIndex === entry.chapterIndex;
    if (matches && typeof result.citationIndex === "number") {
      return result.citationIndex;
    }
  }
  return undefined;
}

/**
 * Convert legacy message format to MessageV2 format with parts.
 * Handles three cases:
 * 1. New format with properly typed parts array
 * 2. Format with partsOrder for reconstructing parts sequence
 * 3. Legacy format without partsOrder (fallback)
 */
export function convertToMessageV2(messages: ChatMessageLike[]): MessageV2[] {
  return messages.map((m) => {
    // If message already has properly typed parts (new format), use them directly
    if (m.parts && Array.isArray(m.parts) && m.parts.length > 0 && m.parts[0]?.type) {
      return {
        id: m.id,
        threadId: m.threadId,
        role: m.role,
        parts: m.parts,
        createdAt: m.createdAt,
      };
    }

    // If partsOrder is available, use it to reconstruct parts in the correct order
    if (m.partsOrder && Array.isArray(m.partsOrder) && m.partsOrder.length > 0) {
      const parts: Part[] = [];
      const reasoningMap = new Map<string, ReasoningStep>();
      const toolCallMap = new Map<string, ToolCall>();

      if (m.reasoning) {
        for (const r of m.reasoning) {
          reasoningMap.set(r.id || `reasoning-${r.timestamp}`, r);
        }
      }
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          toolCallMap.set(tc.id, tc);
        }
      }

      for (const entry of m.partsOrder) {
        switch (entry.type) {
          case "text":
            parts.push({
              id: entry.id,
              type: "text",
              text: entry.text || m.content || "",
              status: "completed",
              createdAt: m.createdAt,
            });
            break;
          case "quote":
            parts.push({
              id: entry.id,
              type: "quote",
              text: entry.text || "",
              source: entry.source,
              status: "completed",
              createdAt: m.createdAt,
            });
            break;
          case "reasoning": {
            const r = reasoningMap.get(entry.id);
            if (r) {
              parts.push({
                id: entry.id,
                type: "reasoning",
                text: r.content,
                thinkingType: r.type,
                status: "completed",
                createdAt: r.timestamp || m.createdAt,
              });
            }
            break;
          }
          case "tool_call": {
            const tc = toolCallMap.get(entry.id);
            if (tc) {
              parts.push({
                id: tc.id,
                type: "tool_call",
                name: tc.name,
                args: tc.args,
                result: tc.result,
                error: tc.error,
                reasoning: tc.reasoning,
                status: tc.status || "completed",
                createdAt: m.createdAt,
              });
            }
            break;
          }
          case "citation":
            parts.push({
              id: entry.id,
              type: "citation",
              bookId: entry.bookId || "",
              chapterTitle: entry.chapterTitle || "",
              chapterIndex: entry.chapterIndex ?? 0,
              cfi: entry.cfi || "",
              text: entry.text || "",
              citationIndex:
                entry.citationIndex ?? findCitationIndexFromToolCalls(entry, m.toolCalls),
              status: "completed",
              createdAt: m.createdAt,
            });
            break;
          case "mindmap":
            parts.push({
              id: entry.id,
              type: "mindmap",
              title: entry.title || "",
              markdown: entry.markdown || "",
              status: "completed",
              createdAt: m.createdAt,
            });
            break;
        }
      }

      return {
        id: m.id,
        threadId: m.threadId,
        role: m.role,
        parts,
        createdAt: m.createdAt,
      };
    }

    // Fallback: legacy format without partsOrder
    const parts: Part[] = [];

    // Add reasoning parts
    if (m.reasoning && m.reasoning.length > 0) {
      for (const r of m.reasoning) {
        parts.push({
          id: r.id || `reasoning-${Date.now()}`,
          type: "reasoning",
          text: r.content,
          thinkingType: r.type,
          status: "completed",
          createdAt: r.timestamp || m.createdAt,
        });
      }
    }

    // Add tool call parts
    if (m.toolCalls && m.toolCalls.length > 0) {
      for (const tc of m.toolCalls) {
        parts.push({
          id: tc.id,
          type: "tool_call",
          name: tc.name,
          args: tc.args,
          result: tc.result,
          error: tc.error,
          reasoning: tc.reasoning,
          status: tc.status || "completed",
          createdAt: m.createdAt,
        });
      }
    }

    // Add text part
    if (m.content) {
      parts.push({
        id: `text-${m.id}`,
        type: "text",
        text: m.content,
        status: "completed",
        createdAt: m.createdAt,
      });
    }

    return {
      id: m.id,
      threadId: m.threadId,
      role: m.role,
      parts,
      createdAt: m.createdAt,
    };
  });
}

/**
 * Merge streaming message with store messages, avoiding duplicate keys.
 * When streaming, filter out any store message with the same ID as currentMessage.
 */
export function mergeMessagesWithStreaming(
  storeMessages: MessageV2[],
  currentMessage: MessageV2 | null,
  isStreaming: boolean,
): MessageV2[] {
  if (isStreaming && currentMessage) {
    return [...storeMessages.filter((m) => m.id !== currentMessage.id), currentMessage];
  }
  return storeMessages;
}
