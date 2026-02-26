import { readingStatsService } from "@/lib/stats/reading-stats";
import type { DailyStats, OverallStats } from "@/lib/stats/reading-stats";
import { BookOpen, Clock, Flame, TrendingUp } from "lucide-react";
/**
 * ReadingStatsPanel — displays reading statistics with visual charts
 * Uses native CSS for chart rendering (no recharts dependency)
 */
import { useEffect, useState } from "react";

export function ReadingStatsPanel() {
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"week" | "month">("week");

  useEffect(() => {
    loadStats();
  }, [period]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (period === "week" ? 7 : 30));

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
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const maxTime = Math.max(...dailyStats.map((d) => d.totalTime), 1);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {/* Overall stats cards */}
      {overall && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<BookOpen className="h-4 w-4" />}
            label="Books Read"
            value={String(overall.totalBooks)}
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label="Total Time"
            value={formatTime(overall.totalReadingTime)}
          />
          <StatCard
            icon={<Flame className="h-4 w-4" />}
            label="Current Streak"
            value={`${overall.currentStreak}d`}
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Avg Daily"
            value={formatTime(overall.avgDailyTime)}
          />
        </div>
      )}

      {/* Period selector */}
      <div className="flex gap-1">
        <button
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            period === "week"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setPeriod("week")}
        >
          Week
        </button>
        <button
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            period === "month"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setPeriod("month")}
        >
          Month
        </button>
      </div>

      {/* Bar chart */}
      <div className="rounded-lg border border-border p-3">
        <h4 className="mb-3 text-xs font-medium text-muted-foreground">Daily Reading Time</h4>
        <div className="flex items-end gap-1" style={{ height: "120px" }}>
          {dailyStats.map((stat) => {
            const height = maxTime > 0 ? (stat.totalTime / maxTime) * 100 : 0;
            const date = new Date(stat.date);
            const dayLabel = date.toLocaleDateString("en", { weekday: "narrow" });

            return (
              <div
                key={stat.date}
                className="group relative flex flex-1 flex-col items-center"
                style={{ height: "100%" }}
              >
                {/* Tooltip */}
                <div className="pointer-events-none absolute -top-8 z-10 hidden rounded bg-foreground px-2 py-1 text-[10px] text-background group-hover:block">
                  {Math.round(stat.totalTime)}m
                </div>

                {/* Bar */}
                <div className="mt-auto w-full max-w-[24px]">
                  <div
                    className="w-full rounded-t bg-primary transition-all"
                    style={{
                      height: `${Math.max(height, stat.totalTime > 0 ? 4 : 0)}%`,
                      minHeight: stat.totalTime > 0 ? "2px" : "0",
                    }}
                  />
                </div>

                {/* Day label */}
                <span className="mt-1 text-[9px] text-muted-foreground">{dayLabel}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Longest streak */}
      {overall && overall.longestStreak > 0 && (
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-500" />
            <span className="text-sm font-medium">
              Longest Streak: {overall.longestStreak} days
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase">{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function formatTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
