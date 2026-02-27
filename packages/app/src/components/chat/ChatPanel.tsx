/**
 * ChatPanel — book-scoped sidebar chat panel.
 */
import { useStreamingChat } from "@/hooks/use-streaming-chat";
import { useChatStore } from "@/stores/chat-store";
import type { Book, MessageV2 } from "@/types";
import { Brain, History, MessageCirclePlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatInput } from "./ChatInput";
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

  const handleSend = useCallback(
    (content: string, deepThinking: boolean = false) => {
      sendMessage(content, bookId, deepThinking);
    },
    [sendMessage, bookId],
  );

  // Listen for "Ask AI" from reader selection
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.bookId === bookId && detail?.question) {
        const prompt = detail.selectedText
          ? `关于以下文本：\n> ${detail.selectedText.slice(0, 300)}\n\n${detail.question}`
          : detail.question;
        handleSend(prompt);
      }
    };
    window.addEventListener("ask-ai-from-reader", handler);
    return () => window.removeEventListener("ask-ai-from-reader", handler);
  }, [bookId, handleSend]);

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
  
  // Convert old message format to MessageV2 format with parts
  const convertToMessageV2 = (messages: any[]): MessageV2[] => {
    return messages.map((m) => {
      const parts: any[] = [];
      
      // Add reasoning parts
      if (m.reasoning && m.reasoning.length > 0) {
        m.reasoning.forEach((r: any) => {
          parts.push({
            id: r.id || `reasoning-${Date.now()}`,
            type: "reasoning",
            text: r.content,
            thinkingType: r.type,
            status: "completed",
            createdAt: r.timestamp || m.createdAt,
          });
        });
      }
      
      // Add tool call parts
      if (m.toolCalls && m.toolCalls.length > 0) {
        m.toolCalls.forEach((tc: any) => {
          parts.push({
            id: tc.id,
            type: "tool_call",
            name: tc.name,
            args: tc.args,
            result: tc.result,
            status: tc.status || "completed",
            createdAt: m.createdAt,
          });
        });
      }
      
      // Add text part
      if (m.content) {
        parts.push({
          id: `text-${m.id}`,
          type: "text",
          text: m.content,
          status: "completed",
          createdAt: m.createdAt,
        });
      }
      
      return {
        id: m.id,
        threadId: m.threadId,
        role: m.role,
        parts,
        createdAt: m.createdAt,
      };
    });
  };

  // Build message list with streaming message
  const allMessages: MessageV2[] = isStreaming && currentMessage
    ? [...convertToMessageV2(displayMessages), currentMessage]
    : convertToMessageV2(displayMessages);

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
        />
      </div>
    </div>
  );
}
