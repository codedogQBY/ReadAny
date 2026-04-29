import { toLocalDateKey } from "./period-utils";
/**
 * streak-service.ts — Pure helpers for streak status (at-risk detection, etc.).
 */
import type { DailyReadingFact } from "./schema";

export interface StreakStatus {
  /** Current streak count (days). */
  streakCount: number;
  /** The streak exists but today has not been logged yet → at risk of breaking. */
  atRisk: boolean;
  /** User has already read today → streak is safe. */
  readToday: boolean;
}

/**
 * Evaluate streak status from daily facts.
 *
 * Rules:
 * - streakCount = consecutive days with totalTime > 0 ending at the most recent reading day.
 * - If the most recent reading day is today → readToday=true, atRisk=false.
 * - If the most recent reading day is yesterday → streak is still alive but atRisk=true.
 * - Else (last read was >=2 days ago or never) → streakCount=0.
 */
export function evaluateStreakStatus(
  facts: DailyReadingFact[],
  now: Date = new Date(),
): StreakStatus {
  const activeDates = facts
    .filter((f) => f.totalTime > 0)
    .map((f) => f.date)
    .sort();

  if (activeDates.length === 0) {
    return { streakCount: 0, atRisk: false, readToday: false };
  }

  const todayKey = toLocalDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toLocalDateKey(yesterday);

  const mostRecent = activeDates[activeDates.length - 1];
  const readToday = mostRecent === todayKey;
  const readYesterday = mostRecent === yesterdayKey;

  if (!readToday && !readYesterday) {
    // Streak broken.
    return { streakCount: 0, atRisk: false, readToday: false };
  }

  // Count consecutive days back from mostRecent.
  let streakCount = 1;
  for (let i = activeDates.length - 2; i >= 0; i--) {
    const curr = new Date(activeDates[i + 1]);
    const prev = new Date(activeDates[i]);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
    if (diffDays === 1) streakCount += 1;
    else break;
  }

  return {
    streakCount,
    atRisk: !readToday && readYesterday,
    readToday,
  };
}
