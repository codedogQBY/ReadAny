import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { readingStatsService } from "@/lib/stats/reading-stats";
import type { DailyStats, OverallStats } from "@/lib/stats/reading-stats";
import { BookOpen, Clock, Flame, TrendingUp } from "lucide-react";
/**
 * ReadingStatsPanel — displays reading statistics with heatmap
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function ReadingStatsPanel() {
  const { t, i18n } = useTranslation();
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      // Load last 365 days for heatmap
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 365);

      const [daily, overallStats] = await Promise.all([
        readingStatsService.getDailyStats(startDate, endDate),
        readingStatsService.getOverallStats(),
      ]);

      setDailyStats(daily);
      setOverall(overallStats);
    } catch {
      // Stats may fail if DB isn't initialized
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 overflow-auto p-6">
      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-neutral-900">{t("stats.title")}</h1>
        <p className="text-sm text-neutral-500">{t("stats.subtitle")}</p>
      </div>

      {/* Stat Cards Grid */}
      {overall && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<BookOpen className="h-4 w-4" />}
            title={t("stats.booksRead")}
            value={String(overall.totalBooks)}
            description={t("stats.booksReadDesc")}
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            title={t("stats.totalTime")}
            value={formatTime(overall.totalReadingTime)}
            description={t("stats.totalTimeDesc")}
          />
          <StatCard
            icon={<Flame className="h-4 w-4" />}
            title={t("stats.currentStreak")}
            value={`${overall.currentStreak}d`}
            description={t("stats.currentStreakDesc")}
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            title={t("stats.avgDaily")}
            value={formatTime(overall.avgDailyTime)}
            description={t("stats.avgDailyDesc")}
          />
        </div>
      )}

      {/* Heatmap Section */}
      <div className="rounded-xl border border-neutral-150 p-5">
        <div className="mb-4 space-y-1">
          <h3 className="text-base font-semibold text-neutral-900">{t("stats.heatmapTitle")}</h3>
          <p className="text-xs text-neutral-500">{t("stats.heatmapDesc")}</p>
        </div>
        <HeatmapChart dailyStats={dailyStats} lang={i18n.language} />
        <HeatmapLegend />
      </div>

      {/* Longest Streak */}
      {overall && overall.longestStreak > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-neutral-150 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50">
            <Flame className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-900">
              {t("stats.longestStreak", { days: overall.longestStreak })}
            </p>
            <p className="text-xs text-neutral-500">{t("stats.longestStreakDesc")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Heatmap Chart ── */

function HeatmapChart({ dailyStats, lang }: { dailyStats: DailyStats[]; lang: string }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(12);
  const gap = 2;
  const labelWidth = 28;

  // Measure container and compute cell size to fill available width
  const updateSize = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const availableWidth = el.clientWidth - labelWidth;
    // 53 columns, with gap between each: 53 * (cell + gap) - gap = availableWidth
    const computed = Math.floor((availableWidth + gap) / 53 - gap);
    setCellSize(Math.max(6, Math.min(computed, 16)));
  }, []);

  useEffect(() => {
    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateSize]);

  const unit = cellSize + gap;

  const { weeks, monthLabels } = useMemo(() => {
    const statsMap = new Map<string, number>();
    for (const s of dailyStats) {
      statsMap.set(s.date, s.totalTime);
    }

    const today = new Date();
    const todayDay = today.getDay();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (52 * 7 + todayDay));

    const weeksArr: Array<Array<{ date: string; time: number; dayOfWeek: number }>> = [];
    const mLabels: Array<{ label: string; col: number }> = [];
    let currentWeek: Array<{ date: string; time: number; dayOfWeek: number }> = [];
    let lastMonth = -1;

    const cursor = new Date(startDate);
    let weekIdx = 0;

    while (cursor <= today) {
      const dateStr = cursor.toISOString().split("T")[0];
      const dow = cursor.getDay();
      const month = cursor.getMonth();

      if (dow === 0 && currentWeek.length > 0) {
        weeksArr.push(currentWeek);
        currentWeek = [];
        weekIdx++;
      }

      if (month !== lastMonth) {
        const monthName = cursor.toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { month: "short" });
        mLabels.push({ label: monthName, col: weekIdx });
        lastMonth = month;
      }

      currentWeek.push({
        date: dateStr,
        time: statsMap.get(dateStr) || 0,
        dayOfWeek: dow,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    if (currentWeek.length > 0) weeksArr.push(currentWeek);

    return { weeks: weeksArr, monthLabels: mLabels };
  }, [dailyStats, lang]);

  const dayLabels = useMemo(() => {
    const days = lang === "zh"
      ? ["日", "一", "二", "三", "四", "五", "六"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return [
      { idx: 1, label: days[1] },
      { idx: 3, label: days[3] },
      { idx: 5, label: days[5] },
    ];
  }, [lang]);

  return (
    <TooltipProvider delayDuration={100}>
      <div ref={containerRef} className="w-full">
        {/* Month labels */}
        <div className="flex" style={{ paddingLeft: `${labelWidth}px` }}>
          {monthLabels.map((m, i) => {
            const nextCol = i + 1 < monthLabels.length ? monthLabels[i + 1].col : weeks.length;
            const span = nextCol - m.col;
            return (
              <div
                key={`${m.label}-${m.col}`}
                className="text-xs text-neutral-400"
                style={{ width: `${span * unit}px`, minWidth: `${span * unit}px` }}
              >
                {span >= 2 ? m.label : ""}
              </div>
            );
          })}
        </div>

        <div className="flex gap-0">
          {/* Day of week labels */}
          <div className="flex flex-col justify-between pr-1.5" style={{ width: `${labelWidth}px`, height: `${7 * unit - gap}px` }}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => {
              const label = dayLabels.find((l) => l.idx === d);
              return (
                <div key={d} className="flex items-center" style={{ height: `${cellSize}px` }}>
                  <span className="text-[10px] text-neutral-400">{label?.label || ""}</span>
                </div>
              );
            })}
          </div>

          {/* Heatmap grid */}
          <div className="flex" style={{ gap: `${gap}px` }}>
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col" style={{ gap: `${gap}px` }}>
                {week[0] && week[0].dayOfWeek > 0 && wi === 0 &&
                  Array.from({ length: week[0].dayOfWeek }).map((_, i) => (
                    <div key={`empty-${i}`} style={{ height: `${cellSize}px`, width: `${cellSize}px` }} />
                  ))}
                {week.map((day) => (
                  <Tooltip key={day.date}>
                    <TooltipTrigger asChild>
                      <div
                        className={`rounded-[2px] transition-colors ${getHeatColor(day.time)}`}
                        style={{ height: `${cellSize}px`, width: `${cellSize}px` }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="bg-neutral-800 text-white">
                      <p className="text-xs font-medium">
                        {day.time > 0
                          ? t("stats.heatmapTooltip", { time: Math.round(day.time), date: day.date })
                          : t("stats.heatmapNoReading", { date: day.date })}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function HeatmapLegend() {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-neutral-400">
      <span>{t("stats.less")}</span>
      <div className="h-[12px] w-[12px] rounded-[2px] bg-neutral-100" />
      <div className="h-[12px] w-[12px] rounded-[2px] bg-emerald-200" />
      <div className="h-[12px] w-[12px] rounded-[2px] bg-emerald-400" />
      <div className="h-[12px] w-[12px] rounded-[2px] bg-emerald-500" />
      <div className="h-[12px] w-[12px] rounded-[2px] bg-emerald-700" />
      <span>{t("stats.more")}</span>
    </div>
  );
}

function getHeatColor(minutes: number): string {
  if (minutes <= 0) return "bg-neutral-100";
  if (minutes < 15) return "bg-emerald-200";
  if (minutes < 30) return "bg-emerald-400";
  if (minutes < 60) return "bg-emerald-500";
  return "bg-emerald-700";
}

/* ── Stat Card ── */

function StatCard({
  icon,
  title,
  value,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  description?: string;
}) {
  return (
    <div className="rounded-xl bg-muted p-4 shadow-around">
      <div className="flex items-center justify-between pb-2">
        <h3 className="text-sm font-medium text-neutral-500">{title}</h3>
        <div className="text-neutral-400">{icon}</div>
      </div>
      <div className="space-y-1">
        <div className="text-2xl font-bold text-neutral-900">{value}</div>
        {description && <p className="text-xs text-neutral-400">{description}</p>}
      </div>
    </div>
  );
}

function formatTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
