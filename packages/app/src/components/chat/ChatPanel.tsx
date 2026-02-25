/**
 * ChatPanel — sidebar chat panel
 */
import { useChatStore } from "@/stores/chat-store";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";

export function ChatPanel() {
  const { threads, activeThreadId, addThread, sendMessage } = useChatStore();
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
      <div className="flex-1 overflow-hidden">
        {activeThread ? (
          <MessageList messages={activeThread.messages} />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            Start a conversation about your book
          </div>
        )}
      </div>
      <ChatInput onSend={handleSend} />
    </div>
  );
}
