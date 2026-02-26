import type { ReadingSession, ReadingStats, SessionState } from "@/types";
import * as db from "@/lib/db/database";
/**
 * Reading session store — session state machine (ACTIVE/PAUSED/STOPPED)
 * Connected to SQLite for persistence
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
        const session = {
          ...state.currentSession,
          state: "STOPPED" as const,
          endedAt: Date.now(),
        };
        // Save session to database
        db.insertReadingSession(session).catch((err) =>
          console.error("Failed to save reading session:", err),
        );
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

  loadStats: async (bookId) => {
    try {
      const sessions = await db.getReadingSessions(bookId);
      const totalReadingTime = sessions.reduce((sum, s) => sum + s.totalActiveTime, 0);
      const totalPagesRead = sessions.reduce((sum, s) => sum + s.pagesRead, 0);
      const totalSessions = sessions.length;
      const averageSessionLength = totalSessions > 0 ? totalReadingTime / totalSessions : 0;

      // Build daily reading map from sessions
      const dailyReading = new Map<string, number>();
      for (const s of sessions) {
        const day = new Date(s.startedAt).toISOString().split("T")[0];
        dailyReading.set(day, (dailyReading.get(day) || 0) + s.totalActiveTime);
      }

      set({
        stats: {
          totalReadingTime,
          totalPagesRead,
          totalSessions,
          averageSessionLength,
          dailyReading,
        },
      });
    } catch (err) {
      console.error("Failed to load reading stats:", err);
    }
  },
}));
