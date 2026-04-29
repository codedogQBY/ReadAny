import type { Book, ReadingSession } from "../types";
import { getMonthKey, getWeekKey, getYearKey, toLocalDateKey } from "./period-utils";
import type { DailyBookBreakdown, DailyReadingFact } from "./schema";

function toMinutes(milliseconds: number): number {
  return milliseconds / 60000;
}

function createBookBreakdown(session: ReadingSession, book?: Book): DailyBookBreakdown {
  return {
    bookId: session.bookId,
    title: book?.meta.title ?? "Unknown",
    author: book?.meta.author,
    coverUrl: book?.meta.coverUrl,
    tags: book?.tags ?? [],
    subjects: book?.meta.subjects ?? [],
    totalTime: 0,
    pagesRead: 0,
    charactersRead: 0,
    sessionsCount: 0,
    progressEnd: book?.progress,
  };
}

function getPeakHour(hourlyDistribution: number[]): number | undefined {
  let bestHour: number | undefined;
  let bestValue = -1;

  hourlyDistribution.forEach((value, hour) => {
    if (value > bestValue) {
      bestHour = hour;
      bestValue = value;
    }
  });

  return bestValue > 0 ? bestHour : undefined;
}

function createDailyFact(date: string): DailyReadingFact {
  return {
    date,
    weekKey: getWeekKey(date),
    monthKey: getMonthKey(date),
    yearKey: getYearKey(date),
    totalTime: 0,
    pagesRead: 0,
    charactersRead: 0,
    sessionsCount: 0,
    booksTouched: 0,
    completedBooks: 0,
    avgSessionTime: 0,
    longestSessionTime: 0,
    hourlyDistribution: Array.from({ length: 24 }, () => 0),
    bookBreakdown: [],
  };
}

export function mergeCurrentSessionIntoDailyFacts(
  dailyFacts: DailyReadingFact[],
  currentSession: ReadingSession | null,
  books: Book[] | Map<string, Book> = [],
): DailyReadingFact[] {
  if (!currentSession || currentSession.totalActiveTime <= 0) {
    return dailyFacts;
  }

  const bookIndex = books instanceof Map ? books : new Map(books.map((book) => [book.id, book]));
  const sessionDate = toLocalDateKey(currentSession.startedAt);
  const sessionMinutes = toMinutes(currentSession.totalActiveTime);
  const sessionHour = new Date(currentSession.startedAt).getHours();
  const book = bookIndex.get(currentSession.bookId);

  const nextFacts = dailyFacts.map((fact) => ({
    ...fact,
    bookBreakdown: fact.bookBreakdown.map((item) => ({ ...item })),
  }));

  let target = nextFacts.find((fact) => fact.date === sessionDate);
  if (!target) {
    target = createDailyFact(sessionDate);
    nextFacts.push(target);
  }

  target.totalTime += sessionMinutes;
  target.pagesRead += currentSession.pagesRead;
  target.charactersRead = (target.charactersRead ?? 0) + (currentSession.charactersRead ?? 0);
  target.sessionsCount += 1;
  target.longestSessionTime = Math.max(target.longestSessionTime, sessionMinutes);
  target.firstSessionAt =
    target.firstSessionAt === undefined
      ? currentSession.startedAt
      : Math.min(target.firstSessionAt, currentSession.startedAt);
  target.lastSessionAt =
    target.lastSessionAt === undefined
      ? (currentSession.endedAt ?? currentSession.startedAt)
      : Math.max(target.lastSessionAt, currentSession.endedAt ?? currentSession.startedAt);
  target.hourlyDistribution[sessionHour] =
    (target.hourlyDistribution[sessionHour] ?? 0) + sessionMinutes;
  target.peakHour = getPeakHour(target.hourlyDistribution);

  let targetBook = target.bookBreakdown.find((item) => item.bookId === currentSession.bookId);
  if (!targetBook) {
    targetBook = createBookBreakdown(currentSession, book);
    target.bookBreakdown.push(targetBook);
  }

  targetBook.totalTime += sessionMinutes;
  targetBook.pagesRead += currentSession.pagesRead;
  targetBook.charactersRead =
    (targetBook.charactersRead ?? 0) + (currentSession.charactersRead ?? 0);
  targetBook.sessionsCount += 1;
  targetBook.tags = book?.tags ?? targetBook.tags;
  targetBook.subjects = book?.meta.subjects ?? targetBook.subjects;
  targetBook.progressEnd = book?.progress ?? targetBook.progressEnd;

  target.bookBreakdown.sort((a, b) => b.totalTime - a.totalTime);
  target.booksTouched = new Set(target.bookBreakdown.map((item) => item.bookId)).size;
  target.avgSessionTime = target.sessionsCount > 0 ? target.totalTime / target.sessionsCount : 0;

  return nextFacts.sort((a, b) => a.date.localeCompare(b.date));
}
