import { describe, expect, it } from "vitest";

import { getGoalProgress } from "./goals-service";
import type { DailyReadingFact, ReadingGoal } from "./schema";

const facts: DailyReadingFact[] = [
  {
    date: "2026-04-02",
    weekKey: "2026-W14",
    monthKey: "2026-04",
    yearKey: "2026",
    totalTime: 45,
    pagesRead: 10,
    charactersRead: 18000,
    sessionsCount: 1,
    booksTouched: 1,
    completedBooks: 0,
    avgSessionTime: 45,
    longestSessionTime: 45,
    peakHour: 21,
    hourlyDistribution: Array.from({ length: 24 }, () => 0),
    bookBreakdown: [],
  },
  {
    date: "2026-04-10",
    weekKey: "2026-W15",
    monthKey: "2026-04",
    yearKey: "2026",
    totalTime: 60,
    pagesRead: 18,
    charactersRead: 24000,
    sessionsCount: 2,
    booksTouched: 1,
    completedBooks: 0,
    avgSessionTime: 30,
    longestSessionTime: 40,
    peakHour: 22,
    hourlyDistribution: Array.from({ length: 24 }, () => 0),
    bookBreakdown: [],
  },
];

describe("goals-service", () => {
  it("computes character goals from the filtered period", () => {
    const goal: ReadingGoal = {
      id: "goal-characters",
      type: "characters",
      target: 50000,
      period: "monthly",
      createdAt: Date.now(),
    };

    const progress = getGoalProgress(goal, facts, new Date(2026, 3, 18));

    expect(progress.current).toBe(42000);
    expect(progress.remaining).toBe(8000);
    expect(progress.percentage).toBe(84);
  });
});
