import {
  buildLifetimePeriodRef,
  buildPeriodRef,
  fromLocalDateKey,
  getMonthEndDate,
  getMonthStartDate,
  getWeekEndDate,
  getWeekStartDate,
  getYearStartDate,
  toLocalDateKey,
} from "./period-utils";
import type {
  DailyReadingFact,
  DayReport,
  LifetimeReport,
  MonthReport,
  StatsCalendarBlock,
  StatsCalendarCell,
  StatsChartBlock,
  StatsChartDatum,
  StatsDimension,
  StatsInsight,
  StatsMetricCard,
  StatsMetricComparison,
  StatsNavigation,
  StatsPeriodRef,
  StatsShareCardModel,
  StatsSummary,
  StatsYearSnapshot,
  TopBookEntry,
  WeekReport,
  YearReport,
} from "./schema";

interface ReportBuilderOptions {
  joinedSince?: string;
  limitTopBooks?: number;
  now?: Date;
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function toDisplayTime(minutes: number): string {
  if (minutes >= 60) {
    const hours = minutes / 60;
    return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
  }
  return `${Math.round(minutes)}m`;
}

function createMetricCard(
  id: string,
  label: string,
  value: string,
  sublabel?: string,
): StatsMetricCard {
  return { id, label, value, sublabel };
}

export function buildStatsSummary(facts: DailyReadingFact[]): StatsSummary {
  const totalReadingTime = sum(facts.map((fact) => fact.totalTime));
  const totalSessions = sum(facts.map((fact) => fact.sessionsCount));
  const totalPagesRead = sum(facts.map((fact) => fact.pagesRead));
  const totalCharactersRead = sum(facts.map((fact) => fact.charactersRead ?? 0));
  const activeDays = facts.filter((fact) => fact.totalTime > 0).length;
  const bookIds = new Set<string>();

  for (const fact of facts) {
    for (const book of fact.bookBreakdown) {
      bookIds.add(book.bookId);
    }
  }

  const streaks = calculateStreaks(facts.map((fact) => fact.date));

  return {
    totalReadingTime,
    totalSessions,
    totalPagesRead,
    totalCharactersRead,
    avgCharactersPerMinute: totalReadingTime > 0 ? totalCharactersRead / totalReadingTime : 0,
    activeDays,
    booksTouched: bookIds.size,
    completedBooks: sum(facts.map((fact) => fact.completedBooks)),
    avgSessionTime: totalSessions > 0 ? totalReadingTime / totalSessions : 0,
    avgActiveDayTime: activeDays > 0 ? totalReadingTime / activeDays : 0,
    longestSessionTime: Math.max(0, ...facts.map((fact) => fact.longestSessionTime)),
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak,
  };
}

export function buildTopBooksFromFacts(facts: DailyReadingFact[], limit = 20): TopBookEntry[] {
  const map = new Map<string, TopBookEntry>();

  for (const fact of facts) {
    for (const book of fact.bookBreakdown) {
      const existing = map.get(book.bookId) ?? {
        bookId: book.bookId,
        title: book.title,
        author: book.author,
        coverUrl: book.coverUrl,
        totalTime: 0,
        pagesRead: 0,
        charactersRead: 0,
        sessionsCount: 0,
        progress: book.progressEnd,
        totalPages: book.totalPages,
      };

      existing.totalTime += book.totalTime;
      existing.pagesRead += book.pagesRead;
      existing.charactersRead = (existing.charactersRead ?? 0) + (book.charactersRead ?? 0);
      existing.sessionsCount += book.sessionsCount;
      existing.progress = book.progressEnd ?? existing.progress;
      existing.totalPages = book.totalPages ?? existing.totalPages;
      existing.title = book.title;
      existing.author = book.author;
      existing.coverUrl = book.coverUrl;
      existing.avgCharactersPerMinute =
        existing.totalTime > 0 ? (existing.charactersRead ?? 0) / existing.totalTime : 0;

      map.set(book.bookId, existing);
    }
  }

  return Array.from(map.values())
    .map((book) => ({
      ...book,
      avgCharactersPerMinute: book.totalTime > 0 ? (book.charactersRead ?? 0) / book.totalTime : 0,
    }))
    .sort((a, b) => b.totalTime - a.totalTime)
    .slice(0, limit);
}

function calculateStreaks(dateKeys: string[]): { currentStreak: number; longestStreak: number } {
  if (dateKeys.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const sorted = [...new Set(dateKeys)].sort();
  let longestStreak = 1;
  let running = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = fromLocalDateKey(sorted[i - 1]);
    const curr = fromLocalDateKey(sorted[i]);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
    if (diffDays === 1) {
      running += 1;
      longestStreak = Math.max(longestStreak, running);
    } else {
      running = 1;
    }
  }

  let currentStreak = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    const curr = fromLocalDateKey(sorted[i]);
    const prev = fromLocalDateKey(sorted[i - 1]);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
    if (diffDays === 1) {
      currentStreak += 1;
    } else {
      break;
    }
  }

