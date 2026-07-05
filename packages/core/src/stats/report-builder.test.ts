import { describe, expect, it } from "vitest";

import {
  buildDayReport,
  buildLifetimeReport,
  buildMonthReport,
  buildStatsSummary,
  buildTopBooksFromFacts,
  buildWeekReport,
  buildYearReport,
} from "./report-builder";
import type { DailyReadingFact } from "./schema";

const facts: DailyReadingFact[] = [
  {
    date: "2026-04-13",
    weekKey: "2026-W16",
    monthKey: "2026-04",
    yearKey: "2026",
    totalTime: 30,
    pagesRead: 10,
    charactersRead: 12000,
    sessionsCount: 1,
    booksTouched: 1,
    completedBooks: 0,
    avgSessionTime: 30,
    longestSessionTime: 30,
    firstSessionAt: new Date(2026, 3, 13, 8, 0, 0).getTime(),
    lastSessionAt: new Date(2026, 3, 13, 8, 30, 0).getTime(),
    peakHour: 8,
    hourlyDistribution: Array.from({ length: 24 }, (_, hour) => (hour === 8 ? 30 : 0)),
    bookBreakdown: [
      {
        bookId: "book-1",
        title: "Deep Reading",
        author: "Alice",
        tags: ["Growth"],
        subjects: ["Personal Growth"],
        totalTime: 30,
        pagesRead: 10,
        charactersRead: 12000,
        sessionsCount: 1,
      },
    ],
  },
  {
    date: "2026-04-14",
    weekKey: "2026-W16",
    monthKey: "2026-04",
    yearKey: "2026",
    totalTime: 45,
    pagesRead: 14,
    charactersRead: 18000,
    sessionsCount: 2,
    booksTouched: 1,
    completedBooks: 0,
    avgSessionTime: 22.5,
    longestSessionTime: 25,
    firstSessionAt: new Date(2026, 3, 14, 20, 0, 0).getTime(),
    lastSessionAt: new Date(2026, 3, 14, 21, 0, 0).getTime(),
    peakHour: 20,
    hourlyDistribution: Array.from({ length: 24 }, (_, hour) => (hour === 20 ? 45 : 0)),
    bookBreakdown: [
      {
        bookId: "book-1",
        title: "Deep Reading",
        author: "Alice",
        tags: ["Growth"],
        subjects: ["Personal Growth"],
        totalTime: 45,
        pagesRead: 14,
        charactersRead: 18000,
        sessionsCount: 2,
      },
    ],
  },
  {
    date: "2026-04-16",
    weekKey: "2026-W16",
    monthKey: "2026-04",
    yearKey: "2026",
    totalTime: 60,
    pagesRead: 18,
    charactersRead: 21000,
    sessionsCount: 1,
    booksTouched: 1,
    completedBooks: 0,
    avgSessionTime: 60,
    longestSessionTime: 60,
    firstSessionAt: new Date(2026, 3, 16, 21, 0, 0).getTime(),
    lastSessionAt: new Date(2026, 3, 16, 22, 0, 0).getTime(),
    peakHour: 21,
    hourlyDistribution: Array.from({ length: 24 }, (_, hour) => (hour === 21 ? 60 : 0)),
    bookBreakdown: [
      {
        bookId: "book-2",
        title: "Systems Thinking",
        author: "Bob",
        tags: ["Thinking"],
        subjects: ["Systems"],
        totalTime: 60,
        pagesRead: 18,
        charactersRead: 21000,
        sessionsCount: 1,
      },
    ],
  },
  {
    date: "2026-05-02",
    weekKey: "2026-W18",
    monthKey: "2026-05",
    yearKey: "2026",
    totalTime: 20,
    pagesRead: 5,
    charactersRead: 6000,
    sessionsCount: 1,
    booksTouched: 1,
    completedBooks: 0,
    avgSessionTime: 20,
    longestSessionTime: 20,
    firstSessionAt: new Date(2026, 4, 2, 9, 0, 0).getTime(),
    lastSessionAt: new Date(2026, 4, 2, 9, 20, 0).getTime(),
    peakHour: 9,
    hourlyDistribution: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 20 : 0)),
    bookBreakdown: [
      {
        bookId: "book-1",
        title: "Deep Reading",
        author: "Alice",
        tags: ["Growth"],
        subjects: ["Personal Growth"],
        totalTime: 20,
        pagesRead: 5,
        charactersRead: 6000,
        sessionsCount: 1,
      },
    ],
  },
];

