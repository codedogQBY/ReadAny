import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadingSession } from "../types/reading";
import {
  mergeCurrentSessionIntoDailyStats,
  mergeCurrentSessionIntoOverallStats,
} from "./live-reading-stats";
import type { DailyStats, OverallStats } from "./reading-stats";

describe("mergeCurrentSessionIntoDailyStats", () => {
  it("returns original stats when there is no active session", () => {
    const dailyStats: DailyStats[] = [
      { date: "2026-04-01", totalTime: 10, pagesRead: 5, sessionsCount: 1 },
    ];

    expect(mergeCurrentSessionIntoDailyStats(dailyStats, null)).toEqual(dailyStats);
  });

  it("merges an active session into an existing day", () => {
    const dailyStats: DailyStats[] = [
      { date: "2026-04-03", totalTime: 20, pagesRead: 10, sessionsCount: 2 },
    ];
    const session: ReadingSession = {
      id: "session-1",
      bookId: "book-1",
      state: "ACTIVE",
      startedAt: new Date("2026-04-03T08:00:00.000Z").getTime(),
      totalActiveTime: 30 * 60 * 1000,
      pagesRead: 8,
    };

    expect(mergeCurrentSessionIntoDailyStats(dailyStats, session)).toEqual([
      { date: "2026-04-03", totalTime: 50, pagesRead: 18, charactersRead: 0, sessionsCount: 3 },
    ]);
  });

  it("creates and sorts a new day when the session is on a missing date", () => {
    const dailyStats: DailyStats[] = [
      { date: "2026-04-01", totalTime: 20, pagesRead: 10, sessionsCount: 2 },
      { date: "2026-04-03", totalTime: 40, pagesRead: 15, sessionsCount: 1 },
    ];
    const session: ReadingSession = {
      id: "session-1",
      bookId: "book-1",
      state: "ACTIVE",
      startedAt: new Date("2026-04-02T08:00:00.000Z").getTime(),
      totalActiveTime: 15 * 60 * 1000,
      pagesRead: 4,
    };

    expect(mergeCurrentSessionIntoDailyStats(dailyStats, session)).toEqual([
      { date: "2026-04-01", totalTime: 20, pagesRead: 10, sessionsCount: 2 },
      { date: "2026-04-02", totalTime: 15, pagesRead: 4, charactersRead: 0, sessionsCount: 1 },
      { date: "2026-04-03", totalTime: 40, pagesRead: 15, sessionsCount: 1 },
    ]);
  });
});

describe("mergeCurrentSessionIntoOverallStats", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns original overall stats when there is no active session", () => {
    const overall: OverallStats = {
      totalBooks: 3,
      totalReadingTime: 120,
      totalSessions: 5,
      totalReadingDays: 2,
      avgDailyTime: 60,
      longestStreak: 2,
      currentStreak: 1,
    };

    expect(mergeCurrentSessionIntoOverallStats(overall, [], null)).toEqual(overall);
  });

  it("updates totals and streaks using the merged daily stats", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T12:00:00.000Z"));

    const overall: OverallStats = {
      totalBooks: 3,
      totalReadingTime: 120,
      totalSessions: 5,
      totalReadingDays: 2,
      avgDailyTime: 60,
      longestStreak: 2,
      currentStreak: 1,
    };
    const dailyStats: DailyStats[] = [
      { date: "2026-04-02", totalTime: 20, pagesRead: 5, sessionsCount: 1 },
      { date: "2026-04-03", totalTime: 30, pagesRead: 7, sessionsCount: 1 },
    ];
    const session: ReadingSession = {
      id: "session-1",
      bookId: "book-1",
      state: "ACTIVE",
      startedAt: new Date("2026-04-04T08:00:00.000Z").getTime(),
      totalActiveTime: 30 * 60 * 1000,
      pagesRead: 12,
    };

    expect(mergeCurrentSessionIntoOverallStats(overall, dailyStats, session)).toEqual({
      totalBooks: 3,
      totalReadingTime: 150,
      totalCharactersRead: 0,
      totalSessions: 6,
      totalReadingDays: 3,
      avgDailyTime: 50,
      avgCharactersPerMinute: 0,
      longestStreak: 3,
      currentStreak: 3,
    });
  });

  it("resets current streak when neither today nor yesterday has reading", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T12:00:00.000Z"));

    const overall: OverallStats = {
      totalBooks: 1,
      totalReadingTime: 90,
      totalSessions: 3,
      totalReadingDays: 2,
      avgDailyTime: 45,
      longestStreak: 2,
      currentStreak: 2,
    };
    const dailyStats: DailyStats[] = [
      { date: "2026-04-01", totalTime: 20, pagesRead: 5, sessionsCount: 1 },
      { date: "2026-04-02", totalTime: 30, pagesRead: 7, sessionsCount: 1 },
    ];
    const session: ReadingSession = {
      id: "session-1",
      bookId: "book-1",
      state: "ACTIVE",
      startedAt: new Date("2026-04-05T08:00:00.000Z").getTime(),
      totalActiveTime: 15 * 60 * 1000,
      pagesRead: 2,
    };

    expect(mergeCurrentSessionIntoOverallStats(overall, dailyStats, session)).toEqual({
      totalBooks: 1,
      totalReadingTime: 105,
      totalCharactersRead: 0,
      totalSessions: 4,
      totalReadingDays: 3,
      avgDailyTime: 35,
      avgCharactersPerMinute: 0,
      longestStreak: 2,
      currentStreak: 0,
    });
  });
});
