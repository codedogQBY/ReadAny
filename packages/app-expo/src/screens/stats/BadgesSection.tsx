import { BookOpenIcon, ClockIcon, FlameIcon, TrendingUpIcon } from "@/components/ui/Icon";
/**
 * BadgesSection.tsx — Premium achievement badges for mobile Stats screen.
 * Hexagonal shield badges with metallic gradients and large icons.
 */
import { useColors, withOpacity } from "@/styles/theme";
import type { BadgeDefinition, EarnedBadge } from "@readany/core/stats";
import { Text, View } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop } from "react-native-svg";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  flame: FlameIcon,
  library: BookOpenIcon,
  clock: ClockIcon,
  trophy: TrendingUpIcon,
  brain: ClockIcon,
  moon: ClockIcon,
  sunrise: FlameIcon,
  swords: TrendingUpIcon,
  "book-open": BookOpenIcon,
};

/* ─── Tier themes ─── */

interface TierTheme {
  bgFrom: string;
  bgMid: string;
  bgTo: string;
  ringFrom: string;
  ringTo: string;
  glow: string;
  iconColor: string;
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

/* ─── Hex path ─── */

function hexPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return `M${pts.join("L")}Z`;
}

const SIZE = 66;
const OUTER_R = 28;
const INNER_R = 24;
const CENTER = SIZE / 2;

/* ─── Component ─── */

export function BadgesSection({
  earned,
  allBadges,
  t,
}: {
  earned: EarnedBadge[];
  allBadges: BadgeDefinition[];
  t: (key: string) => string;
}) {
  const colors = useColors();
  const earnedIds = new Set(earned.map((b) => b.id));

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 4 }}>
      {allBadges.map((badge) => {
        const isEarned = earnedIds.has(badge.id);
        const theme = TIER[badge.tier] ?? TIER.bronze;
        const Icon = ICON_MAP[badge.icon] ?? FlameIcon;
        const gradId = `bg-${badge.id}`;
        const ringGradId = `rg-${badge.id}`;

        return (
          <View
            key={badge.id}
            style={{
              width: "22%",
              alignItems: "center",
              gap: 4,
              paddingVertical: 6,
              opacity: isEarned ? 1 : 0.2,
            }}
          >
            <View
              style={
                isEarned
                  ? {
                      shadowColor: theme.glow,
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 1,
                      shadowRadius: 10,
                      elevation: 5,
                    }
                  : undefined
              }
            >
              <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
                <Defs>
                  <RadialGradient id={gradId} cx="40%" cy="35%" r="65%" fx="35%" fy="30%">
                    <Stop offset="0%" stopColor={isEarned ? theme.bgFrom : "#e4e4e7"} />
                    <Stop offset="50%" stopColor={isEarned ? theme.bgMid : "#c8c8cc"} />
                    <Stop offset="100%" stopColor={isEarned ? theme.bgTo : "#a1a1a5"} />
                  </RadialGradient>
                  <LinearGradient id={ringGradId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <Stop offset="0%" stopColor={isEarned ? theme.ringFrom : "#b0b0b5"} />
                    <Stop offset="100%" stopColor={isEarned ? theme.ringTo : "#88888d"} />
                  </LinearGradient>
                </Defs>

                {/* Outer ring */}
                <Path d={hexPath(CENTER, CENTER, OUTER_R)} fill={`url(#${ringGradId})`} />

                {/* Inner face */}
                <Path d={hexPath(CENTER, CENTER, INNER_R)} fill={`url(#${gradId})`} />

                {/* Highlight spot */}
                {isEarned && (
                  <Ellipse
                    cx={CENTER - 6}
                    cy={CENTER - 8}
                    rx={6}
                    ry={4}
                    fill={theme.highlight}
                    opacity={0.6}
                  />
                )}
              </Svg>

              {/* Icon */}
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon size={22} color={isEarned ? theme.iconColor : "#a1a1aa"} />
              </View>
            </View>

            {/* Label */}
            <Text
              style={{
                fontSize: 9,
                fontWeight: "600",
                color: isEarned
                  ? withOpacity(colors.foreground, 0.7)
                  : withOpacity(colors.mutedForeground, 0.25),
                textAlign: "center",
                lineHeight: 12,
              }}
              numberOfLines={2}
            >
              {t(`stats.desktop.badge_${badge.id}_title`)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
