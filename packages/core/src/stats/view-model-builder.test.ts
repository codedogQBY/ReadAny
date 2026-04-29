import { describe, expect, it } from "vitest";

import { buildLifetimeReport, buildMonthReport, buildWeekReport } from "./report-builder";
import type { DailyReadingFact } from "./schema";
import { buildStatsViewModel } from "./view-model-builder";

const facts: DailyReadingFact[] = [
  {
    date: "2026-04-13",
    weekKey: "2026-W16",
    monthKey: "2026-04",
    yearKey: "2026",
    totalTime: 30,
    pagesRead: 10,
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
        tags: ["Growth"],
        subjects: ["Personal Growth"],
        totalTime: 30,
        pagesRead: 10,
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
        tags: ["Growth"],
        subjects: ["Personal Growth"],
        totalTime: 45,
        pagesRead: 14,
        sessionsCount: 2,
      },
    ],
  },
];

describe("buildStatsViewModel", () => {
  it("maps a weekly report into a UI-friendly view model", () => {
    const report = buildWeekReport(facts, new Date(2026, 3, 14), {
      now: new Date(2026, 3, 20),
    });
    const viewModel = buildStatsViewModel(report);

    expect(viewModel.header.title).toBe("Weekly Reading Report");
    expect(viewModel.header.periodLabel).toBe(report.period.label);
    expect(viewModel.heroMetrics[0]).toMatchObject({
      id: "reading-time",
    });
    expect(viewModel.sections.map((section) => section.id)).toEqual([
      "charts",
      "top-books",
      "insights",
    ]);
  });

  it("adds reading calendar section for month reports", () => {
    const weekReport = buildWeekReport(facts, new Date(2026, 3, 14), {
      now: new Date(2026, 3, 20),
    });
    expect(
      buildStatsViewModel(weekReport).sections.some((section) => section.id === "reading-calendar"),
    ).toBe(false);

    const monthReport = buildMonthReport(facts, new Date(2026, 3, 14), {
      now: new Date(2026, 3, 20),
    });
    expect(
      buildStatsViewModel(monthReport).sections.some(
        (section) => section.id === "reading-calendar",
      ),
    ).toBe(true);
  });

  it("adds lifetime-specific header and milestones section", () => {
    const report = buildLifetimeReport(facts);
    const viewModel = buildStatsViewModel(report);

    expect(viewModel.header.title).toBe("Lifetime Reading Report");
    expect(viewModel.header.subtitle).toBe(report.context.companionMessage);
    expect(viewModel.heroMetrics[0]).toMatchObject({
      id: "journey-days",
    });
    expect(viewModel.sections.some((section) => section.id === "milestones")).toBe(true);
  });
});
