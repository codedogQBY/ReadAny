import { ClockIcon } from "@/components/ui/Icon";
/**
 * StatsSections.tsx — Section components for the mobile Stats screen.
 * Each section is a self-contained visual block with no business logic.
 *
 * Feature-parity with desktop StatsSections.tsx:
 *  - ChartSurface (heatmap / bar)
 *  - DaySummaryPanel (day dimension)
 *  - TopBooksSection (expand/collapse)       → TopBooksSection.tsx
 *  - InsightsSection
 *  - MonthCalendarSection (month dimension)  → CalendarSection.tsx
 *  - RhythmProfileSection (year/lifetime)    → LifetimeSections.tsx
 *  - YearlySnapshotsSection (lifetime)       → LifetimeSections.tsx
 *  - JourneySummaryPanel (lifetime)          → LifetimeSections.tsx
 *  - SectionCard, MetricTile, EmptyState
 *  - StatsBookCover                          → StatsBookCover.tsx
 */
import { useColors, withOpacity } from "@/styles/theme";
import type {
  DailyReadingFact,
  StatsChartBlock,
  StatsInsight,
  TopBookEntry,
} from "@readany/core/stats";
import { Text, View, type ViewStyle } from "react-native";
import { BarChart } from "./BarChart";
import { MonthHeatmap } from "./MonthHeatmap";
import { makeStyles } from "./stats-styles";
import { formatClock, formatTimeLocalized } from "./stats-utils";

/* ─── Types ─── */

