import { create } from "zustand";
import * as db from "../db/database";
import { runWithDbRetry } from "../db/write-retry";
/**
 * Reading session store — session state machine (ACTIVE/PAUSED/STOPPED)
 * Connected to SQLite for persistence via core db module
 */
import type { ReadingSession, ReadingStats, SessionState } from "../types";
import { generateId } from "../utils/generate-id";

async function persistReadingSession(session: ReadingSession): Promise<void> {
  await runWithDbRetry(() => db.insertReadingSession(session));
}

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
  incrementCharactersRead: (count: number) => void;
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
      id: generateId(),
      bookId,
      state: "ACTIVE",
      startedAt: Date.now(),
      totalActiveTime: 0,
      pagesRead: 0,
      charactersRead: 0,
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
        persistReadingSession(session).catch((err) =>
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

  incrementCharactersRead: (count) =>
    set((state) => ({
      currentSession: state.currentSession
        ? {
            ...state.currentSession,
            charactersRead: (state.currentSession.charactersRead ?? 0) + count,
          }
        : null,
    })),

  saveCurrentSession: async () => {
    const { currentSession } = get();
    if (currentSession && currentSession.totalActiveTime > 0) {
      try {
        const session = {
          ...currentSession,
          endedAt: Date.now(),
        };
        await persistReadingSession(session);

        set({
          currentSession: {
            ...currentSession,
            id: generateId(),
            startedAt: Date.now(),
            totalActiveTime: 0,
            pagesRead: 0,
            charactersRead: 0,
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
      const totalCharactersRead = sessions.reduce((sum, s) => sum + (s.charactersRead ?? 0), 0);
      const totalSessions = sessions.length;
      const averageSessionTime = totalSessions > 0 ? totalReadingTime / totalSessions : 0;

      const dailyStatsMap = new Map<
        string,
        { readingTime: number; pagesRead: number; charactersRead: number; sessions: number }
      >();
      for (const s of sessions) {
        const day = new Date(s.startedAt).toISOString().split("T")[0];
        const existing = dailyStatsMap.get(day) || {
          readingTime: 0,
          pagesRead: 0,
          charactersRead: 0,
          sessions: 0,
        };
        dailyStatsMap.set(day, {
          readingTime: existing.readingTime + s.totalActiveTime,
          pagesRead: existing.pagesRead + s.pagesRead,
          charactersRead: existing.charactersRead + (s.charactersRead ?? 0),
          sessions: existing.sessions + 1,
        });
      }

      const dailyStats = Array.from(dailyStatsMap.entries()).map(([date, data]) => ({
        date,
        readingTime: data.readingTime,
        pagesRead: data.pagesRead,
        charactersRead: data.charactersRead,
        sessions: data.sessions,
      }));

      const lastSession = sessions[0];
      const lastReadAt = lastSession?.startedAt || 0;

      set({
        stats: {
          bookId,
          totalReadingTime,
          totalPagesRead,
          totalCharactersRead,
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
