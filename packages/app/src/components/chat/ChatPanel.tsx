/**
 * ChatPanel — book-scoped sidebar chat panel.
 */
import { useStreamingChat } from "@/hooks/use-streaming-chat";
import { convertToMessageV2, mergeMessagesWithStreaming } from "@/lib/chat-utils";
import { useChatStore } from "@/stores/chat-store";
import type { Book } from "@/types";
import { Brain, History, MessageCirclePlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatInput, type AttachedQuote } from "./ChatInput";
import { MessageList } from "./MessageList";

interface ChatPanelProps {
  book?: Book | null;
}

export function ChatPanel({ book }: ChatPanelProps) {
  const { t } = useTranslation();
  const bookId = book?.id;

  const {
    threads,
    loadThreads,
    createThread,
    removeThread,
    setBookActiveThread,
    getActiveThreadId,
    getThreadsForContext,
  } = useChatStore();

  // Use streaming chat hook with book context
  const {
    isStreaming,
    currentMessage,
    currentStep,
    sendMessage,
    stopStream,
  } = useStreamingChat({
    book: book || null,
    bookId,
  });

  // Load book threads on mount
  useEffect(() => {
    if (bookId) {
      loadThreads(bookId);
    }
  }, [bookId, loadThreads]);

  const activeThreadId = bookId ? getActiveThreadId(bookId) : null;
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const bookThreads = bookId ? getThreadsForContext(bookId) : [];

  const [showThreadList, setShowThreadList] = useState(false);
  const [attachedQuotes, setAttachedQuotes] = useState<AttachedQuote[]>([]);

  const handleSend = useCallback(
    (content: string, deepThinking: boolean = false, quotes?: AttachedQuote[]) => {
      sendMessage(content, bookId, deepThinking, quotes);
      // Clear quotes after sending
      setAttachedQuotes([]);
    },
    [sendMessage, bookId],
  );

  const handleRemoveQuote = useCallback((id: string) => {
    setAttachedQuotes((prev) => prev.filter((q) => q.id !== id));
  }, []);

  // Listen for "Ask AI" from reader selection — now adds quote to input instead of sending immediately
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.bookId === bookId && detail?.selectedText) {
        const newQuote: AttachedQuote = {
          id: crypto.randomUUID(),
          text: detail.selectedText,
          source: detail.chapterTitle,
        };
        setAttachedQuotes((prev) => {
          // Avoid duplicate text
          if (prev.some((q) => q.text === newQuote.text)) return prev;
          return [...prev, newQuote];
        });
      }
    };
    window.addEventListener("ask-ai-from-reader", handler);
    return () => window.removeEventListener("ask-ai-from-reader", handler);
  }, [bookId]);

  const handleNewThread = useCallback(async () => {
    if (bookId) {
      await createThread(bookId);
    }
  }, [bookId, createThread]);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      if (bookId) {
        setBookActiveThread(bookId, threadId);
      }
      setShowThreadList(false);
    },
    [bookId, setBookActiveThread],
  );

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      await removeThread(threadId);
    },
    [removeThread],
  );

  const displayMessages = activeThread?.messages || [];

  // Build message list with streaming message
  const storeMessages = convertToMessageV2(displayMessages);
  const allMessages = mergeMessagesWithStreaming(storeMessages, currentMessage, isStreaming);

  const SUGGESTIONS = [
    t("chat.suggestions.summarizeChapter"),
    t("chat.suggestions.explainConcepts"),
    t("chat.suggestions.analyzeAuthor"),
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header with thread controls */}
      <div className="flex h-8 shrink-0 items-center justify-between px-3">
        <button
          type="button"
          onClick={() => setShowThreadList(!showThreadList)}
          className="flex items-center gap-1 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title={t("chat.history")}
        >
          <History className="size-3.5" />
          {bookThreads.length > 1 && (
            <span className="text-[10px]">{bookThreads.length}</span>
          )}
        </button>
        <button
          type="button"
          onClick={handleNewThread}
          className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title={t("chat.newChat")}
        >
          <MessageCirclePlus className="size-3.5" />
        </button>
      </div>

      {/* Thread list dropdown */}
      {showThreadList && bookThreads.length > 0 && (
        <div className="border-b border-border/40 px-2 pb-2">
          <div className="max-h-40 overflow-y-auto">
            {bookThreads.map((thread) => (
              <div
                key={thread.id}
                className={`group flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors ${
                  thread.id === activeThreadId
                    ? "bg-primary/10 text-primary"
                    : "text-neutral-600 hover:bg-muted"
                }`}
                onClick={() => handleSelectThread(thread.id)}
              >
                <span className="truncate">
                  {thread.title || t("chat.newChat")}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteThread(thread.id);
                  }}
                  className="hidden shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages or empty state */}
      <div className="flex-1 overflow-hidden">
        {allMessages.length > 0 ? (
          <MessageList 
            messages={allMessages} 
            isStreaming={isStreaming}
            currentStep={currentStep}
            onStop={stopStream}
          />
        ) : (
          <div className="flex h-full flex-col items-start justify-end gap-3 overflow-y-auto p-4 pb-6">
            <div className="flex flex-col items-start gap-3 pl-1">
              <div className="rounded-full bg-muted/70 p-2.5">
                <Brain className="size-6 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-neutral-900">
                  {t("chat.aiAssistant")}
                </h3>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {t("chat.aiAssistantDesc")}
                </p>
              </div>
            </div>
            <div className="w-full space-y-0.5">
              {SUGGESTIONS.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => handleSend(text)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-muted/70"
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-2 pb-2 pt-1">
        <ChatInput
          onSend={handleSend}
          disabled={isStreaming}
          placeholder={t("chat.askBookPlaceholder")}
          quotes={attachedQuotes}
          onRemoveQuote={handleRemoveQuote}
        />
      </div>
    </div>
  );
}