export type StatsCopy = {
  heatmapLegendLow: string;
  heatmapLegendHigh: string;
  activeDaysSummary: (count: number) => string;
  noDataDesc: string;
  noDataTitle: string;
  chartPeakLabel: (label: string, value: string) => string;
  singlePointLabel: string;
  singlePointDesc: string;
  topBookLead: string;
  topBooksCollapse: string;
  topBooksExpandCount: (count: number) => string;
  noTopBooks: string;
  unknownAuthor: string;
  pagesReadSuffix: string;
  charactersReadSuffix: string;
  charactersPerMinuteSuffix: string;
  sessionsSuffix: string;
  noInsights: string;
  // Day summary
  firstSession: string;
  lastSession: string;
  peakHour: string;
  longestRead: string;
  topFocus: string;
  noDayTopBook: string;
  noTimeline: string;
  activeNow: string;
  // Calendar
  readingCalendar: string;
  readingCalendarDesc: string;
  // Rhythm profile
  timeOfDay: string;
  timeOfDayDesc: string;
  categoryDistribution: string;
  categoryDistributionDesc: string;
  uncategorized: string;
  timeOfDayLabels: Record<string, string>;
  // Yearly snapshots
  books: string;
  activeDays: string;
  // Journey
  daysSuffix: string;
  startedOn: string;
  activeReadingDays: string;
  inactiveReadingDays: string;
  journeyNarrative: (days: number) => string;
  // Milestones
  milestones: string;
  milestonesDesc: string;
  // Day summary
  daySummary: string;
  daySummaryDesc: string;
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Chart Surface
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function ChartSurface({
  chart,
  isZh,
  copy,
}: {
  chart: StatsChartBlock;
  isZh: boolean;
  copy: StatsCopy;
}) {
  const colors = useColors();
  const s = makeStyles(colors);

  if (chart.type === "heatmap") {
    return <MonthHeatmap chart={chart} isZh={isZh} copy={copy} />;
  }

  if (chart.data.length <= 1) {
    const point = chart.data[0];
    if (!point) {
      return (
        <View style={s.barChartEmpty}>
          <Text style={s.barChartEmptyText}>{copy.noDataDesc}</Text>
        </View>
      );
    }
    return (
      <View style={s.singlePointCard}>
        <Text style={s.singlePointEyebrow}>{copy.singlePointLabel}</Text>
        <Text style={s.singlePointValue}>{formatTimeLocalized(point.value, isZh)}</Text>
        <Text style={s.singlePointLabel}>{point.label}</Text>
        <Text style={s.singlePointDesc}>{copy.singlePointDesc}</Text>
      </View>
    );
  }

  const barData = chart.data.map((item) => ({ label: item.label, value: item.value }));
  return <BarChart data={barData} />;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Day Summary
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function DaySummaryPanel({
  dayFact,
  topBook,
  isZh,
  copy,
}: {
  dayFact: DailyReadingFact | null;
  topBook?: TopBookEntry;
  isZh: boolean;
  copy: StatsCopy;
}) {
  const colors = useColors();
  const s = makeStyles(colors);

  if (!dayFact) {
    return (
      <EmptyState
        title={copy.noDataTitle}
        description={copy.noDataDesc}
        icon={<ClockIcon size={24} color={withOpacity(colors.mutedForeground, 0.45)} />}
      />
    );
  }

  const facts = [
    { label: copy.firstSession, value: formatClock(dayFact.firstSessionAt, isZh) },
    { label: copy.lastSession, value: formatClock(dayFact.lastSessionAt, isZh) },
    {
      label: copy.peakHour,
      value:
        dayFact.peakHour !== undefined ? `${String(dayFact.peakHour).padStart(2, "0")}:00` : "—",
    },
    { label: copy.longestRead, value: formatTimeLocalized(dayFact.longestSessionTime, isZh) },
  ];

  const [firstSession, lastSession, peakHour, longestRead] = facts;
  const topBookDuration = topBook ? formatTimeLocalized(topBook.totalTime, isZh) : copy.noTimeline;

  return (
    <View style={s.daySummaryPanel}>
      <View style={s.daySummaryHeroRow}>
        {[firstSession, lastSession].map((item, index) => (
          <View
            key={item.label}
            style={[s.daySummaryHeroBlock, index === 0 && s.daySummaryHeroBlockDivider]}
          >
            <Text style={s.daySummaryHeroLabel}>{item.label}</Text>
            <Text style={s.daySummaryHeroValue}>{item.value}</Text>
          </View>
        ))}
      </View>

      <View style={s.daySummaryMetaRow}>
        {[peakHour, longestRead].map((item) => (
          <View key={item.label} style={s.daySummaryMetaBlock}>
            <Text style={s.daySummaryMetaLabel}>{item.label}</Text>
            <Text style={s.daySummaryMetaValue}>{item.value}</Text>
          </View>
        ))}
      </View>

      <View style={s.daySummaryBookRow}>
        <View style={s.daySummaryBookText}>
          <Text style={s.daySummaryBookLabel}>{copy.topFocus}</Text>
          <Text style={s.daySummaryBookTitle} numberOfLines={2}>
            {topBook?.title ?? copy.noDayTopBook}
          </Text>
        </View>
        <Text style={s.daySummaryBookValue}>{topBookDuration}</Text>
      </View>
    </View>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Insights
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function InsightsSection({
  insights,
  copy,
}: {
  insights: StatsInsight[];
  copy: StatsCopy;
}) {
  const colors = useColors();
  const s = makeStyles(colors);

  if (insights.length === 0) {
    return (
      <Text
        style={{
          fontSize: 13,
          color: withOpacity(colors.mutedForeground, 0.45),
          textAlign: "center",
          paddingVertical: 16,
        }}
      >
        {copy.noInsights}
      </Text>
    );
  }

  return (
    <View>
      {insights.map((insight) => {
        const dotStyle =
          insight.tone === "celebration"
            ? s.insightDotCelebration
            : insight.tone === "warning"
              ? s.insightDotWarning
              : insight.tone === "positive"
                ? s.insightDotPositive
                : s.insightDotDefault;

        return (
          <View key={insight.id} style={s.insightItem}>
            <View style={[s.insightDot, dotStyle]} />
            <View style={{ flex: 1 }}>
              <Text style={s.insightTitle}>{insight.title}</Text>
              <Text style={s.insightBody}>{insight.body}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Section card wrapper
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function SectionCard({
  title,
  featured,
  action,
  style,
  children,
}: {
  title?: string;
  description?: string;
  featured?: boolean;
  action?: React.ReactNode;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const s = makeStyles(colors);

  return (
    <View style={[s.sectionCard, featured && s.sectionFeatured, style]}>
      {title || action ? (
        <View
          style={[
            s.sectionHeader,
            action
              ? { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }
              : undefined,
          ]}
        >
          <View style={{ flex: 1 }}>
            {title ? <Text style={s.sectionTitle}>{title}</Text> : null}
          </View>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Metric tile
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function MetricTile({
  label,
  value,
  sublabel,
  delta,
  deltaLabel,
  style,
}: {
  label: string;
  value: string;
  sublabel?: string;
  delta?: number;
  deltaLabel?: string;
  style?: ViewStyle;
}) {
  const colors = useColors();
  const s = makeStyles(colors);

  return (
    <View style={[s.metricTile, style]}>
      <Text style={s.metricLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
        <Text style={s.metricValue} numberOfLines={1}>
          {value}
        </Text>
        {deltaLabel && delta !== undefined && delta !== 0 && (
          <Text
            style={{
              fontSize: 9,
              fontWeight: "700",
              color: delta > 0 ? "rgba(16,185,129,0.7)" : "rgba(239,68,68,0.7)",
            }}
          >
            {delta > 0 ? "↑" : "↓"}
            {deltaLabel}
          </Text>
        )}
      </View>
      {sublabel && (
        <Text style={s.metricSub} numberOfLines={1}>
          {sublabel}
        </Text>
      )}
    </View>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Empty state
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  const colors = useColors();
  const s = makeStyles(colors);

  return (
    <View style={s.emptyWrap}>
      <View style={s.emptyIcon}>{icon}</View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyDesc}>{description}</Text>
    </View>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Re-exports from extracted files
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export { TopBooksSection } from "./TopBooksSection";
export { MonthCalendarSection } from "./CalendarSection";
export {
  RhythmProfileSection,
  YearlySnapshotsSection,
  JourneySummaryPanel,
} from "./LifetimeSections";
export { StatsBookCover } from "./StatsBookCover";
