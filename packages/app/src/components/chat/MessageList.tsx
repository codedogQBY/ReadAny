/**
 * MessageList — sageread-style scrollable message list
 * Messages centered in max-w-3xl container
 */
import type { Message } from "@/types";
import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-y-auto py-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
