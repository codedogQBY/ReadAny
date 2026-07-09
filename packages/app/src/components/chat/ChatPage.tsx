/**
 * ChatPage — standalone full-page chat for general conversations.
 */
import { ConfigGuideDialog, type ConfigGuideType } from "@/components/shared/ConfigGuideDialog";
import { useStreamingChat } from "@/hooks/use-streaming-chat";
import { getBook as getBookRecord } from "@/lib/db/database";
import { openDesktopBook } from "@/lib/library/open-book";
import { useChatReaderStore } from "@/stores/chat-reader-store";
import { useChatStore } from "@/stores/chat-store";
import { useLibraryStore } from "@/stores/library-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getPlatformService } from "@readany/core/services";
import type { CitationPart } from "@readany/core/types";
import {
  convertToMessageV2,
  exportChatAsJSON,
  exportChatAsMarkdown,
  formatChatForClipboard,
  formatRelativeTimeShort,
  getExportFilename,
  getMonthLabel,
  groupThreadsByTime,
  mergeMessagesWithStreaming,
  providerRequiresApiKey,
} from "@readany/core/utils";
import {
  BookOpen,
  ClipboardCopy,
  Download,
  FileJson,
  FileText,
  History,
  Library,
  Lightbulb,
  MessageCirclePlus,
  ScrollText,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChatInput } from "./ChatInput";
