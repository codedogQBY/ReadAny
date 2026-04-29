/**
 * Next-generation reading stats schema.
 *
 * This file defines the stable data contracts for the upcoming
 * day / week / month / year / lifetime reporting system.
 *
 * These types are additive for now and do not replace the existing
 * DailyStats / OverallStats contracts yet.
 */

export type StatsDimension = "day" | "week" | "month" | "year" | "lifetime";

export interface StatsPeriodRef {
  dimension: StatsDimension;
  key: string;
  startDate: string; // local YYYY-MM-DD
  endDate: string; // local YYYY-MM-DD
  label: string;
}

export interface StatsNavigation {
  canGoPrev: boolean;
  canGoNext: boolean;
  prevKey?: string;
  nextKey?: string;
}

export interface StatsMetricComparison {
  label: string;
  value: number;
  delta?: number;
  deltaLabel?: string;
}

export interface StatsSummary {
  totalReadingTime: number; // minutes
  totalSessions: number;
  totalPagesRead: number;
  totalCharactersRead?: number;
  avgCharactersPerMinute?: number;
  activeDays: number;
  booksTouched: number;
  completedBooks: number;
  avgSessionTime: number; // minutes
  avgActiveDayTime: number; // minutes
  longestSessionTime: number; // minutes
  currentStreak: number;
  longestStreak: number;
}

export interface DailyBookBreakdown {
  bookId: string;
  title: string;
  author?: string;
  coverUrl?: string;
  tags?: string[];
  subjects?: string[];
  totalTime: number; // minutes
  pagesRead: number;
  charactersRead?: number;
  sessionsCount: number;
  progressStart?: number;
  progressEnd?: number;
  progressDelta?: number;
  totalPages?: number;
}

export interface DailyReadingFact {
  date: string; // local YYYY-MM-DD
  weekKey: string; // YYYY-Www
  monthKey: string; // YYYY-MM
  yearKey: string; // YYYY

  totalTime: number; // minutes
  pagesRead: number;
  charactersRead?: number;
  sessionsCount: number;
  booksTouched: number;
  completedBooks: number;

  avgSessionTime: number; // minutes
  longestSessionTime: number; // minutes
  firstSessionAt?: number;
  lastSessionAt?: number;
  peakHour?: number; // 0-23
  hourlyDistribution: number[]; // 24 buckets, minutes per hour

  bookBreakdown: DailyBookBreakdown[];
}

export type StatsInsightTone = "neutral" | "positive" | "warning" | "celebration";

export interface StatsInsight {
  id: string;
  title: string;
  body: string;
  tone?: StatsInsightTone;
}

export interface StatsMetricCard {
  id: string;
  label: string;
  value: string;
  sublabel?: string;
  comparison?: StatsMetricComparison;
}

export type StatsChartType =
  | "heatmap"
  | "bar"
  | "line"
  | "stacked-bar"
  | "area"
  | "timeline"
  | "radial";

export interface StatsChartDatum {
  key: string;
  label: string;
  value: number;
  secondaryValue?: number;
}

export interface StatsChartBlock {
  id: string;
  title: string;
  description?: string;
  type: StatsChartType;
  data: StatsChartDatum[];
}

export interface StatsCalendarCover {
  bookId: string;
  title: string;
  coverUrl?: string;
  totalTime: number; // minutes
}

export interface StatsCalendarCell {
  date: string; // local YYYY-MM-DD
  dayOfMonth: number;
  inCurrentMonth: boolean;
  isToday?: boolean;
  totalTime: number; // minutes
  pagesRead: number;
  charactersRead?: number;
  sessionsCount: number;
  intensity: 0 | 1 | 2 | 3 | 4;
  covers: StatsCalendarCover[];
}

export interface StatsCalendarBlock {
  id: string;
  title: string;
  description?: string;
  monthKey: string;
  weeks: StatsCalendarCell[][];
}

