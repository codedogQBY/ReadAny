/**
 * ChatPage — standalone full-page chat (sageread style)
 */
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
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatInput } from "./ChatInput";
import { ContextPopover } from "./ContextPopover";
import { MessageList } from "./MessageList";

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
  const { threads, activeThreadId, removeThread } = useChatStore();

  return (
    <div className={`absolute inset-0 z-50 ${open ? "pointer-events-auto" : "pointer-events-none"}`}>
      <div className={`absolute inset-0 transition-opacity duration-300 ${open ? "bg-black/5 opacity-100" : "opacity-0"}`} onClick={onClose} />
      <div className={`absolute left-0 top-0 h-full w-72 transform rounded-r-2xl border-r bg-background px-3 py-3 shadow-lg transition-all duration-300 ease-out ${open ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"}`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900">{t("chat.history")}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {threads.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">{t("chat.noConversations")}</p>
          )}
          {threads.map((thread) => (
            <div
              key={thread.id}
              onClick={() => { onSelect(thread.id); onClose(); }}
              className={`group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${thread.id === activeThreadId ? "bg-primary/10 text-primary" : "text-neutral-700 hover:bg-muted"}`}
            >
              <span className="truncate">{thread.title || t("chat.newChat")}</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); removeThread(thread.id); }} className="hidden rounded-full p-0.5 text-muted-foreground hover:text-destructive group-hover:block">
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

export function ChatPage() {
  const { t } = useTranslation();
  const { threads, activeThreadId, sendMessage, addThread, setActiveThread } = useChatStore();
  const { bookTitle } = useChatReaderStore();
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const [showThreads, setShowThreads] = useState(false);

  const handleSend = useCallback(
    (content: string) => {
      if (!activeThreadId) {
        const thread = { id: crypto.randomUUID(), title: content.slice(0, 50), messages: [], createdAt: Date.now(), updatedAt: Date.now() };
        addThread(thread);
        sendMessage(thread.id, content);
      } else {
        sendMessage(activeThreadId, content);
      }
    },
    [activeThreadId, addThread, sendMessage],
  );

  const handleNewThread = () => { setActiveThread(null as unknown as string); };
  const hasMessages = activeThread && activeThread.messages.length > 0;

  return (
    <div className="relative flex h-full flex-col">
      <ThreadsSidebar open={showThreads} onClose={() => setShowThreads(false)} onSelect={(id) => setActiveThread(id)} />
      <div className="relative flex h-10 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowThreads(true)} className="rounded-full p-1.5 text-neutral-600 hover:bg-muted">
            <History className="size-4" />
          </button>
          {bookTitle && (
            <span className="text-xs text-muted-foreground">
              {t("chat.context")}: <span className="font-medium text-neutral-700">{bookTitle}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <ContextPopover />
          <button type="button" onClick={handleNewThread} className="rounded-full p-1.5 text-neutral-600 hover:bg-muted">
            <MessageCirclePlus className="size-4" />
          </button>
        </div>
        {hasMessages && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-4 translate-y-full bg-gradient-to-b from-background to-transparent" />
        )}
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        {hasMessages ? (
          <>
            <div className="flex-1 overflow-hidden"><MessageList messages={activeThread.messages} /></div>
            <div className="shrink-0 px-4 pb-3 pt-2"><ChatInput onSend={handleSend} /></div>
          </>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <EmptyState onSuggestionClick={handleSend} />
            <div className="shrink-0 px-4 pb-3 pt-2"><ChatInput onSend={handleSend} /></div>
          </div>
        )}
      </div>
    </div>
  );
}