import { ContextPopover } from "./ContextPopover";
import { MessageList } from "./MessageList";
import { ModelSelector } from "./ModelSelector";

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
  const getThreadsForContext = useChatStore((s) => s.getThreadsForContext);
  const getActiveThreadId = useChatStore((s) => s.getActiveThreadId);
  const removeThread = useChatStore((s) => s.removeThread);
  const generalThreads = getThreadsForContext();
  const activeThreadId = getActiveThreadId();

  return (
    <div
      className={`absolute inset-0 z-50 ${open ? "pointer-events-auto" : "pointer-events-none"}`}
    >
      <button
        type="button"
        aria-label={t("common.close")}
        className={`absolute inset-0 transition-opacity duration-300 ${open ? "bg-black/5 opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`absolute left-0 top-0 h-full w-72 transform rounded-r-2xl border-r bg-background px-3 py-3 shadow-lg transition-all duration-300 ease-out flex flex-col ${open ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"}`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{t("chat.history")}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {generalThreads.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t("chat.noConversations")}
            </p>
          )}
          {(() => {
            const grouped = groupThreadsByTime(generalThreads);
            const sections: { key: string; label: string; threads: typeof generalThreads }[] = [
              { key: "today", label: t("chat.today"), threads: grouped.today },
              { key: "yesterday", label: t("chat.yesterday"), threads: grouped.yesterday },
              { key: "last7Days", label: t("chat.last7Days"), threads: grouped.last7Days },
              { key: "last30Days", label: t("chat.last30Days"), threads: grouped.last30Days },
            ];

            const olderByMonth = new Map<string, typeof generalThreads>();
            for (const thread of grouped.older) {
              const monthLabel = getMonthLabel(thread.updatedAt);
              if (!olderByMonth.has(monthLabel)) {
                olderByMonth.set(monthLabel, []);
              }
              const monthThreads = olderByMonth.get(monthLabel);
              if (monthThreads) {
                monthThreads.push(thread);
              }
            }
            const sortedMonths = [...olderByMonth.keys()].sort((a, b) => b.localeCompare(a));
            for (const month of sortedMonths) {
              const monthThreads = olderByMonth.get(month);
              if (monthThreads) {
                sections.push({ key: month, label: month, threads: monthThreads });
              }
            }

            return sections.map(({ key, label, threads }) => {
              if (threads.length === 0) return null;
              return (
                <div key={key} className="mb-2">
                  <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground">
                    {label}
                  </div>
                  {threads.map((thread) => {
                    const lastMsg =
                      thread.messages.length > 0
                        ? thread.messages[thread.messages.length - 1]
                        : null;
                    const preview = lastMsg?.content?.slice(0, 80) || "";
                    return (
                      <div
                        key={thread.id}
                        onClick={() => {
                          onSelect(thread.id);
                          onClose();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelect(thread.id);
                            onClose();
                          }
                        }}
                        className={`group flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2.5 transition-colors ${thread.id === activeThreadId ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">
                              {thread.title || t("chat.newChat")}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground/50">
                              {formatRelativeTimeShort(thread.updatedAt, t)}
                            </span>
                          </div>
                          {preview && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {preview}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeThread(thread.id);
                          }}
                          className="mt-0.5 hidden shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:block"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}
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
    { key: "chat.suggestions.findConcepts", icon: Library },
    { key: "chat.suggestions.generateNotes", icon: BookOpen },
  ] as const;

  return (
    <div className="flex h-full w-full select-none items-center justify-center overflow-y-auto p-6">
      <div className="flex items-center gap-12">
        <img src="/think.svg" alt="" className="h-52 w-52 shrink-0 dark:invert" />
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{t("chat.howCanIHelp")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("chat.askAboutBooks")}</p>
          </div>
          <div>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              {t("chat.getStarted")}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {SUGGESTIONS.map(({ key, icon: Icon }) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => onSuggestionClick(t(key))}
                  className="flex cursor-pointer flex-col items-start gap-3 rounded-xl bg-muted/70 p-4 text-left transition-colors hover:bg-muted"
                >
                  <Icon className="size-5 text-muted-foreground" />
                  <span className="text-sm text-foreground">{t(key)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatPage() {
  const { t } = useTranslation();
  const threads = useChatStore((s) => s.threads);
  const initialized = useChatStore((s) => s.initialized);
  const loadAllThreads = useChatStore((s) => s.loadAllThreads);
  const createThread = useChatStore((s) => s.createThread);
  const setGeneralActiveThread = useChatStore((s) => s.setGeneralActiveThread);
  const getActiveThreadId = useChatStore((s) => s.getActiveThreadId);
  const { bookTitle } = useChatReaderStore();
  const books = useLibraryStore((s) => s.books);

  // /chats page should only use general threads - always pass undefined for bookId
  const { isStreaming, currentMessage, currentStep, sendMessage, stopStream } = useStreamingChat();

  const [showThreads, setShowThreads] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [configGuide, setConfigGuide] = useState<ConfigGuideType>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialized) {
      loadAllThreads();
    }
  }, [initialized, loadAllThreads]);

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showExportMenu]);

  const activeThreadId = getActiveThreadId();
  const activeThread = threads.find((t) => t.id === activeThreadId);

  const handleSend = useCallback(
    async (content: string, deepThinking = false, spoilerFree = false) => {
      const { aiConfig } = useSettingsStore.getState();
      const endpoint = aiConfig.endpoints.find((e) => e.id === aiConfig.activeEndpointId);
      const needsKey = endpoint ? providerRequiresApiKey(endpoint.provider) : true;
      if (!endpoint || (needsKey && !endpoint.apiKey) || !aiConfig.activeModel) {
        setConfigGuide("ai");
        return;
      }

      // /chats page should only use general threads (no bookId)
      if (!activeThreadId) {
        await createThread(undefined, content.slice(0, 50));
        setTimeout(() => sendMessage(content, undefined, deepThinking, spoilerFree), 50);
      } else {
        sendMessage(content, undefined, deepThinking, spoilerFree);
      }
    },
    [activeThreadId, createThread, sendMessage],
  );

  const handleNewThread = useCallback(() => {
    setGeneralActiveThread(null);
  }, [setGeneralActiveThread]);

  const handleCitationClick = useCallback(
    async (citation: CitationPart) => {
      const book =
        books.find((item) => item.id === citation.bookId) ??
        (await getBookRecord(citation.bookId, { includeDeleted: true }).catch((err) => {
          console.warn("[ChatPage] Failed to get cited book record:", err);
          return null;
        }));

      if (!book) {
        toast.error(t("chat.citationBookNotFound", "找不到这条引用对应的书籍"));
        return;
      }

      const trimmedCfi = citation.cfi?.trim();
      const initialCfi = trimmedCfi || `chapter:${Math.max(0, Number(citation.chapterIndex) || 0)}`;

      const opened = await openDesktopBook({
        book,
        t,
        initialCfi,
      });

      if (!opened) {
        toast.error(t("chat.citationOpenFailed", "无法打开这条引用"));
      }
    },
    [books, t],
  );

  const displayMessages = convertToMessageV2(activeThread?.messages || []);
  const activeCurrentMessage =
    activeThread?.id === currentMessage?.threadId ? currentMessage : null;
  const allMessages = mergeMessagesWithStreaming(
    displayMessages,
    activeCurrentMessage,
    isStreaming,
  );

  const exportTitle = activeThread?.title || t("chat.aiAssistant");

  const exportOpts = useMemo(
    () => ({
      title: exportTitle,
      userLabel: t("chat.roleUser"),
      aiLabel: t("chat.roleAI"),
    }),
    [exportTitle, t],
  );

  const handleExportMarkdown = useCallback(async () => {
    setShowExportMenu(false);
    const md = exportChatAsMarkdown(allMessages, exportOpts);
    const filename = getExportFilename("md");
    const platform = getPlatformService();
    await platform.shareOrDownloadFile(md, filename, "text/markdown");
    toast.success(t("chat.exportSuccess"));
  }, [allMessages, exportOpts, t]);

  const handleExportJSON = useCallback(async () => {
    setShowExportMenu(false);
    const json = exportChatAsJSON(allMessages, exportOpts);
    const filename = getExportFilename("json");
    const platform = getPlatformService();
    await platform.shareOrDownloadFile(json, filename, "application/json");
    toast.success(t("chat.exportSuccess"));
  }, [allMessages, exportOpts, t]);

  const handleCopyAll = useCallback(async () => {
    setShowExportMenu(false);
    const text = formatChatForClipboard(allMessages, exportOpts);
    const platform = getPlatformService();
    await platform.copyToClipboard(text);
    toast.success(t("chat.copiedSuccess"));
  }, [allMessages, exportOpts, t]);

  return (
    <div className="relative flex h-full flex-col">
      <ThreadsSidebar
        open={showThreads}
        onClose={() => setShowThreads(false)}
        onSelect={(id) => setGeneralActiveThread(id)}
      />
      <div className="relative flex h-11 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowThreads(true)}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t("chat.history")}
          >
            <History className="size-4" />
          </button>
          {bookTitle && (
            <span className="text-xs text-muted-foreground">
              {t("chat.context")}: <span className="font-medium text-foreground">{bookTitle}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <ModelSelector />
          <ContextPopover />
          <div className="mx-1 h-4 w-px bg-border" />
          {allMessages.length > 0 && (
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t("chat.export")}
              >
                <Download className="size-4" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full z-50 mt-1 min-w-48 animate-in fade-in slide-in-from-top-1 rounded-lg border bg-popover p-1.5 shadow-lg">
                  <button
                    type="button"
                    onClick={handleExportMarkdown}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 whitespace-nowrap text-left">
                      {t("chat.exportMarkdown")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportJSON}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
                  >
                    <FileJson className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 whitespace-nowrap text-left">
                      {t("chat.exportJSON")}
                    </span>
                  </button>
                  <div className="mx-2 my-1 border-t" />
                  <button
                    type="button"
                    onClick={handleCopyAll}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
                  >
                    <ClipboardCopy className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 whitespace-nowrap text-left">{t("chat.copyAll")}</span>
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={handleNewThread}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t("chat.newChat")}
          >
            <MessageCirclePlus className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Message list or empty state - consistent container structure */}
        <div className="flex-1 overflow-hidden">
          {allMessages.length > 0 ? (
            <MessageList
              messages={allMessages}
              isStreaming={isStreaming}
              currentStep={currentStep}
              onStop={stopStream}
              onCitationClick={handleCitationClick}
            />
          ) : (
            <EmptyState onSuggestionClick={handleSend} />
          )}
        </div>

        {/* Input always at bottom with consistent position */}
        <div className="shrink-0 px-4 pb-3 pt-2">
          <ChatInput onSend={handleSend} onStop={stopStream} isStreaming={isStreaming} />
        </div>
      </div>

      <ConfigGuideDialog type={configGuide} onClose={() => setConfigGuide(null)} />
    </div>
  );
}
