/**
 * StatsSections.tsx — Core content section components for the Stats page.
 *
 * Each section is a self-contained visual block. They receive pre-computed data
 * from the parent orchestrator — no business logic or data fetching here.
 *
 * Larger sections have been extracted into their own files; this module
 * re-exports them so that existing imports from ReadingStatsPanel.tsx
 * continue to work unchanged.
 */
import type {
  DailyReadingFact,
  StatsChartBlock,
  StatsInsight,
  TopBookEntry,
} from "@readany/core/stats";
import { cn } from "@readany/core/utils";
import { Clock3, TrendingUp } from "lucide-react";
import { BarChart } from "./BarChart";
import { HeatmapChart } from "./HeatmapChart";
import { EmptyState } from "./StatsShared";
import type { StatsCopy } from "./stats-copy";
import { formatChartMinutes, formatClock, formatMinutes, getPeakChartDatum } from "./stats-utils";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Chart Surface
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function ChartSurface({
  chart,
  copy,
  isZh,
}: {
  chart: StatsChartBlock;
  copy: StatsCopy;
  isZh: boolean;
}) {
  if (chart.type === "heatmap") {
    return (
      <div className="space-y-5">
        <HeatmapChart
          data={chart.data}
          emptyMessage={copy.noDataDesc}
          isZh={isZh}
          lowLabel={copy.heatmapLegendLow}
          highLabel={copy.heatmapLegendHigh}
          activeDaysLabel={copy.activeDaysSummary}
        />
      </div>
    );
  }

  /* Single data point — show as big number instead of a one-bar chart */
  if (chart.data.length <= 1) {
    const point = chart.data[0];
    if (!point) {
      return (
        <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground/55">
          {copy.noDataDesc}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/55">
            {copy.singlePointLabel}
          </div>
          <div className="text-4xl font-bold tabular-nums tracking-tighter text-foreground">
            {formatMinutes(point.value, isZh)}
          </div>
          <div className="text-[13px] text-muted-foreground/65">{point.label}</div>
        </div>
        <p className="max-w-lg text-[13px] leading-relaxed text-muted-foreground/60">
          {copy.singlePointDesc}
        </p>
      </div>
    );
  }

  /* Standard bar chart */
  const peak = getPeakChartDatum(chart);
  return (
    <div className="space-y-5">
      <div className="-mx-1 overflow-hidden rounded-xl bg-gradient-to-b from-primary/[0.03] to-transparent px-1 pt-2 pb-1">
        <BarChart
          data={chart.data.map((item) => ({ label: item.label, value: item.value }))}
          height={240}
          emptyMessage={copy.noDataDesc}
          formatValue={(value) => formatChartMinutes(value, isZh)}
        />
      </div>
      {peak && <PeakBadge copy={copy} peak={peak} isZh={isZh} />}
    </div>
  );
}

function PeakBadge({
  copy,
  peak,
  isZh,
}: {
  copy: StatsCopy;
  peak: StatsChartBlock["data"][number];
  isZh: boolean;
}) {
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-lg bg-primary/[0.05] px-3 py-1.5 text-[13px] font-medium text-foreground/75">
      <TrendingUp className="h-3.5 w-3.5 text-primary/40" />
      {copy.chartPeakLabel(peak.label, formatMinutes(peak.value, isZh))}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Day Summary
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function DaySummaryPanel({
  dayFact,
  topBook,
  copy,
  isZh,
}: {
  dayFact: DailyReadingFact | null;
  topBook?: TopBookEntry;
  copy: StatsCopy;
  isZh: boolean;
}) {
  if (!dayFact) {
    return (
      <EmptyState
        title={copy.noDataTitle}
        description={copy.noDataDesc}
        icon={<Clock3 className="h-7 w-7 text-muted-foreground/60" />}
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
    { label: copy.longestRead, value: formatMinutes(dayFact.longestSessionTime, isZh) },
  ];

  const [firstSession, lastSession, peakHour, longestRead] = facts;
  const topBookDuration = topBook ? formatMinutes(topBook.totalTime, isZh) : copy.noTimeline;

  return (
    <div className="space-y-5">
      <div className="rounded-[22px] border border-border/18 bg-gradient-to-b from-primary/[0.03] via-transparent to-transparent px-5 py-5">
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="grid gap-4 sm:grid-cols-2">
            {[firstSession, lastSession].map((item, index) => (
              <div
                key={item.label}
                className={cn(
                  "space-y-2 border-border/16 pb-4",
                  index === 0 ? "sm:border-r sm:pr-5" : "sm:pl-1",
                )}
              >
                <div className="text-[12px] font-medium text-muted-foreground/56">{item.label}</div>
                <div className="text-[32px] font-bold tabular-nums tracking-[-0.04em] text-foreground/90">
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 border-t border-border/14 pt-4 sm:grid-cols-2 lg:border-t-0 lg:border-l lg:pl-5 lg:pt-0">
            {[peakHour, longestRead].map((item) => (
              <div key={item.label} className="space-y-1.5">
                <div className="text-[12px] font-medium text-muted-foreground/56">{item.label}</div>
                <div className="text-[32px] font-bold tabular-nums tracking-[-0.04em] text-foreground/90">
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3 border-t border-border/16 pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div className="min-w-0 space-y-1.5">
            <div className="text-[12px] font-medium text-muted-foreground/54">{copy.topFocus}</div>
            <div className="line-clamp-2 text-[22px] font-semibold leading-snug tracking-[-0.03em] text-foreground/88">
              {topBook?.title ?? copy.noDayTopBook}
            </div>
          </div>

          <div className="flex items-center self-start md:pl-4">
            <div className="text-[18px] font-semibold text-primary/72">{topBookDuration}</div>
          </div>
        </div>
      </div>
    </div>
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
  if (insights.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted-foreground/62">{copy.noInsights}</p>
    );
  }

  return (
    <div className="space-y-2.5">
      {insights.map((insight) => (
        <div
          key={insight.id}
          className="group rounded-xl border border-border/20 px-4 py-3.5 transition-colors hover:border-border/40"
        >
          <div className="flex items-start gap-3">
            <div className="mt-1.5 flex-shrink-0">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  insight.tone === "celebration" && "bg-primary/60",
                  insight.tone === "warning" && "bg-destructive/45",
                  insight.tone === "positive" && "bg-primary/45",
                  (!insight.tone ||
                    !["celebration", "warning", "positive"].includes(insight.tone)) &&
                    "bg-border/60",
                )}
              />
            </div>
            <div className="min-w-0 space-y-0.5">
              <div className="text-[13px] font-semibold text-foreground/75">{insight.title}</div>
              <div className="text-[13px] leading-relaxed text-muted-foreground/62">
                {insight.body}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
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
export { GoalsSection } from "./GoalsSection";
