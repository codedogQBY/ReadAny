/**
 * MessageBubble — single message with citation markers
 */
import type { Message } from "@/types";
import { ToolCallDisplay } from "./ToolCallDisplay";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>

        {message.citations && message.citations.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-border/20 pt-2">
            {message.citations.map((citation, i) => (
              <div key={i} className="text-xs opacity-75">
                [{citation.chapterTitle}] "{citation.text.slice(0, 80)}..."
              </div>
            ))}
          </div>
        )}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((tc) => (
              <ToolCallDisplay key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
