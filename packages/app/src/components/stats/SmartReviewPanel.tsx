/**
 * SmartReviewPanel — 智能复习面板
 *
 * 集成 smart-review.ts 艾宾浩斯遗忘曲线复习系统：
 * - 显示待复习章节列表
 * - 支持完成复习（质量评级）
 * - 跳过复习
 * - 复习统计概览
 */
import { smartReviewSystem, type ReviewItem, type ReviewQuality } from "@/lib/smart-review";
import { useLibraryStore } from "@/stores/library-store";
import { cn } from "@readany/core/utils";
import {
  Brain,
  // Check,
  // ChevronRight,
  Clock,
  // Loader2,
  // RotateCcw,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionHeader, StatsCard } from "./StatsShared";

/* ─── Quality buttons ─── */

const QUALITY_OPTIONS: { value: ReviewQuality; labelKey: string; emoji: string; descKey: string; color: string }[] = [
  { value: "excellent", labelKey: "review.qualityExcellent", descKey: "review.qualityExcellentDesc", emoji: "🧠", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30" },
  { value: "good", labelKey: "review.qualityGood", descKey: "review.qualityGoodDesc", emoji: "👍", color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30" },
  { value: "fair", labelKey: "review.qualityFair", descKey: "review.qualityFairDesc", emoji: "🤔", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30" },
  { value: "poor", labelKey: "review.qualityPoor", descKey: "review.qualityPoorDesc", emoji: "😓", color: "text-red-600 bg-red-50 dark:bg-red-950/30" },
];

/* ─── Utility ─── */

function formatDueTime(timestamp: number): string {
  const diff = timestamp - Date.now();
  if (diff <= 0) return "";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}分钟后`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时后`;
  const days = Math.floor(hours / 24);
  return `${days}天后`;
}

function formatOverdue(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff <= 0) return "";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

/* ─── Main Component ─── */

export function SmartReviewPanel() {
  const { t } = useTranslation();
  const books = useLibraryStore((s) => s.books);

  const [dueReviews, setDueReviews] = useState<ReviewItem[]>([]);
  const [upcomingReviews, setUpcomingReviews] = useState<ReviewItem[]>([]);
  const [stats, setStats] = useState(smartReviewSystem.getStats());
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshData = useCallback(() => {
    setDueReviews(smartReviewSystem.getDueReviews());
    setUpcomingReviews(smartReviewSystem.getUpcomingReviews(5));
    setStats(smartReviewSystem.getStats());
  }, []);

  useEffect(() => {
    refreshData();
    const unsubscribe = smartReviewSystem.subscribe(refreshData);
    return () => {
      unsubscribe();
    };
  }, [refreshData]);

  const bookMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const book of books) {
      map.set(book.id, book.meta.title);
    }
    return map;
  }, [books]);

  const handleCompleteReview = useCallback(async (id: string, quality: ReviewQuality) => {
    setLoading(true);
    try {
      smartReviewSystem.completeReview(id, quality, {
        enabled: true,
        algorithm: "hybrid",
        intervals: [],
        autoAdjust: true,
        showBadges: false,
      });
      setReviewingId(null);
      refreshData();
    } finally {
      setLoading(false);
    }
  }, [refreshData]);

  const handleSkipReview = useCallback((id: string) => {
    smartReviewSystem.skipReview(id);
    setReviewingId(null);
    refreshData();
  }, [refreshData]);

  const hasDue = dueReviews.length > 0;
  const hasUpcoming = upcomingReviews.length > 0;
  const isEmpty = !hasDue && !hasUpcoming && stats.total === 0;

  return (
    <StatsCard>
      <SectionHeader
        title={t("review.title", "智能复习")}
        action={
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Brain className="h-3.5 w-3.5 text-primary" />
            {t("review.algorithm", "艾宾浩斯")}
          </span>
        }
      />

      {isEmpty ? (
        <div className="py-6 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/30" />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("review.empty", "阅读完章节后，复习提醒会自动出现在这里")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Stats row */}
          <div className="flex gap-3">
            <div className="flex-1 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/20">
              <div className="text-lg font-bold text-amber-600">{stats.due}</div>
              <div className="text-[10px] text-amber-600/70">{t("review.due", "待复习")}</div>
            </div>
            <div className="flex-1 rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/20">
              <div className="text-lg font-bold text-emerald-600">{stats.completed}</div>
              <div className="text-[10px] text-emerald-600/70">{t("review.completed", "已完成")}</div>
            </div>
            <div className="flex-1 rounded-lg bg-muted px-3 py-2">
              <div className="text-lg font-bold text-muted-foreground">{stats.total}</div>
              <div className="text-[10px] text-muted-foreground/70">{t("review.total", "总计")}</div>
            </div>
          </div>

          {/* Due reviews */}
          {hasDue && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-amber-600">
                {t("review.dueNow", "需要复习")}
              </h4>
              {dueReviews.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-amber-200/50 bg-amber-50/50 p-2.5 dark:border-amber-800/30 dark:bg-amber-950/10"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">
                        {item.chapterTitle}
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {bookMap.get(item.bookId) || "..."}
                      </div>
                      <div className="mt-0.5 text-[10px] text-amber-600">
                        {formatOverdue(item.scheduledDate)}
                      </div>
                    </div>
                    {reviewingId === item.id ? (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-[9px] text-muted-foreground">
                          {t("review.qualityHint", "你对这部分内容的记忆如何？")}
                        </p>
                        <div className="flex flex-col gap-0.5">
                          {QUALITY_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              disabled={loading}
                              className={cn(
                                "flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors",
                                opt.color,
                              )}
                              onClick={() => handleCompleteReview(item.id, opt.value)}
                            >
                              <span>{opt.emoji}</span>
                              <span>{t(opt.descKey, opt.value === "excellent" ? "完全掌握" : opt.value === "good" ? "还有印象" : opt.value === "fair" ? "有些模糊" : "需要重读")}</span>
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="flex items-center gap-1 self-center text-[10px] text-muted-foreground hover:text-foreground"
                          onClick={() => handleSkipReview(item.id)}
                        >
                          <SkipForward className="h-3 w-3" />
                          {t("review.skip", "跳过")}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="shrink-0 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
                        onClick={() => setReviewingId(item.id)}
                      >
                        {t("review.start", "复习")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Upcoming reviews */}
          {hasUpcoming && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-muted-foreground">
                {t("review.upcoming", "即将复习")}
              </h4>
              {upcomingReviews.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">
                      {item.chapterTitle}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {bookMap.get(item.bookId) || "..."}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    <Clock className="mr-0.5 inline h-3 w-3" />
                    {formatDueTime(item.scheduledDate)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </StatsCard>
  );
}
