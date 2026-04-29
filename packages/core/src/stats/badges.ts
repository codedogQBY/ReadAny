/**
 * badges.ts — Achievement badge definitions and evaluator.
 *
 * 6-tier system: 青铜 → 白银 → 黄金 → 铂金 → 钻石 → 传奇
 * 8 categories, 39 badges total.
 *
 * Stateless: badges are recalculated from DailyReadingFact[] every time,
 * following the same pattern as buildInsights(). No persistence needed.
 */
import type { DailyReadingFact, StatsSummary } from "./schema";

/* ─── Types ─── */

export type BadgeTier = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "legendary";
export type BadgeCategory =
  | "days"
  | "streak"
  | "time"
  | "books"
  | "completed"
  | "notes"
  | "focus"
  | "special";

export interface BadgeDefinition {
  id: string;
  icon: string;
  tier: BadgeTier;
  colorScheme: string;
  category: BadgeCategory;
}

export interface EarnedBadge extends BadgeDefinition {
  earnedAt: string;
  titleKey: string;
  descKey: string;
}

/* ─── Badge catalog ─── */

type CheckFn = (facts: DailyReadingFact[], summary: StatsSummary) => boolean;

interface BadgeDef extends BadgeDefinition {
  check: CheckFn;
}

// Helper: count total active reading days
function countActiveDays(facts: DailyReadingFact[]): number {
  return facts.filter((f) => f.totalTime > 0).length;
}

// Helper: check if any week has 7 reading days
function hasPerfectWeek(facts: DailyReadingFact[]): boolean {
  const byWeek = new Map<string, Set<string>>();
  for (const f of facts) {
    if (f.totalTime <= 0) continue;
    const set = byWeek.get(f.weekKey) ?? new Set();
    set.add(f.date);
    byWeek.set(f.weekKey, set);
  }
  for (const days of byWeek.values()) {
    if (days.size >= 7) return true;
  }
  return false;
}

// Helper: check if read during 3-5am
function hasLateNightReading(facts: DailyReadingFact[]): boolean {
  for (const f of facts) {
    if (!f.hourlyDistribution) continue;
    for (let h = 3; h <= 4; h++) {
      if ((f.hourlyDistribution[h] ?? 0) > 0) return true;
    }
  }
  return false;
}

