/**
 * StatsScreen.tsx — Mobile reading statistics dashboard.
 *
 * Feature-parity with desktop ReadingStatsPanel:
 * - Dimension tabs (day/week/month/year/lifetime)
 * - Hero metric section with period navigation + narrative
 * - Day summary panel (day dimension)
 * - Chart surface (heatmap or bar)
 * - Month calendar (month dimension)
 * - Rhythm profile (year/lifetime)
 * - Yearly snapshots (lifetime)
 * - Journey summary (lifetime)
 * - Top books with expand/collapse
 * - Insights cards
 * - Milestones (lifetime)
 * - Longest streak card
 */
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon, SearchIcon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useReadingSessionStore } from "@/stores";
import { useColors, withOpacity } from "@/styles/theme";
import {
  type NavigationProp,
  type ParamListBase,
  useFocusEffect,
  useNavigation,
} from "@react-navigation/native";
import {
  type GoalPeriod,
  type GoalType,
  type StatsDimension,
  type StatsReport,
  buildStatsSummary,
  evaluateBadges,
  fromLocalDateKey,
  getAllGoalProgress,
  isStatsRelevantBookUpdate,
  readingReportsService,
} from "@readany/core/stats";
import { useGoalsStore } from "@readany/core/stores";
import { eventBus } from "@readany/core/utils/event-bus";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useResolvedCovers } from "./notes/useResolvedCovers";
import { BadgesPreview } from "./stats/BadgesPreview";
import { GoalsSection } from "./stats/GoalsSection";
import {
  ChartSurface,
  DaySummaryPanel,
  EmptyState,
  InsightsSection,
  JourneySummaryPanel,
  MetricTile,
  MonthCalendarSection,
  RhythmProfileSection,
  SectionCard,
  TopBooksSection,
} from "./stats/StatsSections";
import { makeStyles } from "./stats/stats-styles";
import {
  buildHeroNarrative,
  formatCharacterCount,
  formatCharactersPerMinute,
  formatDateLabel,
  formatTimeLocalized,
  localizeInsight,
} from "./stats/stats-utils";

const DIMENSIONS: StatsDimension[] = ["day", "week", "month", "year", "lifetime"];

/* ─── Helpers ─── */

function formatPeriodLabel(report: StatsReport, isZh: boolean): string {
  if (report.dimension === "day") return formatDateLabel(report.period.startDate, isZh);
  if (report.dimension === "week") {
    const start = formatDateLabel(report.period.startDate, isZh);
    const end = formatDateLabel(report.period.endDate, isZh);
    return `${start} – ${end}`;
  }
  if (report.dimension === "month") {
    const date = fromLocalDateKey(report.period.startDate);
    return new Intl.DateTimeFormat(isZh ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "long",
    }).format(date);
  }
  if (report.dimension === "year") return report.period.key;
  return "";
}

