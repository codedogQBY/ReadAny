/**
 * stats-utils.ts — Pure formatters, date helpers, and metric builders for the Stats page.
 * No React, no side-effects — only deterministic functions.
 */
import {
  type StatsCalendarCell,
  type StatsChartBlock,
  type StatsDimension,
  type StatsInsight,
  type StatsReport,
  fromLocalDateKey,
} from "@readany/core/stats";
import { cn } from "@readany/core/utils";
import type { ReactNode } from "react";
import type { StatsCopy } from "./stats-copy";

/* ─── Shared types ─── */

export type MetricTileData = {
  id: string;
  label: string;
  value: string;
  sublabel?: string;
  icon: ReactNode;
  /** Delta from previous period, e.g. "+23%" or "-5%" */
  deltaLabel?: string;
  /** Positive = up, negative = down, 0 = no change */
  delta?: number;
};

export const DIMENSIONS: StatsDimension[] = ["day", "week", "month", "year", "lifetime"];

/* ─── Time formatters ─── */

export function formatMinutes(minutes: number, isZh: boolean): string {
  if (minutes <= 0) return isZh ? "0 分钟" : "0m";
  if (minutes < 60) return isZh ? `${Math.round(minutes)} 分钟` : `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins <= 0) return isZh ? `${hours} 小时` : `${hours}h`;
  return isZh ? `${hours} 小时 ${mins} 分钟` : `${hours}h ${mins}m`;
}

export function formatCompactMinutes(minutes: number, isZh = false): string {
  if (minutes <= 0) return isZh ? "0分" : "0m";
  if (minutes < 60) return isZh ? `${Math.round(minutes)}分` : `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (isZh) {
    return mins > 0 ? `${hours}时${mins}分` : `${hours}时`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function formatChartMinutes(minutes: number, isZh: boolean): string {
  if (minutes <= 0) return isZh ? "0分" : "0m";
  if (minutes < 60) return isZh ? `${Math.round(minutes)}分` : `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return isZh
    ? mins > 0
      ? `${hours}时${mins}分`
      : `${hours}时`
    : mins > 0
      ? `${hours}h${mins}m`
      : `${hours}h`;
}

export function formatCharacterCount(value: number, isZh: boolean): string {
  const rounded = Math.max(0, Math.round(value));

  if (isZh) {
    if (rounded >= 10000) {
      const wan = rounded / 10000;
      const digits = wan >= 100 ? 0 : 1;
      return `${wan.toFixed(digits).replace(/\.0$/, "")} 万字`;
    }
    return `${rounded.toLocaleString()} 字`;
  }

  if (rounded >= 1000) {
    const thousands = rounded / 1000;
    const digits = thousands >= 100 ? 0 : 1;
    return `${thousands.toFixed(digits).replace(/\.0$/, "")}k chars`;
  }

  return `${rounded.toLocaleString()} chars`;
}

export function formatCharactersPerMinute(value: number, isZh: boolean): string {
  const rounded = Math.max(0, Math.round(value));
  return isZh ? `${rounded.toLocaleString()} 字/分` : `${rounded.toLocaleString()} chars/min`;
}

export function formatClock(timestamp: number | undefined, isZh: boolean): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(isZh ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: !isZh,
  }).format(new Date(timestamp));
}

export function formatDateLabel(dateKey: string | undefined, isZh: boolean): string {
  if (!dateKey) return "—";
  const date = fromLocalDateKey(dateKey);
  return new Intl.DateTimeFormat(isZh ? "zh-CN" : "en-US", {
    year: "numeric",
    month: isZh ? "long" : "short",
    day: "numeric",
  }).format(date);
}

/* ─── Period formatting ─── */

export function formatPeriodLabel(report: StatsReport, isZh: boolean, copy: StatsCopy): string {
  if (report.dimension === "day") {
    return formatDateLabel(report.period.startDate, isZh);
  }

  if (report.dimension === "week") {
    const start = formatDateLabel(report.period.startDate, isZh);
    const end = formatDateLabel(report.period.endDate, isZh);
    const weekKey = report.period.key.split("W")[1] ?? "";
    return isZh
      ? `${start} – ${end} · ${copy.weekPrefix}${weekKey}${copy.weekSuffix}`
      : `${copy.weekPrefix}${weekKey}${copy.weekSuffix} · ${start} – ${end}`;
  }

  if (report.dimension === "month") {
    const date = fromLocalDateKey(report.period.startDate);
    return new Intl.DateTimeFormat(isZh ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "long",
    }).format(date);
  }

  if (report.dimension === "year") {
    return report.period.key;
  }

  return `${copy.companionMessage} ${(report.context.daysSinceJoined || 0).toLocaleString()} ${copy.daysSuffix}`;
}

/* ─── Date input helpers ─── */

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toMonthInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function shiftAnchorDate(date: Date, dimension: StatsDimension, delta: -1 | 1): Date {
  const next = new Date(date);
  if (dimension === "day") {
    next.setDate(next.getDate() + delta);
    return next;
  }
  if (dimension === "week") {
    next.setDate(next.getDate() + delta * 7);
    return next;
  }
  if (dimension === "month") {
    next.setMonth(next.getMonth() + delta);
    return next;
  }
  if (dimension === "year") {
    next.setFullYear(next.getFullYear() + delta);
  }
  return next;
}

/* ─── Calendar intensity ─── */

export function intensityClass(
  level: StatsCalendarCell["intensity"],
  inCurrentMonth: boolean,
): string {
  if (!inCurrentMonth && level === 0) {
    return "border-transparent bg-muted/15 text-muted-foreground/30";
  }

  const palette = [
    "border-border/30 bg-card text-foreground",
    "border-primary/8 bg-primary/[0.04] text-foreground",
    "border-primary/12 bg-primary/[0.08] text-foreground",
    "border-primary/18 bg-primary/[0.14] text-foreground",
    "border-primary/25 bg-primary/[0.22] text-foreground",
  ] as const;

  return cn(palette[level], !inCurrentMonth && "opacity-55");
}

/* ─── Chart peak finder ─── */

export function getPeakChartDatum(chart: StatsChartBlock): StatsChartBlock["data"][number] | null {
  if (chart.data.length === 0) return null;
  const strongest = [...chart.data].sort((a, b) => b.value - a.value)[0];
  return strongest && strongest.value > 0 ? strongest : null;
}

/* ─── Semantic label localizer ─── */

export function localizeSemanticLabel(key: string, fallback: string, copy: StatsCopy): string {
  if (key === "__uncategorized__") {
    return copy.uncategorized;
  }
  if (key in copy.timeOfDayLabels) {
    return copy.timeOfDayLabels[key as keyof typeof copy.timeOfDayLabels];
  }
  return fallback;
}

/* ─── Hero narrative ─── */

export function buildHeroNarrative(report: StatsReport, copy: StatsCopy, isZh: boolean): string {
  if (report.dimension === "day") {
    return copy.heroNarrativeDay(
      formatMinutes(report.summary.totalReadingTime, isZh),
      report.summary.totalSessions,
    );
  }
  if (report.dimension === "week") {
    return copy.heroNarrativeWeek(
      report.summary.activeDays,
      formatMinutes(report.summary.longestSessionTime, isZh),
    );
  }
  if (report.dimension === "month") {
    return copy.heroNarrativeMonth(
      formatMinutes(report.summary.totalReadingTime, isZh),
      report.summary.booksTouched,
    );
  }
  if (report.dimension === "year") {
    return copy.heroNarrativeYear(
      formatMinutes(report.summary.totalReadingTime, isZh),
      report.summary.activeDays,
    );
  }
  return copy.heroNarrativeLifetime(formatDateLabel(report.context.joinedSince, isZh));
}

/* ─── Insight localizer ─── */

export function localizeInsight(
  insight: StatsInsight,
  report: StatsReport,
  copy: StatsCopy,
  isZh: boolean,
): StatsInsight {
  if (insight.id === "no-reading") {
    return { ...insight, title: copy.insightTitleNoReading, body: copy.insightBodyNoReading };
  }
  if (insight.id === "streak") {
    return {
      ...insight,
      title: copy.insightTitleStreak,
      body: copy.insightBodyStreak(report.summary.currentStreak),
    };
  }
  if (insight.id === "focus") {
    return {
      ...insight,
      title: copy.insightTitleFocus,
      body: copy.insightBodyFocus(Math.round(report.summary.longestSessionTime)),
    };
  }
  if (insight.id === "top-book") {
    return {
      ...insight,
      title: copy.insightTitleTopBook,
      body: copy.insightBodyTopBook(report.topBooks[0]?.title ?? copy.noDayTopBook),
    };
  }
  if (insight.id === "joined" && report.dimension === "lifetime") {
    return {
      ...insight,
      title: copy.milestoneTitleJoined,
      body: copy.milestoneBodyJoined(formatDateLabel(report.context.joinedSince, isZh)),
    };
  }
  return insight;
}
