import { StreamingChat, createMessageId } from "@/lib/ai/streaming";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { Book, SemanticContext, Thread, Part, TextPart, ToolCallPart, MessageV2, ReasoningPart } from "@/types";
import { useCallback, useRef, useState } from "react";
import {
  createTextPart,
  createReasoningPart,
  createToolCallPart,
  createQuotePart,
} from "@/types/message";
import type { AttachedQuote } from "@/components/chat/ChatInput";

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

  const {
    threads,
    getActiveThreadId,
    createThread,
    addMessage,
    updateThreadTitle,
    setStreaming,
  } = useChatStore();

  const aiConfig = useSettingsStore((s) => s.aiConfig);

  const getOrCreateThread = useCallback(
    async (bookId?: string): Promise<Thread> => {
      const activeId = getActiveThreadId(bookId);
      const existing = activeId ? threads.find((t) => t.id === activeId) : null;
      if (existing) return existing;
      return await createThread(bookId);
    },
    [threads, getActiveThreadId, createThread],
  );

  const sendMessage = useCallback(
    async (content: string, overrideBookId?: string, deepThinking: boolean = false, quotes?: AttachedQuote[]) => {
      if ((!content.trim() && (!quotes || quotes.length === 0)) || state.isStreaming) return;

      const messageId = createMessageId();
      const initialMessage = {
        id: messageId,
        threadId: "",
        role: "assistant" as const,
        parts: [],
        createdAt: Date.now(),
      };

      setState({
        isStreaming: true,
        currentMessage: initialMessage,
        currentStep: "thinking",
      });
      setError(null);
      setStreaming(true);

      const bookId = overrideBookId ?? options?.bookId;
      const thread = await getOrCreateThread(bookId);

      if (thread.messages.length === 0 && !thread.title) {
        await updateThreadTitle(thread.id, content.slice(0, 50));
      }

      // Build the actual prompt sent to AI (includes quotes as context)
      let aiPrompt = content.trim();
      if (quotes && quotes.length > 0) {
        const quotesText = quotes
          .map((q) => `> ${q.text.slice(0, 300)}`)
          .join("\n\n");
        aiPrompt = content.trim()
          ? `关于以下文本：\n${quotesText}\n\n${content.trim()}`
          : `关于以下文本：\n${quotesText}\n\n请帮我分析这段文本。`;
      }

      // Build user message with QuotePart + TextPart for display
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

      // Save user message to store
      await addMessage(thread.id, userMessage as any);

      streamingRef.current = new StreamingChat();

      const updatedThread: Thread = {
        ...thread,
        messages: [...thread.messages, userMessage as any],
      };

      const currentParts: Part[] = [];
      let currentTextPart: TextPart | null = null;
      let currentReasoningPart: ReasoningPart | null = null;
      let currentToolCallPart: ToolCallPart | null = null;

      try {
        await streamingRef.current.stream({
          thread: updatedThread,
          book: options?.book || null,
          semanticContext: options?.semanticContext || null,
          enabledSkills: [],
          isVectorized: options?.book?.isVectorized || false,
          aiConfig,
          deepThinking,
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

            // Extract text content from parts for database storage
            const textContent = currentParts
              .filter((p) => p.type === "text")
              .map((p) => (p as TextPart).text)
              .join("\n");

            // Extract reasoning from parts
            const reasoning = currentParts
              .filter((p) => p.type === "reasoning")
              .map((p) => ({
                id: p.id,
                type: (p as ReasoningPart).thinkingType || "thinking",
                content: (p as ReasoningPart).text,
                timestamp: p.createdAt,
              }));

            // Build partsOrder to preserve the exact sequence of parts
            const partsOrder = currentParts.map((p) => ({
              type: p.type as "text" | "reasoning" | "tool_call" | "citation",
              id: p.id,
              ...(p.type === "text" ? { text: (p as TextPart).text } : {}),
            }));

            // Create assistant message compatible with database schema
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

            // IMPORTANT: Clear streaming state BEFORE saving to store.
            // Otherwise both currentMessage and the saved message share the
            // same ID, causing React duplicate key errors.
            setState({
              isStreaming: false,
              currentMessage: null,
              currentStep: "idle",
            });
            setStreaming(false);

            // Save assistant message to store (now that currentMessage is cleared)
            await addMessage(thread.id, assistantMessage as any);
          },
          onError: (err) => {
            setError(err);
            setState((prev) => ({ ...prev, isStreaming: false, currentStep: "idle" }));
            setStreaming(false);
          },
          onToolCall: (name, args) => {
            // Close the previous text part so it stops showing the streaming cursor
            if (currentTextPart) {
              currentTextPart.status = "completed";
              currentTextPart.updatedAt = Date.now();
            }
            // Reset currentTextPart so text before tool calls becomes a separate part
            // from text after tool calls, preserving correct display order
            currentTextPart = null;
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
            // Find the last tool_call part with matching name that doesn't have a result yet
            // (supports multiple calls to the same tool)
            const part = [...currentParts]
              .reverse()
              .find(
                (p) =>
                  p.type === "tool_call" &&
                  (p as ToolCallPart).name === name &&
                  !(p as ToolCallPart).result
              ) as ToolCallPart | undefined;
            if (part) {
              part.result = result;
              part.status = "completed";
              part.updatedAt = Date.now();
              // Reset currentTextPart so text after tool results becomes a new part
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
            currentReasoningPart = createReasoningPart(content, type);
            currentParts.push(currentReasoningPart);
            setState((prev) => ({
              ...prev,
              currentMessage: prev.currentMessage
                ? { ...prev.currentMessage, parts: [...currentParts] }
                : null,
              currentStep: "thinking",
            }));
          },
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Unknown error"));
        setState((prev) => ({ ...prev, isStreaming: false, currentStep: "idle" }));
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
      options?.book,
      options?.bookId,
      options?.semanticContext,
    ],
  );

  const stopStream = useCallback(() => {
    streamingRef.current?.abort();
    setState({
      isStreaming: false,
      currentMessage: null,
      currentStep: "idle",
    });
    setStreaming(false);
  }, [setStreaming]);

  return {
    ...state,
    error,
    sendMessage,
    stopStream,
  };
}
