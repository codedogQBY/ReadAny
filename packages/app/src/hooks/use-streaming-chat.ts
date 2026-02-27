import { StreamingChat, createMessageId } from "@/lib/ai/streaming";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { Book, Message, SemanticContext, Thread } from "@/types";
/**
 * useStreamingChat — React hook for AI streaming chat.
 *
 * Supports two modes:
 * 1. **Book chat** (bookId provided): scoped to a single book, RAG tools use that book's index.
 * 2. **General chat** (no bookId): standalone chat, can optionally reference selected books.
 */
import { useCallback, useRef, useState } from "react";

export interface StreamingChatOptions {
  /** The book context for book-scoped chat */
  book?: Book | null;
  /** Semantic reading context */
  semanticContext?: SemanticContext | null;
  /** The bookId for scoping (used to find/create thread) */
  bookId?: string;
}

export function useStreamingChat(options?: StreamingChatOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const streamingRef = useRef<StreamingChat | null>(null);

  const {
    threads,
    getActiveThreadId,
    createThread,
    addMessage,
    updateThreadTitle,
    setStreaming,
    setStreamingContent,
  } = useChatStore();

  const aiConfig = useSettingsStore((s) => s.aiConfig);

  const getOrCreateThread = useCallback(
    async (bookId?: string): Promise<Thread> => {
      const activeId = getActiveThreadId(bookId);
      const existing = activeId ? threads.find((t) => t.id === activeId) : null;
      if (existing) return existing;

      // Create a new thread scoped to this context
      return await createThread(bookId);
    },
    [threads, getActiveThreadId, createThread],
  );

  const sendMessage = useCallback(
    async (content: string, overrideBookId?: string) => {
      if (!content.trim() || isStreaming) return;

      setIsStreaming(true);
      setStreamingText("");
      setError(null);
      setStreaming(true);
      setStreamingContent("");

      const bookId = overrideBookId ?? options?.bookId;
      const thread = await getOrCreateThread(bookId);

      // Auto-title: use first message as thread title
      if (thread.messages.length === 0 && !thread.title) {
        await updateThreadTitle(thread.id, content.slice(0, 50));
      }

      // Add user message
      const userMessage: Message = {
        id: createMessageId(),
        threadId: thread.id,
        role: "user",
        content: content.trim(),
        createdAt: Date.now(),
      };
      await addMessage(thread.id, userMessage);

      // Create streaming client
      streamingRef.current = new StreamingChat();

      // Get the updated thread with the new message
      const updatedThread: Thread = {
        ...thread,
        messages: [...thread.messages, userMessage],
      };

      try {
        await streamingRef.current.stream({
          thread: updatedThread,
          book: options?.book || null,
          semanticContext: options?.semanticContext || null,
          enabledSkills: [],
          isVectorized: options?.book?.isVectorized || false,
          aiConfig,
          onToken: (token) => {
            setStreamingText((prev) => {
              const updated = prev + token;
              setStreamingContent(updated);
              return updated;
            });
          },
          onComplete: async (fullText, toolCalls) => {
            const assistantMessage: Message = {
              id: createMessageId(),
              threadId: thread.id,
              role: "assistant",
              content: fullText,
              toolCalls: toolCalls?.map((tc) => ({
                id: `tc-${Date.now()}`,
                name: tc.name,
                args: tc.args,
                result: tc.result,
                status: "completed" as const,
              })),
              createdAt: Date.now(),
            };
            await addMessage(thread.id, assistantMessage);

            setIsStreaming(false);
            setStreaming(false);
            setStreamingContent("");
          },
          onError: (err) => {
            setError(err);
            setIsStreaming(false);
            setStreaming(false);
            setStreamingContent("");
          },
          onToolCall: (name, args) => {
            console.log(`Tool call: ${name}`, args);
          },
          onToolResult: (name, result) => {
            console.log(`Tool result: ${name}`, result);
          },
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Unknown error"));
        setIsStreaming(false);
        setStreaming(false);
      }
    },
    [
      isStreaming,
      getOrCreateThread,
      addMessage,
      updateThreadTitle,
      setStreaming,
      setStreamingContent,
      aiConfig,
      options?.book,
      options?.bookId,
      options?.semanticContext,
    ],
  );

  const stopStream = useCallback(() => {
    streamingRef.current?.abort();
    setIsStreaming(false);
    setStreaming(false);
    setStreamingContent("");
  }, [setStreaming, setStreamingContent]);

  return {
    isStreaming,
    streamingText,
    error,
    sendMessage,
    stopStream,
  };
}
