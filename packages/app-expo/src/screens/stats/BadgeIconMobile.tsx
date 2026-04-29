/**
 * BadgeIconMobile.tsx — Rich SVG badge renderer for React Native.
 *
 * Gradient coin base + decorative ring + large center icon + number tag.
 * Mirrors the desktop BadgeIcon but uses react-native-svg primitives.
 */
import {
  BookOpenIcon,
  BrainIcon,
  CalendarIcon,
  ClockIcon,
  EditIcon,
  FlameIcon,
  MoonIcon,
  SunIcon,
  SwordsIcon,
  TrendingUpIcon,
  TrophyIcon,
} from "@/components/ui/Icon";
import type { BadgeDefinition } from "@readany/core/stats";
import { BADGE_NUMBERS } from "@readany/core/stats";
import { Text, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Stop } from "react-native-svg";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  flame: FlameIcon,
  library: BookOpenIcon,
  clock: ClockIcon,
  trophy: TrophyIcon,
  brain: BrainIcon,
  moon: MoonIcon,
  sunrise: SunIcon,
  swords: SwordsIcon,
  calendar: CalendarIcon,
  pencil: EditIcon,
  "book-open": BookOpenIcon,
};

interface TierPalette {
  baseFrom: string;
  baseTo: string;
  innerFrom: string;
  innerTo: string;
  ringStroke: string;
  numBg: string;
  numText: string;
  iconColor: string;
  glow: string;
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
    glow: "rgba(184,115,51,0.35)",
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

export function BadgeIconMobile({
  badge,
  isEarned,
  size = 72,
}: {
  badge: BadgeDefinition;
  isEarned: boolean;
  size?: number;
}) {
  const p = PALETTES[badge.tier] ?? PALETTES.bronze;
  const Icon = ICON_MAP[badge.icon] ?? FlameIcon;
  const num = BADGE_NUMBERS[badge.id];
  const c = size / 2;
  const outerR = size * 0.46;
  const innerR = size * 0.36;
  const ringR = size * 0.41;
  const iconSize = size * 0.3;
  const bid = `b-${badge.id}`;
  const glowInset = size * 0.14;

  if (!isEarned) {
    return (
      <View style={{ width: size, height: size, position: "relative" }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle cx={c} cy={c} r={outerR} fill="#e4e4e7" />
          <Circle cx={c} cy={c} r={innerR} fill="#f4f4f5" />
          <Circle
            cx={c}
            cy={c}
            r={ringR}
            fill="none"
            strokeWidth={0.8}
            stroke="#d4d4d8"
            strokeDasharray="3 3"
          />
        </Svg>
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.2,
          }}
        >
          <Icon size={iconSize} color="#a1a1aa" />
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        position: "relative",
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: glowInset,
          right: glowInset,
          bottom: glowInset,
          left: glowInset,
          borderRadius: 999,
          backgroundColor: p.glow,
          opacity: 0.42,
          transform: [{ scale: 1.18 }],
          shadowColor: p.glow,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.95,
          shadowRadius: 14,
          elevation: 8,
        }}
      />

      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ zIndex: 1 }}>
        <Defs>
          <RadialGradient id={`${bid}-base`} cx="35%" cy="30%" r="70%">
            <Stop offset="0%" stopColor={p.baseFrom} />
            <Stop offset="100%" stopColor={p.baseTo} />
          </RadialGradient>
          <RadialGradient id={`${bid}-inner`} cx="40%" cy="35%" r="65%">
            <Stop offset="0%" stopColor={p.innerFrom} />
            <Stop offset="100%" stopColor={p.innerTo} />
          </RadialGradient>
        </Defs>

        {/* Outer coin */}
        <Circle cx={c} cy={c} r={outerR} fill={`url(#${bid}-base)`} />

        {/* Decorative ring */}
        <Circle
          cx={c}
          cy={c}
          r={ringR}
          fill="none"
          strokeWidth={1}
          stroke={p.ringStroke}
          strokeDasharray="4 2"
        />

        {/* Inner disc */}
        <Circle cx={c} cy={c} r={innerR} fill={`url(#${bid}-inner)`} />

        {/* Top-left highlight */}
        <Ellipse
          cx={c - size * 0.1}
          cy={c - size * 0.12}
          rx={size * 0.12}
          ry={size * 0.07}
          fill="rgba(255,255,255,0.35)"
        />
      </Svg>

      {/* Center icon — bigger when no number tag */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: num ? size * 0.06 : 0,
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
        }}
      >
        <Icon size={num ? iconSize : iconSize * 1.2} color={p.iconColor} />
      </View>

      {/* Number tag — only when there's an actual number */}
      {num ? (
        <View
          style={{
            position: "absolute",
            bottom: size * 0.04,
            alignSelf: "center",
            left: "50%",
            transform: [{ translateX: -(size * 0.16) }],
            minWidth: size * 0.32,
            height: size * 0.2,
            borderRadius: size * 0.1,
            backgroundColor: p.numBg,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 4,
            zIndex: 3,
          }}
        >
          <Text style={{ fontSize: size * 0.13, fontWeight: "800", color: p.numText }}>{num}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function BadgeBackIconMobile({
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
  const bid = `bb-${badge.id}`;

  if (!isEarned) {
    return (
      <View style={{ width: size, height: size, position: "relative" }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle cx={c} cy={c} r={outerR} fill="#e4e4e7" />
          <Circle cx={c} cy={c} r={innerR} fill="#f4f4f5" />
          <Circle
            cx={c}
            cy={c}
            r={ringR}
            fill="none"
            strokeWidth={0.8}
            stroke="#d4d4d8"
            strokeDasharray="3 3"
          />
          <Circle cx={c} cy={c} r={crestR} fill="#e5e7eb" />
          <Circle cx={c} cy={c} r={crestR * 1.55} fill="none" strokeWidth={1} stroke="#d4d4d8" />
        </Svg>
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.2,
          }}
        >
          <TrendingUpIcon size={size * 0.18} color="#a1a1aa" />
        </View>
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: size * 0.14,
          right: size * 0.14,
          bottom: size * 0.14,
          left: size * 0.14,
          borderRadius: 999,
          backgroundColor: p.glow,
          opacity: 0.42,
          transform: [{ scale: 1.18 }],
          shadowColor: p.glow,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.95,
          shadowRadius: 14,
          elevation: 8,
        }}
      />

      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ zIndex: 1 }}>
        <Defs>
          <RadialGradient id={`${bid}-base`} cx="60%" cy="35%" r="72%">
            <Stop offset="0%" stopColor={p.baseTo} />
            <Stop offset="100%" stopColor={p.baseFrom} />
          </RadialGradient>
          <RadialGradient id={`${bid}-inner`} cx="55%" cy="38%" r="68%">
            <Stop offset="0%" stopColor={p.innerTo} />
            <Stop offset="100%" stopColor={p.innerFrom} />
          </RadialGradient>
        </Defs>

        <Circle cx={c} cy={c} r={outerR} fill={`url(#${bid}-base)`} />
        <Circle
          cx={c}
          cy={c}
          r={outerR * 0.92}
          fill="none"
          strokeWidth={0.9}
          stroke="rgba(255,255,255,0.14)"
          strokeDasharray="1.4 3.6"
        />
        <Circle
          cx={c}
          cy={c}
          r={ringR}
          fill="none"
          strokeWidth={1}
          stroke={p.ringStroke}
          strokeDasharray="2.5 3"
        />
        <Circle cx={c} cy={c} r={innerR} fill={`url(#${bid}-inner)`} />
        <Circle
          cx={c}
          cy={c}
          r={innerR * 0.72}
          fill="none"
          strokeWidth={0.8}
          stroke="rgba(255,255,255,0.12)"
          strokeDasharray="3 2.4"
        />
        <Circle
          cx={c}
          cy={c}
          r={crestR * 1.55}
          fill="none"
          strokeWidth={1.2}
          stroke="rgba(255,255,255,0.22)"
        />
        <Circle cx={c} cy={c} r={crestR} fill="rgba(255,255,255,0.12)" />
        <Circle cx={c} cy={c - ringR * 0.82} r={studR} fill="rgba(255,255,255,0.24)" />
        <Circle cx={c + ringR * 0.82} cy={c} r={studR} fill="rgba(255,255,255,0.18)" />
        <Circle cx={c} cy={c + ringR * 0.82} r={studR} fill="rgba(255,255,255,0.2)" />
        <Circle cx={c - ringR * 0.82} cy={c} r={studR} fill="rgba(255,255,255,0.16)" />
        <Ellipse
          cx={c - size * 0.08}
          cy={c - size * 0.11}
          rx={size * 0.1}
          ry={size * 0.06}
          fill="rgba(255,255,255,0.16)"
        />
        <Path
          d={`M ${c - size * 0.16} ${c + size * 0.2} Q ${c} ${c + size * 0.26} ${c + size * 0.16} ${c + size * 0.2}`}
          fill="none"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth={1}
          strokeLinecap="round"
        />
      </Svg>

      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
        }}
      >
        <TrendingUpIcon size={size * 0.18} color="rgba(255,255,255,0.32)" />
      </View>
    </View>
  );
}
