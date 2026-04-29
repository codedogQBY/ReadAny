/**
 * BadgeIcon.tsx — Rich SVG badge renderer for desktop.
 *
 * Each badge = gradient circle base + inner decorative ring + large center icon + number tag.
 * Tier determines: color palette, glow intensity, ring style.
 * Inspired by WeChat Read medal system — each badge feels like a collectible coin.
 */
import type { BadgeDefinition } from "@readany/core/stats";
import { BADGE_NUMBERS } from "@readany/core/stats";
import {
  BookOpenText,
  Brain,
  CalendarDays,
  Clock3,
  Flame,
  LibraryBig,
  Moon,
  Pencil,
  Sunrise,
  Swords,
  Trophy,
} from "lucide-react";

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
  calendar: CalendarDays,
  pencil: Pencil,
};

/* ─── Tier palettes ─── */

interface TierPalette {
  baseFrom: string; // outer gradient start
  baseTo: string; // outer gradient end
  innerFrom: string; // inner disc gradient start
  innerTo: string; // inner disc gradient end
  ringStroke: string; // decorative inner ring
  numBg: string; // number tag background
  numText: string; // number tag text
  iconColor: string; // center icon
  glow: string; // drop-shadow
}

const PALETTES: Record<string, TierPalette> = {
  bronze: {
    baseFrom: "#b87333",
    baseTo: "#7a4f2e",
    innerFrom: "#e8c9a0",
    innerTo: "#c49a6c",
    ringStroke: "rgba(122,79,46,0.4)",
    numBg: "#7a4f2e",
    numText: "#fff8ee",
    iconColor: "#5c3a1e",
    glow: "rgba(184,115,51,0.3)",
  },
  silver: {
    baseFrom: "#b8bcc5",
    baseTo: "#7a7d85",
    innerFrom: "#e8eaef",
    innerTo: "#b0b3bb",
    ringStroke: "rgba(120,125,133,0.35)",
    numBg: "#6b6e76",
    numText: "#f0f1f3",
    iconColor: "#4a4d54",
    glow: "rgba(150,153,165,0.35)",
  },
  gold: {
    baseFrom: "#f0c030",
    baseTo: "#b8860b",
    innerFrom: "#fff8d6",
    innerTo: "#f0d060",
    ringStroke: "rgba(184,134,11,0.35)",
    numBg: "#9a7209",
    numText: "#fffdf0",
    iconColor: "#7a5a08",
    glow: "rgba(240,192,48,0.4)",
  },
  platinum: {
    baseFrom: "#e8ecf0",
    baseTo: "#a0b0c0",
    innerFrom: "#f5f7fa",
    innerTo: "#d0d8e0",
    ringStroke: "rgba(100,140,180,0.3)",
    numBg: "#708090",
    numText: "#f8fafc",
    iconColor: "#4a6070",
    glow: "rgba(120,160,200,0.35)",
  },
  diamond: {
    baseFrom: "#7dd3fc",
    baseTo: "#0284c7",
    innerFrom: "#e0f2fe",
    innerTo: "#7dd3fc",
    ringStroke: "rgba(2,132,199,0.3)",
    numBg: "#0369a1",
    numText: "#f0f9ff",
    iconColor: "#075985",
    glow: "rgba(56,189,248,0.4)",
  },
  legendary: {
    baseFrom: "#c084fc",
    baseTo: "#7c3aed",
    innerFrom: "#f3e8ff",
    innerTo: "#c4b5fd",
    ringStroke: "rgba(124,58,237,0.3)",
    numBg: "#6d28d9",
    numText: "#faf5ff",
    iconColor: "#5b21b6",
    glow: "rgba(167,139,250,0.45)",
  },
};

/* ─── Badge SVG component ─── */

