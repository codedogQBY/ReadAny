import type { StatsMetricCard, StatsReport, StatsSectionBlock, StatsViewModel } from "./schema";

function toDisplayTime(minutes: number): string {
  if (minutes >= 60) {
    const hours = minutes / 60;
    return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
  }
  return `${Math.round(minutes)}m`;
}

function buildHeroMetrics(report: StatsReport): StatsMetricCard[] {
  const metrics: StatsMetricCard[] = [
    {
      id: "reading-time",
      label: report.dimension === "lifetime" ? "Reading journey" : "Reading time",
      value: toDisplayTime(report.summary.totalReadingTime),
      sublabel: `${report.summary.activeDays} active day${report.summary.activeDays === 1 ? "" : "s"}`,
    },
    {
      id: "sessions",
      label: "Sessions",
      value: String(report.summary.totalSessions),
    },
    {
      id: "books",
      label: "Books",
      value: String(report.summary.booksTouched),
    },
    {
      id: "streak",
      label: report.dimension === "lifetime" ? "Longest streak" : "Current streak",
      value:
        report.dimension === "lifetime"
          ? `${report.summary.longestStreak}d`
          : `${report.summary.currentStreak}d`,
    },
  ];

  if (report.topBooks[0]) {
    metrics.push({
      id: "top-book",
      label: "Top book",
      value: report.topBooks[0].title,
      sublabel: toDisplayTime(report.topBooks[0].totalTime),
    });
  }

  if (report.dimension === "lifetime") {
    metrics.unshift({
      id: "journey-days",
      label: "Days together",
      value: `${report.context.daysSinceJoined}d`,
      sublabel: `Since ${report.context.joinedSince}`,
    });
  }

  return metrics;
}

function buildSections(report: StatsReport): StatsSectionBlock[] {
  const sections: StatsSectionBlock[] = [];

  if (report.dimension === "month" && report.readingCalendar) {
    sections.push({
      id: "reading-calendar",
      title: "Reading calendar",
      description: "See each day's reading activity with book covers on active dates",
      layout: "grid",
    });
  }

  if (report.charts.length > 0) {
    sections.push({
      id: "charts",
      title: "Charts",
      description: "Reading activity and distribution",
      layout: "chart",
    });
  }

  if (report.topBooks.length > 0) {
    sections.push({
      id: "top-books",
      title: "Top books",
      description: "Books that received the most reading time",
      layout: "list",
    });
  }

  if (report.insights.length > 0) {
    sections.push({
      id: "insights",
      title: "Insights",
      description: "Highlights and behavioral patterns from this period",
      layout: "list",
    });
  }

  if (report.dimension === "lifetime") {
    sections.push({
      id: "milestones",
      title: "Milestones",
      description: "Journey and long-term progress",
      layout: "timeline",
    });
  }

  return sections;
}

function getHeaderTitle(report: StatsReport): string {
  switch (report.dimension) {
    case "day":
      return "Daily Reading Report";
    case "week":
      return "Weekly Reading Report";
    case "month":
      return "Monthly Reading Report";
    case "year":
      return "Yearly Reading Report";
    case "lifetime":
      return "Lifetime Reading Report";
  }
}

function getHeaderSubtitle(report: StatsReport): string | undefined {
  if (report.dimension === "lifetime") {
    return report.context.companionMessage;
  }

  if (report.summary.totalReadingTime <= 0) {
    return "No reading activity recorded in this period yet.";
  }

  return `You read for ${toDisplayTime(report.summary.totalReadingTime)} in this period.`;
}

export function buildStatsViewModel(report: StatsReport): StatsViewModel {
  return {
    header: {
      title: getHeaderTitle(report),
      subtitle: getHeaderSubtitle(report),
      periodLabel: report.period.label,
    },
    heroMetrics: buildHeroMetrics(report),
    sections: buildSections(report),
    shareCard: report.shareCard,
  };
}
