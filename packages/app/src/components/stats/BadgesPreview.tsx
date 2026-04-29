/**
 * BadgesPreview.tsx — Compact badge summary for the Stats page sidebar.
 * Horizontal scroll of earned badges.
 */
import type { EarnedBadge } from "@readany/core/stats";
import { BadgeIcon } from "./BadgeIcon";
import type { StatsCopy } from "./stats-copy";

export function BadgesPreview({
  earned,
  copy,
  t,
  onViewAll,
}: {
  earned: EarnedBadge[];
  copy: StatsCopy;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onViewAll: () => void;
}) {
  if (earned.length === 0) {
    return <p className="py-3 text-center text-[13px] text-muted-foreground/40">{copy.noBadges}</p>;
  }

  return (
    <div className="space-y-3">
      {/* Header — only when there are badges */}
      <div className="flex items-center">
        <span className="text-[13px] font-medium text-foreground/60">
          {t("stats.desktop.badgesEarnedCount", { count: earned.length })}
        </span>
      </div>

      {/* Earned badges scroll */}
      <div className="flex gap-4 overflow-x-auto pb-1 scrollbar-none">
        {earned.slice(0, 6).map((badge) => (
          <button
            key={badge.id}
            onClick={onViewAll}
            className="group flex shrink-0 flex-col items-center gap-1.5 transition-transform hover:scale-105"
          >
            <BadgeIcon badge={badge} isEarned size={64} />
            <span className="max-w-[60px] truncate text-center text-[10px] font-semibold text-foreground/55">
              {t(`stats.desktop.badge_${badge.id}_title`)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
