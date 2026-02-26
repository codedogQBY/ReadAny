import { Button } from "@/components/ui/button";
import { useStreamingChat } from "@/hooks/use-streaming-chat";
/**
 * ChatPanel — sidebar chat panel with streaming AI support
 */
import { useChatStore } from "@/stores/chat-store";
import { Square } from "lucide-react";
import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";

export function ChatPanel() {
  const { threads, activeThreadId, isStreaming, streamingContent } = useChatStore();
  const activeThread = threads.find((t) => t.id === activeThreadId);

  const { sendMessage, stopStream } = useStreamingChat();

  const handleSend = (content: string) => {
    sendMessage(content, activeThread?.bookId);
  };

  // Build messages with streaming content appended
  const displayMessages = activeThread?.messages || [];
  const allMessages =
    isStreaming && streamingContent
      ? [
          ...displayMessages,
          {
            id: "streaming",
            threadId: activeThread?.id || "",
            role: "assistant" as const,
            content: streamingContent,
            createdAt: Date.now(),
          },
        ]
      : displayMessages;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        {allMessages.length > 0 ? (
          <MessageList messages={allMessages} />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            Start a conversation about your book
          </div>
        )}
      </div>

      {isStreaming && (
        <div className="flex justify-center px-3 pb-1">
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={stopStream}>
            <Square className="h-3 w-3" />
            Stop
          </Button>
        </div>
      )}

      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
