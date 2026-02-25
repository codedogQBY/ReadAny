/** Reading session and statistics types */

export type SessionState = "ACTIVE" | "PAUSED" | "STOPPED";

export interface ReadingSession {
  id: string;
  bookId: string;
  state: SessionState;
  startedAt: number;
  endedAt?: number;
  pausedAt?: number;
  totalActiveTime: number; // ms
  pagesRead: number;
  startCfi?: string;
  endCfi?: string;
}

export interface ReadingStats {
  bookId: string;
  totalReadingTime: number; // ms
  totalSessions: number;
  totalPagesRead: number;
  averageSessionTime: number;
  lastReadAt: number;
  readingStreak: number; // days
  dailyStats: DailyReadingStat[];
}

export interface DailyReadingStat {
  date: string; // YYYY-MM-DD
  readingTime: number; // ms
  pagesRead: number;
  sessions: number;
}

export interface SessionDetectorConfig {
  pauseThreshold: number; // ms, default 5 min
  stopThreshold: number; // ms, default 30 min
  minSessionDuration: number; // ms, default 30s
}
