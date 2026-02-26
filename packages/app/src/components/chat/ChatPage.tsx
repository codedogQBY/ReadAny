import { useChatReaderStore } from "@/stores/chat-reader-store";
/**
 * ChatPage — standalone full-page chat
 */
import { useChatStore } from "@/stores/chat-store";
import { ChatInput } from "./ChatInput";
import { ContextPopover } from "./ContextPopover";
import { MessageList } from "./MessageList";

export function ChatPage() {
  const { threads, activeThreadId, sendMessage, addThread } = useChatStore();
  const { bookTitle } = useChatReaderStore();
  const activeThread = threads.find((t) => t.id === activeThreadId);

  const handleSend = (content: string) => {
    if (!activeThreadId) {
      const thread = {
        id: crypto.randomUUID(),
        title: content.slice(0, 50),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addThread(thread);
      sendMessage(thread.id, content);
    } else {
      sendMessage(activeThreadId, content);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h2 className="text-lg font-medium">{bookTitle ? `Chat — ${bookTitle}` : "Chat"}</h2>
        <ContextPopover />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {activeThread ? (
            <MessageList messages={activeThread.messages} />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Start a new conversation
            </div>
          )}
        </div>
        <div className="border-t border-border p-4">
          <ChatInput onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}
