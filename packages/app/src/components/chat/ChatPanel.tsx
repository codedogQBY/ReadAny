/**
 * ChatPanel — book-scoped sidebar chat panel.
 */
import { ConfigGuideDialog, type ConfigGuideType } from "@/components/shared/ConfigGuideDialog";
import { useStreamingChat } from "@/hooks/use-streaming-chat";
import { useReadingContext } from "@/lib/ai/reading-context-service";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getPlatformService } from "@readany/core/services";
import type { Book, CitationPart } from "@readany/core/types";
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
  ClipboardCopy,
  Download,
  FileJson,
  FileText,
  History,
  MessageCirclePlus,
  Quote,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type AttachedQuote, ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";
import { ModelSelector } from "./ModelSelector";

interface ChatPanelProps {
  book?: Book | null;
  onNavigateToCitation?: (citation: CitationPart) => void;
}

export function ChatPanel({ book, onNavigateToCitation }: ChatPanelProps) {
  const { t } = useTranslation();
  const bookId = book?.id;

  const threads = useChatStore((s) => s.threads);
  const loadThreads = useChatStore((s) => s.loadThreads);
  const createThread = useChatStore((s) => s.createThread);
  const removeThread = useChatStore((s) => s.removeThread);
  const setBookActiveThread = useChatStore((s) => s.setBookActiveThread);
  const getActiveThreadId = useChatStore((s) => s.getActiveThreadId);
  const getThreadsForContext = useChatStore((s) => s.getThreadsForContext);

  // Use streaming chat hook with book context
  const { isStreaming, currentMessage, currentStep, sendMessage, stopStream } = useStreamingChat({
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
  const readerContext = useReadingContext();
  const activeReaderContext =
    readerContext && readerContext.bookId === bookId ? readerContext : null;
  const firstBookThreadId = bookThreads[0]?.id;

  useEffect(() => {
    if (bookId && !activeThreadId && firstBookThreadId) {
      setBookActiveThread(bookId, firstBookThreadId);
    }
  }, [activeThreadId, bookId, firstBookThreadId, setBookActiveThread]);

  const [showThreadList, setShowThreadList] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [attachedQuotes, setAttachedQuotes] = useState<AttachedQuote[]>([]);
  const [configGuide, setConfigGuide] = useState<ConfigGuideType>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!showThreadList) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowThreadList(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showThreadList]);

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

  const handleSend = useCallback(
    (content: string, deepThinking = false, spoilerFree = false, quotes?: AttachedQuote[]) => {
      const { aiConfig } = useSettingsStore.getState();
      const endpoint = aiConfig.endpoints.find((e) => e.id === aiConfig.activeEndpointId);
      const needsKey = endpoint ? providerRequiresApiKey(endpoint.provider) : true;
      if (!endpoint || (needsKey && !endpoint.apiKey) || !aiConfig.activeModel) {
        setConfigGuide("ai");
        return;
      }

      sendMessage(content, bookId, deepThinking, spoilerFree, quotes);
      setAttachedQuotes([]);
    },
    [sendMessage, bookId],
  );

  const handleRemoveQuote = useCallback((id: string) => {
    setAttachedQuotes((prev) => prev.filter((q) => q.id !== id));
  }, []);

  const attachCurrentSelection = useCallback(() => {
    const context = activeReaderContext;
    if (!context?.selection?.text) return;
    const selection = context.selection;

    const newQuote: AttachedQuote = {
      id: crypto.randomUUID(),
      text: selection.text,
      source: selection.chapterTitle || context.currentChapter.title,
    };

    setAttachedQuotes((prev) => {
      if (prev.some((quote) => quote.text === newQuote.text)) return prev;
      return [...prev, newQuote];
    });
  }, [activeReaderContext]);

  // Check for pending quote when component mounts (from reader selection when panel was closed)
  useEffect(() => {
    const pendingKey = `pending-ai-quote-${bookId}`;
    const pending = sessionStorage.getItem(pendingKey);
    if (pending) {
      try {
        const detail = JSON.parse(pending);
        if (detail?.selectedText) {
          const newQuote: AttachedQuote = {
            id: crypto.randomUUID(),
            text: detail.selectedText,
            source: detail.chapterTitle,
          };
          setAttachedQuotes((prev) => {
            if (prev.some((q) => q.text === newQuote.text)) return prev;
            return [...prev, newQuote];
          });
        }
      } catch {
        // Ignore parse errors
      }
      sessionStorage.removeItem(pendingKey);
    }
  }, [bookId]);

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
    if (!bookId) return;
    // If current thread is already empty (new conversation), don't create another
    if (activeThread && activeThread.messages.length === 0) return;
    await createThread(bookId);
  }, [bookId, activeThread, createThread]);

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
  const activeCurrentMessage =
    activeThread?.id === currentMessage?.threadId ? currentMessage : null;
  const allMessages = mergeMessagesWithStreaming(storeMessages, activeCurrentMessage, isStreaming);

  const exportTitle = activeThread?.title || book?.meta?.title || t("chat.aiAssistant");

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

  const SUGGESTIONS = [
    t("chat.suggestions.summarizeChapter"),
    t("chat.suggestions.explainConcepts"),
    t("chat.suggestions.analyzeAuthor"),
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header with thread controls */}
      <div className="relative flex h-8 shrink-0 items-center justify-between px-3">
        <button
          type="button"
          onClick={() => setShowThreadList(!showThreadList)}
          className={`flex items-center gap-1 rounded-full p-1 transition-colors ${
            showThreadList
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          title={t("chat.history")}
        >
          <History className="size-3.5" />
          {bookThreads.length > 1 && <span className="text-[10px]">{bookThreads.length}</span>}
        </button>
        <div className="flex items-center gap-1">
          <ModelSelector />
          {allMessages.length > 0 && (
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title={t("chat.export")}
              >
                <Download className="size-3.5" />
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
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title={t("chat.newChat")}
          >
            <MessageCirclePlus className="size-3.5" />
          </button>
        </div>

        {/* Thread list popover */}
        {showThreadList && (
          <div
            ref={popoverRef}
            className="absolute left-1 right-1 top-8 z-50 animate-in fade-in slide-in-from-top-1 duration-150 rounded-lg border border-border/60 bg-background shadow-lg"
          >
            <div className="max-h-56 space-y-1 overflow-y-auto p-1.5">
              {bookThreads.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {t("chat.noConversations")}
                </p>
              ) : (
                (() => {
                  const grouped = groupThreadsByTime(bookThreads);
                  const sections: { key: string; label: string; threads: typeof bookThreads }[] = [
                    { key: "today", label: t("chat.today"), threads: grouped.today },
                    { key: "yesterday", label: t("chat.yesterday"), threads: grouped.yesterday },
                    { key: "last7Days", label: t("chat.last7Days"), threads: grouped.last7Days },
                    { key: "last30Days", label: t("chat.last30Days"), threads: grouped.last30Days },
                  ];

                  const olderByMonth = new Map<string, typeof bookThreads>();
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
                      <div key={key}>
                        <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
                          {label}
                        </div>
                        {threads.map((thread) => {
                          const lastMsg =
                            thread.messages.length > 0
                              ? thread.messages[thread.messages.length - 1]
                              : null;
                          const preview = lastMsg?.content?.slice(0, 60) || "";
                          return (
                            <div
                              key={thread.id}
                              className={`group flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 transition-colors ${
                                thread.id === activeThreadId
                                  ? "bg-primary/10 text-primary"
                                  : "text-foreground hover:bg-muted"
                              }`}
                              onClick={() => handleSelectThread(thread.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handleSelectThread(thread.id);
                                }
                              }}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-xs font-medium">
                                    {thread.title || t("chat.newChat")}
                                  </span>
                                  <span className="shrink-0 text-[10px] text-muted-foreground/50">
                                    {formatRelativeTimeShort(thread.updatedAt, t)}
                                  </span>
                                </div>
                                {preview && (
                                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                    {preview}
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteThread(thread.id);
                                }}
                                className="mt-0.5 hidden shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:block"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()
              )}
            </div>
          </div>
        )}
      </div>

      {activeReaderContext ? (
        <div className="mx-3 mb-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-foreground">
                {activeReaderContext.currentChapter.title ||
                  book?.meta?.title ||
                  t("chat.aiAssistant")}
              </p>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {Math.round(activeReaderContext.currentPosition.percentage * 100)}%
                {activeReaderContext.selection?.text ? " · selected text ready" : ""}
              </p>
            </div>
            {activeReaderContext.selection?.text ? (
              <button
                type="button"
                onClick={attachCurrentSelection}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-[10px] text-primary hover:bg-primary/10"
              >
                <Quote className="size-3" />
                <span>Attach</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Messages or empty state */}
      <div className="flex-1 overflow-hidden">
        {allMessages.length > 0 ? (
          <MessageList
            messages={allMessages}
            isStreaming={isStreaming}
            currentStep={currentStep}
            onStop={stopStream}
            onCitationClick={onNavigateToCitation}
          />
        ) : (
          <div className="flex h-full flex-col items-start justify-end gap-3 overflow-y-auto p-4 pb-6">
            <div className="flex flex-col items-start gap-3 pl-1">
              <img src="/think.svg" alt="" className="h-28 w-28 shrink-0 dark:invert" />
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-foreground">{t("chat.aiAssistant")}</h3>
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
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted/70"
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
          onStop={stopStream}
          isStreaming={isStreaming}
          placeholder={t("chat.askBookPlaceholder")}
          quotes={attachedQuotes}
          onRemoveQuote={handleRemoveQuote}
        />
      </div>

      <ConfigGuideDialog type={configGuide} onClose={() => setConfigGuide(null)} />
    </div>
  );
}
