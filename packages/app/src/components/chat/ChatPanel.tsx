import { ConfigGuideDialog, type ConfigGuideType } from "@/components/shared/ConfigGuideDialog";
import { useSocraticChat } from "@/hooks/use-socratic-chat";
/**
 * ChatPanel — book-scoped sidebar chat panel.
 */
import { useStreamingChat } from "@/hooks/use-streaming-chat";
import { conversationExportService, type ExportTemplateType } from "@/lib/conversation-export";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getPlatformService } from "@readany/core/services";
import type { AIConfig, Book, CitationPart } from "@readany/core/types";
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
  Loader2,
  MessageCirclePlus,
  Sparkles,
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
  
  // Get AI config for manual preheating strategy
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const socraticSettings = aiConfig.socraticSettings || {
    enabled: false,
    mode: "socratic" as const,
    knowledgeScope: "current_chapter" as const,
    questionComplexity: "medium" as const,
    enablePreheating: true,
    preheatingStrategy: "smart" as const,
    enableWebSearch: false,
  };

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
  const { isStreaming, currentMessage, currentStep, sendMessage, stopStream } = useStreamingChat({
    book: book || null,
    bookId,
  });

  // Use socratic chat hook for preheating support
  const { startPreheating, processCommand, addUserAnswer, getSystemPrompt, isPreheatingComplete } =
    useSocraticChat({
      book: book || null,
      bookId,
    });

  // Handle preheating trigger from sessionStorage
  useEffect(() => {
    if (!bookId) return;
    const preheatKey = `preheating-start-${bookId}`;
    const shouldPreheat = sessionStorage.getItem(preheatKey);
    console.log("[ChatPanel] Checking preheating:", { bookId, shouldPreheat });
    if (shouldPreheat === "true") {
      sessionStorage.removeItem(preheatKey);
      console.log("[ChatPanel] Starting preheating...");
      startPreheating();
      // Send initial preheating message after a short delay to ensure thread is ready
      setTimeout(() => {
        const aiConfig = useSettingsStore.getState().aiConfig;
        const socraticSettings = aiConfig.socraticSettings || {
          mode: "socratic",
          knowledgeScope: "book_summary",
        };
        // const bookTitle = book?.meta?.title || "这本书";
        const mode = socraticSettings.mode || "socratic";
        // const scope = socraticSettings.knowledgeScope || "book_summary";
        
        // Use socratic system prompt for preheating (hidden from user)
        const socraticSystemPrompt = getSystemPrompt();
        const aiConfigOverride = socraticSystemPrompt
          ? {
              ...aiConfig,
              customPrompt: socraticSystemPrompt,
            }
          : undefined;

        // Send a simple trigger message instead of the full prompt
        const triggerMessage = `开始${mode === "socratic" ? "苏格拉底式" : mode}预热`;
        console.log("[ChatPanel] Sending preheating trigger:", triggerMessage);
        sendMessage(triggerMessage, bookId, false, false, undefined, aiConfigOverride);
      }, 500);
    }
  }, [bookId, startPreheating, sendMessage, book, getSystemPrompt]);

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
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [attachedQuotes, setAttachedQuotes] = useState<AttachedQuote[]>([]);
  const [configGuide, setConfigGuide] = useState<ConfigGuideType>(null);
  const [exporting, setExporting] = useState(false);
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

      // Check if this is a command
      if (content.trim().startsWith("/")) {
        const result = processCommand(content);
        if (result?.success) {
          // Get socratic system prompt for command responses too
          let aiConfigOverride: AIConfig | undefined;
          if (aiConfig.chatMode === "socratic") {
            const socraticSystemPrompt = getSystemPrompt();
            if (socraticSystemPrompt) {
              aiConfigOverride = {
                ...aiConfig,
                customPrompt: socraticSystemPrompt,
              };
            }
          }
          // Add command as user message
          sendMessage(content, bookId, deepThinking, spoilerFree, quotes, aiConfigOverride);
          // Send system response
          setTimeout(() => {
            sendMessage(
              result.message || "命令已执行",
              bookId,
              false,
              false,
              undefined,
              aiConfigOverride,
            );
          }, 100);
          setAttachedQuotes([]);
          return;
        }
      }

      // In socratic mode, track user answers and use socratic system prompt
      let aiConfigOverride: AIConfig | undefined;
      if (aiConfig.chatMode === "socratic") {
        if (!isPreheatingComplete) {
          addUserAnswer(content);
        }
        const socraticSystemPrompt = getSystemPrompt();
        if (socraticSystemPrompt) {
          aiConfigOverride = {
            ...aiConfig,
            customPrompt: socraticSystemPrompt,
          };
        }
      }

      sendMessage(content, bookId, deepThinking, spoilerFree, quotes, aiConfigOverride);
      setAttachedQuotes([]);
    },
    [sendMessage, bookId, processCommand, addUserAnswer, isPreheatingComplete, getSystemPrompt],
  );

  const handleRemoveQuote = useCallback((id: string) => {
    setAttachedQuotes((prev) => prev.filter((q) => q.id !== id));
  }, []);

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
  const allMessages = mergeMessagesWithStreaming(storeMessages, currentMessage, isStreaming);

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

  // AI-enhanced export using conversationExportService
  const handleAIExport = useCallback(async (templateType: ExportTemplateType) => {
    setShowExportMenu(false);
    setExporting(true);
    try {
      const convMessages = allMessages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant" | "system",
        content: m.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n"),
        timestamp: m.createdAt ?? Date.now(),
      }));

      const result = await conversationExportService.exportConversation(
        convMessages,
        book?.meta?.title || t("chat.aiAssistant"),
        activeThread?.title || "",
        {
          template: templateType,
          format: "markdown",
          includeMetadata: true,
          useAIEnhancement: true,
        },
      );

      const platform = getPlatformService();
      await platform.shareOrDownloadFile(result.content, result.filename, result.mimeType);
      toast.success(t("chat.exportSuccess"));
    } catch (err) {
      console.error("[ChatPanel] AI export failed:", err);
      toast.error(t("chat.exportFailed", "导出失败"));
    } finally {
      setExporting(false);
    }
  }, [allMessages, book, activeThread, t]);

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
                <div className="absolute right-0 top-full z-50 mt-1 min-w-52 animate-in fade-in slide-in-from-top-1 rounded-lg border bg-popover p-1.5 shadow-lg">
                  {/* AI Enhanced Exports */}
                  <div className="px-2 py-1 text-[10px] font-medium text-primary/70 uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="size-3" />
                    {t("chat.aiExport", "AI 智能导出")}
                  </div>
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={() => handleAIExport("summary")}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {exporting ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <Sparkles className="size-4 shrink-0 text-primary" />}
                    <span className="flex-1 whitespace-nowrap text-left">
                      {t("chat.exportAISummary", "AI 对话摘要")}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={() => handleAIExport("key_insights")}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {exporting ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <Sparkles className="size-4 shrink-0 text-primary" />}
                    <span className="flex-1 whitespace-nowrap text-left">
                      {t("chat.exportAIInsights", "AI 核心洞察")}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={() => handleAIExport("chapter_notes")}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {exporting ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <BookOpen className="size-4 shrink-0 text-primary" />}
                    <span className="flex-1 whitespace-nowrap text-left">
                      {t("chat.exportAIChapterNotes", "AI 章节笔记")}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={() => handleAIExport("questions_answers")}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {exporting ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <Sparkles className="size-4 shrink-0 text-primary" />}
                    <span className="flex-1 whitespace-nowrap text-left">
                      {t("chat.exportAIQA", "AI 问答整理")}
                    </span>
                  </button>

                  <div className="mx-2 my-1 border-t" />
                  {/* Standard Exports */}
                  <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                    {t("chat.standardExport", "标准导出")}
                  </div>
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
                    olderByMonth.get(monthLabel)?.push(thread);
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
                            <button
                              type="button"
                              key={thread.id}
                              className={`group flex w-full cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                                thread.id === activeThreadId
                                  ? "bg-primary/10 text-primary"
                                  : "text-neutral-600 hover:bg-muted"
                              }`}
                              onClick={() => handleSelectThread(thread.id)}
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
                            </button>
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
            {/* Manual preheating trigger button */}
            {aiConfig.chatMode === "socratic" && 
             socraticSettings.enablePreheating && 
             socraticSettings.preheatingStrategy === "manual" && 
             allMessages.length === 0 && (
              <button
                onClick={() => {
                  console.log("[ChatPanel] Manual preheating triggered");
                  // Set flag and trigger preheating via sessionStorage check
                  sessionStorage.setItem(`preheating-start-${bookId}`, "true");
                  // Dispatch custom event to notify SocraticReaderWrapper
                  window.dispatchEvent(new CustomEvent('trigger-preheating', { detail: { bookId } }));
                }}
                className="w-full rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/10"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">{t("chat.startPreheating", "开始思维预热")}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("chat.preheatingDesc", "AI将提出引导性问题，帮助您建立阅读框架")}
                </p>
              </button>
            )}
            
            <div className="flex flex-col items-start gap-3 pl-1">
              <img src="/think.svg" alt="" className="h-28 w-28 shrink-0 dark:invert" />
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-neutral-900">{t("chat.aiAssistant")}</h3>
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
