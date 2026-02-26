/**
 * ChatPanel — sidebar chat panel with streaming AI support
 */
import { Button } from "@/components/ui/button";
import { useStreamingChat } from "@/hooks/use-streaming-chat";
import { useChatStore } from "@/stores/chat-store";
import { Brain, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";

export function ChatPanel() {
  const { t } = useTranslation();
  const { threads, activeThreadId, isStreaming, streamingContent } = useChatStore();
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const { sendMessage, stopStream } = useStreamingChat();

  const handleSend = (content: string) => { sendMessage(content, activeThread?.bookId); };

  const displayMessages = activeThread?.messages || [];
  const allMessages =
    isStreaming && streamingContent
      ? [...displayMessages, { id: "streaming", threadId: activeThread?.id || "", role: "assistant" as const, content: streamingContent, createdAt: Date.now() }]
      : displayMessages;

  const SUGGESTIONS = [
    t("chat.suggestions.summarizeChapter"),
    t("chat.suggestions.explainConcepts"),
    t("chat.suggestions.analyzeAuthor"),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        {allMessages.length > 0 ? (
          <MessageList messages={allMessages} />
        ) : (
          <div className="flex h-full flex-col items-start justify-end gap-3 overflow-y-auto p-4 pb-6">
            <div className="flex flex-col items-start gap-3 pl-1">
              <div className="rounded-full bg-muted/70 p-2.5"><Brain className="size-6 text-primary" /></div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-neutral-900">{t("chat.aiAssistant")}</h3>
                <p className="max-w-sm text-sm text-muted-foreground">{t("chat.aiAssistantDesc")}</p>
              </div>
            </div>
            <div className="w-full space-y-0.5">
              {SUGGESTIONS.map((text) => (
                <button key={text} type="button" onClick={() => handleSend(text)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-muted/70">
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {isStreaming && (
        <div className="flex justify-center px-3 pb-1">
          <Button variant="outline" size="sm" className="h-7 gap-1 rounded-full text-xs" onClick={stopStream}>
            <Square className="size-3" />{t("common.stop")}
          </Button>
        </div>
      )}
      <div className="shrink-0 px-2 pb-2 pt-1">
        <ChatInput onSend={handleSend} disabled={isStreaming} placeholder={t("chat.askBookPlaceholder")} />
      </div>
    </div>
  );
}