const BADGE_DEFS: BadgeDef[] = [
  // ━━━━━ 📅 阅读天数 (6 tiers) ━━━━━
  {
    id: "days-10",
    icon: "calendar",
    tier: "bronze",
    colorScheme: "amber",
    category: "days",
    check: (f) => countActiveDays(f) >= 10,
  },
  {
    id: "days-30",
    icon: "calendar",
    tier: "silver",
    colorScheme: "amber",
    category: "days",
    check: (f) => countActiveDays(f) >= 30,
  },
  {
    id: "days-100",
    icon: "calendar",
    tier: "gold",
    colorScheme: "amber",
    category: "days",
    check: (f) => countActiveDays(f) >= 100,
  },
  {
    id: "days-200",
    icon: "calendar",
    tier: "platinum",
    colorScheme: "amber",
    category: "days",
    check: (f) => countActiveDays(f) >= 200,
  },
  {
    id: "days-365",
    icon: "calendar",
    tier: "diamond",
    colorScheme: "amber",
    category: "days",
    check: (f) => countActiveDays(f) >= 365,
  },
  {
    id: "days-1000",
    icon: "calendar",
    tier: "legendary",
    colorScheme: "amber",
    category: "days",
    check: (f) => countActiveDays(f) >= 1000,
  },

  // ━━━━━ 🔥 连续阅读 (5 tiers) ━━━━━
  {
    id: "streak-7",
    icon: "flame",
    tier: "bronze",
    colorScheme: "amber",
    category: "streak",
    check: (_, s) => s.longestStreak >= 7,
  },
  {
    id: "streak-14",
    icon: "flame",
    tier: "silver",
    colorScheme: "amber",
    category: "streak",
    check: (_, s) => s.longestStreak >= 14,
  },
  {
    id: "streak-30",
    icon: "flame",
    tier: "gold",
    colorScheme: "amber",
    category: "streak",
    check: (_, s) => s.longestStreak >= 30,
  },
  {
    id: "streak-100",
    icon: "flame",
    tier: "platinum",
    colorScheme: "amber",
    category: "streak",
    check: (_, s) => s.longestStreak >= 100,
  },
  {
    id: "streak-365",
    icon: "flame",
    tier: "diamond",
    colorScheme: "amber",
    category: "streak",
    check: (_, s) => s.longestStreak >= 365,
  },

  // ━━━━━ ⏱ 阅读时长 (5 tiers) ━━━━━
  {
    id: "time-10h",
    icon: "clock",
    tier: "bronze",
    colorScheme: "emerald",
    category: "time",
    check: (_, s) => s.totalReadingTime >= 600,
  },
  {
    id: "time-50h",
    icon: "clock",
    tier: "silver",
    colorScheme: "emerald",
    category: "time",
    check: (_, s) => s.totalReadingTime >= 3000,
  },
  {
    id: "time-100h",
    icon: "clock",
    tier: "gold",
    colorScheme: "emerald",
    category: "time",
    check: (_, s) => s.totalReadingTime >= 6000,
  },
  {
    id: "time-500h",
    icon: "clock",
    tier: "platinum",
    colorScheme: "emerald",
    category: "time",
    check: (_, s) => s.totalReadingTime >= 30000,
  },
  {
    id: "time-1000h",
    icon: "clock",
    tier: "diamond",
    colorScheme: "emerald",
    category: "time",
    check: (_, s) => s.totalReadingTime >= 60000,
  },

  // ━━━━━ 📚 阅读书籍 (5 tiers) ━━━━━
  {
    id: "books-5",
    icon: "library",
    tier: "bronze",
    colorScheme: "blue",
    category: "books",
    check: (_, s) => s.booksTouched >= 5,
  },
  {
    id: "books-10",
    icon: "library",
    tier: "silver",
    colorScheme: "blue",
    category: "books",
    check: (_, s) => s.booksTouched >= 10,
  },
  {
    id: "books-30",
    icon: "library",
    tier: "gold",
    colorScheme: "blue",
    category: "books",
    check: (_, s) => s.booksTouched >= 30,
  },
  {
    id: "books-50",
    icon: "library",
    tier: "platinum",
    colorScheme: "blue",
    category: "books",
    check: (_, s) => s.booksTouched >= 50,
  },
  {
    id: "books-100",
    icon: "library",
    tier: "diamond",
    colorScheme: "blue",
    category: "books",
    check: (_, s) => s.booksTouched >= 100,
  },

  // ━━━━━ ✅ 读完书籍 (5 tiers) ━━━━━
  {
    id: "completed-1",
    icon: "book-open",
    tier: "bronze",
    colorScheme: "emerald",
    category: "completed",
    check: (_, s) => s.completedBooks >= 1,
  },
  {
    id: "completed-5",
    icon: "book-open",
    tier: "silver",
    colorScheme: "emerald",
    category: "completed",
    check: (_, s) => s.completedBooks >= 5,
  },
  {
    id: "completed-10",
    icon: "book-open",
    tier: "gold",
    colorScheme: "emerald",
    category: "completed",
    check: (_, s) => s.completedBooks >= 10,
  },
  {
    id: "completed-30",
    icon: "book-open",
    tier: "platinum",
    colorScheme: "emerald",
    category: "completed",
    check: (_, s) => s.completedBooks >= 30,
  },
  {
    id: "completed-100",
    icon: "book-open",
    tier: "diamond",
    colorScheme: "emerald",
    category: "completed",
    check: (_, s) => s.completedBooks >= 100,
  },

  // ━━━━━ 📝 笔记高亮 (4 tiers) ━━━━━
  // Note: uses totalPagesRead as proxy for annotations count until real data is wired
  {
    id: "notes-1",
    icon: "pencil",
    tier: "bronze",
    colorScheme: "purple",
    category: "notes",
    check: (_, s) => s.totalPagesRead >= 1,
  },
  {
    id: "notes-10",
    icon: "pencil",
    tier: "silver",
    colorScheme: "purple",
    category: "notes",
    check: (_, s) => s.totalPagesRead >= 10,
  },
  {
    id: "notes-50",
    icon: "pencil",
    tier: "gold",
    colorScheme: "purple",
    category: "notes",
    check: (_, s) => s.totalPagesRead >= 50,
  },
  {
    id: "notes-200",
    icon: "pencil",
    tier: "platinum",
    colorScheme: "purple",
    category: "notes",
    check: (_, s) => s.totalPagesRead >= 200,
  },

  // ━━━━━ 🧠 深度阅读 (4 tiers) ━━━━━
  {
    id: "focus-30m",
    icon: "brain",
    tier: "bronze",
    colorScheme: "purple",
    category: "focus",
    check: (_, s) => s.longestSessionTime >= 30,
  },
  {
    id: "focus-1h",
    icon: "brain",
    tier: "silver",
    colorScheme: "purple",
    category: "focus",
    check: (_, s) => s.longestSessionTime >= 60,
  },
  {
    id: "focus-2h",
    icon: "brain",
    tier: "gold",
    colorScheme: "purple",
    category: "focus",
    check: (_, s) => s.longestSessionTime >= 120,
  },
  {
    id: "focus-3h",
    icon: "brain",
    tier: "platinum",
    colorScheme: "purple",
    category: "focus",
    check: (_, s) => s.longestSessionTime >= 180,
  },

  // ━━━━━ 🌟 特殊习惯 (5 independent) ━━━━━
  {
    id: "early-bird",
    icon: "sunrise",
    tier: "silver",
    colorScheme: "amber",
    category: "special",
    check: (facts) => {
      let morningTime = 0,
        totalTime = 0;
      for (const f of facts) {
        if (!f.hourlyDistribution) continue;
        for (let h = 0; h < 24; h++) {
          const t = f.hourlyDistribution[h] ?? 0;
          totalTime += t;
          if (h >= 4 && h < 8) morningTime += t;
        }
      }
      return totalTime > 60 && morningTime / totalTime > 0.5;
    },
  },
  {
    id: "night-owl",
    icon: "moon",
    tier: "silver",
    colorScheme: "purple",
    category: "special",
    check: (facts) => {
      let nightTime = 0,
        totalTime = 0;
      for (const f of facts) {
        if (!f.hourlyDistribution) continue;
        for (let h = 0; h < 24; h++) {
          const t = f.hourlyDistribution[h] ?? 0;
          totalTime += t;
          if (h >= 22 || h < 4) nightTime += t;
        }
      }
      return totalTime > 60 && nightTime / totalTime > 0.5;
    },
  },
  {
    id: "weekend-warrior",
    icon: "swords",
    tier: "bronze",
    colorScheme: "rose",
    category: "special",
    check: (facts) => {
      let weekendDays = 0,
        totalDays = 0;
      for (const f of facts) {
        if (f.totalTime <= 0) continue;
        totalDays++;
        const d = new Date(f.date.replace(/-/g, "/"));
        if (d.getDay() === 0 || d.getDay() === 6) weekendDays++;
      }
      return totalDays >= 4 && weekendDays / totalDays > 0.7;
    },
  },
  {
    id: "perfect-week",
    icon: "trophy",
    tier: "gold",
    colorScheme: "amber",
    category: "special",
    check: (facts) => hasPerfectWeek(facts),
  },
  {
    id: "midnight-reader",
    icon: "moon",
    tier: "diamond",
    colorScheme: "purple",
    category: "special",
    check: (facts) => hasLateNightReading(facts),
  },
];

