/**
 * BadgesSection.tsx — Premium achievement badges for the Stats page.
 *
 * Shield-shaped badges with radial metallic gradients, glow, and large icons.
 * Inspired by Duolingo/gaming achievement UI.
 */
import type { BadgeDefinition, EarnedBadge } from "@readany/core/stats";
import { cn } from "@readany/core/utils";
import {
  BookOpenText,
  Brain,
  Clock3,
  Flame,
  LibraryBig,
  Moon,
  Sunrise,
  Swords,
  Trophy,
} from "lucide-react";
import type { StatsCopy } from "./stats-copy";

const ICON_MAP: Record<
  string,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  flame: Flame,
  library: LibraryBig,
  clock: Clock3,
  trophy: Trophy,
  brain: Brain,
  moon: Moon,
  sunrise: Sunrise,
  swords: Swords,
  "book-open": BookOpenText,
};

/* ─── Tier visual themes ─── */

interface TierTheme {
  // Radial gradient for the shield face
  bgFrom: string;
  bgMid: string;
  bgTo: string;
  // Ring/border
  ringFrom: string;
  ringTo: string;
  // Glow
  glow: string;
  // Icon color
  iconColor: string;
  // Highlight spot
  highlight: string;
}

const TIER: Record<string, TierTheme> = {
  bronze: {
    bgFrom: "#e8a85c",
    bgMid: "#cd7f32",
    bgTo: "#8b5e3c",
    ringFrom: "#d4954a",
    ringTo: "#7a4f2e",
    glow: "rgba(205,127,50,0.35)",
    iconColor: "#fff8ee",
    highlight: "rgba(255,240,210,0.5)",
  },
  silver: {
    bgFrom: "#e0e0e5",
    bgMid: "#b0b0b8",
    bgTo: "#78787f",
    ringFrom: "#c8c8d0",
    ringTo: "#6e6e76",
    glow: "rgba(180,180,195,0.4)",
    iconColor: "#f8f8fa",
    highlight: "rgba(255,255,255,0.6)",
  },
  gold: {
    bgFrom: "#ffe566",
    bgMid: "#f0c030",
    bgTo: "#b8860b",
    ringFrom: "#ffd700",
    ringTo: "#9a7209",
    glow: "rgba(255,215,0,0.45)",
    iconColor: "#fffdf0",
    highlight: "rgba(255,255,230,0.7)",
  },
};

const SIZE = 80;
const ICON_SIZE = "h-7 w-7"; // larger icons

/* ─── Hexagonal shield path ─── */

function hexPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    // Rotate -90° so flat top
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return `M${pts.join("L")}Z`;
}

/* ─── Component ─── */

export function BadgesSection({
  earned,
  allBadges,
  copy,
  t,
}: {
  earned: EarnedBadge[];
  allBadges: BadgeDefinition[];
  copy: StatsCopy;
  t: (key: string) => string;
}) {
  const earnedIds = new Set(earned.map((b) => b.id));

  if (allBadges.length === 0) {
    return <p className="py-6 text-center text-[13px] text-muted-foreground/45">{copy.noBadges}</p>;
  }

  return (
    <div className="grid grid-cols-5 gap-x-3 gap-y-5">
      {allBadges.map((badge) => {
        const isEarned = earnedIds.has(badge.id);
        const theme = TIER[badge.tier] ?? TIER.bronze;
        const Icon = ICON_MAP[badge.icon] ?? Flame;
        const gradId = `bg-${badge.id}`;
        const ringGradId = `ring-${badge.id}`;
        const center = SIZE / 2;
        const outerR = 34;
        const innerR = 29;

        return (
          <div
            key={badge.id}
            className={cn(
              "group flex flex-col items-center gap-2 transition-all duration-300",
              isEarned ? "hover:scale-110 cursor-default" : "opacity-20 grayscale saturate-0",
            )}
            title={isEarned ? t(`stats.desktop.badge_${badge.id}_desc`) : undefined}
          >
            {/* Shield badge */}
            <div
              className="relative"
              style={
                isEarned
                  ? {
                      filter: `drop-shadow(0 2px 6px ${theme.glow}) drop-shadow(0 0 12px ${theme.glow})`,
                    }
                  : undefined
              }
            >
              <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
                <defs>
                  {/* Radial metallic gradient for face */}
                  <radialGradient id={gradId} cx="40%" cy="35%" r="65%" fx="35%" fy="30%">
                    <stop offset="0%" stopColor={isEarned ? theme.bgFrom : "#e4e4e7"} />
                    <stop offset="50%" stopColor={isEarned ? theme.bgMid : "#c8c8cc"} />
                    <stop offset="100%" stopColor={isEarned ? theme.bgTo : "#a1a1a5"} />
                  </radialGradient>
                  {/* Ring gradient */}
                  <linearGradient id={ringGradId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={isEarned ? theme.ringFrom : "#b0b0b5"} />
                    <stop offset="100%" stopColor={isEarned ? theme.ringTo : "#88888d"} />
                  </linearGradient>
                </defs>

                {/* Outer ring — hexagonal */}
                <path d={hexPath(center, center, outerR)} fill={`url(#${ringGradId})`} />

                {/* Inner face — hexagonal */}
                <path d={hexPath(center, center, innerR)} fill={`url(#${gradId})`} />

                {/* Highlight spot — top-left reflection */}
                {isEarned && (
                  <ellipse
                    cx={center - 8}
                    cy={center - 10}
                    rx={8}
                    ry={5}
                    fill={theme.highlight}
                    opacity={0.6}
                  />
                )}
              </svg>

              {/* Icon — large, centered */}
              <div className="absolute inset-0 flex items-center justify-center pt-0.5">
                <Icon
                  className={cn(
                    ICON_SIZE,
                    "drop-shadow-sm transition-transform group-hover:scale-110",
                  )}
                  style={{ color: isEarned ? theme.iconColor : "#a1a1aa" }}
                />
              </div>
            </div>

            {/* Label */}
            <span
              className={cn(
                "max-w-[72px] text-center text-[11px] font-semibold leading-tight",
                isEarned ? "text-foreground/70" : "text-muted-foreground/25",
              )}
            >
              {t(`stats.desktop.badge_${badge.id}_title`)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
