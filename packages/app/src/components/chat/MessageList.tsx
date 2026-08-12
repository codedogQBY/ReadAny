/**
 * MessageList — scrollable message list with streaming support
 * Uses Part-based rendering for real-time updates
 */
import type { CitationPart, MessageV2, QuotePart } from "@readany/core/types/message";
import { ArrowDown, Check, Copy, Quote } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PartRenderer } from "./PartRenderer";
import { StreamingIndicator } from "./StreamingIndicator";

interface MessageListProps {
  messages: MessageV2[];
  onCitationClick?: (citation: CitationPart) => void;
  isStreaming?: boolean;
  currentStep?: "thinking" | "tool_calling" | "responding" | "idle";
  onStop?: () => void;
}

/** Threshold (px) to consider the user "at the bottom" */
const BOTTOM_THRESHOLD = 80;

function sortCitationsByIndex(citations: CitationPart[]): CitationPart[] {
  return citations
    .map((citation, order) => ({ citation, order }))
    .sort((a, b) => {
      const aIndex = a.citation.citationIndex;
      const bIndex = b.citation.citationIndex;
      if (typeof aIndex === "number" && typeof bIndex === "number") return aIndex - bIndex;
      if (typeof aIndex === "number") return -1;
      if (typeof bIndex === "number") return 1;
      return a.order - b.order;
    })
    .map(({ citation }) => citation);
}

export function MessageList({
  messages,
  onCitationClick,
  isStreaming,
  currentStep,
}: MessageListProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  /** Whether the user has intentionally scrolled away from the bottom */
  const [showScrollDown, setShowScrollDown] = useState(false);
  /** Track whether we should auto-scroll (user is near bottom) */
  const userAtBottomRef = useRef(true);

  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = containerRef.current;
    if (!el) return;

    if (behavior === "smooth") {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: "smooth",
      });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // Listen to scroll events to detect if user scrolled away
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = isNearBottom();
      userAtBottomRef.current = nearBottom;
      setShowScrollDown(!nearBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [isNearBottom]);

  // Auto-scroll when new messages/parts arrive, but only if user is near bottom
  useEffect(() => {
    if (userAtBottomRef.current) {
      scrollToBottom("smooth");
    }
  }, [messages.length, messages[messages.length - 1]?.parts.length, scrollToBottom]);

  // Auto-scroll during streaming (text growing inside a part) — use a timer
  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => {
      if (userAtBottomRef.current) {
        scrollToBottom("smooth");
      }
    }, 300);
    return () => clearInterval(interval);
  }, [isStreaming, scrollToBottom]);

  const handleScrollToBottom = useCallback(() => {
    userAtBottomRef.current = true;
    setShowScrollDown(false);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  // Show streaming indicator when streaming but the last assistant message has no visible parts yet
  const lastMsg = messages[messages.length - 1];
  const showStreamingIndicator =
    isStreaming &&
    currentStep &&
    currentStep !== "idle" &&
    (!lastMsg || lastMsg.role !== "assistant" || lastMsg.parts.length === 0);

  // Determine if the last assistant message is the one currently being streamed
  const isLastMsgStreaming =
    isStreaming && !!lastMsg && lastMsg.role === "assistant" && lastMsg.parts.length > 0;

  return (
    <div ref={containerRef} className="relative flex h-full flex-col overflow-y-auto py-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
        {messages.map((msg, idx) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onCitationClick={onCitationClick}
            isStreaming={idx === messages.length - 1 && isLastMsgStreaming}
            currentStep={currentStep}
          />
        ))}
        {showStreamingIndicator && <StreamingIndicator step={currentStep!} />}
      </div>

      {/* Sticky scroll-to-bottom button — stays at visible bottom of scroll container */}
      {showScrollDown && (
        <div className="sticky bottom-2 z-10 flex justify-center pointer-events-none">
          <button
            type="button"
            onClick={handleScrollToBottom}
            className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowDown className="size-3.5" />
            <span>{t("streaming.scrollToBottom")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

interface MessageBubbleProps {
  message: MessageV2;
  onCitationClick?: (citation: CitationPart) => void;
  isStreaming?: boolean;
  currentStep?: "thinking" | "tool_calling" | "responding" | "idle";
}

/** Inline quote block component for user messages */
function UserQuoteBlock({ part }: { part: QuotePart }) {
  return (
    <div className="flex gap-2 rounded-lg bg-primary/5 border border-primary/15 px-2.5 py-2">
      <Quote className="mt-0.5 size-3 shrink-0 text-primary/50" />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-relaxed text-foreground/80">
          {part.text.length > 200 ? `${part.text.slice(0, 200)}...` : part.text}
        </p>
        {part.source && <p className="mt-1 text-[10px] text-muted-foreground">— {part.source}</p>}
      </div>
    </div>
  );
}

/** Extract plain text from a message's parts for clipboard copy */
function extractMessageText(message: MessageV2): string {
  return message.parts
    .filter((p) => p.type === "text" && p.text.trim())
    .map((p) => (p as { text: string }).text)
    .join("\n\n");
}

function CopyMessageButton({ message }: { message: MessageV2 }) {
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
      onClick={() => {
        const text = extractMessageText(message);
        if (text) {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }}
      title={t("common.copy", "复制")}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

function MessageBubble({ message, onCitationClick, isStreaming, currentStep }: MessageBubbleProps) {
  if (message.role === "user") {
    const quoteParts = message.parts.filter((p) => p.type === "quote") as QuotePart[];
    const textParts = message.parts.filter((p) => p.type === "text");
    const hasQuotes = quoteParts.length > 0;

    return (
      <div className="group mt-6 flex max-w-full select-text flex-col first:mt-0">
        <div className="min-w-0 max-w-[85%] self-end rounded-2xl bg-muted px-3 py-2 text-sm leading-relaxed">
          {hasQuotes && (
            <div className="mb-2 flex flex-col gap-1.5">
              {quoteParts.map((q) => (
                <UserQuoteBlock key={q.id} part={q} />
              ))}
            </div>
          )}
          {textParts.length > 0 && (
            <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {textParts.map((part) => {
                if (part.type === "text") {
                  return <span key={part.id}>{part.text}</span>;
                }
                return null;
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  const hasContent = message.parts.some(
    (p) => (p.type === "text" && p.text.trim()) || p.type !== "text",
  );

  if (!hasContent) return null;

  // Collect all CitationPart objects from the message for reference in text
  const citations = sortCitationsByIndex(
    message.parts.filter((p) => p.type === "citation") as CitationPart[],
  );

  // Show "thinking" indicator in gaps between parts, but NOT when:
  // - A text part is actively streaming (cursor handles that)
  // - A tool call is pending/running (the tool card already shows its own loading state)
  const lastPart = message.parts[message.parts.length - 1];
  const isLastPartRunningText = lastPart?.type === "text" && lastPart.status === "running";
  const isLastPartActiveToolCall =
    lastPart?.type === "tool_call" &&
    (lastPart.status === "pending" || lastPart.status === "running");
  const showGapIndicator =
    isStreaming &&
    currentStep !== "idle" &&
    lastPart &&
    !isLastPartRunningText &&
    !isLastPartActiveToolCall;

  return (
    <div className="group flex w-full select-text flex-col gap-1">
      {message.parts.map((part) => (
        <PartRenderer
          key={part.id}
          part={part}
          citations={citations}
          onCitationClick={onCitationClick}
        />
      ))}
      {showGapIndicator && <StreamingIndicator step="thinking" />}
      {!isStreaming && <CopyMessageButton message={message} />}
    </div>
  );
}
