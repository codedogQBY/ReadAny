/**
 * Reading Stats service — computes reading statistics from session data
 */
import { getBooks, getReadingSessions, getReadingSessionsByDateRange } from "@/lib/db/database";

export interface DailyStats {
  date: string; // YYYY-MM-DD
  totalTime: number; // minutes
  pagesRead: number;
  sessionsCount: number;
}

export interface BookStats {
  bookId: string;
  bookTitle: string;
  totalTime: number; // minutes
  sessions: number;
  avgSessionTime: number; // minutes
  pagesRead: number;
}

export interface OverallStats {
  totalBooks: number;
  totalReadingTime: number; // minutes
  totalSessions: number;
  avgDailyTime: number; // minutes
  longestStreak: number; // days
  currentStreak: number; // days
}

export class ReadingStatsService {
  /** Get daily reading stats for a date range */
  async getDailyStats(startDate: Date, endDate: Date): Promise<DailyStats[]> {
    const sessions = await getReadingSessionsByDateRange(startDate, endDate);

    const grouped = new Map<string, DailyStats>();

    for (const session of sessions) {
      const date = new Date(session.startedAt).toISOString().split("T")[0];
      const existing = grouped.get(date) || {
        date,
        totalTime: 0,
        pagesRead: 0,
        sessionsCount: 0,
      };

      existing.totalTime += session.totalActiveTime / 60000; // ms -> minutes
      existing.pagesRead += session.pagesRead;
      existing.sessionsCount += 1;

      grouped.set(date, existing);
    }

    // Fill in missing days with zeros
    const result: DailyStats[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      const dateStr = current.toISOString().split("T")[0];
      result.push(
        grouped.get(dateStr) || {
          date: dateStr,
          totalTime: 0,
          pagesRead: 0,
          sessionsCount: 0,
        },
      );
      current.setDate(current.getDate() + 1);
    }

    return result;
  }

  /** Get stats for a specific book */
  async getBookStats(bookId: string): Promise<BookStats> {
    const sessions = await getReadingSessions(bookId);
    const books = await getBooks();
    const book = books.find((b) => b.id === bookId);

    const totalTime = sessions.reduce((sum, s) => sum + s.totalActiveTime, 0);

    return {
      bookId,
      bookTitle: book?.meta.title || "Unknown",
      totalTime: totalTime / 60000,
      sessions: sessions.length,
      avgSessionTime: sessions.length > 0 ? totalTime / sessions.length / 60000 : 0,
      pagesRead: sessions.reduce((sum, s) => sum + s.pagesRead, 0),
    };
  }

  /** Get overall reading statistics */
  async getOverallStats(): Promise<OverallStats> {
    const books = await getBooks();

    let totalTime = 0;
    let totalSessions = 0;
    let totalPages = 0;
    const readingDays = new Set<string>();

    for (const book of books) {
      const sessions = await getReadingSessions(book.id);
      for (const session of sessions) {
        totalTime += session.totalActiveTime;
        totalSessions++;
        totalPages += session.pagesRead;
        readingDays.add(new Date(session.startedAt).toISOString().split("T")[0]);
      }
    }

    // Calculate streaks
    const { longestStreak, currentStreak } = this.calculateStreaks(readingDays);

    const daysCount = readingDays.size || 1;

    return {
      totalBooks: books.filter((b) => b.progress > 0).length,
      totalReadingTime: totalTime / 60000,
      totalSessions,
      avgDailyTime: totalTime / 60000 / daysCount,
      longestStreak,
      currentStreak,
    };
  }

  /** Calculate reading streaks from a set of reading dates */
  private calculateStreaks(readingDays: Set<string>): {
    longestStreak: number;
    currentStreak: number;
  } {
    if (readingDays.size === 0) {
      return { longestStreak: 0, currentStreak: 0 };
    }

    const sortedDates = Array.from(readingDays).sort();

    let longestStreak = 1;
    let currentStreakCount = 1;
    let tempStreak = 1;

    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1]);
      const curr = new Date(sortedDates[i]);
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }

      longestStreak = Math.max(longestStreak, tempStreak);
    }

    // Check if current streak is active (includes today or yesterday)
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    if (readingDays.has(today) || readingDays.has(yesterday)) {
      // Count backwards from the most recent date
      currentStreakCount = 1;
      const reversed = sortedDates.reverse();
      for (let i = 1; i < reversed.length; i++) {
        const curr = new Date(reversed[i - 1]);
        const prev = new Date(reversed[i]);
        const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          currentStreakCount++;
        } else {
          break;
        }
      }
    } else {
      currentStreakCount = 0;
    }

    return { longestStreak, currentStreak: currentStreakCount };
  }
}

/** Singleton stats service */
export const readingStatsService = new ReadingStatsService();
