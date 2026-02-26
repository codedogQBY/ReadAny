import type { ReadingSession, ReadingStats, SessionState } from "@/types";
/**
 * Reading session store — session state machine (ACTIVE/PAUSED/STOPPED)
 */
import { create } from "zustand";

export interface ReadingSessionState {
  currentSession: ReadingSession | null;
  sessionState: SessionState;
  stats: ReadingStats | null;

  // Actions
  startSession: (bookId: string) => void;
  pauseSession: () => void;
  resumeSession: () => void;
  stopSession: () => void;
  updateActiveTime: () => void;
  incrementPagesRead: (count: number) => void;
  loadStats: (bookId: string) => Promise<void>;
}

export const useReadingSessionStore = create<ReadingSessionState>((set) => ({
  currentSession: null,
  sessionState: "STOPPED",
  stats: null,

  startSession: (bookId) => {
    const session: ReadingSession = {
      id: crypto.randomUUID(),
      bookId,
      state: "ACTIVE",
      startedAt: Date.now(),
      totalActiveTime: 0,
      pagesRead: 0,
    };
    set({ currentSession: session, sessionState: "ACTIVE" });
  },

  pauseSession: () =>
    set((state) => ({
      sessionState: "PAUSED",
      currentSession: state.currentSession
        ? { ...state.currentSession, state: "PAUSED", pausedAt: Date.now() }
        : null,
    })),

  resumeSession: () =>
    set((state) => ({
      sessionState: "ACTIVE",
      currentSession: state.currentSession
        ? { ...state.currentSession, state: "ACTIVE", pausedAt: undefined }
        : null,
    })),

  stopSession: () =>
    set((state) => {
      if (state.currentSession) {
        // TODO: Save session to database
        const session = {
          ...state.currentSession,
          state: "STOPPED" as const,
          endedAt: Date.now(),
        };
        void session;
      }
      return { currentSession: null, sessionState: "STOPPED" };
    }),

  updateActiveTime: () =>
    set((state) => ({
      currentSession: state.currentSession
        ? {
            ...state.currentSession,
            totalActiveTime: state.currentSession.totalActiveTime + 1000,
          }
        : null,
    })),

  incrementPagesRead: (count) =>
    set((state) => ({
      currentSession: state.currentSession
        ? {
            ...state.currentSession,
            pagesRead: state.currentSession.pagesRead + count,
          }
        : null,
    })),

  loadStats: async (_bookId) => {
    // TODO: Load reading stats from database
  },
}));
