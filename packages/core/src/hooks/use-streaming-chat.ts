import { useCallback, useRef, useState } from "react";
import { getBuiltinSkills } from "../ai/skills/builtin-skills";
import { StreamingChat, createMessageId } from "../ai/streaming";
import { getAvailableTools } from "../ai/tools";
import { getSkills as getDbSkills } from "../db/database";
import i18n from "../i18n";
import { useChatStore } from "../stores/chat-store";
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

export function useStreamingChat(options?: StreamingChatOptions) {
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    currentMessage: null,
    currentStep: "idle",
  });
  const [error, setError] = useState<Error | null>(null);
  const streamingRef = useRef<StreamingChat | null>(null);

  const { createThread, addMessage, updateThreadTitle, setStreaming } = useChatStore();

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
    } catch {
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
      if ((!content.trim() && (!quotes || quotes.length === 0)) || state.isStreaming) return;

      const messageId = createMessageId();
      const initialMessage = {
        id: messageId,
        threadId: "",
        role: "assistant" as const,
        parts: [],
        createdAt: Date.now(),
      };

      setError(null);

      try {
        const bookId = overrideBookId ?? options?.bookId;
        const thread = await getOrCreateThread(bookId);

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
        setState({
          isStreaming: true,
          currentMessage: initialMessage,
          currentStep: "thinking",
        });
        setStreaming(true);

        streamingRef.current = new StreamingChat();

        const enabledSkills = await loadEnabledSkills();

        const updatedThread: Thread = {
          ...thread,
          messages: [...thread.messages, userMessage as any],
        };

        const currentParts: Part[] = [];
        let currentTextPart: TextPart | null = null;
        let currentReasoningPart: ReasoningPart | null = null;
        let currentToolCallPart: ToolCallPart | null = null;
        void currentToolCallPart;
        await streamingRef.current.stream({
          thread: updatedThread,
          book: options?.book || null,
          semanticContext: options?.semanticContext || null,
          enabledSkills,
          isVectorized: options?.book?.isVectorized || false,
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
            setState((prev) => ({
              ...prev,
              currentMessage: prev.currentMessage
                ? { ...prev.currentMessage, parts: [...currentParts] }
                : null,
              currentStep: "responding",
            }));
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

            const partsOrder = currentParts.map((p) => {
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
                };
              }
              return base;
            });

            const assistantMessage = {
              id: messageId,
              threadId: thread.id,
              role: "assistant" as const,
              content: textContent,
              toolCalls: currentParts
                .filter((p) => p.type === "tool_call")
                .map((p) => ({
                  id: p.id,
                  name: (p as ToolCallPart).name,
                  args: (p as ToolCallPart).args,
                  result: (p as ToolCallPart).result,
                  status: (p as ToolCallPart).status,
                })),
              reasoning: reasoning.length > 0 ? reasoning : undefined,
              partsOrder: partsOrder.length > 0 ? partsOrder : undefined,
              createdAt: Date.now(),
            };

            // Persist to store FIRST, then clear streaming state
            // This prevents the gap where message disappears
            // Set currentStep to "idle" before addMessage to prevent
            // the "thinking" indicator from briefly flashing during persist
            setState((prev) => ({ ...prev, currentStep: "idle" }));
            await addMessage(thread.id, assistantMessage as any);

            setState({
              isStreaming: false,
              currentMessage: null,
              currentStep: "idle",
            });
            setStreaming(false);
          },
          onError: async (err) => {
            setError(err);

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

            const partsOrder = currentParts.map((p) => {
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
                };
              }
              return base;
            });

            const errorMessage = {
              id: messageId,
              threadId: thread.id,
              role: "assistant" as const,
              content: textContent,
              toolCalls: currentParts
                .filter((p) => p.type === "tool_call")
                .map((p) => ({
                  id: p.id,
                  name: (p as ToolCallPart).name,
                  args: (p as ToolCallPart).args,
                  result: (p as ToolCallPart).result,
                  status: (p as ToolCallPart).status,
                })),
              partsOrder: partsOrder.length > 0 ? partsOrder : undefined,
              createdAt: Date.now(),
            };

            // Persist error message FIRST, then clear streaming state
            setState((prev) => ({ ...prev, currentStep: "idle" }));
            await addMessage(thread.id, errorMessage as any);

            setState({
              isStreaming: false,
              currentMessage: null,
              currentStep: "idle",
            });
            setStreaming(false);
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

            const partsOrder = currentParts.map((p) => {
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
                };
              }
              return base;
            });

            const abortedMessage = {
              id: messageId,
              threadId: thread.id,
              role: "assistant" as const,
              content: textContent,
              parts: currentParts,
              toolCalls: currentParts
                .filter((p) => p.type === "tool_call")
                .map((p) => ({
                  id: p.id,
                  name: (p as ToolCallPart).name,
                  args: (p as ToolCallPart).args,
                  result: (p as ToolCallPart).result,
                  status: (p as ToolCallPart).status,
                })),
              reasoning: reasoning.length > 0 ? reasoning : undefined,
              partsOrder: partsOrder.length > 0 ? partsOrder : undefined,
              createdAt: Date.now(),
            };

            setState((prev) => ({ ...prev, currentStep: "idle" }));
            await addMessage(thread.id, abortedMessage as any);

            setState({
              isStreaming: false,
              currentMessage: null,
              currentStep: "idle",
            });
            setStreaming(false);
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
            setState((prev) => ({
              ...prev,
              currentMessage: prev.currentMessage
                ? { ...prev.currentMessage, parts: [...currentParts] }
                : null,
              currentStep: "tool_calling",
            }));
          },
          onToolResult: (name, result) => {
            const part = [...currentParts]
              .reverse()
              .find(
                (p) =>
                  p.type === "tool_call" &&
                  (p as ToolCallPart).name === name &&
                  !(p as ToolCallPart).result,
              ) as ToolCallPart | undefined;
            if (part) {
              part.result = result;
              part.status = "completed";
              part.updatedAt = Date.now();

              if (name === "mindmap" && isMindmapResult(result)) {
                const mindmapPart = createMindmapPart(result.title, result.markdown);
                currentParts.push(mindmapPart);
              }

              currentTextPart = null;
              setState((prev) => ({
                ...prev,
                currentMessage: prev.currentMessage
                  ? { ...prev.currentMessage, parts: [...currentParts] }
                  : null,
              }));
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
            setState((prev) => ({
              ...prev,
              currentMessage: prev.currentMessage
                ? { ...prev.currentMessage, parts: [...currentParts] }
                : null,
              currentStep: "thinking",
            }));
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
            setState((prev) => ({
              ...prev,
              currentMessage: prev.currentMessage
                ? { ...prev.currentMessage, parts: [...currentParts] }
                : null,
            }));
          },
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Unknown error"));
        setState({
          isStreaming: false,
          currentMessage: null,
          currentStep: "idle",
        });
        setStreaming(false);
      }
    },
    [
      state.isStreaming,
      getOrCreateThread,
      addMessage,
      updateThreadTitle,
      setStreaming,
      aiConfig,
      loadEnabledSkills,
      options?.book,
      options?.bookId,
      options?.semanticContext,
    ],
  );

  const stopStream = useCallback(() => {
    streamingRef.current?.abort();
    // Immediately update UI state
    setState((prev) => ({ ...prev, isStreaming: false }));
    setStreaming(false);
  }, [setStreaming]);

  return {
    ...state,
    error,
    sendMessage,
    stopStream,
  };
}
