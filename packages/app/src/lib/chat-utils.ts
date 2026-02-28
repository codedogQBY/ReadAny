/**
 * Chat utility functions shared between ChatPage and ChatPanel
 */
import type { MessageV2 } from "@/types/message";

/**
 * Convert legacy message format to MessageV2 format with parts.
 * Handles three cases:
 * 1. New format with properly typed parts array
 * 2. Format with partsOrder for reconstructing parts sequence
 * 3. Legacy format without partsOrder (fallback)
 */
export function convertToMessageV2(messages: any[]): MessageV2[] {
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
      const parts: any[] = [];
      const reasoningMap = new Map<string, any>();
      const toolCallMap = new Map<string, any>();

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
              text: entry.text || m.content,
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
                status: tc.status || "completed",
                createdAt: m.createdAt,
              });
            }
            break;
          }
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
    const parts: any[] = [];

    // Add reasoning parts
    if (m.reasoning && m.reasoning.length > 0) {
      m.reasoning.forEach((r: any) => {
        parts.push({
          id: r.id || `reasoning-${Date.now()}`,
          type: "reasoning",
          text: r.content,
          thinkingType: r.type,
          status: "completed",
          createdAt: r.timestamp || m.createdAt,
        });
      });
    }

    // Add tool call parts
    if (m.toolCalls && m.toolCalls.length > 0) {
      m.toolCalls.forEach((tc: any) => {
        parts.push({
          id: tc.id,
          type: "tool_call",
          name: tc.name,
          args: tc.args,
          result: tc.result,
          status: tc.status || "completed",
          createdAt: m.createdAt,
        });
      });
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
  isStreaming: boolean
): MessageV2[] {
  if (isStreaming && currentMessage) {
    return [...storeMessages.filter((m) => m.id !== currentMessage.id), currentMessage];
  }
  return storeMessages;
}
