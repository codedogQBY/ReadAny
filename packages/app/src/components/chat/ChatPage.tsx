/**
 * ChatPage — standalone full-page chat for general conversations.
 */
import { useStreamingChat } from "@/hooks/use-streaming-chat";
import { useChatReaderStore } from "@/stores/chat-reader-store";
import { useChatStore } from "@/stores/chat-store";
import {
  BookOpen,
  Brain,
  History,
  Lightbulb,
  MessageCirclePlus,
  ScrollText,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatInput } from "./ChatInput";
import { ContextPopover } from "./ContextPopover";
import { MessageList } from "./MessageList";
import type { MessageV2 } from "@/types/message";

function ThreadsSidebar({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (threadId: string) => void;
}) {
  const { t } = useTranslation();
  const { getThreadsForContext, getActiveThreadId, removeThread } = useChatStore();
  const generalThreads = getThreadsForContext();
  const activeThreadId = getActiveThreadId();

  return (
    <div className={`absolute inset-0 z-50 ${open ? "pointer-events-auto" : "pointer-events-none"}`}>
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${open ? "bg-black/5 opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`absolute left-0 top-0 h-full w-72 transform rounded-r-2xl border-r bg-background px-3 py-3 shadow-lg transition-all duration-300 ease-out ${open ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"}`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900">{t("chat.history")}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {generalThreads.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t("chat.noConversations")}
            </p>
          )}
          {generalThreads.map((thread) => (
            <div
              key={thread.id}
              onClick={() => {
                onSelect(thread.id);
                onClose();
              }}
              className={`group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${thread.id === activeThreadId ? "bg-primary/10 text-primary" : "text-neutral-700 hover:bg-muted"}`}
            >
              <span className="truncate">{thread.title || t("chat.newChat")}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeThread(thread.id);
                }}
                className="hidden rounded-full p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) {
  const { t } = useTranslation();
  const SUGGESTIONS = [
    { key: "chat.suggestions.summarizeReading", icon: ScrollText },
    { key: "chat.suggestions.analyzeArguments", icon: Lightbulb },
    { key: "chat.suggestions.findConcepts", icon: Search },
    { key: "chat.suggestions.generateNotes", icon: BookOpen },
  ] as const;

  return (
    <div className="flex h-full w-full select-none flex-col items-center justify-center overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-2xl space-y-8">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-full bg-primary/10 p-3">
            <Brain className="size-10 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900">{t("chat.howCanIHelp")}</h1>
          <p className="text-sm text-muted-foreground">{t("chat.askAboutBooks")}</p>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t("chat.getStarted")}</h2>
          <div className="grid grid-cols-2 gap-3">
            {SUGGESTIONS.map(({ key, icon: Icon }) => (
              <div
                key={key}
                onClick={() => onSuggestionClick(t(key))}
                className="flex cursor-pointer flex-col items-start gap-3 rounded-xl bg-muted/70 p-4 transition-colors hover:bg-muted"
              >
                <Icon className="size-5 text-muted-foreground" />
                <span className="text-sm text-neutral-700">{t(key)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function convertToMessageV2(messages: any[]): MessageV2[] {
  return messages.map((m) => {
    // If partsOrder is available, use it to reconstruct parts in the correct order
    if (m.partsOrder && Array.isArray(m.partsOrder) && m.partsOrder.length > 0) {
      const parts: any[] = [];
      const reasoningMap = new Map<string, any>();
      const toolCallMap = new Map<string, any>();

      if (m.reasoning) {
        for (const r of m.reasoning) {
          reasoningMap.set(r.id || `reasoning-${r.timestamp}`, r);
        }
      }
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          toolCallMap.set(tc.id, tc);
        }
      }

      for (const entry of m.partsOrder) {
        switch (entry.type) {
          case "text":
            parts.push({
              id: entry.id,
              type: "text",
              text: entry.text || m.content,
              status: "completed",
              createdAt: m.createdAt,
            });
            break;
          case "reasoning": {
            const r = reasoningMap.get(entry.id);
            if (r) {
              parts.push({
                id: entry.id,
                type: "reasoning",
                text: r.content,
                thinkingType: r.type,
                status: "completed",
                createdAt: r.timestamp || m.createdAt,
              });
            }
            break;
          }
          case "tool_call": {
            const tc = toolCallMap.get(entry.id);
            if (tc) {
              parts.push({
                id: tc.id,
                type: "tool_call",
                name: tc.name,
                args: tc.args,
                result: tc.result,
                status: tc.status || "completed",
                createdAt: m.createdAt,
              });
            }
            break;
          }
        }
      }

      return {
        id: m.id,
        threadId: m.threadId,
        role: m.role,
        parts,
        createdAt: m.createdAt,
      };
    }

    // Fallback: legacy format without partsOrder
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
}

export function ChatPage() {
  const { t } = useTranslation();
  const {
    threads,
    loadAllThreads,
    initialized,
    createThread,
    setGeneralActiveThread,
    getActiveThreadId,
  } = useChatStore();
  const { bookTitle } = useChatReaderStore();
  
  const {
    isStreaming,
    currentMessage,
    currentStep,
    sendMessage,
    stopStream,
  } = useStreamingChat();
  
  const [showThreads, setShowThreads] = useState(false);

  useEffect(() => {
    if (!initialized) {
      loadAllThreads();
    }
  }, [initialized, loadAllThreads]);

  const activeThreadId = getActiveThreadId();
  const activeThread = threads.find((t) => t.id === activeThreadId);

  const handleSend = useCallback(
    async (content: string, deepThinking: boolean = false) => {
      if (!activeThreadId) {
        await createThread(undefined, content.slice(0, 50));
        setTimeout(() => sendMessage(content, undefined, deepThinking), 50);
      } else {
        sendMessage(content, undefined, deepThinking);
      }
    },
    [activeThreadId, createThread, sendMessage],
  );

  const handleNewThread = useCallback(() => {
    setGeneralActiveThread(null);
  }, [setGeneralActiveThread]);

  const displayMessages = convertToMessageV2(activeThread?.messages || []);

  // Filter out any store message with the same ID as currentMessage to prevent duplicate keys
  const allMessages: MessageV2[] = isStreaming && currentMessage
    ? [...displayMessages.filter((m) => m.id !== currentMessage.id), currentMessage]
    : displayMessages;

  return (
    <div className="relative flex h-full flex-col">
      <ThreadsSidebar
        open={showThreads}
        onClose={() => setShowThreads(false)}
        onSelect={(id) => setGeneralActiveThread(id)}
      />
      <div className="relative flex h-10 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowThreads(true)}
            className="rounded-full p-1.5 text-neutral-600 hover:bg-muted"
          >
            <History className="size-4" />
          </button>
          {bookTitle && (
            <span className="text-xs text-muted-foreground">
              {t("chat.context")}:{" "}
              <span className="font-medium text-neutral-700">{bookTitle}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <ContextPopover />
          <button
            type="button"
            onClick={handleNewThread}
            className="rounded-full p-1.5 text-neutral-600 hover:bg-muted"
          >
            <MessageCirclePlus className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        {allMessages.length > 0 ? (
          <>
            <div className="flex-1 overflow-hidden">
              <MessageList 
                messages={allMessages} 
                isStreaming={isStreaming}
                currentStep={currentStep}
                onStop={stopStream}
              />
            </div>

            <div className="shrink-0 px-4 pb-3 pt-2">
              <ChatInput onSend={handleSend} disabled={isStreaming} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <EmptyState onSuggestionClick={handleSend} />
            <div className="shrink-0 px-4 pb-3 pt-2">
              <ChatInput onSend={handleSend} disabled={isStreaming} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
