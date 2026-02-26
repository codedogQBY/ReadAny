/**
 * MessageBubble — sageread-style message display
 * - Assistant: left-aligned, no bubble, prose text
 * - User: right-aligned, muted rounded card
 */
import type { Message } from "@/types";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { ToolCallDisplay } from "./ToolCallDisplay";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isUser) {
    return (
      <div className="group mt-6 flex max-w-full flex-col first:mt-0">
        <div className="max-w-[85%] self-end rounded-2xl bg-muted px-3 py-2 text-sm leading-relaxed">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex w-full flex-col gap-0.5">
      {/* assistant text — no bubble, left aligned */}
      <div className="prose prose-neutral max-w-none text-sm leading-relaxed">
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>

      {/* citations */}
      {message.citations && message.citations.length > 0 && (
        <div className="mt-1.5 space-y-1 border-l-2 border-neutral-200 pl-3">
          {message.citations.map((citation, i) => (
            <div key={i} className="text-xs text-muted-foreground">
              <span className="font-medium">[{citation.chapterTitle}]</span>{" "}
              "{citation.text.slice(0, 100)}…"
            </div>
          ))}
        </div>
      )}

      {/* tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {message.toolCalls.map((tc) => (
            <ToolCallDisplay key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}

      {/* action buttons — visible on hover */}
      <div className="-ml-1.5 mt-0.5 flex items-center gap-0 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
    </div>
  );
}