export interface TopBookEntry {
  bookId: string;
  title: string;
  author?: string;
  coverUrl?: string;
  totalTime: number; // minutes
  pagesRead: number;
  charactersRead?: number;
  avgCharactersPerMinute?: number;
  sessionsCount: number;
  progress?: number;
  totalPages?: number;
}

export interface StatsYearSnapshot {
  year: string;
  totalReadingTime: number; // minutes
  activeDays: number;
  booksTouched: number;
  topBook?: TopBookEntry;
}

export interface StatsShareCardModel {
  dimension: StatsDimension;
  title: string;
  subtitle?: string;
  periodLabel: string;
  accentMetric: StatsMetricCard;
  secondaryMetrics: StatsMetricCard[];
  chart?: StatsChartBlock;
  topBook?: TopBookEntry;
  footer: string;
  theme: "light" | "dark" | "brand";
}

export interface StatsSectionBlock {
  id: string;
  title: string;
  description?: string;
  layout?: "grid" | "list" | "chart" | "timeline";
}

export interface StatsViewModel {
  header: {
    title: string;
    subtitle?: string;
    periodLabel: string;
  };
  heroMetrics: StatsMetricCard[];
  sections: StatsSectionBlock[];
  shareCard: StatsShareCardModel;
}

export interface BaseStatsReport {
  dimension: StatsDimension;
  period: StatsPeriodRef;
  navigation: StatsNavigation;
  summary: StatsSummary;
  insights: StatsInsight[];
  charts: StatsChartBlock[];
  topBooks: TopBookEntry[];
  shareCard: StatsShareCardModel;
  /** Comparison to the previous period (e.g. this month vs last month) */
  previousPeriodComparison?: StatsMetricComparison[];
}

export interface DayReport extends BaseStatsReport {
  dimension: "day";
  dayFact: DailyReadingFact | null;
  hourlyTimeline: StatsChartBlock | null;
  comparisonToPreviousDay?: StatsMetricComparison[];
}

export interface WeekReport extends BaseStatsReport {
  dimension: "week";
  dailyFacts: DailyReadingFact[];
  weekdayDistribution?: StatsChartBlock;
  workingDayComparison?: StatsMetricComparison[];
}

export interface MonthReport extends BaseStatsReport {
  dimension: "month";
  dailyFacts: DailyReadingFact[];
  heatmap?: StatsChartBlock;
  weeklyBreakdown?: StatsChartBlock;
  readingCalendar?: StatsCalendarBlock;
}

export interface YearReport extends BaseStatsReport {
  dimension: "year";
  monthlyCharts: StatsChartBlock[];
  strongestMonth?: StatsMetricComparison;
  timeOfDayChart?: StatsChartBlock;
  categoryDistribution?: StatsChartBlock;
}

export interface LifetimeContext {
  joinedSince: string; // local YYYY-MM-DD
  daysSinceJoined: number;
  firstReadingDate?: string;
  totalActiveDays: number;
  totalInactiveDays: number;
  companionMessage: string;
}

export interface LifetimeReport extends BaseStatsReport {
  dimension: "lifetime";
  context: LifetimeContext;
  yearlyCharts: StatsChartBlock[];
  yearlySnapshots: StatsYearSnapshot[];
  timeOfDayChart?: StatsChartBlock;
  categoryDistribution?: StatsChartBlock;
  milestones: StatsInsight[];
}

export type StatsReport = DayReport | WeekReport | MonthReport | YearReport | LifetimeReport;

/* ─── Reading Goals ─── */

export type GoalType = "books" | "time" | "characters" | "pages";
export type GoalPeriod = "monthly" | "yearly";

export interface ReadingGoal {
  id: string;
  type: GoalType;
  target: number;
  period: GoalPeriod;
  createdAt: number; // timestamp
}

export interface GoalProgress {
  goal: ReadingGoal;
  current: number;
  percentage: number; // 0–100
  remaining: number;
  onTrack: boolean;
}