describe("report-builder", () => {
  it("builds summary and top books from daily facts", () => {
    const summary = buildStatsSummary(facts.slice(0, 3));
    expect(summary).toMatchObject({
      totalReadingTime: 135,
      totalSessions: 4,
      totalPagesRead: 42,
      totalCharactersRead: 51000,
      avgCharactersPerMinute: 377.77777777777777,
      activeDays: 3,
      booksTouched: 2,
      avgSessionTime: 33.75,
      avgActiveDayTime: 45,
      longestSessionTime: 60,
      currentStreak: 1,
      longestStreak: 2,
    });

    const topBooks = buildTopBooksFromFacts(facts.slice(0, 3));
    expect(topBooks[0]).toMatchObject({
      bookId: "book-1",
      totalTime: 75,
      charactersRead: 30000,
      avgCharactersPerMinute: 400,
    });
    expect(topBooks[1]).toMatchObject({
      bookId: "book-2",
      totalTime: 60,
      charactersRead: 21000,
      avgCharactersPerMinute: 350,
    });
  });

  it("keeps renamed books merged by id and uses the latest metadata", () => {
    const renamedFacts: DailyReadingFact[] = [
      {
        ...facts[0],
        bookBreakdown: [
          {
            ...facts[0].bookBreakdown[0],
            title: "Old Title",
            author: "Old Author",
            coverUrl: "old-cover",
          },
        ],
      },
      {
        ...facts[1],
        bookBreakdown: [
          {
            ...facts[1].bookBreakdown[0],
            title: "New Title",
            author: "New Author",
            coverUrl: "new-cover",
          },
        ],
      },
    ];

    const [topBook] = buildTopBooksFromFacts(renamedFacts);

    expect(topBook).toMatchObject({
      bookId: "book-1",
      title: "New Title",
      author: "New Author",
      coverUrl: "new-cover",
      totalTime: 75,
      sessionsCount: 3,
    });
  });

  it("builds a day report for a single local date", () => {
    const report = buildDayReport(facts, new Date(2026, 3, 16), {
      now: new Date(2026, 4, 10),
    });
    expect(report.dimension).toBe("day");
    expect(report.period.key).toBe("2026-04-16");
    expect(report.summary.totalReadingTime).toBe(60);
    expect(report.dayFact?.peakHour).toBe(21);
    expect(report.topBooks[0].bookId).toBe("book-2");
  });

  it("builds a week report with 7 chart buckets", () => {
    const report = buildWeekReport(facts, new Date(2026, 3, 16), {
      now: new Date(2026, 4, 10),
    });
    expect(report.dimension).toBe("week");
    expect(report.period.key).toBe("2026-W16");
    expect(report.summary.totalReadingTime).toBe(135);
    expect(report.weekdayDistribution?.data).toHaveLength(7);
    expect(report.navigation.canGoNext).toBe(true);
  });

  it("builds month, year and lifetime reports", () => {
    const monthReport = buildMonthReport(facts, new Date(2026, 3, 16), {
      now: new Date(2026, 4, 10),
    });
    expect(monthReport.dimension).toBe("month");
    expect(monthReport.period.key).toBe("2026-04");
    expect(monthReport.summary.totalReadingTime).toBe(135);
    expect(monthReport.readingCalendar?.monthKey).toBe("2026-04");
    expect(monthReport.readingCalendar?.weeks.length).toBeGreaterThanOrEqual(4);
    const activeCalendarCell = monthReport.readingCalendar?.weeks
      .flat()
      .find((cell) => cell.date === "2026-04-16");
    expect(activeCalendarCell).toMatchObject({
      inCurrentMonth: true,
      totalTime: 60,
      intensity: 4,
    });
    expect(activeCalendarCell?.covers[0]).toMatchObject({
      bookId: "book-2",
      title: "Systems Thinking",
    });

    const yearReport = buildYearReport(facts, new Date(2026, 3, 16), {
      now: new Date(2026, 4, 10),
    });
    expect(yearReport.dimension).toBe("year");
    expect(yearReport.period.key).toBe("2026");
    expect(yearReport.monthlyCharts[0].data.find((item) => item.key === "2026-04")?.value).toBe(
      135,
    );
    expect(yearReport.timeOfDayChart?.data.length).toBe(6);
    expect(yearReport.categoryDistribution?.data[0]?.key).toBe("Growth");

    const lifetimeReport = buildLifetimeReport(facts, {
      now: new Date(2026, 4, 10),
    });
    expect(lifetimeReport.dimension).toBe("lifetime");
    expect(lifetimeReport.context.joinedSince).toBe("2026-04-13");
    expect(lifetimeReport.context.daysSinceJoined).toBeGreaterThan(0);
    expect(lifetimeReport.yearlyCharts[0].data[0]).toMatchObject({
      key: "2026",
      value: 155,
    });
    expect(lifetimeReport.yearlySnapshots[0]?.year).toBe("2026");
  });

  it("allows navigating to a previous partial month when that month contains the earliest reading records", () => {
    const partialFacts: DailyReadingFact[] = [
      {
        ...facts[0],
        date: "2026-03-22",
        weekKey: "2026-W12",
        monthKey: "2026-03",
      },
      {
        ...facts[1],
        date: "2026-04-03",
        weekKey: "2026-W14",
        monthKey: "2026-04",
      },
    ];

    const report = buildMonthReport(partialFacts, new Date(2026, 3, 15), {
      now: new Date(2026, 3, 21),
    });

    expect(report.navigation.canGoPrev).toBe(true);
    expect(report.navigation.prevKey).toBe("2026-03");
  });
});
