/**
 * LifetimeSections.tsx — Rhythm profile, category distribution,
 * yearly snapshots, and journey summary panels.
 */
import type { StatsChartBlock, StatsReport } from "@readany/core/stats";
import { cn } from "@readany/core/utils";
import { BarChart } from "./BarChart";
import { BookCover } from "./TopBooksSection";
import type { StatsCopy } from "./stats-copy";
import {
  formatChartMinutes,
  formatCompactMinutes,
  formatDateLabel,
  localizeSemanticLabel,
} from "./stats-utils";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Rhythm Profile (Year / Lifetime)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function RhythmProfileSection({
  timeOfDayChart,
  categoryChart,
  copy,
  isZh,
}: {
  timeOfDayChart?: StatsChartBlock;
  categoryChart?: StatsChartBlock;
  copy: StatsCopy;
  isZh: boolean;
}) {
  const hasTwo = Boolean(timeOfDayChart) && Boolean(categoryChart);

  return (
    <div className={cn("grid gap-8", hasTwo && "xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]")}>
      {timeOfDayChart && (
        <div className={cn("space-y-5", hasTwo && "xl:border-r xl:border-border/20 xl:pr-8")}>
          <div className="space-y-1">
            <h3 className="text-[14px] font-semibold text-foreground/85">{copy.timeOfDay}</h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground/62">
              {copy.timeOfDayDesc}
            </p>
          </div>
          <BarChart
            data={timeOfDayChart.data.map((item) => ({
              label: localizeSemanticLabel(item.key, item.label, copy),
              value: item.value,
            }))}
            height={220}
            emptyMessage={copy.noDataDesc}
            formatValue={(value) => formatChartMinutes(value, isZh)}
          />
        </div>
      )}

      {categoryChart && (
        <div className="space-y-5">
          <div className="space-y-1">
            <h3 className="text-[14px] font-semibold text-foreground/85">
              {copy.categoryDistribution}
            </h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground/62">
              {copy.categoryDistributionDesc}
            </p>
          </div>
          <CategoryDistributionList chart={categoryChart} copy={copy} isZh={isZh} />
        </div>
      )}
    </div>
  );
}

function CategoryDistributionList({
  chart,
  copy,
  isZh,
}: {
  chart: StatsChartBlock;
  copy: StatsCopy;
  isZh: boolean;
}) {
  const maxValue = Math.max(...chart.data.map((item) => item.value), 1);

  return (
    <div className="space-y-4">
      {chart.data.map((item, index) => {
        const label = localizeSemanticLabel(item.key, item.label, copy);
        const pct = Math.max(10, (item.value / maxValue) * 100);

        return (
          <div key={`${item.key}-${index}`} className="group space-y-1.5">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 text-[13px] font-medium text-foreground/75 transition-colors group-hover:text-foreground">
                {label}
              </div>
              <div className="flex-shrink-0 text-[13px] tabular-nums text-muted-foreground/65">
                {formatCompactMinutes(item.value, isZh)}
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted/25">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary/25 to-primary/55 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Yearly Snapshots (Lifetime) — flat rows, no nested cards
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function YearlySnapshotsSection({
  snapshots,
  copy,
  isZh,
}: {
  snapshots: Extract<StatsReport, { dimension: "lifetime" }>["yearlySnapshots"];
  copy: StatsCopy;
  isZh: boolean;
}) {
  return (
    <div className="divide-y divide-border/20">
      {snapshots.map((snapshot) => (
        <div key={snapshot.year} className="flex items-center gap-5 py-4 first:pt-0 last:pb-0">
          {/* Year label */}
          <div className="w-12 shrink-0 text-[13px] font-bold tabular-nums text-foreground/70">
            {snapshot.year}
          </div>

          {/* Top book cover — library style */}
          {snapshot.topBook ? (
            <div className="book-cover-shadow relative w-10 shrink-0 overflow-hidden rounded">
              <div className="aspect-[28/41] w-full">
                <BookCover title={snapshot.topBook.title} coverUrl={snapshot.topBook.coverUrl} />
              </div>
              <div className="book-spine absolute inset-0 rounded" />
            </div>
          ) : (
            <div className="w-10 shrink-0" />
          )}

          {/* Stats */}
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold tabular-nums tracking-tight text-foreground/85">
              {formatCompactMinutes(snapshot.totalReadingTime, isZh)}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-muted-foreground/62">
              <span>
                {snapshot.booksTouched.toLocaleString()} {copy.books}
              </span>
              <span>
                {snapshot.activeDays.toLocaleString()} {copy.activeDays}
              </span>
              {snapshot.topBook && (
                <span className="truncate text-foreground/68">{snapshot.topBook.title}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Journey Summary (Lifetime) — flat layout, no inner cards
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function JourneySummaryPanel({
  report,
  copy,
  isZh,
}: {
  report: Extract<StatsReport, { dimension: "lifetime" }>;
  copy: StatsCopy;
  isZh: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* Hero number + narrative */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="text-[42px] font-bold tabular-nums leading-none tracking-tighter text-foreground/85">
            {report.context.daysSinceJoined.toLocaleString()}{" "}
            <span className="text-[24px] font-semibold tracking-normal text-muted-foreground/65">
              {copy.daysSuffix}
            </span>
          </div>
          <p className="max-w-lg text-[13px] leading-relaxed text-muted-foreground/62">
            {copy.journeyNarrative(report.context.daysSinceJoined)}
          </p>
        </div>
        <div className="shrink-0 text-[12px] text-muted-foreground/56">
          {copy.startedOn} {formatDateLabel(report.context.joinedSince, isZh)}
        </div>
      </div>

      {/* Metric row — simple divider-separated inline stats */}
      <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border/20 pt-5">
        {[
          {
            label: copy.activeReadingDays,
            value: `${report.context.totalActiveDays.toLocaleString()} ${copy.daysSuffix}`,
          },
          {
            label: copy.inactiveReadingDays,
            value: `${report.context.totalInactiveDays.toLocaleString()} ${copy.daysSuffix}`,
          },
        ].map((item) => (
          <div key={item.label}>
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/52">
              {item.label}
            </div>
            <div className="mt-1 text-[16px] font-bold tabular-nums text-foreground/80">
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
