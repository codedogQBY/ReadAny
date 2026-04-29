/**
 * goals-service.ts — Pure functions to compute reading goal progress.
 * No side-effects, no React — can be used from any context.
 */
import type { DailyReadingFact, GoalProgress, ReadingGoal } from "./schema";

/**
 * Get the date range for a goal's current period.
 */
function getGoalPeriodRange(goal: ReadingGoal, now: Date): { start: Date; end: Date } {
  if (goal.period === "monthly") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { start, end };
  }
  // yearly
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  return { start, end };
}

/**
 * Filter facts to the goal's period.
 */
function filterFactsForGoal(
  facts: DailyReadingFact[],
  goal: ReadingGoal,
  now: Date,
): DailyReadingFact[] {
  const { start, end } = getGoalPeriodRange(goal, now);
  const startKey = toDateKey(start);
  const endKey = toDateKey(end);
  return facts.filter((f) => f.date >= startKey && f.date <= endKey);
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Compute the current value for a goal type from filtered facts.
 */
function computeCurrentValue(facts: DailyReadingFact[], goal: ReadingGoal): number {
  if (goal.type === "time") {
    // Total reading time in hours (goals target is in hours)
    return facts.reduce((sum, f) => sum + f.totalTime, 0) / 60;
  }
  if (goal.type === "books") {
    // Count unique books touched
    const bookIds = new Set<string>();
    for (const f of facts) {
      for (const b of f.bookBreakdown) {
        bookIds.add(b.bookId);
      }
    }
    return bookIds.size;
  }
  if (goal.type === "pages") {
    return facts.reduce((sum, f) => sum + f.pagesRead, 0);
  }
  if (goal.type === "characters") {
    return facts.reduce((sum, f) => sum + (f.charactersRead ?? 0), 0);
  }
  return 0;
}

/**
 * Determine if the user is on track to hit the target by period end.
 */
function computeOnTrack(current: number, target: number, goal: ReadingGoal, now: Date): boolean {
  if (current >= target) return true;

  const { start, end } = getGoalPeriodRange(goal, now);
  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const elapsedDays = Math.max(1, (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const projectedRate = current / elapsedDays;
  const projected = projectedRate * totalDays;

  return projected >= target;
}

/**
 * Main entry: compute progress for a single goal.
 */
export function getGoalProgress(
  goal: ReadingGoal,
  facts: DailyReadingFact[],
  now: Date = new Date(),
): GoalProgress {
  const filtered = filterFactsForGoal(facts, goal, now);
  const current = computeCurrentValue(filtered, goal);
  const percentage = goal.target > 0 ? Math.min(100, Math.round((current / goal.target) * 100)) : 0;
  const remaining = Math.max(0, goal.target - current);
  const onTrack = computeOnTrack(current, goal.target, goal, now);

  return {
    goal,
    current: Math.round(current * 10) / 10, // 1 decimal
    percentage,
    remaining: Math.round(remaining * 10) / 10,
    onTrack,
  };
}

/**
 * Compute progress for all goals.
 */
export function getAllGoalProgress(
  goals: ReadingGoal[],
  facts: DailyReadingFact[],
  now: Date = new Date(),
): GoalProgress[] {
  return goals.map((goal) => getGoalProgress(goal, facts, now));
}
