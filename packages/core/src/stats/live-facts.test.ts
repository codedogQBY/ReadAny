import { describe, expect, it } from "vitest";

import type { Book, ReadingSession } from "../types";
import { mergeCurrentSessionIntoDailyFacts } from "./live-facts";
import type { DailyReadingFact } from "./schema";

const books: Book[] = [
  {
    id: "book-1",
    filePath: "/tmp/book-1.epub",
    format: "epub",
    meta: {
      title: "Deep Reading",
      author: "Alice",
      coverUrl: "cover-1",
      subjects: ["Personal Growth"],
    },
    addedAt: 1,
    updatedAt: 1,
    progress: 0.5,
    isVectorized: false,
    vectorizeProgress: 0,
    tags: ["Growth"],
    syncStatus: "local",
  },
];

const currentSession: ReadingSession = {
  id: "live-1",
  bookId: "book-1",
  state: "ACTIVE",
  startedAt: new Date(2026, 3, 17, 20, 0, 0).getTime(),
  totalActiveTime: 30 * 60 * 1000,
  pagesRead: 9,
};

describe("mergeCurrentSessionIntoDailyFacts", () => {
  it("returns original facts when there is no live session", () => {
    const facts: DailyReadingFact[] = [];
    expect(mergeCurrentSessionIntoDailyFacts(facts, null)).toEqual(facts);
  });

  it("merges into an existing daily fact", () => {
    const facts: DailyReadingFact[] = [
      {
        date: "2026-04-17",
        weekKey: "2026-W16",
        monthKey: "2026-04",
        yearKey: "2026",
        totalTime: 45,
        pagesRead: 12,
        sessionsCount: 2,
        booksTouched: 1,
        completedBooks: 0,
        avgSessionTime: 22.5,
        longestSessionTime: 25,
        firstSessionAt: new Date(2026, 3, 17, 9, 0, 0).getTime(),
        lastSessionAt: new Date(2026, 3, 17, 10, 0, 0).getTime(),
        peakHour: 9,
        hourlyDistribution: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 45 : 0)),
        bookBreakdown: [
          {
            bookId: "book-1",
            title: "Deep Reading",
            author: "Alice",
            coverUrl: "cover-1",
            tags: ["Growth"],
            subjects: ["Personal Growth"],
            totalTime: 45,
            pagesRead: 12,
            sessionsCount: 2,
            progressEnd: 0.5,
          },
        ],
      },
    ];

    const merged = mergeCurrentSessionIntoDailyFacts(facts, currentSession, books);
    expect(merged[0]).toMatchObject({
      date: "2026-04-17",
      totalTime: 75,
      pagesRead: 21,
      sessionsCount: 3,
      booksTouched: 1,
      avgSessionTime: 25,
      longestSessionTime: 30,
    });
    expect(merged[0].bookBreakdown[0]).toMatchObject({
      bookId: "book-1",
      totalTime: 75,
      pagesRead: 21,
      sessionsCount: 3,
    });
    expect(merged[0].hourlyDistribution[20]).toBe(30);
  });

  it("creates a new daily fact when the session is on a missing date", () => {
    const merged = mergeCurrentSessionIntoDailyFacts([], currentSession, books);
    expect(merged).toEqual([
      expect.objectContaining({
        date: "2026-04-17",
        totalTime: 30,
        pagesRead: 9,
        sessionsCount: 1,
        booksTouched: 1,
      }),
    ]);
    expect(merged[0].bookBreakdown[0]).toMatchObject({
      title: "Deep Reading",
      coverUrl: "cover-1",
    });
  });
});
