import type { Message, SemanticContext, Thread, ToolCall, ReasoningStep } from "@/types";
/**
 * Chat store — conversation threads, messages, streaming state.
 *
 * Architecture:
 * - Threads with `bookId` are **book chats** (scoped to that book)
 * - Threads without `bookId` are **general chats**
 * - Each book has its own active thread; general chat has its own.
 * - All threads are persisted to SQLite via database.ts
 */
import { create } from "zustand";
import {
  deleteThread as dbDeleteThread,
  getThreads as dbGetThreads,
  insertMessage as dbInsertMessage,
  insertThread as dbInsertThread,
  updateThreadTitle as dbUpdateThreadTitle,
} from "@/lib/db/database";

export interface ChatState {
  threads: Thread[];
  generalActiveThreadId: string | null;
  bookActiveThreadIds: Record<string, string>;
  isStreaming: boolean;
  streamingContent: string;
  toolCalls: ToolCall[];
  reasoning: ReasoningStep[];
  currentStep: "thinking" | "tool_calling" | "responding" | "idle";
  semanticContext: SemanticContext | null;
  initialized: boolean;

  loadThreads: (bookId?: string) => Promise<void>;
  loadAllThreads: () => Promise<void>;
  createThread: (bookId?: string, title?: string) => Promise<Thread>;
  removeThread: (threadId: string) => Promise<void>;
  setGeneralActiveThread: (threadId: string | null) => void;
  setBookActiveThread: (bookId: string, threadId: string | null) => void;
  getActiveThreadId: (bookId?: string) => string | null;
  getThreadsForContext: (bookId?: string) => Thread[];
  addMessage: (threadId: string, message: Message) => Promise<void>;
  updateMessage: (threadId: string, messageId: string, content: string) => void;
  updateThreadTitle: (threadId: string, title: string) => Promise<void>;
  setStreaming: (streaming: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  setToolCalls: (toolCalls: ToolCall[]) => void;
  addToolCall: (toolCall: ToolCall) => void;
  updateToolCall: (id: string, update: Partial<ToolCall>) => void;
  setReasoning: (reasoning: ReasoningStep[]) => void;
  addReasoningStep: (step: ReasoningStep) => void;
  setCurrentStep: (step: "thinking" | "tool_calling" | "responding" | "idle") => void;
  setSemanticContext: (ctx: SemanticContext | null) => void;
  resetStreamingState: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  threads: [],
  generalActiveThreadId: null,
  bookActiveThreadIds: {},
  isStreaming: false,
  streamingContent: "",
  toolCalls: [],
  reasoning: [],
  currentStep: "idle",
  semanticContext: null,
  initialized: false,

  loadThreads: async (bookId?: string) => {
    try {
      const dbThreads = await dbGetThreads(bookId);
      set((state) => {
        const otherThreads = state.threads.filter((t) =>
          bookId ? t.bookId !== bookId : !!t.bookId,
        );
        return { threads: [...otherThreads, ...dbThreads] };
      });
    } catch (err) {
      console.error("[chat-store] Failed to load threads:", err);
    }
  },

  loadAllThreads: async () => {
    try {
      const dbThreads = await dbGetThreads();
      set({ threads: dbThreads, initialized: true });
    } catch (err) {
      console.error("[chat-store] Failed to load all threads:", err);
      set({ initialized: true });
    }
  },

  createThread: async (bookId?: string, title?: string) => {
    const thread: Thread = {
      id: `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      bookId: bookId || undefined,
      title: title || "",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await dbInsertThread(thread);
    } catch (err) {
      console.error("[chat-store] Failed to insert thread:", err);
    }

    set((state) => {
      const newState: Partial<ChatState> = {
        threads: [thread, ...state.threads],
      };
      if (bookId) {
        newState.bookActiveThreadIds = {
          ...state.bookActiveThreadIds,
          [bookId]: thread.id,
        };
      } else {
        newState.generalActiveThreadId = thread.id;
      }
      return newState as ChatState;
    });

    return thread;
  },

  removeThread: async (threadId: string) => {
    try {
      await dbDeleteThread(threadId);
    } catch (err) {
      console.error("[chat-store] Failed to delete thread:", err);
    }

    set((state) => {
      const removed = state.threads.find((t) => t.id === threadId);
      const newThreads = state.threads.filter((t) => t.id !== threadId);
      const updates: Partial<ChatState> = { threads: newThreads };

      if (removed?.bookId) {
        if (state.bookActiveThreadIds[removed.bookId] === threadId) {
          const nextForBook = newThreads.find((t) => t.bookId === removed.bookId);
          if (!nextForBook) {
            const { [removed.bookId]: _, ...rest } = state.bookActiveThreadIds;
            updates.bookActiveThreadIds = rest;
          } else {
            updates.bookActiveThreadIds = {
              ...state.bookActiveThreadIds,
              [removed.bookId]: nextForBook.id,
            };
          }
        }
      } else {
        if (state.generalActiveThreadId === threadId) {
          const nextGeneral = newThreads.find((t) => !t.bookId);
          updates.generalActiveThreadId = nextGeneral?.id || null;
        }
      }

      return updates as ChatState;
    });
  },

  setGeneralActiveThread: (threadId) => set({ generalActiveThreadId: threadId }),

  setBookActiveThread: (bookId, threadId) =>
    set((state) => ({
      bookActiveThreadIds: {
        ...state.bookActiveThreadIds,
        [bookId]: threadId || "",
      },
    })),

  getActiveThreadId: (bookId?: string) => {
    const state = get();
    if (bookId) {
      return state.bookActiveThreadIds[bookId] || null;
    }
    return state.generalActiveThreadId;
  },

  getThreadsForContext: (bookId?: string) => {
    const state = get();
    if (bookId) {
      return state.threads.filter((t) => t.bookId === bookId);
    }
    return state.threads.filter((t) => !t.bookId);
  },

  addMessage: async (threadId, message) => {
    try {
      await dbInsertMessage(message);
    } catch (err) {
      console.error("[chat-store] Failed to insert message:", err);
    }

    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId
          ? { ...t, messages: [...t.messages, message], updatedAt: Date.now() }
          : t,
      ),
    }));
  },

  updateMessage: (threadId, messageId, content) =>
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: t.messages.map((m) =>
                m.id === messageId ? { ...m, content } : m,
              ),
            }
          : t,
      ),
    })),

  updateThreadTitle: async (threadId, title) => {
    try {
      await dbUpdateThreadTitle(threadId, title);
    } catch (err) {
      console.error("[chat-store] Failed to update thread title:", err);
    }

    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, title } : t,
      ),
    }));
  },

  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setStreamingContent: (content) => set({ streamingContent: content }),
  appendStreamingContent: (chunk) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),
  
  setToolCalls: (toolCalls) => set({ toolCalls }),
  addToolCall: (toolCall) => set((state) => ({ toolCalls: [...state.toolCalls, toolCall] })),
  updateToolCall: (id, update) =>
    set((state) => ({
      toolCalls: state.toolCalls.map((tc) =>
        tc.id === id ? { ...tc, ...update } : tc
      ),
    })),
  
  setReasoning: (reasoning) => set({ reasoning }),
  addReasoningStep: (step) => set((state) => ({ reasoning: [...state.reasoning, step] })),
  
  setCurrentStep: (step) => set({ currentStep: step }),
  
  setSemanticContext: (ctx) => set({ semanticContext: ctx }),
  
  resetStreamingState: () =>
    set({
      isStreaming: false,
      streamingContent: "",
      toolCalls: [],
      reasoning: [],
      currentStep: "idle",
    }),
}));
