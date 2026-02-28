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
  /** Save current session to DB without stopping (for periodic saves) */
  saveCurrentSession: () => Promise<void>;
}

export const useReadingSessionStore = create<ReadingSessionState>((set, get) => ({
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
      if (state.currentSession && state.currentSession.totalActiveTime > 0) {
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

  saveCurrentSession: async () => {
    const { currentSession } = get();
    if (currentSession && currentSession.totalActiveTime > 0) {
      try {
        // Save a snapshot of current session
        const session = {
          ...currentSession,
          endedAt: Date.now(),
        };
        await db.insertReadingSession(session);
        
        // Start a new session to continue tracking
        // Keep the same bookId but reset timing
        set({
          currentSession: {
            ...currentSession,
            id: crypto.randomUUID(),
            startedAt: Date.now(),
            totalActiveTime: 0,
            pagesRead: 0,
          },
        });
      } catch (err) {
        console.error("Failed to save reading session:", err);
      }
    }
  },

  loadStats: async (bookId) => {
    try {
      const sessions = await db.getReadingSessions(bookId);
      const totalReadingTime = sessions.reduce((sum, s) => sum + s.totalActiveTime, 0);
      const totalPagesRead = sessions.reduce((sum, s) => sum + s.pagesRead, 0);
      const totalSessions = sessions.length;
      const averageSessionTime = totalSessions > 0 ? totalReadingTime / totalSessions : 0;

      // Build daily stats from sessions
      const dailyStatsMap = new Map<string, { readingTime: number; pagesRead: number; sessions: number }>();
      for (const s of sessions) {
        const day = new Date(s.startedAt).toISOString().split("T")[0];
        const existing = dailyStatsMap.get(day) || { readingTime: 0, pagesRead: 0, sessions: 0 };
        dailyStatsMap.set(day, {
          readingTime: existing.readingTime + s.totalActiveTime,
          pagesRead: existing.pagesRead + s.pagesRead,
          sessions: existing.sessions + 1,
        });
      }

      const dailyStats = Array.from(dailyStatsMap.entries()).map(([date, data]) => ({
        date,
        readingTime: data.readingTime,
        pagesRead: data.pagesRead,
        sessions: data.sessions,
      }));

      const lastSession = sessions[0];
      const lastReadAt = lastSession?.startedAt || 0;

      set({
        stats: {
          bookId,
          totalReadingTime,
          totalPagesRead,
          totalSessions,
          averageSessionTime,
          lastReadAt,
          readingStreak: 0,
          dailyStats,
        },
      });
    } catch (err) {
      console.error("Failed to load reading stats:", err);
    }
  },
}));
