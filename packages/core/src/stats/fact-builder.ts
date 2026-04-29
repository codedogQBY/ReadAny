import type { Book, ReadingSession } from "../types";
import { getMonthKey, getWeekKey, getYearKey, toLocalDateKey } from "./period-utils";
import type { DailyBookBreakdown, DailyReadingFact } from "./schema";

function toMinutes(milliseconds: number): number {
  return milliseconds / 60000;
}

function createUnknownBookBreakdown(bookId: string): DailyBookBreakdown {
  return {
    bookId,
    title: "Unknown",
    tags: [],
    subjects: [],
    totalTime: 0,
    pagesRead: 0,
    charactersRead: 0,
    sessionsCount: 0,
  };
}

export function createBookIndex(books: Book[]): Map<string, Book> {
  return new Map(books.map((book) => [book.id, book]));
}

interface DayAccumulator {
  date: string;
  totalTime: number;
  pagesRead: number;
  charactersRead: number;
  sessionsCount: number;
  longestSessionTime: number;
  firstSessionAt?: number;
  lastSessionAt?: number;
  hourBuckets: Map<number, number>;
  books: Map<string, DailyBookBreakdown>;
}

function createDayAccumulator(date: string): DayAccumulator {
  return {
    date,
    totalTime: 0,
    pagesRead: 0,
    charactersRead: 0,
    sessionsCount: 0,
    longestSessionTime: 0,
    hourBuckets: new Map(),
    books: new Map(),
  };
}

function getPeakHour(hourBuckets: Map<number, number>): number | undefined {
  let bestHour: number | undefined;
  let bestValue = -1;

  for (const [hour, totalMinutes] of hourBuckets) {
    if (
      totalMinutes > bestValue ||
      (totalMinutes === bestValue && bestHour !== undefined && hour < bestHour)
    ) {
      bestHour = hour;
      bestValue = totalMinutes;
    }
  }

  return bestHour;
}

/**
 * Build daily facts from raw reading sessions.
 *
 * Notes:
 * - day bucketing is based on local calendar fields, not UTC
 * - completedBooks is conservative for now because the current session model
 *   does not carry reliable completion deltas yet
 */
export function buildDailyReadingFacts(
  sessions: ReadingSession[],
  books: Book[] | Map<string, Book> = [],
): DailyReadingFact[] {
  const bookIndex = books instanceof Map ? books : createBookIndex(books);
  const days = new Map<string, DayAccumulator>();

  for (const session of sessions) {
    const date = toLocalDateKey(session.startedAt);
    const day = days.get(date) ?? createDayAccumulator(date);
    const totalTime = toMinutes(session.totalActiveTime);
    const sessionEndAt = session.endedAt ?? session.startedAt;
    const sessionHour = new Date(session.startedAt).getHours();

    day.totalTime += totalTime;
    day.pagesRead += session.pagesRead;
    day.charactersRead += session.charactersRead ?? 0;
    day.sessionsCount += 1;
    day.longestSessionTime = Math.max(day.longestSessionTime, totalTime);
    day.firstSessionAt =
      day.firstSessionAt === undefined
        ? session.startedAt
        : Math.min(day.firstSessionAt, session.startedAt);
    day.lastSessionAt =
      day.lastSessionAt === undefined ? sessionEndAt : Math.max(day.lastSessionAt, sessionEndAt);
    day.hourBuckets.set(sessionHour, (day.hourBuckets.get(sessionHour) ?? 0) + totalTime);

    const book = bookIndex.get(session.bookId);
    const existingBook =
      day.books.get(session.bookId) ??
      (book
        ? {
            bookId: session.bookId,
            title: book.meta.title,
            author: book.meta.author,
            coverUrl: book.meta.coverUrl,
            tags: book.tags,
            subjects: book.meta.subjects,
            totalTime: 0,
            pagesRead: 0,
            charactersRead: 0,
            sessionsCount: 0,
            progressEnd: book.progress,
            totalPages: book.meta.totalPages,
          }
        : createUnknownBookBreakdown(session.bookId));

    existingBook.totalTime += totalTime;
    existingBook.pagesRead += session.pagesRead;
    existingBook.charactersRead =
      (existingBook.charactersRead ?? 0) + (session.charactersRead ?? 0);
    existingBook.sessionsCount += 1;

    day.books.set(session.bookId, existingBook);
    days.set(date, day);
  }

  return Array.from(days.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      const bookBreakdown = Array.from(day.books.values()).sort(
        (a, b) => b.totalTime - a.totalTime,
      );

      return {
        date: day.date,
        weekKey: getWeekKey(day.date),
        monthKey: getMonthKey(day.date),
        yearKey: getYearKey(day.date),
        totalTime: day.totalTime,
        pagesRead: day.pagesRead,
        charactersRead: day.charactersRead,
        sessionsCount: day.sessionsCount,
        booksTouched: day.books.size,
        completedBooks: 0,
        avgSessionTime: day.sessionsCount > 0 ? day.totalTime / day.sessionsCount : 0,
        longestSessionTime: day.longestSessionTime,
        firstSessionAt: day.firstSessionAt,
        lastSessionAt: day.lastSessionAt,
        peakHour: getPeakHour(day.hourBuckets),
        hourlyDistribution: Array.from({ length: 24 }, (_, hour) => day.hourBuckets.get(hour) ?? 0),
        bookBreakdown,
      };
    });
}
