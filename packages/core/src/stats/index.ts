export {
  ReadingStatsService,
  readingStatsService,
} from "./reading-stats";
export {
  buildDailyReadingFacts,
  createBookIndex,
} from "./fact-builder";
export {
  buildDayReport,
  buildLifetimeReport,
  buildMonthReport,
  buildStatsSummary,
  buildPeriodComparison,
  buildTopBooksFromFacts,
  buildWeekReport,
  buildYearReport,
} from "./report-builder";
export {
  getGoalProgress,
  getAllGoalProgress,
} from "./goals-service";
export { evaluateStreakStatus } from "./streak-service";
export type { StreakStatus } from "./streak-service";
export { computeBookETA } from "./eta-service";
export type { BookETA } from "./eta-service";
export {
  evaluateBadges,
  ALL_BADGE_DEFINITIONS,
  BADGE_NUMBERS,
  BADGE_CATEGORIES,
  groupBadgesByCategory,
} from "./badges";
export type {
  BadgeTier,
  BadgeCategory,
  BadgeDefinition,
  EarnedBadge,
} from "./badges";
export { mergeCurrentSessionIntoDailyFacts } from "./live-facts";
export {
  mergeCurrentSessionIntoDailyStats,
  mergeCurrentSessionIntoOverallStats,
} from "./live-reading-stats";
export {
  ReadingReportsService,
  readingReportsService,
} from "./reports-service";
export { buildStatsViewModel } from "./view-model-builder";
export { isStatsRelevantBookUpdate } from "./refresh-policy";
export {
  buildLifetimePeriodRef,
  buildPeriodRef,
  fromLocalDateKey,
  getMonthEndDate,
  getMonthKey,
  getMonthStartDate,
  getWeekEndDate,
  getWeekKey,
  getWeekStartDate,
  getYearEndDate,
  getYearKey,
  getYearStartDate,
  toLocalDate,
  toLocalDateKey,
} from "./period-utils";
export type {
  DailyStats,
  BookStats,
  OverallStats,
  PeriodBookStats,
  TrendPoint,
} from "./reading-stats";
export type {
  BaseStatsReport,
  StatsCalendarBlock,
  StatsCalendarCell,
  StatsCalendarCover,
  DailyBookBreakdown,
  DailyReadingFact,
  DayReport,
  LifetimeContext,
  LifetimeReport,
  MonthReport,
  StatsChartBlock,
  StatsChartDatum,
  StatsChartType,
  StatsDimension,
  StatsInsight,
  StatsInsightTone,
  StatsMetricCard,
  StatsMetricComparison,
  StatsNavigation,
  StatsPeriodRef,
  StatsReport,
  StatsSectionBlock,
  StatsShareCardModel,
  StatsSummary,
  StatsYearSnapshot,
  StatsViewModel,
  TopBookEntry,
  WeekReport,
  YearReport,
  GoalType,
  GoalPeriod,
  ReadingGoal,
  GoalProgress,
} from "./schema";