export function BadgeIcon({
  badge,
  isEarned,
  size = 72,
}: {
  badge: BadgeDefinition;
  isEarned: boolean;
  size?: number;
}) {
  const p = PALETTES[badge.tier] ?? PALETTES.bronze;
  const Icon = ICON_MAP[badge.icon] ?? Flame;
  const num = BADGE_NUMBERS[badge.id];
  const c = size / 2;
  const outerR = size * 0.46;
  const innerR = size * 0.36;
  const ringR = size * 0.41;
  const iconSize = size * 0.3;
  const baseId = `badge-${badge.id}`;
  const glowInset = size * 0.14;

  if (!isEarned) {
    return (
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={c} cy={c} r={outerR} fill="#e4e4e7" />
          <circle cx={c} cy={c} r={innerR} fill="#f4f4f5" />
          <circle
            cx={c}
            cy={c}
            r={ringR}
            fill="none"
            strokeWidth={0.8}
            stroke="#d4d4d8"
            strokeDasharray="3 3"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center opacity-20">
          <Icon style={{ width: iconSize, height: iconSize, color: "#a1a1aa" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{
          inset: glowInset,
          background: `radial-gradient(circle, ${p.glow} 0%, ${p.glow} 48%, transparent 76%)`,
          filter: "blur(10px)",
          opacity: 0.95,
          transform: "scale(1.22)",
        }}
      />

      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="relative z-[1]">
        <defs>
          {/* Outer base gradient */}
          <radialGradient id={`${baseId}-base`} cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor={p.baseFrom} />
            <stop offset="100%" stopColor={p.baseTo} />
          </radialGradient>
          {/* Inner disc gradient */}
          <radialGradient id={`${baseId}-inner`} cx="40%" cy="35%" r="65%">
            <stop offset="0%" stopColor={p.innerFrom} />
            <stop offset="100%" stopColor={p.innerTo} />
          </radialGradient>
        </defs>

        {/* Outer coin base */}
        <circle cx={c} cy={c} r={outerR} fill={`url(#${baseId}-base)`} />

        {/* Decorative ring */}
        <circle
          cx={c}
          cy={c}
          r={ringR}
          fill="none"
          strokeWidth={1}
          stroke={p.ringStroke}
          strokeDasharray="4 2"
        />

        {/* Inner disc */}
        <circle cx={c} cy={c} r={innerR} fill={`url(#${baseId}-inner)`} />

        {/* Top-left highlight */}
        <ellipse
          cx={c - size * 0.1}
          cy={c - size * 0.12}
          rx={size * 0.12}
          ry={size * 0.07}
          fill="rgba(255,255,255,0.35)"
        />
      </svg>

      {/* Center icon — bigger when no number tag */}
      <div
        className="absolute inset-0 z-[2] flex items-center justify-center"
        style={{ paddingBottom: num ? size * 0.06 : 0 }}
      >
        <Icon
          style={{
            width: num ? iconSize : iconSize * 1.2,
            height: num ? iconSize : iconSize * 1.2,
            color: p.iconColor,
          }}
        />
      </div>

      {/* Number tag at bottom — only when there's an actual number */}
      {num ? (
        <div
          className="absolute left-1/2 z-[3] flex -translate-x-1/2 items-center justify-center rounded-full"
          style={{
            bottom: size * 0.04,
            minWidth: size * 0.32,
            height: size * 0.2,
            backgroundColor: p.numBg,
            paddingInline: 4,
          }}
        >
          <span
            className="font-bold tabular-nums leading-none"
            style={{ fontSize: size * 0.13, color: p.numText }}
          >
            {num}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function BadgeBackIcon({
  badge,
  isEarned,
  size = 72,
}: {
  badge: BadgeDefinition;
  isEarned: boolean;
  size?: number;
}) {
  const p = PALETTES[badge.tier] ?? PALETTES.bronze;
  const c = size / 2;
  const outerR = size * 0.46;
  const innerR = size * 0.36;
  const ringR = size * 0.41;
  const crestR = size * 0.12;
  const studR = size * 0.022;
  const baseId = `badge-back-${badge.id}`;

  if (!isEarned) {
    return (
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={c} cy={c} r={outerR} fill="#e4e4e7" />
          <circle cx={c} cy={c} r={innerR} fill="#f4f4f5" />
          <circle
            cx={c}
            cy={c}
            r={ringR}
            fill="none"
            strokeWidth={0.8}
            stroke="#d4d4d8"
            strokeDasharray="3 3"
          />
          <circle cx={c} cy={c} r={crestR} fill="#e5e7eb" />
          <circle cx={c} cy={c} r={crestR * 1.55} fill="none" strokeWidth={1} stroke="#d4d4d8" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center opacity-18">
          <Trophy style={{ width: size * 0.18, height: size * 0.18, color: "#a1a1aa" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{
          inset: size * 0.14,
          background: `radial-gradient(circle, ${p.glow} 0%, ${p.glow} 48%, transparent 76%)`,
          filter: "blur(10px)",
          opacity: 0.9,
          transform: "scale(1.18)",
        }}
      />

      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="relative z-[1]">
        <defs>
          <radialGradient id={`${baseId}-base`} cx="60%" cy="35%" r="72%">
            <stop offset="0%" stopColor={p.baseTo} />
            <stop offset="100%" stopColor={p.baseFrom} />
          </radialGradient>
          <radialGradient id={`${baseId}-inner`} cx="55%" cy="38%" r="68%">
            <stop offset="0%" stopColor={p.innerTo} />
            <stop offset="100%" stopColor={p.innerFrom} />
          </radialGradient>
        </defs>

        <circle cx={c} cy={c} r={outerR} fill={`url(#${baseId}-base)`} />
        <circle
          cx={c}
          cy={c}
          r={outerR * 0.92}
          fill="none"
          strokeWidth={0.9}
          stroke="rgba(255,255,255,0.14)"
          strokeDasharray="1.4 3.6"
        />
        <circle
          cx={c}
          cy={c}
          r={ringR}
          fill="none"
          strokeWidth={1}
          stroke={p.ringStroke}
          strokeDasharray="2.5 3"
        />
        <circle cx={c} cy={c} r={innerR} fill={`url(#${baseId}-inner)`} />
        <circle
          cx={c}
          cy={c}
          r={innerR * 0.72}
          fill="none"
          strokeWidth={0.8}
          stroke="rgba(255,255,255,0.12)"
          strokeDasharray="3 2.4"
        />
        <circle
          cx={c}
          cy={c}
          r={crestR * 1.55}
          fill="none"
          strokeWidth={1.2}
          stroke="rgba(255,255,255,0.22)"
        />
        <circle cx={c} cy={c} r={crestR} fill="rgba(255,255,255,0.12)" />
        <circle cx={c} cy={c - ringR * 0.82} r={studR} fill="rgba(255,255,255,0.24)" />
        <circle cx={c + ringR * 0.82} cy={c} r={studR} fill="rgba(255,255,255,0.18)" />
        <circle cx={c} cy={c + ringR * 0.82} r={studR} fill="rgba(255,255,255,0.2)" />
        <circle cx={c - ringR * 0.82} cy={c} r={studR} fill="rgba(255,255,255,0.16)" />
        <ellipse
          cx={c - size * 0.08}
          cy={c - size * 0.11}
          rx={size * 0.1}
          ry={size * 0.06}
          fill="rgba(255,255,255,0.16)"
        />
        <path
          d={`M ${c - size * 0.16} ${c + size * 0.2} Q ${c} ${c + size * 0.26} ${c + size * 0.16} ${c + size * 0.2}`}
          fill="none"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth={1}
          strokeLinecap="round"
        />
      </svg>

      <div className="absolute inset-0 z-[2] flex items-center justify-center">
        <Trophy
          style={{
            width: size * 0.18,
            height: size * 0.18,
            color: "rgba(255,255,255,0.32)",
          }}
        />
      </div>
    </div>
  );
}