  return { currentStreak, longestStreak };
}

function buildInsights(summary: StatsSummary, topBooks: TopBookEntry[]): StatsInsight[] {
  const insights: StatsInsight[] = [];

  if (summary.totalReadingTime <= 0) {
    insights.push({
      id: "no-reading",
      title: "No reading activity",
      body: "This period does not have recorded reading sessions yet.",
      tone: "neutral",
    });
    return insights;
  }

  if (summary.currentStreak >= 3) {
    insights.push({
      id: "streak",
      title: "Strong consistency",
      body: `You kept reading for ${summary.currentStreak} consecutive days in this period.`,
      tone: "celebration",
    });
  }

  if (summary.longestSessionTime >= 60) {
    insights.push({
      id: "focus",
      title: "Deep focus session",
      body: `Your longest session reached ${Math.round(summary.longestSessionTime)} minutes.`,
      tone: "positive",
    });
  }

  const topBook = topBooks[0];
  if (topBook) {
    insights.push({
      id: "top-book",
      title: "Main reading focus",
      body: `${topBook.title} was your most-read book for this period.`,
      tone: "positive",
    });
  }

  return insights.slice(0, 3);
}

/* ─── Period comparison ─── */

function computeDelta(current: number, previous: number): { delta: number; deltaLabel: string } {
  if (previous <= 0) {
    return current > 0 ? { delta: 100, deltaLabel: "+∞" } : { delta: 0, deltaLabel: "—" };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { delta: 0, deltaLabel: "—" };
  return { delta: pct, deltaLabel: pct > 0 ? `+${pct}%` : `${pct}%` };
}

export function buildPeriodComparison(
  current: StatsSummary,
  previous: StatsSummary,
): StatsMetricComparison[] {
  return [
    {
      label: "readingTime",
      value: current.totalReadingTime,
      ...computeDelta(current.totalReadingTime, previous.totalReadingTime),
    },
    {
      label: "activeDays",
      value: current.activeDays,
      ...computeDelta(current.activeDays, previous.activeDays),
    },
    {
      label: "sessions",
      value: current.totalSessions,
      ...computeDelta(current.totalSessions, previous.totalSessions),
    },
    {
      label: "books",
      value: current.booksTouched,
      ...computeDelta(current.booksTouched, previous.booksTouched),
    },
    {
      label: "avgSessionTime",
      value: current.avgSessionTime,
      ...computeDelta(current.avgSessionTime, previous.avgSessionTime),
    },
  ];
}

function getPreviousPeriodFacts(
  facts: DailyReadingFact[],
  dimension: StatsDimension,
  date: Date,
): DailyReadingFact[] {
  if (dimension === "lifetime") return [];
  const prevDate = new Date(date);
  if (dimension === "day") prevDate.setDate(prevDate.getDate() - 1);
  else if (dimension === "week") prevDate.setDate(prevDate.getDate() - 7);
  else if (dimension === "month") prevDate.setMonth(prevDate.getMonth() - 1);
  else if (dimension === "year") prevDate.setFullYear(prevDate.getFullYear() - 1);

  const prevPeriod = buildPeriodRef(dimension, prevDate);
  return filterFactsByPeriod(facts, prevPeriod);
}

function createShareCard(
  dimension: StatsDimension,
  periodLabel: string,
  summary: StatsSummary,
  topBook?: TopBookEntry,
): StatsShareCardModel {
  const accentMetric = createMetricCard(
    "time",
    dimension === "lifetime" ? "Reading journey" : "Reading time",
    toDisplayTime(summary.totalReadingTime),
    `${summary.activeDays} active day${summary.activeDays === 1 ? "" : "s"}`,
  );

  const secondaryMetrics = [
    createMetricCard("sessions", "Sessions", String(summary.totalSessions)),
    createMetricCard("books", "Books", String(summary.booksTouched)),
    createMetricCard("streak", "Longest streak", `${summary.longestStreak}d`),
  ];

  return {
    dimension,
    title:
      dimension === "lifetime"
        ? "My Reading Journey"
        : `${dimension.charAt(0).toUpperCase()}${dimension.slice(1)} Reading Report`,
    periodLabel,
    accentMetric,
    secondaryMetrics,
    topBook,
    footer: dimension === "lifetime" ? "ReadAny has been reading with you." : "Made with ReadAny",
    theme: "brand",
  };
}

function buildNavigation(
  dimension: Exclude<StatsDimension, "lifetime">,
  input: Date,
  availableFacts: DailyReadingFact[],
  now: Date,
): StatsNavigation {
  const firstDate = availableFacts[0]?.date;
  if (!firstDate) {
    return { canGoPrev: false, canGoNext: false };
  }

  const earliest = fromLocalDateKey(firstDate);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const currentStart =
    dimension === "day"
      ? new Date(input.getFullYear(), input.getMonth(), input.getDate())
      : dimension === "week"
        ? getWeekStartDate(input)
        : dimension === "month"
          ? getMonthStartDate(input)
          : getYearStartDate(input);

  const prevStart = new Date(currentStart);
  const nextStart = new Date(currentStart);

  if (dimension === "day") {
    prevStart.setDate(prevStart.getDate() - 1);
    nextStart.setDate(nextStart.getDate() + 1);
  } else if (dimension === "week") {
    prevStart.setDate(prevStart.getDate() - 7);
    nextStart.setDate(nextStart.getDate() + 7);
  } else if (dimension === "month") {
    prevStart.setMonth(prevStart.getMonth() - 1);
    nextStart.setMonth(nextStart.getMonth() + 1);
  } else {
    prevStart.setFullYear(prevStart.getFullYear() - 1);
    nextStart.setFullYear(nextStart.getFullYear() + 1);
  }

  const prevPeriod = buildPeriodRef(dimension, prevStart);
  const prevEnd = fromLocalDateKey(prevPeriod.endDate);
  const canGoPrev = prevEnd >= earliest;
  const canGoNext = nextStart <= today;

  return {
    canGoPrev,
    canGoNext,
    prevKey: canGoPrev ? prevPeriod.key : undefined,
    nextKey: canGoNext ? buildPeriodRef(dimension, nextStart).key : undefined,
  };
}

function filterFactsByPeriod(
  facts: DailyReadingFact[],
  period: StatsPeriodRef,
): DailyReadingFact[] {
  return facts.filter((fact) => fact.date >= period.startDate && fact.date <= period.endDate);
}

function buildDailyTimeChart(
  facts: DailyReadingFact[],
  period: StatsPeriodRef,
  title: string,
): StatsChartBlock {
  const start = fromLocalDateKey(period.startDate);
  const end = fromLocalDateKey(period.endDate);
  const values = new Map(facts.map((fact) => [fact.date, fact.totalTime]));
  const data: StatsChartDatum[] = [];

  const cursor = new Date(start);
  while (cursor <= end) {
    const key = toLocalDateKey(cursor);
    data.push({
      key,
      label: key.slice(5),
      value: values.get(key) ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    id: `${period.dimension}-daily-time`,
    title,
    type: "bar",
    data,
  };
}

function buildMonthlyHeatmapChart(
  facts: DailyReadingFact[],
  period: StatsPeriodRef,
): StatsChartBlock {
  const start = fromLocalDateKey(period.startDate);
  const end = fromLocalDateKey(period.endDate);
  const values = new Map(facts.map((fact) => [fact.date, fact.totalTime]));
  const data: StatsChartDatum[] = [];

  const cursor = new Date(start);
  while (cursor <= end) {
    const key = toLocalDateKey(cursor);
    data.push({
      key,
      label: key.slice(5),
      value: values.get(key) ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    id: `${period.dimension}-heatmap`,
    title: "Reading intensity",
    type: "heatmap",
    data,
  };
}

function getCalendarIntensity(totalTime: number, maxTotalTime: number): 0 | 1 | 2 | 3 | 4 {
  if (totalTime <= 0 || maxTotalTime <= 0) return 0;
  const ratio = totalTime / maxTotalTime;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

function buildMonthReadingCalendar(
  facts: DailyReadingFact[],
  date: Date,
  now: Date,
): StatsCalendarBlock {
  const monthStart = getMonthStartDate(date);
  const monthEnd = getMonthEndDate(date);
  const calendarStart = getWeekStartDate(monthStart);
  const calendarEnd = getWeekEndDate(monthEnd);
  const factMap = new Map(facts.map((fact) => [fact.date, fact]));
  const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthFacts = facts.filter((fact) => fact.monthKey === monthKey);
  const maxTotalTime = Math.max(0, ...currentMonthFacts.map((fact) => fact.totalTime));
  const todayKey = toLocalDateKey(now);
  const weeks: StatsCalendarCell[][] = [];

  const cursor = new Date(calendarStart);
  while (cursor <= calendarEnd) {
    const week: StatsCalendarCell[] = [];

    for (let i = 0; i < 7; i++) {
      const key = toLocalDateKey(cursor);
      const fact = factMap.get(key);
      const covers =
        fact?.bookBreakdown
          .slice()
          .sort((a, b) => b.totalTime - a.totalTime)
          .slice(0, 3)
          .map((book) => ({
            bookId: book.bookId,
            title: book.title,
            coverUrl: book.coverUrl,
            totalTime: book.totalTime,
          })) ?? [];

      week.push({
        date: key,
        dayOfMonth: cursor.getDate(),
        inCurrentMonth:
          cursor.getMonth() === date.getMonth() && cursor.getFullYear() === date.getFullYear(),
        isToday: key === todayKey,
        totalTime: fact?.totalTime ?? 0,
        pagesRead: fact?.pagesRead ?? 0,
        charactersRead: fact?.charactersRead ?? 0,
        sessionsCount: fact?.sessionsCount ?? 0,
        intensity: getCalendarIntensity(fact?.totalTime ?? 0, maxTotalTime),
        covers,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    weeks.push(week);
  }

  return {
    id: `month-calendar-${monthKey}`,
    title: "Reading calendar",
    description: "Monthly reading calendar with top book covers on active days",
    monthKey,
    weeks,
  };
}

function buildYearlyMonthChart(facts: DailyReadingFact[], year: number): StatsChartBlock {
  const totals = Array.from({ length: 12 }, (_, index) => ({
    key: `${year}-${String(index + 1).padStart(2, "0")}`,
    label: `${index + 1}`,
    value: 0,
  }));

  for (const fact of facts) {
    const date = fromLocalDateKey(fact.date);
    if (date.getFullYear() !== year) continue;
    totals[date.getMonth()].value += fact.totalTime;
  }

  return {
    id: `year-${year}-monthly-time`,
    title: "Monthly reading time",
    type: "bar",
    data: totals,
  };
}

function buildLifetimeYearChart(facts: DailyReadingFact[]): StatsChartBlock {
  const byYear = new Map<string, number>();

  for (const fact of facts) {
    byYear.set(fact.yearKey, (byYear.get(fact.yearKey) ?? 0) + fact.totalTime);
  }

  return {
    id: "lifetime-yearly-time",
    title: "Yearly reading time",
    type: "bar",
    data: Array.from(byYear.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ key, label: key, value })),
  };
}

const TIME_OF_DAY_BUCKETS = [
  { key: "lateNight", label: "lateNight", startHour: 0, endHour: 5 },
  { key: "earlyMorning", label: "earlyMorning", startHour: 5, endHour: 8 },
  { key: "morning", label: "morning", startHour: 8, endHour: 12 },
  { key: "afternoon", label: "afternoon", startHour: 12, endHour: 17 },
  { key: "evening", label: "evening", startHour: 17, endHour: 21 },
  { key: "night", label: "night", startHour: 21, endHour: 24 },
] as const;

function buildTimeOfDayChart(
  facts: DailyReadingFact[],
  id: string,
  title: string,
): StatsChartBlock | undefined {
  if (facts.length === 0) {
    return undefined;
  }

  const data = TIME_OF_DAY_BUCKETS.map((bucket) => {
    let total = 0;
    for (const fact of facts) {
      for (let hour = bucket.startHour; hour < bucket.endHour; hour += 1) {
        total += fact.hourlyDistribution[hour] ?? 0;
      }
    }

    return {
      key: bucket.key,
      label: bucket.label,
      value: total,
    };
  });

  if (!data.some((item) => item.value > 0)) {
    return undefined;
  }

  return {
    id,
    title,
    type: "bar",
    data,
  };
}

const UNCATEGORIZED_KEY = "__uncategorized__";

function buildCategoryDistributionChart(
  facts: DailyReadingFact[],
  id: string,
  title: string,
): StatsChartBlock | undefined {
  const byCategory = new Map<string, number>();

  for (const fact of facts) {
    for (const book of fact.bookBreakdown) {
      const primaryCategory = book.tags?.[0] || book.subjects?.[0] || UNCATEGORIZED_KEY;
      byCategory.set(primaryCategory, (byCategory.get(primaryCategory) ?? 0) + book.totalTime);
    }
  }

  const data = Array.from(byCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, value]) => ({
      key,
      label: key,
      value,
    }));

  if (data.length === 0) {
    return undefined;
  }

  return {
    id,
    title,
    type: "bar",
    data,
  };
}

function buildYearSnapshots(facts: DailyReadingFact[]): StatsYearSnapshot[] {
  const byYear = new Map<string, DailyReadingFact[]>();

  for (const fact of facts) {
    const list = byYear.get(fact.yearKey) ?? [];
    list.push(fact);
    byYear.set(fact.yearKey, list);
  }

  return Array.from(byYear.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 4)
    .map(([year, yearFacts]) => {
      const summary = buildStatsSummary(yearFacts);
      const topBook = buildTopBooksFromFacts(yearFacts, 1)[0];

      return {
        year,
        totalReadingTime: summary.totalReadingTime,
        activeDays: summary.activeDays,
        booksTouched: summary.booksTouched,
        topBook,
      };
    });
}

export function buildDayReport(
  facts: DailyReadingFact[],
  date: Date,
  options: ReportBuilderOptions = {},
): DayReport {
  const period = buildPeriodRef("day", date);
  const periodFacts = filterFactsByPeriod(facts, period);
  const dayFact = periodFacts[0] ?? null;
  const summary = buildStatsSummary(periodFacts);
  const topBooks = buildTopBooksFromFacts(periodFacts, options.limitTopBooks);
  const prevFacts = getPreviousPeriodFacts(facts, "day", date);
  const prevSummary = buildStatsSummary(prevFacts);

  return {
    dimension: "day",
    period,
    navigation: buildNavigation("day", date, facts, options.now ?? new Date()),
    summary,
    insights: buildInsights(summary, topBooks),
    charts: [],
    topBooks,
    hourlyTimeline: null,
    dayFact,
    comparisonToPreviousDay: [],
    previousPeriodComparison: buildPeriodComparison(summary, prevSummary),
    shareCard: createShareCard("day", period.label, summary, topBooks[0]),
  };
}

export function buildWeekReport(
  facts: DailyReadingFact[],
  date: Date,
  options: ReportBuilderOptions = {},
): WeekReport {
  const period = buildPeriodRef("week", date);
  const periodFacts = filterFactsByPeriod(facts, period);
  const summary = buildStatsSummary(periodFacts);
  const topBooks = buildTopBooksFromFacts(periodFacts, options.limitTopBooks);
  const weekdayDistribution = buildDailyTimeChart(periodFacts, period, "Reading by day");
  const prevFacts = getPreviousPeriodFacts(facts, "week", date);
  const prevSummary = buildStatsSummary(prevFacts);

  return {
    dimension: "week",
    period,
    navigation: buildNavigation("week", date, facts, options.now ?? new Date()),
    summary,
    insights: buildInsights(summary, topBooks),
    charts: [weekdayDistribution],
    topBooks,
    dailyFacts: periodFacts,
    weekdayDistribution,
    workingDayComparison: [],
    previousPeriodComparison: buildPeriodComparison(summary, prevSummary),
    shareCard: createShareCard("week", period.label, summary, topBooks[0]),
  };
}

export function buildMonthReport(
  facts: DailyReadingFact[],
  date: Date,
  options: ReportBuilderOptions = {},
): MonthReport {
  const period = buildPeriodRef("month", date);
  const periodFacts = filterFactsByPeriod(facts, period);
  const summary = buildStatsSummary(periodFacts);
  const topBooks = buildTopBooksFromFacts(periodFacts, options.limitTopBooks);
  const heatmap = buildMonthlyHeatmapChart(periodFacts, period);
  const readingCalendar = buildMonthReadingCalendar(periodFacts, date, options.now ?? new Date());
  const prevFacts = getPreviousPeriodFacts(facts, "month", date);
  const prevSummary = buildStatsSummary(prevFacts);

  return {
    dimension: "month",
    period,
    navigation: buildNavigation("month", date, facts, options.now ?? new Date()),
    summary,
    insights: buildInsights(summary, topBooks),
    charts: [heatmap],
    topBooks,
    dailyFacts: periodFacts,
    heatmap,
    weeklyBreakdown: undefined,
    readingCalendar,
    previousPeriodComparison: buildPeriodComparison(summary, prevSummary),
    shareCard: createShareCard("month", period.label, summary, topBooks[0]),
  };
}

export function buildYearReport(
  facts: DailyReadingFact[],
  date: Date,
  options: ReportBuilderOptions = {},
): YearReport {
  const period = buildPeriodRef("year", date);
  const periodFacts = filterFactsByPeriod(facts, period);
  const summary = buildStatsSummary(periodFacts);
  const topBooks = buildTopBooksFromFacts(periodFacts, options.limitTopBooks);
  const monthlyChart = buildYearlyMonthChart(periodFacts, date.getFullYear());
  const timeOfDayChart = buildTimeOfDayChart(
    periodFacts,
    `year-${date.getFullYear()}-time-of-day`,
    "Preferred reading time",
  );
  const categoryDistribution = buildCategoryDistributionChart(
    periodFacts,
    `year-${date.getFullYear()}-category-distribution`,
    "Book distribution",
  );
  const prevFacts = getPreviousPeriodFacts(facts, "year", date);
  const prevSummary = buildStatsSummary(prevFacts);
  const strongestMonth = monthlyChart.data.reduce<StatsMetricCard | undefined>((best, current) => {
    if (!best || Number(best.sublabel ?? "0") < current.value) {
      return createMetricCard(
        "strongest-month",
        "Strongest month",
        current.label,
        String(current.value),
      );
    }
    return best;
  }, undefined);

  return {
    dimension: "year",
    period,
    navigation: buildNavigation("year", date, facts, options.now ?? new Date()),
    summary,
    insights: buildInsights(summary, topBooks),
    charts: [monthlyChart],
    topBooks,
    monthlyCharts: [monthlyChart],
    timeOfDayChart,
    categoryDistribution,
    strongestMonth: strongestMonth
      ? {
          label: strongestMonth.label,
          value: Number(strongestMonth.sublabel ?? "0"),
        }
      : undefined,
    previousPeriodComparison: buildPeriodComparison(summary, prevSummary),
    shareCard: createShareCard("year", period.label, summary, topBooks[0]),
  };
}

export function buildLifetimeReport(
  facts: DailyReadingFact[],
  options: ReportBuilderOptions = {},
): LifetimeReport {
  const sortedFacts = [...facts].sort((a, b) => a.date.localeCompare(b.date));
  const joinedSince = options.joinedSince ?? sortedFacts[0]?.date ?? toLocalDateKey(new Date());
  const period = buildLifetimePeriodRef(joinedSince);
  const summary = buildStatsSummary(sortedFacts);
  const topBooks = buildTopBooksFromFacts(sortedFacts, options.limitTopBooks);
  const yearlyChart = buildLifetimeYearChart(sortedFacts);
  const timeOfDayChart = buildTimeOfDayChart(
    sortedFacts,
    "lifetime-time-of-day",
    "Preferred reading time",
  );
  const categoryDistribution = buildCategoryDistributionChart(
    sortedFacts,
    "lifetime-category-distribution",
    "Book distribution",
  );
  const yearlySnapshots = buildYearSnapshots(sortedFacts);
  const firstReadingDate = sortedFacts[0]?.date;
  const totalActiveDays = summary.activeDays;
  const totalDays = Math.max(
    1,
    Math.round(
      (fromLocalDateKey(period.endDate).getTime() - fromLocalDateKey(period.startDate).getTime()) /
        86400000,
    ) + 1,
  );

  return {
    dimension: "lifetime",
    period,
    navigation: { canGoPrev: false, canGoNext: false },
    summary,
    insights: buildInsights(summary, topBooks),
    charts: [yearlyChart],
    topBooks,
    context: {
      joinedSince: period.startDate,
      daysSinceJoined: totalDays,
      firstReadingDate,
      totalActiveDays,
      totalInactiveDays: Math.max(0, totalDays - totalActiveDays),
      companionMessage: `ReadAny has been with you for ${totalDays} days.`,
    },
    yearlyCharts: [yearlyChart],
    yearlySnapshots,
    timeOfDayChart,
    categoryDistribution,
    milestones: [
      {
        id: "joined",
        title: "Journey started",
        body: `You began reading with ReadAny on ${period.startDate}.`,
        tone: "celebration",
      },
    ],
    shareCard: createShareCard("lifetime", period.label, summary, topBooks[0]),
  };
}
