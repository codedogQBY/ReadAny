/**
 * stats-utils.ts — Pure formatters, date helpers, and narrative builders for mobile stats.
 * No React, no side-effects — only deterministic functions.
 */
import {
  type StatsChartBlock,
  type StatsInsight,
  type StatsReport,
  fromLocalDateKey,
} from "@readany/core/stats";

/* ─── Time formatters ─── */

export function formatTime(minutes: number): string {
  if (minutes <= 0) return "0m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export function formatTimeLocalized(minutes: number, isZh: boolean): string {
  if (minutes <= 0) return isZh ? "0分" : "0m";
  if (minutes < 60) return isZh ? `${Math.round(minutes)}分` : `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (isZh) return m > 0 ? `${h}时${m}分` : `${h}时`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatCompactMinutes(minutes: number, isZh: boolean): string {
  if (minutes <= 0) return isZh ? "0分" : "0m";
  if (minutes < 60) return isZh ? `${Math.round(minutes)}分` : `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (isZh) return m > 0 ? `${h}时${m}分` : `${h}时`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
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

export function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number.parseInt(m)}/${Number.parseInt(d)}`;
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

/* ─── Date helpers ─── */

export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getWeekEnd(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

/* ─── Chart peak finder ─── */

export function getPeakChartDatum(chart: StatsChartBlock): StatsChartBlock["data"][number] | null {
  if (chart.data.length === 0) return null;
  const strongest = [...chart.data].sort((a, b) => b.value - a.value)[0];
  return strongest && strongest.value > 0 ? strongest : null;
}

/* ─── Semantic label localizer ─── */

export function localizeSemanticLabel(
  key: string,
  fallback: string,
  timeOfDayLabels: Record<string, string>,
  uncategorized: string,
): string {
  if (key === "__uncategorized__") return uncategorized;
  if (key in timeOfDayLabels) return timeOfDayLabels[key];
  return fallback;
}

/* ─── Hero narrative builder ─── */

export function buildHeroNarrative(
  report: StatsReport,
  t: (key: string, opts?: Record<string, unknown>) => string,
  isZh: boolean,
): string {
  if (report.dimension === "day") {
    return t("stats.desktop.heroNarrativeDay", {
      time: formatTimeLocalized(report.summary.totalReadingTime, isZh),
      sessions: report.summary.totalSessions,
    });
  }
  if (report.dimension === "week") {
    return t("stats.desktop.heroNarrativeWeek", {
      days: report.summary.activeDays,
      longest: formatTimeLocalized(report.summary.longestSessionTime, isZh),
    });
  }
  if (report.dimension === "month") {
    return t("stats.desktop.heroNarrativeMonth", {
      time: formatTimeLocalized(report.summary.totalReadingTime, isZh),
      books: report.summary.booksTouched,
    });
  }
  if (report.dimension === "year") {
    return t("stats.desktop.heroNarrativeYear", {
      time: formatTimeLocalized(report.summary.totalReadingTime, isZh),
      activeDays: report.summary.activeDays,
    });
  }
  return t("stats.desktop.heroNarrativeLifetime", {
    date: formatDateLabel(report.context.joinedSince, isZh),
  });
}

/* ─── Insight localizer (full version matching desktop) ─── */

export function localizeInsight(
  insight: StatsInsight,
  report: StatsReport,
  t: (key: string, opts?: Record<string, unknown>) => string,
  isZh: boolean,
): StatsInsight {
  if (insight.id === "no-reading") {
    return {
      ...insight,
      title: t("stats.desktop.insightTitleNoReading"),
      body: t("stats.desktop.insightBodyNoReading"),
    };
  }
  if (insight.id === "streak") {
    return {
      ...insight,
      title: t("stats.desktop.insightTitleStreak"),
      body: t("stats.desktop.insightBodyStreak", { days: report.summary.currentStreak }),
    };
  }
  if (insight.id === "focus") {
    return {
      ...insight,
      title: t("stats.desktop.insightTitleFocus"),
      body: t("stats.desktop.insightBodyFocus", {
        minutes: Math.round(report.summary.longestSessionTime),
      }),
    };
  }
  if (insight.id === "top-book") {
    return {
      ...insight,
      title: t("stats.desktop.insightTitleTopBook"),
      body: t("stats.desktop.insightBodyTopBook", { title: report.topBooks[0]?.title ?? "—" }),
    };
  }
  if (insight.id === "joined" && report.dimension === "lifetime") {
    return {
      ...insight,
      title: t("stats.desktop.milestoneTitleJoined"),
      body: t("stats.desktop.milestoneBodyJoined", {
        date: formatDateLabel(report.context.joinedSince, isZh),
      }),
    };
  }
  return insight;
}
