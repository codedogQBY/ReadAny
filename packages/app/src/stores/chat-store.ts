import type { AIConfig, AIModel, Message, SemanticContext, Thread } from "@/types";
/**
 * Chat store — conversation threads, messages, streaming state
 */
import { create } from "zustand";

export interface ChatState {
  threads: Thread[];
  activeThreadId: string | null;
  isStreaming: boolean;
  streamingContent: string;
  semanticContext: SemanticContext | null;
  aiConfig: AIConfig;

  // Actions
  setThreads: (threads: Thread[]) => void;
  addThread: (thread: Thread) => void;
  removeThread: (threadId: string) => void;
  setActiveThread: (threadId: string | null) => void;
  addMessage: (threadId: string, message: Message) => void;
  updateMessage: (threadId: string, messageId: string, content: string) => void;
  setStreaming: (streaming: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  setSemanticContext: (ctx: SemanticContext | null) => void;
  setAIModel: (model: AIModel) => void;
  sendMessage: (threadId: string, content: string) => Promise<void>;
}

const defaultAIConfig: AIConfig = {
  model: "gpt-4o",
  apiKey: "",
  temperature: 0.7,
  maxTokens: 4096,
  slidingWindowSize: 8,
};

export const useChatStore = create<ChatState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  isStreaming: false,
  streamingContent: "",
  semanticContext: null,
  aiConfig: defaultAIConfig,

  setThreads: (threads) => set({ threads }),

  addThread: (thread) =>
    set((state) => ({
      threads: [...state.threads, thread],
      activeThreadId: thread.id,
    })),

  removeThread: (threadId) =>
    set((state) => ({
      threads: state.threads.filter((t) => t.id !== threadId),
      activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
    })),

  setActiveThread: (threadId) => set({ activeThreadId: threadId }),

  addMessage: (threadId, message) =>
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, messages: [...t.messages, message], updatedAt: Date.now() } : t,
      ),
    })),

  updateMessage: (threadId, messageId, content) =>
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: t.messages.map((m) => (m.id === messageId ? { ...m, content } : m)),
            }
          : t,
      ),
    })),

  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setStreamingContent: (content) =>
    set((state) => ({
      streamingContent: state.streamingContent + content,
    })),
  appendStreamingContent: (chunk) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),
  setSemanticContext: (ctx) => set({ semanticContext: ctx }),
  setAIModel: (model) => set((state) => ({ aiConfig: { ...state.aiConfig, model } })),

  sendMessage: async (_threadId, _content) => {
    // Streaming is now handled by the useStreamingChat hook.
    // This method is kept for backward compatibility with components
    // that use it directly. The hook provides the full streaming flow.
    const state = get();
    if (state.isStreaming) return;

    // For non-streaming fallback, this could be implemented as a simple
    // fetch, but the primary flow uses the useStreamingChat hook.
    console.warn(
      "sendMessage called directly on chat store. Use useStreamingChat hook for streaming support.",
    );
  },
}));
