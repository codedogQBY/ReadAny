import { useCallback, useMemo } from "react";
import { maybeCompressThreadMemory } from "../ai/chat-memory";
import { getBuiltinSkills } from "../ai/skills/builtin-skills";
import { StreamingChat, createMessageId } from "../ai/streaming";
import {
  applyToolResultToParts,
  markRunningToolCallPartsAsError,
  toolCallPartToMessageToolCall,
} from "../ai/tool-call-state";
import { getAvailableTools } from "../ai/tools";
import { getBook, getSkills as getDbSkills } from "../db/database";
import i18n from "../i18n";
import { getChatStreamingKey, useChatStore } from "../stores/chat-store";
import { useSettingsStore } from "../stores/settings-store";
import type {
  AIConfig,
  AttachedQuote,
  Book,
  CitationPart,
  MessageV2,
  Part,
  ReasoningPart,
  SemanticContext,
  Skill,
  TextPart,
  Thread,
  ToolCallPart,
} from "../types";
import {
  createAbortedPart,
  createCitationPart,
  createMindmapPart,
  createQuotePart,
  createReasoningPart,
  createTextPart,
  createToolCallPart,
} from "../types/message";
import type { MindmapPart } from "../types/message";

function buildPartsOrder(parts: Part[]) {
  return parts.map((p) => {
    const base = {
      type: p.type as "text" | "reasoning" | "tool_call" | "citation" | "mindmap",
      id: p.id,
    };
    if (p.type === "text") {
      return { ...base, text: (p as TextPart).text };
    }
    if (p.type === "mindmap") {
      return {
        ...base,
        title: (p as MindmapPart).title,
        markdown: (p as MindmapPart).markdown,
      };
    }
    if (p.type === "citation") {
      return {
        ...base,
        bookId: (p as CitationPart).bookId,
        chapterTitle: (p as CitationPart).chapterTitle,
        chapterIndex: (p as CitationPart).chapterIndex,
        cfi: (p as CitationPart).cfi,
        text: (p as CitationPart).text,
        citationIndex: (p as CitationPart).citationIndex,
      };
    }
    return base;
  });
}

/** Type guard for mindmap tool result */
function isMindmapResult(
  result: unknown,
): result is { type: "mindmap"; title: string; markdown: string } {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as Record<string, unknown>).type === "mindmap" &&
    typeof (result as Record<string, unknown>).markdown === "string"
  );
}

export interface StreamingChatOptions {
  book?: Book | null;
  semanticContext?: SemanticContext | null;
  bookId?: string;
}

export interface StreamingState {
  isStreaming: boolean;
  currentMessage: MessageV2 | null;
  currentStep: "thinking" | "tool_calling" | "responding" | "idle";
}

const activeStreams = new Map<string, StreamingChat>();
const STREAMING_PUBLISH_INTERVAL_MS = 160;

async function resolveFreshBook(
  bookId: string | undefined,
  fallback?: Book | null,
): Promise<Book | null> {
  if (!bookId) return fallback ?? null;
  try {
    return (await getBook(bookId)) ?? fallback ?? null;
  } catch (err) {
    console.warn("[AI] Failed to refresh book state before streaming:", err);
    return fallback ?? null;
  }
}

