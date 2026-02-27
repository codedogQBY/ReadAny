import type { Message, SemanticContext, Thread } from "@/types";
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
  /** All loaded threads (both book & general) */
  threads: Thread[];
  /** Active thread for general chat (ChatPage) */
  generalActiveThreadId: string | null;
  /** Active thread per book (keyed by bookId) */
  bookActiveThreadIds: Record<string, string>;
  /** Streaming state */
  isStreaming: boolean;
  streamingContent: string;
  /** Semantic reading context (for book chat) */
  semanticContext: SemanticContext | null;
  /** Whether initial load from DB is complete */
  initialized: boolean;

  // --- Actions ---
  /** Load threads from DB. If bookId given, load that book's threads; otherwise load general. */
  loadThreads: (bookId?: string) => Promise<void>;
  /** Load all threads (for initial app startup) */
  loadAllThreads: () => Promise<void>;
  /** Create a new thread and persist to DB */
  createThread: (bookId?: string, title?: string) => Promise<Thread>;
  /** Remove a thread and delete from DB */
  removeThread: (threadId: string) => Promise<void>;
  /** Set active thread for general chat */
  setGeneralActiveThread: (threadId: string | null) => void;
  /** Set active thread for a specific book */
  setBookActiveThread: (bookId: string, threadId: string | null) => void;
  /** Get the active thread ID for a context (book or general) */
  getActiveThreadId: (bookId?: string) => string | null;
  /** Get threads filtered by context */
  getThreadsForContext: (bookId?: string) => Thread[];
  /** Add a message to a thread (in-memory + DB) */
  addMessage: (threadId: string, message: Message) => Promise<void>;
  /** Update message content in-memory */
  updateMessage: (threadId: string, messageId: string, content: string) => void;
  /** Update thread title */
  updateThreadTitle: (threadId: string, title: string) => Promise<void>;
  /** Streaming controls */
  setStreaming: (streaming: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  setSemanticContext: (ctx: SemanticContext | null) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  threads: [],
  generalActiveThreadId: null,
  bookActiveThreadIds: {},
  isStreaming: false,
  streamingContent: "",
  semanticContext: null,
  initialized: false,

  loadThreads: async (bookId?: string) => {
    try {
      const dbThreads = await dbGetThreads(bookId);
      set((state) => {
        // Merge: replace threads for this context, keep others
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

    // Persist to DB
    try {
      await dbInsertThread(thread);
    } catch (err) {
      console.error("[chat-store] Failed to insert thread:", err);
    }

    set((state) => {
      const newState: Partial<ChatState> = {
        threads: [thread, ...state.threads],
      };
      // Auto-activate the new thread
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
          // Pick the next thread for this book, or null
          const nextForBook = newThreads.find((t) => t.bookId === removed.bookId);
          updates.bookActiveThreadIds = {
            ...state.bookActiveThreadIds,
            [removed.bookId]: nextForBook?.id || "",
          };
          if (!nextForBook) {
            const { [removed.bookId]: _, ...rest } = state.bookActiveThreadIds;
            updates.bookActiveThreadIds = rest;
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
    // Persist to DB
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
  setSemanticContext: (ctx) => set({ semanticContext: ctx }),
}));