/* ─── All badge definitions (for showing unearned) ─── */

export const ALL_BADGE_DEFINITIONS: BadgeDefinition[] = BADGE_DEFS.map(
  ({ id, icon, tier, colorScheme, category }) => ({ id, icon, tier, colorScheme, category }),
);

/* ─── Evaluator ─── */

export function evaluateBadges(facts: DailyReadingFact[], summary: StatsSummary): EarnedBadge[] {
  const earned: EarnedBadge[] = [];
  for (const def of BADGE_DEFS) {
    if (def.check(facts, summary)) {
      earned.push({
        id: def.id,
        icon: def.icon,
        tier: def.tier,
        colorScheme: def.colorScheme,
        category: def.category,
        earnedAt: "lifetime",
        titleKey: `stats.desktop.badge_${def.id}_title`,
        descKey: `stats.desktop.badge_${def.id}_desc`,
      });
    }
  }
  return earned;
}

/* ─── Badge display number ─── */

export const BADGE_NUMBERS: Record<string, string> = {
  "days-10": "10",
  "days-30": "30",
  "days-100": "100",
  "days-200": "200",
  "days-365": "365",
  "days-1000": "1K",
  "streak-7": "7",
  "streak-14": "14",
  "streak-30": "30",
  "streak-100": "100",
  "streak-365": "365",
  "time-10h": "10",
  "time-50h": "50",
  "time-100h": "100",
  "time-500h": "500",
  "time-1000h": "1K",
  "books-5": "5",
  "books-10": "10",
  "books-30": "30",
  "books-50": "50",
  "books-100": "100",
  "completed-1": "1",
  "completed-5": "5",
  "completed-10": "10",
  "completed-30": "30",
  "completed-100": "100",
  "notes-1": "1",
  "notes-10": "10",
  "notes-50": "50",
  "notes-200": "200",
  "focus-30m": "30",
  "focus-1h": "60",
  "focus-2h": "2h",
  "focus-3h": "3h",
  "early-bird": "",
  "night-owl": "",
  "weekend-warrior": "",
  "perfect-week": "",
  "midnight-reader": "",
};

/* ─── Category grouping ─── */

export const BADGE_CATEGORIES: { key: BadgeCategory; titleKey: string }[] = [
  { key: "days", titleKey: "stats.desktop.badgeCategoryDays" },
  { key: "streak", titleKey: "stats.desktop.badgeCategoryStreak" },
  { key: "time", titleKey: "stats.desktop.badgeCategoryTime" },
  { key: "books", titleKey: "stats.desktop.badgeCategoryBooks" },
  { key: "completed", titleKey: "stats.desktop.badgeCategoryCompleted" },
  { key: "notes", titleKey: "stats.desktop.badgeCategoryNotes" },
  { key: "focus", titleKey: "stats.desktop.badgeCategoryFocus" },
  { key: "special", titleKey: "stats.desktop.badgeCategorySpecial" },
];

export function groupBadgesByCategory(
  badges: BadgeDefinition[],
): Map<BadgeCategory, BadgeDefinition[]> {
  const map = new Map<BadgeCategory, BadgeDefinition[]>();
  for (const b of badges) {
    const list = map.get(b.category) ?? [];
    list.push(b);
    map.set(b.category, list);
  }
  return map;
}
