/**
 * MessageList — scrollable message list with streaming support
 * Uses Part-based rendering for real-time updates
 */
import type { MessageV2, CitationPart } from "@/types/message";
import { useEffect, useRef } from "react";
import { PartRenderer } from "./PartRenderer";
import { StreamingIndicator } from "./StreamingIndicator";

interface MessageListProps {
  messages: MessageV2[];
  onCitationClick?: (citation: CitationPart) => void;
  isStreaming?: boolean;
  currentStep?: "thinking" | "tool_calling" | "responding" | "idle";
  onStop?: () => void;
}

export function MessageList({ messages, onCitationClick, isStreaming, currentStep }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, messages[messages.length - 1]?.parts.length]);

  // Show streaming indicator when streaming but the last assistant message has no visible parts yet
  const lastMsg = messages[messages.length - 1];
  const showStreamingIndicator =
    isStreaming &&
    currentStep &&
    currentStep !== "idle" &&
    (!lastMsg ||
      lastMsg.role !== "assistant" ||
      lastMsg.parts.length === 0);

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-y-auto py-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} onCitationClick={onCitationClick} />
        ))}
        {showStreamingIndicator && (
          <StreamingIndicator step={currentStep!} />
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: MessageV2;
  onCitationClick?: (citation: CitationPart) => void;
}

function MessageBubble({ message, onCitationClick }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="group mt-6 flex max-w-full flex-col first:mt-0">
        <div className="max-w-[85%] self-end rounded-2xl bg-muted px-3 py-2 text-sm leading-relaxed">
          <div className="whitespace-pre-wrap">
            {message.parts.map((part) => {
              if (part.type === "text") {
                return <span key={part.id}>{part.text}</span>;
              }
              return null;
            })}
          </div>
        </div>
      </div>
    );
  }

  const hasContent = message.parts.some(
    (p) => (p.type === "text" && p.text.trim()) || p.type !== "text"
  );

  if (!hasContent) return null;

  return (
    <div className="group flex w-full flex-col gap-1">
      {message.parts.map((part) => (
        <PartRenderer key={part.id} part={part} onCitationClick={onCitationClick} />
      ))}
    </div>
  );
}
