/**
 * LifetimeSections.tsx — Rhythm profile, category distribution, yearly snapshots, journey summary.
 * Extracted from StatsSections.tsx.
 */
import { useColors } from "@/styles/theme";
import type { StatsChartBlock, StatsReport } from "@readany/core/stats";
import { Text, View } from "react-native";
import { BarChart } from "./BarChart";
import { StatsBookCover } from "./StatsBookCover";
import type { StatsCopy } from "./StatsSections";
import { makeStyles } from "./stats-styles";
import { formatCompactMinutes, formatDateLabel, localizeSemanticLabel } from "./stats-utils";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Rhythm Profile (Year / Lifetime)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function RhythmProfileSection({
  timeOfDayChart,
  categoryChart,
  isZh,
  copy,
}: {
  timeOfDayChart?: StatsChartBlock;
  categoryChart?: StatsChartBlock;
  isZh: boolean;
  copy: StatsCopy;
}) {
  const colors = useColors();
  const s = makeStyles(colors);

  return (
    <View style={{ gap: 24 }}>
      {/* Time of day bar chart */}
      {timeOfDayChart && (
        <View style={{ gap: 8 }}>
          <Text style={s.rhythmSubTitle}>{copy.timeOfDay}</Text>
          <Text style={s.rhythmSubDesc}>{copy.timeOfDayDesc}</Text>
          <BarChart
            data={timeOfDayChart.data.map((item) => ({
              label: localizeSemanticLabel(
                item.key,
                item.label,
                copy.timeOfDayLabels,
                copy.uncategorized,
              ),
              value: item.value,
            }))}
          />
        </View>
      )}

      {/* Category distribution as horizontal progress bars */}
      {categoryChart && (
        <View style={{ gap: 8 }}>
          <Text style={s.rhythmSubTitle}>{copy.categoryDistribution}</Text>
          <Text style={s.rhythmSubDesc}>{copy.categoryDistributionDesc}</Text>
          <CategoryDistributionList chart={categoryChart} isZh={isZh} copy={copy} />
        </View>
      )}
    </View>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Category Distribution List
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function CategoryDistributionList({
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
  const maxValue = Math.max(...chart.data.map((item) => item.value), 1);

  return (
    <View style={{ gap: 12 }}>
      {chart.data.map((item, index) => {
        const label = localizeSemanticLabel(
          item.key,
          item.label,
          copy.timeOfDayLabels,
          copy.uncategorized,
        );
        const pct = Math.max(10, (item.value / maxValue) * 100);

        return (
          <View key={`${item.key}-${index}`} style={{ gap: 4 }}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-end",
              }}
            >
              <Text style={s.categoryLabel}>{label}</Text>
              <Text style={s.categoryValue}>{formatCompactMinutes(item.value, isZh)}</Text>
            </View>
            <View style={s.categoryTrack}>
              <View style={[s.categoryFill, { width: `${pct}%` }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Yearly Snapshots (Lifetime) — flat rows
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function YearlySnapshotsSection({
  snapshots,
  isZh,
  copy,
}: {
  snapshots: Extract<StatsReport, { dimension: "lifetime" }>["yearlySnapshots"];
  isZh: boolean;
  copy: StatsCopy;
}) {
  const colors = useColors();
  const s = makeStyles(colors);

  return (
    <View>
      {snapshots.map((snapshot, index) => (
        <View key={snapshot.year} style={[s.snapshotRow, index > 0 && s.snapshotRowBorder]}>
          {/* Year */}
          <Text style={s.snapshotYear}>{snapshot.year}</Text>

          {/* Top book cover — library style */}
          {snapshot.topBook ? (
            <StatsBookCover
              coverUrl={snapshot.topBook.coverUrl}
              title={snapshot.topBook.title}
              width={28}
            />
          ) : (
            <View style={{ width: 28 }} />
          )}

          {/* Stats */}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.snapshotTime}>
              {formatCompactMinutes(snapshot.totalReadingTime, isZh)}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Text style={s.snapshotMeta}>
                {snapshot.booksTouched} {copy.books}
              </Text>
              <Text style={s.snapshotMeta}>
                {snapshot.activeDays} {copy.activeDays}
              </Text>
              {snapshot.topBook && (
                <Text style={s.snapshotTopBookTitle} numberOfLines={1}>
                  {snapshot.topBook.title}
                </Text>
              )}
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Journey Summary (Lifetime)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function JourneySummaryPanel({
  report,
  isZh,
  copy,
}: {
  report: Extract<StatsReport, { dimension: "lifetime" }>;
  isZh: boolean;
  copy: StatsCopy;
}) {
  const colors = useColors();
  const s = makeStyles(colors);

  return (
    <View style={{ gap: 16 }}>
      {/* Hero big number */}
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
          <Text style={s.journeyBigNumber}>{report.context.daysSinceJoined.toLocaleString()}</Text>
          <Text style={s.journeyBigSuffix}>{copy.daysSuffix}</Text>
        </View>
        <Text style={s.journeyNarrative}>
          {copy.journeyNarrative(report.context.daysSinceJoined)}
        </Text>
      </View>

      {/* Start date */}
      <Text style={s.journeyStartDate}>
        {copy.startedOn} {formatDateLabel(report.context.joinedSince, isZh)}
      </Text>

      {/* Metric row */}
      <View style={s.journeyMetricsRow}>
        <View style={{ gap: 2 }}>
          <Text style={s.journeyMetricLabel}>{copy.activeReadingDays}</Text>
          <Text style={s.journeyMetricValue}>
            {report.context.totalActiveDays.toLocaleString()} {copy.daysSuffix}
          </Text>
        </View>
        <View style={{ gap: 2 }}>
          <Text style={s.journeyMetricLabel}>{copy.inactiveReadingDays}</Text>
          <Text style={s.journeyMetricValue}>
            {report.context.totalInactiveDays.toLocaleString()} {copy.daysSuffix}
          </Text>
        </View>
      </View>
    </View>
  );
}