export function useStreamingChat(options?: StreamingChatOptions) {
  const streamingKey = getChatStreamingKey(options?.bookId);
  const streamingSession = useChatStore(
    useCallback((store) => store.streamingSessions[streamingKey] ?? null, [streamingKey]),
  );
  const state: StreamingState = {
    isStreaming: streamingSession?.isStreaming ?? false,
    currentMessage: streamingSession?.currentMessage ?? null,
    currentStep: streamingSession?.currentStep ?? "idle",
  };
  const error = useMemo(
    () => (streamingSession?.errorMessage ? new Error(streamingSession.errorMessage) : null),
    [streamingSession?.errorMessage],
  );

  const createThread = useChatStore((s) => s.createThread);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateThreadTitle = useChatStore((s) => s.updateThreadTitle);
  const startStreamingSession = useChatStore((s) => s.startStreamingSession);
  const updateStreamingSession = useChatStore((s) => s.updateStreamingSession);
  const finishStreamingSession = useChatStore((s) => s.finishStreamingSession);

  const aiConfig = useSettingsStore((s) => s.aiConfig);

  /** Load enabled skills (merge builtin definitions with DB enabled state) */
  const loadEnabledSkills = useCallback(async (): Promise<Skill[]> => {
    try {
      const dbSkills = await getDbSkills();
      const builtins = getBuiltinSkills();

      const mergedBuiltins = builtins
        .map((builtin) => {
          const dbSkill = dbSkills.find((s) => s.id === builtin.id);
          return dbSkill
            ? {
                ...builtin,
                description: dbSkill.description,
                enabled: dbSkill.enabled,
                prompt: dbSkill.prompt,
                updatedAt: dbSkill.updatedAt,
              }
            : builtin;
        })
        .filter((s) => s.enabled);

      const customSkills = dbSkills.filter((s) => !s.builtIn && s.enabled);

      return [...mergedBuiltins, ...customSkills];
    } catch (err) {
      console.warn("[AI] Failed to load enabled skills:", err);
      return [];
    }
  }, []);

  const getOrCreateThread = useCallback(
    async (bookId?: string): Promise<Thread> => {
      // Read fresh state directly to avoid stale closure
      const {
        threads: freshThreads,
        generalActiveThreadId,
        bookActiveThreadIds,
      } = useChatStore.getState();
      const activeId = bookId ? bookActiveThreadIds[bookId] || null : generalActiveThreadId;
      const existing = activeId ? freshThreads.find((t) => t.id === activeId) : null;
      if (existing) return existing;
      return await createThread(bookId);
    },
    [createThread],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      overrideBookId?: string,
      deepThinking = false,
      spoilerFree = false,
      quotes?: AttachedQuote[],
      aiConfigOverride?: AIConfig,
    ) => {
      const bookId = overrideBookId ?? options?.bookId;
      const sessionKey = getChatStreamingKey(bookId);
      const activeSession = useChatStore.getState().streamingSessions[sessionKey];
      if ((!content.trim() && (!quotes || quotes.length === 0)) || activeSession?.isStreaming) {
        return;
      }

      const messageId = createMessageId();
      const initialMessage: MessageV2 = {
        id: messageId,
        threadId: "",
        role: "assistant" as const,
        parts: [],
        createdAt: Date.now(),
      };
      let clearPendingPublish: (() => void) | null = null;

      try {
        const thread = await getOrCreateThread(bookId);
        initialMessage.threadId = thread.id;

        if (thread.messages.length === 0 && !thread.title) {
          await updateThreadTitle(thread.id, content.slice(0, 50));
        }

        let aiPrompt = content.trim();
        if (quotes && quotes.length > 0) {
          const quotesText = quotes.map((q) => `> ${q.text.slice(0, 300)}`).join("\n\n");
          aiPrompt = content.trim()
            ? `关于以下文本：\n${quotesText}\n\n${content.trim()}`
            : `关于以下文本：\n${quotesText}\n\n请帮我分析这段文本。`;
        }

        const userMessageId = createMessageId();
        const userParts: Part[] = [];
        if (quotes && quotes.length > 0) {
          for (const q of quotes) {
            userParts.push(createQuotePart(q.text, q.source));
          }
        }
        if (content.trim()) {
          userParts.push(createTextPart(content.trim()));
        }

        const userMessage = {
          id: userMessageId,
          threadId: thread.id,
          role: "user" as const,
          content: aiPrompt,
          parts: userParts,
          partsOrder: userParts.map((p) => ({
            type: p.type as "text" | "quote",
            id: p.id,
            ...(p.type === "text" ? { text: (p as TextPart).text } : {}),
            ...(p.type === "quote" ? { text: (p as any).text, source: (p as any).source } : {}),
          })),
          createdAt: Date.now(),
        };

        // Add user message to store FIRST so it renders immediately
        await addMessage(thread.id, userMessage as any);

        // Then set streaming state — user message is already visible
        startStreamingSession({
          key: sessionKey,
          threadId: thread.id,
          bookId: bookId || undefined,
          isStreaming: true,
          currentMessage: initialMessage,
          currentStep: "thinking",
          errorMessage: null,
          startedAt: Date.now(),
          updatedAt: Date.now(),
        });

        const stream = new StreamingChat();
        activeStreams.set(sessionKey, stream);

        const enabledSkills = await loadEnabledSkills();

        const updatedThread: Thread = {
          ...thread,
          messages: [...thread.messages, userMessage as any],
        };
        const threadForStream = await maybeCompressThreadMemory(
          updatedThread,
          aiConfigOverride || aiConfig,
        );
        if (threadForStream.memoryMessageCount !== updatedThread.memoryMessageCount) {
          useChatStore.setState((storeState) => ({
            threads: storeState.threads.map((item) =>
              item.id === threadForStream.id
                ? {
                    ...item,
                    memorySummary: threadForStream.memorySummary,
                    memoryUpdatedAt: threadForStream.memoryUpdatedAt,
                    memoryMessageCount: threadForStream.memoryMessageCount,
                  }
                : item,
            ),
          }));
        }

        const currentParts: Part[] = [];
        let currentTextPart: TextPart | null = null;
        let currentReasoningPart: ReasoningPart | null = null;
        let currentToolCallPart: ToolCallPart | null = null;
        let pendingPublishTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingCurrentStep: StreamingState["currentStep"] | undefined;
        let lastPublishedAt = 0;
        void currentToolCallPart;

        clearPendingPublish = () => {
          if (pendingPublishTimer) {
            clearTimeout(pendingPublishTimer);
            pendingPublishTimer = null;
          }
        };

        const publishCurrentMessage = (currentStep?: StreamingState["currentStep"]) => {
          lastPublishedAt = Date.now();
          pendingCurrentStep = undefined;
          updateStreamingSession(sessionKey, {
            isStreaming: true,
            currentMessage: { ...initialMessage, parts: [...currentParts] },
            ...(currentStep ? { currentStep } : {}),
            updatedAt: lastPublishedAt,
          });
        };

        const flushCurrentMessage = (currentStep?: StreamingState["currentStep"]) => {
          clearPendingPublish?.();
          publishCurrentMessage(currentStep ?? pendingCurrentStep);
        };

        const scheduleCurrentMessage = (currentStep?: StreamingState["currentStep"]) => {
          if (currentStep) {
            pendingCurrentStep = currentStep;
          }

          const now = Date.now();
          const elapsed = now - lastPublishedAt;

          if (!pendingPublishTimer) {
            pendingPublishTimer = setTimeout(
              () => {
                pendingPublishTimer = null;
                publishCurrentMessage(pendingCurrentStep);
              },
              lastPublishedAt === 0 ? 0 : Math.max(STREAMING_PUBLISH_INTERVAL_MS - elapsed, 0),
            );
          }
        };

        const finishCurrentSession = () => {
          clearPendingPublish?.();
          activeStreams.delete(sessionKey);
          finishStreamingSession(sessionKey);
        };

        const streamBook = await resolveFreshBook(bookId, options?.book);
        const streamIsVectorized = streamBook?.isVectorized ?? false;

        await stream.stream({
          thread: threadForStream,
          book: streamBook,
          bookId,
          semanticContext: options?.semanticContext || null,
          enabledSkills,
          isVectorized: streamIsVectorized,
          aiConfig: aiConfigOverride || aiConfig,
          deepThinking,
          spoilerFree,
          getAvailableTools,
          onToken: (token) => {
            if (!currentTextPart) {
              currentTextPart = createTextPart("");
              currentParts.push(currentTextPart);
            }
            currentTextPart.text += token;
            currentTextPart.status = "running";
            currentTextPart.updatedAt = Date.now();
            scheduleCurrentMessage("responding");
          },
          onComplete: async () => {
            if (currentTextPart) {
              currentTextPart.status = "completed";
              currentTextPart.updatedAt = Date.now();
            }
            if (currentReasoningPart) {
              currentReasoningPart.status = "completed";
              currentReasoningPart.updatedAt = Date.now();
            }
            markRunningToolCallPartsAsError(
              currentParts,
              i18n.t("streaming.toolNoResult", "工具没有返回结果"),
            );

            const textContent = currentParts
              .filter((p) => p.type === "text")
              .map((p) => (p as TextPart).text)
              .join("\n");

            const reasoning = currentParts
              .filter((p) => p.type === "reasoning")
              .map((p) => ({
                id: p.id,
                type: (p as ReasoningPart).thinkingType || "thinking",
                content: (p as ReasoningPart).text,
                timestamp: p.createdAt,
              }));

            const partsOrder = buildPartsOrder(currentParts);

            const assistantMessage = {
              id: messageId,
              threadId: thread.id,
              role: "assistant" as const,
              content: textContent,
              toolCalls: currentParts
                .filter((p) => p.type === "tool_call")
                .map((p) => toolCallPartToMessageToolCall(p as ToolCallPart)),
              reasoning: reasoning.length > 0 ? reasoning : undefined,
              partsOrder: partsOrder.length > 0 ? partsOrder : undefined,
              createdAt: Date.now(),
            };

            // Persist to store FIRST, then clear streaming state
            // This prevents the gap where message disappears
            // Set currentStep to "idle" before addMessage to prevent
            // the "thinking" indicator from briefly flashing during persist
            flushCurrentMessage("idle");
            await addMessage(thread.id, assistantMessage as any);
            finishCurrentSession();
          },
          onError: async (err) => {
            flushCurrentMessage();
            updateStreamingSession(sessionKey, {
              isStreaming: true,
              errorMessage: err.message,
              updatedAt: Date.now(),
            });
            markRunningToolCallPartsAsError(currentParts, err.message || "Unknown error");

            const errorPart = createTextPart(`⚠️ ${err.message || "Unknown error"}`);
            errorPart.status = "error";
            currentParts.push(errorPart);

            if (currentTextPart) {
              currentTextPart.status = "completed";
              currentTextPart.updatedAt = Date.now();
            }
            if (currentReasoningPart) {
              currentReasoningPart.status = "completed";
              currentReasoningPart.updatedAt = Date.now();
            }

            const textContent = currentParts
              .filter((p) => p.type === "text")
              .map((p) => (p as TextPart).text)
              .join("\n");

            const partsOrder = buildPartsOrder(currentParts);

            const errorMessage = {
              id: messageId,
              threadId: thread.id,
              role: "assistant" as const,
              content: textContent,
              toolCalls: currentParts
                .filter((p) => p.type === "tool_call")
                .map((p) => toolCallPartToMessageToolCall(p as ToolCallPart)),
              partsOrder: partsOrder.length > 0 ? partsOrder : undefined,
              createdAt: Date.now(),
            };

            // Persist error message FIRST, then clear streaming state
            flushCurrentMessage("idle");
            await addMessage(thread.id, errorMessage as any);
            finishCurrentSession();
          },
          onAbort: async () => {
            for (const part of currentParts) {
              if (part.status === "running") {
                if (part.type === "tool_call") {
                  part.status = "error";
                  (part as ToolCallPart).error = i18n.t("streaming.aborted");
                } else {
                  part.status = "completed";
                }
                part.updatedAt = Date.now();
              }
            }

            const abortedPart = createAbortedPart(i18n.t("streaming.aborted"));
            currentParts.push(abortedPart);

            const textContent = currentParts
              .filter((p) => p.type === "text")
              .map((p) => (p as TextPart).text)
              .join("\n");

            const reasoning = currentParts
              .filter((p) => p.type === "reasoning")
              .map((p) => ({
                id: p.id,
                type: (p as ReasoningPart).thinkingType || "thinking",
                content: (p as ReasoningPart).text,
                timestamp: p.createdAt,
              }));

            const partsOrder = buildPartsOrder(currentParts);

            const abortedMessage = {
              id: messageId,
              threadId: thread.id,
              role: "assistant" as const,
              content: textContent,
              parts: currentParts,
              toolCalls: currentParts
                .filter((p) => p.type === "tool_call")
                .map((p) => toolCallPartToMessageToolCall(p as ToolCallPart)),
              reasoning: reasoning.length > 0 ? reasoning : undefined,
              partsOrder: partsOrder.length > 0 ? partsOrder : undefined,
              createdAt: Date.now(),
            };

            flushCurrentMessage("idle");
            await addMessage(thread.id, abortedMessage as any);
            finishCurrentSession();
          },
          onToolCall: (name, args) => {
            if (currentTextPart) {
              currentTextPart.status = "completed";
              currentTextPart.updatedAt = Date.now();
            }
            if (currentReasoningPart) {
              currentReasoningPart.status = "completed";
              currentReasoningPart.updatedAt = Date.now();
            }
            currentTextPart = null;
            currentReasoningPart = null;
            currentToolCallPart = createToolCallPart(name, args);
            currentParts.push(currentToolCallPart);
            flushCurrentMessage("tool_calling");
          },
          onToolResult: (name, result) => {
            const part = applyToolResultToParts(currentParts, name, result);
            if (part) {
              if (name === "mindmap" && isMindmapResult(result)) {
                const mindmapPart = createMindmapPart(result.title, result.markdown);
                currentParts.push(mindmapPart);
              }

              currentTextPart = null;
              flushCurrentMessage();
            }
          },
          onReasoning: (content, type) => {
            if (!currentReasoningPart) {
              currentReasoningPart = createReasoningPart("", type);
              currentParts.push(currentReasoningPart);
            }
            currentReasoningPart.text += content;
            currentReasoningPart.status = "running";
            currentReasoningPart.updatedAt = Date.now();
            scheduleCurrentMessage("thinking");
          },
          onCitation: (citation) => {
            const citationPart = createCitationPart(
              citation.bookId,
              citation.chapterTitle,
              citation.chapterIndex,
              citation.cfi,
              citation.text,
              citation.citationIndex,
            );
            currentParts.push(citationPart);
            flushCurrentMessage();
          },
        });
      } catch (err) {
        clearPendingPublish?.();
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        updateStreamingSession(sessionKey, {
          isStreaming: false,
          currentMessage: null,
          currentStep: "idle",
          errorMessage,
          updatedAt: Date.now(),
        });
        activeStreams.delete(sessionKey);
      }
    },
    [
      getOrCreateThread,
      addMessage,
      updateThreadTitle,
      startStreamingSession,
      updateStreamingSession,
      finishStreamingSession,
      aiConfig,
      loadEnabledSkills,
      options?.book,
      options?.bookId,
      options?.semanticContext,
    ],
  );

  const stopStream = useCallback(() => {
    activeStreams.get(streamingKey)?.abort();
  }, [streamingKey]);

  return {
    ...state,
    error,
    sendMessage,
    stopStream,
  };
}
