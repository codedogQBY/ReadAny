import { StreamingChat, createMessageId, createThreadId } from "@/lib/ai/streaming";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { Book, Message, SemanticContext, Thread } from "@/types";
/**
 * useStreamingChat — React hook for AI streaming chat
 */
import { useCallback, useRef, useState } from "react";

export function useStreamingChat(options?: {
  book?: Book | null;
  semanticContext?: SemanticContext | null;
}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const streamingRef = useRef<StreamingChat | null>(null);

  const { threads, activeThreadId, addThread, addMessage, setStreaming, setStreamingContent } =
    useChatStore();

  const aiConfig = useSettingsStore((s) => s.aiConfig);

  const getOrCreateThread = useCallback(
    (bookId?: string): Thread => {
      const existing = activeThreadId ? threads.find((t) => t.id === activeThreadId) : null;

      if (existing) return existing;

      const thread: Thread = {
        id: createThreadId(),
        bookId: bookId || undefined,
        title: "New Chat",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      addThread(thread);
      return thread;
    },
    [activeThreadId, threads, addThread],
  );

  const sendMessage = useCallback(
    async (content: string, bookId?: string) => {
      if (!content.trim() || isStreaming) return;

      setIsStreaming(true);
      setStreamingText("");
      setError(null);
      setStreaming(true);
      setStreamingContent("");

      const thread = getOrCreateThread(bookId);

      // Add user message
      const userMessage: Message = {
        id: createMessageId(),
        threadId: thread.id,
        role: "user",
        content: content.trim(),
        createdAt: Date.now(),
      };
      addMessage(thread.id, userMessage);

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
            setStreamingText((prev) => prev + token);
            setStreamingContent(token); // append via store action
          },
          onComplete: (fullText, toolCalls) => {
            // Add assistant message
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
            addMessage(thread.id, assistantMessage);

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
            // Could add a pending tool call display
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
      setStreaming,
      setStreamingContent,
      aiConfig,
      options?.book,
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