function shiftAnchor(date: Date, dim: StatsDimension, delta: -1 | 1): Date {
  const next = new Date(date);
  if (dim === "day") next.setDate(next.getDate() + delta);
  else if (dim === "week") next.setDate(next.getDate() + delta * 7);
  else if (dim === "month") next.setMonth(next.getMonth() + delta);
  else if (dim === "year") next.setFullYear(next.getFullYear() + delta);
  return next;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function StatsScreen() {
  const colors = useColors();
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const nav = useNavigation<NavigationProp<ParamListBase>>();
  const layout = useResponsiveLayout();
  const statsContentWidth = Math.min(
    layout.centeredContentWidth,
    layout.isTabletLandscape ? 1040 : layout.isTablet ? 860 : layout.centeredContentWidth,
  );
  const useTabletSectionGrid = layout.isTablet;
  const sectionGap = 12;
  const halfSectionWidth = Math.floor((statsContentWidth - sectionGap) / 2);
  const primarySectionWidth = Math.floor((statsContentWidth - sectionGap) * 0.58);
  const secondarySectionWidth = statsContentWidth - sectionGap - primarySectionWidth;
  const metricColumns = layout.isTabletLandscape ? 5 : layout.isTablet ? 4 : 2;
  const metricTileSlotWidth = `${100 / metricColumns}%` as `${number}%`;
  const s = makeStyles(colors);
  const saveCurrentSession = useReadingSessionStore((ss) => ss.saveCurrentSession);
  const currentSession = useReadingSessionStore((ss) => ss.currentSession);

  const [dimension, setDimension] = useState<StatsDimension>("month");
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [report, setReport] = useState<StatsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const resolvedCovers = useResolvedCovers(report?.topBooks);

  // Collect all calendar covers for resolution
  const calendarCoverItems = useMemo(() => {
    if (report?.dimension !== "month" || !report.readingCalendar) return [];
    const seen = new Set<string>();
    const items: { bookId: string; coverUrl?: string }[] = [];
    for (const week of report.readingCalendar.weeks) {
      for (const cell of week) {
        for (const cover of cell.covers) {
          if (!seen.has(cover.bookId)) {
            seen.add(cover.bookId);
            items.push({ bookId: cover.bookId, coverUrl: cover.coverUrl });
          }
        }
      }
    }
    return items;
  }, [report]);
  const resolvedCalendarCovers = useResolvedCovers(calendarCoverItems);

  /* ── Data loading ── */
  const loadReport = useCallback(async () => {
    setLoading(true);
    setErrorKey(null);
    try {
      let r: StatsReport;
      if (dimension === "day")
        r = await readingReportsService.getDayReport(anchorDate, currentSession);
      else if (dimension === "week")
        r = await readingReportsService.getWeekReport(anchorDate, currentSession);
      else if (dimension === "month")
        r = await readingReportsService.getMonthReport(anchorDate, currentSession);
      else if (dimension === "year")
        r = await readingReportsService.getYearReport(anchorDate, currentSession);
      else r = await readingReportsService.getLifetimeReport(currentSession);
      setReport(r);
    } catch (err) {
      console.error("[StatsScreen] Failed to load report", err);
      setErrorKey("stats.loadFailed");
    } finally {
      setLoading(false);
    }
  }, [anchorDate, currentSession, dimension]);

  const loadReportRef = useRef(loadReport);

  useEffect(() => {
    loadReportRef.current = loadReport;
  }, [loadReport]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void saveCurrentSession().finally(() => {
        if (!cancelled) {
          void loadReportRef.current();
        }
      });

      return () => {
        cancelled = true;
      };
    }, [saveCurrentSession]),
  );

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    return eventBus.on("sync:completed", () => void loadReport());
  }, [loadReport]);

  useEffect(() => {
    return eventBus.on("book:updated", ({ changedFields }) => {
      if (!isStatsRelevantBookUpdate(changedFields)) return;
      void loadReport();
    });
  }, [loadReport]);

  /* ── Derived ── */
  const periodLabel = useMemo(
    () => (report ? formatPeriodLabel(report, isZh) : ""),
    [report, isZh],
  );

  const headlineValue = useMemo(() => {
    if (!report) return "";
    if (report.dimension === "lifetime")
      return `${report.context.daysSinceJoined.toLocaleString()} ${t("stats.desktop.daysSuffix")}`;
    return formatTimeLocalized(report.summary.totalReadingTime, isZh);
  }, [report, isZh, t]);

  const headlineLabel = useMemo(() => {
    if (!report) return "";
    return report.dimension === "lifetime"
      ? t("stats.desktop.daysTogether")
      : t("stats.desktop.readingTime");
  }, [report, t]);

  const heroNarrative = useMemo(
    () => (report ? buildHeroNarrative(report, t, isZh) : ""),
    [report, t, isZh],
  );

  const supportMetrics = useMemo(() => {
    if (!report) return [];
    const compMap = new Map<string, { delta?: number; deltaLabel?: string }>();
    for (const c of report.previousPeriodComparison ?? []) {
      compMap.set(c.label, { delta: c.delta, deltaLabel: c.deltaLabel });
    }
    const adC = compMap.get("activeDays");
    const ssC = compMap.get("sessions");
    const bkC = compMap.get("books");
    const readingVolumeValue = formatCharacterCount(report.summary.totalCharactersRead ?? 0, isZh);
    const readingSpeedValue =
      (report.summary.avgCharactersPerMinute ?? 0) > 0
        ? formatCharactersPerMinute(report.summary.avgCharactersPerMinute ?? 0, isZh)
        : null;
    return [
      {
        label: t("stats.desktop.activeDays"),
        value: `${report.summary.activeDays} ${t("stats.desktop.daysSuffix")}`,
        sublabel: t("stats.desktop.avgActiveDay"),
        delta: adC?.delta,
        deltaLabel: adC?.deltaLabel,
      },
      {
        label: t("stats.desktop.sessions"),
        value: `${report.summary.totalSessions} ${t("stats.desktop.sessionsSuffix")}`,
        sublabel: formatTimeLocalized(report.summary.avgSessionTime, isZh),
        delta: ssC?.delta,
        deltaLabel: ssC?.deltaLabel,
      },
      {
        label: t("stats.desktop.books"),
        value: String(report.summary.booksTouched),
        sublabel: readingVolumeValue,
        delta: bkC?.delta,
        deltaLabel: bkC?.deltaLabel,
      },
      {
        label: t("stats.desktop.streak"),
        value: `${report.dimension === "lifetime" ? report.summary.longestStreak : report.summary.currentStreak} ${t("stats.desktop.daysSuffix")}`,
        sublabel: `${t("stats.desktop.longestSession")} ${formatTimeLocalized(report.summary.longestSessionTime, isZh)}`,
      },
      {
        label: readingSpeedValue
          ? t("stats.desktop.readingSpeed")
          : t("stats.desktop.avgActiveDay"),
        value: readingSpeedValue ?? formatTimeLocalized(report.summary.avgActiveDayTime, isZh),
        sublabel: readingSpeedValue
          ? t("stats.desktop.characters")
          : t("stats.desktop.readingTime"),
      },
    ];
  }, [report, isZh, t]);

  const localizedInsights = useMemo(
    () => (report ? report.insights.map((ins) => localizeInsight(ins, report, t, isZh)) : []),
    [report, t, isZh],
  );

  const localizedMilestones = useMemo(
    () =>
      report?.dimension === "lifetime"
        ? report.milestones.map((ins) => localizeInsight(ins, report, t, isZh))
        : [],
    [report, t, isZh],
  );

  /* ── Badges ── */
  const [allFacts, setAllFacts] = useState<import("@readany/core/stats").DailyReadingFact[]>([]);

  useEffect(() => {
    if (report) {
      readingReportsService
        .getAllDailyFacts(currentSession)
        .then(setAllFacts)
        .catch((err) => console.warn("[Stats] Failed to load daily facts:", err));
    }
  }, [currentSession, report]);

  const earnedBadges = useMemo(() => {
    if (allFacts.length === 0) return [];
    const lifetimeSummary = buildStatsSummary(allFacts);
    return evaluateBadges(allFacts, lifetimeSummary);
  }, [allFacts]);

  /* ── Goals ── */
  const goals = useGoalsStore((s) => s.goals);
  const addGoalAction = useGoalsStore((s) => s.addGoal);
  const removeGoalAction = useGoalsStore((s) => s.removeGoal);

  const goalProgress = useMemo(
    () => (goals.length > 0 && allFacts.length > 0 ? getAllGoalProgress(goals, allFacts) : []),
    [goals, allFacts],
  );

  const activeGoalPeriod = useMemo<GoalPeriod | null>(() => {
    if (dimension === "month") return "monthly";
    if (dimension === "year") return "yearly";
    return null;
  }, [dimension]);

  const visibleGoalProgress = useMemo(
    () =>
      activeGoalPeriod ? goalProgress.filter(({ goal }) => goal.period === activeGoalPeriod) : [],
    [goalProgress, activeGoalPeriod],
  );

  const goalSectionTitle = useMemo(
    () =>
      activeGoalPeriod
        ? t(
            activeGoalPeriod === "yearly"
              ? "stats.desktop.goalsTitleYearly"
              : "stats.desktop.goalsTitleMonthly",
          )
        : "",
    [activeGoalPeriod, t],
  );

  const goalSectionDescription = useMemo(
    () =>
      activeGoalPeriod
        ? t(
            activeGoalPeriod === "yearly"
              ? "stats.desktop.goalsDescYearly"
              : "stats.desktop.goalsDescMonthly",
          )
        : "",
    [activeGoalPeriod, t],
  );

  const handleAddGoal = useCallback(
    (type: GoalType, target: number, period: GoalPeriod) => {
      addGoalAction({
        id: `goal-${Date.now()}`,
        type,
        target,
        period,
        createdAt: Date.now(),
      });
    },
    [addGoalAction],
  );

  const copy = useMemo(
    () => ({
      heatmapLegendLow: t("stats.desktop.heatmapLegendLow"),
      heatmapLegendHigh: t("stats.desktop.heatmapLegendHigh"),
      activeDaysSummary: (count: number) => t("stats.desktop.activeDaysSummary", { count }),
      noDataDesc: t("stats.desktop.noDataDesc"),
      noDataTitle: t("stats.desktop.noDataTitle"),
      chartPeakLabel: (label: string, value: string) =>
        t("stats.desktop.chartPeakLabel", { label, value }),
      singlePointLabel: t("stats.desktop.singlePointLabel"),
      singlePointDesc: t("stats.desktop.singlePointDesc"),
      topBookLead: t("stats.desktop.topBookLead"),
      topBooksCollapse: t("stats.desktop.topBooksCollapse"),
      topBooksExpandCount: (count: number) => t("stats.desktop.topBooksExpandCount", { count }),
      noTopBooks: t("stats.desktop.noTopBooks"),
      unknownAuthor: t("stats.desktop.unknownAuthor"),
      pagesReadSuffix: t("stats.desktop.pagesReadSuffix"),
      charactersReadSuffix: t("stats.desktop.charactersReadSuffix"),
      charactersPerMinuteSuffix: t("stats.desktop.charactersPerMinuteSuffix"),
      sessionsSuffix: t("stats.desktop.sessionsSuffix"),
      noInsights: t("stats.desktop.noInsights"),
      // Day summary
      firstSession: t("stats.desktop.firstSession"),
      lastSession: t("stats.desktop.lastSession"),
      peakHour: t("stats.desktop.peakHour"),
      longestRead: t("stats.desktop.longestRead"),
      topFocus: t("stats.desktop.topFocus"),
      noDayTopBook: t("stats.desktop.noDayTopBook"),
      noTimeline: t("stats.desktop.noTimeline"),
      activeNow: t("stats.desktop.activeNow"),
      // Calendar
      readingCalendar: t("stats.desktop.readingCalendar"),
      readingCalendarDesc: t("stats.desktop.readingCalendarDesc"),
      // Rhythm
      timeOfDay: t("stats.desktop.timeOfDay"),
      timeOfDayDesc: t("stats.desktop.timeOfDayDesc"),
      categoryDistribution: t("stats.desktop.categoryDistribution"),
      categoryDistributionDesc: t("stats.desktop.categoryDistributionDesc"),
      uncategorized: t("stats.desktop.uncategorized"),
      timeOfDayLabels: {
        lateNight: t("stats.desktop.timeOfDayLabels.lateNight"),
        earlyMorning: t("stats.desktop.timeOfDayLabels.earlyMorning"),
        morning: t("stats.desktop.timeOfDayLabels.morning"),
        afternoon: t("stats.desktop.timeOfDayLabels.afternoon"),
        evening: t("stats.desktop.timeOfDayLabels.evening"),
        night: t("stats.desktop.timeOfDayLabels.night"),
      },
      // Yearly snapshots
      books: t("stats.desktop.books"),
      activeDays: t("stats.desktop.activeDays"),
      // Journey
      daysSuffix: t("stats.desktop.daysSuffix"),
      startedOn: t("stats.desktop.startedOn"),
      activeReadingDays: t("stats.desktop.activeReadingDays"),
      inactiveReadingDays: t("stats.desktop.inactiveReadingDays"),
      journeyNarrative: (days: number) => t("stats.desktop.journeyNarrative", { days }),
      // Milestones
      milestones: t("stats.desktop.milestones"),
      milestonesDesc: t("stats.desktop.milestonesDesc"),
      // Day summary
      daySummary: t("stats.desktop.daySummary"),
      daySummaryDesc: t("stats.desktop.daySummaryDesc"),
    }),
    [t],
  );

  const dimLabels: Record<StatsDimension, string> = {
    day: t("stats.desktop.dimensions.day"),
    week: t("stats.desktop.dimensions.week"),
    month: t("stats.desktop.dimensions.month"),
    year: t("stats.desktop.dimensions.year"),
    lifetime: t("stats.desktop.dimensions.lifetime"),
  };

  const primaryChart = report?.charts[0] ?? null;
  const monthlyReport = report?.dimension === "month" ? report : null;
  const yearOrLifetimeReport =
    report?.dimension === "year" || report?.dimension === "lifetime" ? report : null;
  const hasRhythmProfile = Boolean(
    yearOrLifetimeReport &&
      (yearOrLifetimeReport.timeOfDayChart || yearOrLifetimeReport.categoryDistribution),
  );

  /* ━━━━━━━━━━ Render ━━━━━━━━━━ */

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      {/* Header */}
      <View style={[s.header, { paddingHorizontal: layout.horizontalPadding }]}>
        <View style={[s.headerInner, { maxWidth: statsContentWidth }]}>
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => {
              if (nav.canGoBack()) {
                nav.goBack();
              } else {
                nav.navigate("Tabs" as never);
              }
            }}
          >
            <ChevronLeftIcon size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{t("stats.title")}</Text>
          <View style={{ width: 36 }} />
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          s.scrollContent,
          { paddingHorizontal: layout.horizontalPadding, alignItems: "center" },
        ]}
        stickyHeaderIndices={[0]}
      >
        {/* Dimension tabs — sticky */}
        <View style={[s.dimTabsSticky, { width: "100%", maxWidth: statsContentWidth }]}>
          <View style={s.dimTabs}>
            {DIMENSIONS.map((dim) => (
              <TouchableOpacity
                key={dim}
                style={[s.dimTab, dimension === dim && s.dimTabActive]}
                onPress={() => {
                  setDimension(dim);
                  setAnchorDate(new Date());
                }}
                activeOpacity={0.7}
              >
                <Text style={[s.dimTabText, dimension === dim && s.dimTabTextActive]}>
                  {dimLabels[dim]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={colors.mutedForeground} />
          </View>
        ) : errorKey || !report ? (
          <EmptyState
            title={errorKey ? t(errorKey) : t("stats.desktop.noDataTitle")}
            description={t("stats.desktop.noDataDesc")}
            icon={<SearchIcon size={24} color={withOpacity(colors.mutedForeground, 0.45)} />}
          />
        ) : (
          <View style={{ width: "100%", maxWidth: statsContentWidth }}>
            {/* ═══ Hero Section ═══ */}
            <View style={s.heroCard}>
              {/* Period row + nav */}
              {dimension === "lifetime" ? (
                <View style={s.heroLifetimeHeader}>
                  <Text style={s.heroDimLabel}>
                    {t(`stats.desktop.dimensionTitles.${dimension}`)}
                  </Text>
                  <Text style={s.heroLifetimeTitle}>
                    {t("stats.desktop.companionMessage")} {headlineValue}
                  </Text>
                </View>
              ) : (
                <View style={s.heroPeriodRow}>
                  <View>
                    <Text style={s.heroDimLabel}>
                      {t(`stats.desktop.dimensionTitles.${dimension}`)}
                    </Text>
                    <Text style={s.heroPeriodLabel}>{periodLabel}</Text>
                  </View>
                  <View style={s.heroNavRow}>
                    <TouchableOpacity
                      style={s.heroNavBtn}
                      onPress={() => setAnchorDate((p) => shiftAnchor(p, dimension, -1))}
                      disabled={!report.navigation.canGoPrev}
                    >
                      <ChevronLeftIcon
                        size={16}
                        color={
                          report.navigation.canGoPrev
                            ? colors.foreground
                            : withOpacity(colors.mutedForeground, 0.3)
                        }
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.heroNavBtn}
                      onPress={() => setAnchorDate((p) => shiftAnchor(p, dimension, 1))}
                      disabled={!report.navigation.canGoNext}
                    >
                      <ChevronRightIcon
                        size={16}
                        color={
                          report.navigation.canGoNext
                            ? colors.foreground
                            : withOpacity(colors.mutedForeground, 0.3)
                        }
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Headline metric */}
              <Text style={s.heroValue}>{headlineValue}</Text>
              <View style={s.heroSubRow}>
                <ClockIcon size={14} color={withOpacity(colors.primary, 0.35)} />
                <Text style={s.heroSubText}>{headlineLabel}</Text>
              </View>

              {/* Hero narrative */}
              {heroNarrative ? <Text style={s.heroNarrative}>{heroNarrative}</Text> : null}

              {/* Supporting metrics grid */}
              <View style={s.metricsGrid}>
                {supportMetrics.map((m) => (
                  <View
                    key={m.label}
                    style={{
                      width: metricTileSlotWidth,
                      paddingHorizontal: 4,
                      paddingBottom: 8,
                    }}
                  >
                    <MetricTile
                      label={m.label}
                      value={m.value}
                      sublabel={m.sublabel}
                      delta={m.delta}
                      deltaLabel={m.deltaLabel}
                      style={{ width: "100%" }}
                    />
                  </View>
                ))}
              </View>
            </View>

            {/* ═══ Reading Goals (month/year only) ═══ */}
            {activeGoalPeriod && !(useTabletSectionGrid && report.dimension === "month") && (
              <SectionCard title={goalSectionTitle} description={goalSectionDescription}>
                <GoalsSection
                  progress={visibleGoalProgress}
                  onAddGoal={handleAddGoal}
                  onRemoveGoal={removeGoalAction}
                  currentDimension={dimension}
                />
              </SectionCard>
            )}

            {/* ═══ Day Summary (day dimension) ═══ */}
            {report.dimension === "day" && !useTabletSectionGrid && (
              <SectionCard title={copy.daySummary} description={copy.daySummaryDesc}>
                <DaySummaryPanel
                  dayFact={report.dayFact}
                  topBook={report.topBooks[0]}
                  isZh={isZh}
                  copy={copy}
                />
              </SectionCard>
            )}

            {/* ═══ Primary Chart ═══ */}
            {primaryChart &&
              !(
                useTabletSectionGrid &&
                (report.dimension === "day" ||
                  report.dimension === "month" ||
                  report.dimension === "year")
              ) && (
                <SectionCard
                  title={
                    primaryChart.type === "heatmap"
                      ? t("stats.desktop.readingHeatmap")
                      : t("stats.desktop.primaryChart")
                  }
                  description={
                    primaryChart.type === "heatmap"
                      ? t("stats.desktop.readingHeatmapDesc")
                      : t("stats.desktop.primaryChartDesc")
                  }
                >
                  <ChartSurface chart={primaryChart} isZh={isZh} copy={copy} />
                </SectionCard>
              )}

            {useTabletSectionGrid && report.dimension === "day" && (
              <View style={s.sectionGrid}>
                {primaryChart && (
                  <SectionCard
                    title={
                      primaryChart.type === "heatmap"
                        ? t("stats.desktop.readingHeatmap")
                        : t("stats.desktop.primaryChart")
                    }
                    description={
                      primaryChart.type === "heatmap"
                        ? t("stats.desktop.readingHeatmapDesc")
                        : t("stats.desktop.primaryChartDesc")
                    }
                    style={{
                      width: primarySectionWidth,
                      marginBottom: 0,
                    }}
                  >
                    <ChartSurface chart={primaryChart} isZh={isZh} copy={copy} />
                  </SectionCard>
                )}

                <SectionCard
                  title={copy.daySummary}
                  description={copy.daySummaryDesc}
                  style={{
                    width: primaryChart ? secondarySectionWidth : statsContentWidth,
                    marginBottom: 0,
                  }}
                >
                  <DaySummaryPanel
                    dayFact={report.dayFact}
                    topBook={report.topBooks[0]}
                    isZh={isZh}
                    copy={copy}
                  />
                </SectionCard>
              </View>
            )}

            {useTabletSectionGrid && report.dimension === "month" && (
              <View style={s.sectionGrid}>
                {primaryChart && (
                  <SectionCard
                    title={
                      primaryChart.type === "heatmap"
                        ? t("stats.desktop.readingHeatmap")
                        : t("stats.desktop.primaryChart")
                    }
                    description={
                      primaryChart.type === "heatmap"
                        ? t("stats.desktop.readingHeatmapDesc")
                        : t("stats.desktop.primaryChartDesc")
                    }
                    style={{
                      width: activeGoalPeriod ? primarySectionWidth : statsContentWidth,
                      marginBottom: 0,
                    }}
                  >
                    <ChartSurface chart={primaryChart} isZh={isZh} copy={copy} />
                  </SectionCard>
                )}

                {activeGoalPeriod && (
                  <SectionCard
                    title={goalSectionTitle}
                    description={goalSectionDescription}
                    style={{
                      width: primaryChart ? secondarySectionWidth : statsContentWidth,
                      marginBottom: 0,
                    }}
                  >
                    <GoalsSection
                      progress={visibleGoalProgress}
                      onAddGoal={handleAddGoal}
                      onRemoveGoal={removeGoalAction}
                      currentDimension={dimension}
                    />
                  </SectionCard>
                )}
              </View>
            )}

            {useTabletSectionGrid && report.dimension === "year" && (
              <View style={s.sectionGrid}>
                {primaryChart && (
                  <SectionCard
                    title={
                      primaryChart.type === "heatmap"
                        ? t("stats.desktop.readingHeatmap")
                        : t("stats.desktop.primaryChart")
                    }
                    description={
                      primaryChart.type === "heatmap"
                        ? t("stats.desktop.readingHeatmapDesc")
                        : t("stats.desktop.primaryChartDesc")
                    }
                    style={{
                      width: hasRhythmProfile ? primarySectionWidth : statsContentWidth,
                      marginBottom: 0,
                    }}
                  >
                    <ChartSurface chart={primaryChart} isZh={isZh} copy={copy} />
                  </SectionCard>
                )}

                {hasRhythmProfile && (
                  <SectionCard
                    title={undefined}
                    style={{
                      width: primaryChart ? secondarySectionWidth : statsContentWidth,
                      marginBottom: 0,
                    }}
                  >
                    <RhythmProfileSection
                      timeOfDayChart={yearOrLifetimeReport?.timeOfDayChart}
                      categoryChart={yearOrLifetimeReport?.categoryDistribution}
                      isZh={isZh}
                      copy={copy}
                    />
                  </SectionCard>
                )}
              </View>
            )}

            {/* ═══ Month Calendar (month dimension) ═══ */}
            {monthlyReport?.readingCalendar && (
              <SectionCard title={copy.readingCalendar} description={copy.readingCalendarDesc}>
                <MonthCalendarSection
                  calendar={monthlyReport.readingCalendar}
                  isZh={isZh}
                  resolvedCovers={resolvedCalendarCovers}
                />
              </SectionCard>
            )}

            {/* ═══ Rhythm Profile (year/lifetime) ═══ */}
            {(yearOrLifetimeReport &&
              (yearOrLifetimeReport.timeOfDayChart || yearOrLifetimeReport.categoryDistribution)) ||
            report.dimension === "lifetime" ? (
              <View style={useTabletSectionGrid ? s.sectionGrid : undefined}>
                {yearOrLifetimeReport &&
                  (yearOrLifetimeReport.timeOfDayChart ||
                    yearOrLifetimeReport.categoryDistribution) &&
                  report.dimension === "lifetime" && (
                    <SectionCard
                      title={undefined}
                      style={
                        useTabletSectionGrid
                          ? { width: primarySectionWidth, marginBottom: 0 }
                          : undefined
                      }
                    >
                      <RhythmProfileSection
                        timeOfDayChart={yearOrLifetimeReport.timeOfDayChart}
                        categoryChart={yearOrLifetimeReport.categoryDistribution}
                        isZh={isZh}
                        copy={copy}
                      />
                    </SectionCard>
                  )}

                {report.dimension === "lifetime" && (
                  <SectionCard
                    title={t("stats.desktop.journey")}
                    description={t("stats.desktop.journeySubtitle")}
                    style={
                      useTabletSectionGrid
                        ? {
                            width: hasRhythmProfile ? secondarySectionWidth : statsContentWidth,
                            marginBottom: 0,
                          }
                        : undefined
                    }
                  >
                    <JourneySummaryPanel report={report} isZh={isZh} copy={copy} />
                  </SectionCard>
                )}
              </View>
            ) : null}

            <View style={useTabletSectionGrid ? s.sectionGrid : undefined}>
              <SectionCard
                title={t("stats.desktop.topBooks")}
                description={t("stats.desktop.topBooksDesc")}
                featured
                style={
                  useTabletSectionGrid
                    ? {
                        width:
                          localizedInsights.length > 0 ? primarySectionWidth : statsContentWidth,
                        marginBottom: 0,
                      }
                    : undefined
                }
              >
                <TopBooksSection
                  books={report.topBooks}
                  resolvedCovers={resolvedCovers}
                  isZh={isZh}
                  copy={copy}
                  allFacts={allFacts}
                />
              </SectionCard>

              {localizedInsights.length > 0 && (
                <SectionCard
                  title={t("stats.desktop.insights")}
                  description={t("stats.desktop.insightsDesc")}
                  style={
                    useTabletSectionGrid
                      ? { width: secondarySectionWidth, marginBottom: 0 }
                      : undefined
                  }
                >
                  <InsightsSection insights={localizedInsights} copy={copy} />
                </SectionCard>
              )}
            </View>

            {report.dimension === "lifetime" &&
            (localizedMilestones.length > 0 || earnedBadges.length > 0) ? (
              <View style={useTabletSectionGrid ? s.sectionGrid : undefined}>
                {localizedMilestones.length > 0 && (
                  <SectionCard
                    title={t("stats.desktop.milestones")}
                    description={t("stats.desktop.milestonesDesc")}
                    style={
                      useTabletSectionGrid
                        ? { width: halfSectionWidth, marginBottom: 0 }
                        : undefined
                    }
                  >
                    <InsightsSection insights={localizedMilestones} copy={copy} />
                  </SectionCard>
                )}

                {report.dimension === "lifetime" && (
                  <SectionCard
                    title={t("stats.desktop.badges")}
                    description={t("stats.desktop.badgesDesc")}
                    style={
                      useTabletSectionGrid
                        ? {
                            width:
                              localizedMilestones.length > 0 ? halfSectionWidth : statsContentWidth,
                            marginBottom: 0,
                          }
                        : undefined
                    }
                    action={
                      <TouchableOpacity
                        onPress={() => nav.navigate("Badges")}
                        style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
                        activeOpacity={0.6}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "500",
                            color: withOpacity(colors.primary, 0.6),
                          }}
                        >
                          {t("stats.desktop.viewAllBadges")}
                        </Text>
                        <ChevronRightIcon size={14} color={withOpacity(colors.primary, 0.6)} />
                      </TouchableOpacity>
                    }
                  >
                    <BadgesPreview
                      earned={earnedBadges}
                      t={t}
                      onViewAll={() => nav.navigate("Badges")}
                    />
                  </SectionCard>
                )}
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
