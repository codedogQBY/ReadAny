import { describe, expect, it } from "vitest";
import {
  ALL_BADGE_DEFINITIONS,
  BADGE_CATEGORIES,
  BADGE_NUMBERS,
  evaluateBadges,
  groupBadgesByCategory,
} from "./badges";
import type { DailyReadingFact, StatsSummary } from "./schema";

/* ─── Helpers ─── */

function makeSummary(overrides: Partial<StatsSummary> = {}): StatsSummary {
  return {
    totalReadingTime: 0,
    totalSessions: 0,
    totalPagesRead: 0,
    activeDays: 0,
    booksTouched: 0,
    completedBooks: 0,
    avgSessionTime: 0,
    avgActiveDayTime: 0,
    longestSessionTime: 0,
    currentStreak: 0,
    longestStreak: 0,
    ...overrides,
  };
}

function makeFact(overrides: Partial<DailyReadingFact> = {}): DailyReadingFact {
  return {
    date: "2026-04-13",
    weekKey: "2026-W16",
    monthKey: "2026-04",
    yearKey: "2026",
    totalTime: 30,
    pagesRead: 0,
    sessionsCount: 1,
    booksTouched: 1,
    completedBooks: 0,
    avgSessionTime: 30,
    longestSessionTime: 30,
    hourlyDistribution: Array.from({ length: 24 }, () => 0),
    bookBreakdown: [],
    ...overrides,
  };
}

/** Generate N active-day facts with consecutive dates starting from 2026-01-01 */
function makeActiveDays(n: number): DailyReadingFact[] {
  const facts: DailyReadingFact[] = [];
  const base = new Date(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    facts.push(makeFact({ date: `${yyyy}-${mm}-${dd}`, totalTime: 30 }));
  }
  return facts;
}

/* ─── Catalog tests ─── */

describe("badge catalog", () => {
  it("has 39 badge definitions", () => {
    expect(ALL_BADGE_DEFINITIONS).toHaveLength(39);
  });

  it("every badge has a unique id", () => {
    const ids = ALL_BADGE_DEFINITIONS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every badge has a BADGE_NUMBERS entry", () => {
    for (const b of ALL_BADGE_DEFINITIONS) {
      expect(b.id in BADGE_NUMBERS).toBe(true);
    }
  });

  it("BADGE_CATEGORIES covers all categories used by badges", () => {
    const catKeys = new Set(BADGE_CATEGORIES.map((c) => c.key));
    for (const b of ALL_BADGE_DEFINITIONS) {
      expect(catKeys.has(b.category)).toBe(true);
    }
  });

  it("groupBadgesByCategory groups correctly", () => {
    const map = groupBadgesByCategory(ALL_BADGE_DEFINITIONS);
    expect(map.get("days")?.length).toBe(6);
    expect(map.get("streak")?.length).toBe(5);
    expect(map.get("time")?.length).toBe(5);
    expect(map.get("books")?.length).toBe(5);
    expect(map.get("completed")?.length).toBe(5);
    expect(map.get("notes")?.length).toBe(4);
    expect(map.get("focus")?.length).toBe(4);
    expect(map.get("special")?.length).toBe(5);
  });
});

/* ─── Days badges ─── */

describe("days badges", () => {
  it("earns days-10 with 10 active days", () => {
    const facts = makeActiveDays(10);
    const badges = evaluateBadges(facts, makeSummary());
    expect(badges.some((b) => b.id === "days-10")).toBe(true);
  });

  it("does not earn days-10 with 9 active days", () => {
    const facts = makeActiveDays(9);
    const badges = evaluateBadges(facts, makeSummary());
    expect(badges.some((b) => b.id === "days-10")).toBe(false);
  });

  it("earns days-30 with 30 active days", () => {
    const facts = makeActiveDays(30);
    const badges = evaluateBadges(facts, makeSummary());
    expect(badges.some((b) => b.id === "days-30")).toBe(true);
  });

  it("earns days-100 with 100 active days", () => {
    const facts = makeActiveDays(100);
    const badges = evaluateBadges(facts, makeSummary());
    expect(badges.some((b) => b.id === "days-100")).toBe(true);
  });

  it("earns days-200 with 200 active days", () => {
    const facts = makeActiveDays(200);
    const badges = evaluateBadges(facts, makeSummary());
    expect(badges.some((b) => b.id === "days-200")).toBe(true);
  });

  it("earns days-365 with 365 active days", () => {
    const facts = makeActiveDays(365);
    const badges = evaluateBadges(facts, makeSummary());
    expect(badges.some((b) => b.id === "days-365")).toBe(true);
  });

  it("earns days-1000 with 1000 active days", () => {
    const facts = makeActiveDays(1000);
    const badges = evaluateBadges(facts, makeSummary());
    expect(badges.some((b) => b.id === "days-1000")).toBe(true);
  });

  it("does not count zero-time days", () => {
    const facts = makeActiveDays(10);
    facts[0].totalTime = 0; // one day has zero time
    const badges = evaluateBadges(facts, makeSummary());
    expect(badges.some((b) => b.id === "days-10")).toBe(false);
  });
});

/* ─── Streak badges ─── */

describe("streak badges", () => {
  it("earns streak-7 when longestStreak >= 7", () => {
    const badges = evaluateBadges([], makeSummary({ longestStreak: 7 }));
    expect(badges.some((b) => b.id === "streak-7")).toBe(true);
  });

  it("does not earn streak-7 when longestStreak < 7", () => {
    const badges = evaluateBadges([], makeSummary({ longestStreak: 6 }));
    expect(badges.some((b) => b.id === "streak-7")).toBe(false);
  });

  it("earns streak-14 when longestStreak >= 14", () => {
    const badges = evaluateBadges([], makeSummary({ longestStreak: 14 }));
    expect(badges.some((b) => b.id === "streak-14")).toBe(true);
  });

  it("earns streak-30 when longestStreak >= 30", () => {
    const badges = evaluateBadges([], makeSummary({ longestStreak: 30 }));
    expect(badges.some((b) => b.id === "streak-30")).toBe(true);
  });

  it("earns streak-100 when longestStreak >= 100", () => {
    const badges = evaluateBadges([], makeSummary({ longestStreak: 100 }));
    expect(badges.some((b) => b.id === "streak-100")).toBe(true);
  });

  it("earns streak-365 when longestStreak >= 365", () => {
    const badges = evaluateBadges([], makeSummary({ longestStreak: 365 }));
    expect(badges.some((b) => b.id === "streak-365")).toBe(true);
  });

  it("lower streaks also earned at higher value", () => {
    const badges = evaluateBadges([], makeSummary({ longestStreak: 365 }));
    const ids = badges.map((b) => b.id);
    expect(ids).toContain("streak-7");
    expect(ids).toContain("streak-14");
    expect(ids).toContain("streak-30");
    expect(ids).toContain("streak-100");
    expect(ids).toContain("streak-365");
  });
});

/* ─── Time badges ─── */

describe("time badges", () => {
  it("earns time-10h at 600 minutes", () => {
    const badges = evaluateBadges([], makeSummary({ totalReadingTime: 600 }));
    expect(badges.some((b) => b.id === "time-10h")).toBe(true);
  });

  it("does not earn time-10h at 599 minutes", () => {
    const badges = evaluateBadges([], makeSummary({ totalReadingTime: 599 }));
    expect(badges.some((b) => b.id === "time-10h")).toBe(false);
  });

  it("earns time-50h at 3000 minutes", () => {
    const badges = evaluateBadges([], makeSummary({ totalReadingTime: 3000 }));
    expect(badges.some((b) => b.id === "time-50h")).toBe(true);
  });

  it("earns time-100h at 6000 minutes", () => {
    const badges = evaluateBadges([], makeSummary({ totalReadingTime: 6000 }));
    expect(badges.some((b) => b.id === "time-100h")).toBe(true);
  });

  it("earns time-500h at 30000 minutes", () => {
    const badges = evaluateBadges([], makeSummary({ totalReadingTime: 30000 }));
    expect(badges.some((b) => b.id === "time-500h")).toBe(true);
  });

  it("earns time-1000h at 60000 minutes", () => {
    const badges = evaluateBadges([], makeSummary({ totalReadingTime: 60000 }));
    expect(badges.some((b) => b.id === "time-1000h")).toBe(true);
  });
});

/* ─── Books badges ─── */

describe("books badges", () => {
  it("earns books-5 at 5 books", () => {
    const badges = evaluateBadges([], makeSummary({ booksTouched: 5 }));
    expect(badges.some((b) => b.id === "books-5")).toBe(true);
  });

  it("does not earn books-5 at 4 books", () => {
    const badges = evaluateBadges([], makeSummary({ booksTouched: 4 }));
    expect(badges.some((b) => b.id === "books-5")).toBe(false);
  });

  it("earns books-10 at 10 books", () => {
    const badges = evaluateBadges([], makeSummary({ booksTouched: 10 }));
    expect(badges.some((b) => b.id === "books-10")).toBe(true);
  });

  it("earns books-30 at 30 books", () => {
    const badges = evaluateBadges([], makeSummary({ booksTouched: 30 }));
    expect(badges.some((b) => b.id === "books-30")).toBe(true);
  });

  it("earns books-50 at 50 books", () => {
    const badges = evaluateBadges([], makeSummary({ booksTouched: 50 }));
    expect(badges.some((b) => b.id === "books-50")).toBe(true);
  });

  it("earns books-100 at 100 books", () => {
    const badges = evaluateBadges([], makeSummary({ booksTouched: 100 }));
    expect(badges.some((b) => b.id === "books-100")).toBe(true);
  });
});

/* ─── Completed books badges ─── */

describe("completed badges", () => {
  it("earns completed-1 at 1 completed book", () => {
    const badges = evaluateBadges([], makeSummary({ completedBooks: 1 }));
    expect(badges.some((b) => b.id === "completed-1")).toBe(true);
  });

  it("does not earn completed-1 at 0 completed books", () => {
    const badges = evaluateBadges([], makeSummary({ completedBooks: 0 }));
    expect(badges.some((b) => b.id === "completed-1")).toBe(false);
  });

  it("earns completed-5 at 5 completed books", () => {
    const badges = evaluateBadges([], makeSummary({ completedBooks: 5 }));
    expect(badges.some((b) => b.id === "completed-5")).toBe(true);
  });

  it("earns completed-10 at 10 completed books", () => {
    const badges = evaluateBadges([], makeSummary({ completedBooks: 10 }));
    expect(badges.some((b) => b.id === "completed-10")).toBe(true);
  });

  it("earns completed-30 at 30 completed books", () => {
    const badges = evaluateBadges([], makeSummary({ completedBooks: 30 }));
    expect(badges.some((b) => b.id === "completed-30")).toBe(true);
  });

  it("earns completed-100 at 100 completed books", () => {
    const badges = evaluateBadges([], makeSummary({ completedBooks: 100 }));
    expect(badges.some((b) => b.id === "completed-100")).toBe(true);
  });
});

/* ─── Notes badges (uses totalPagesRead as proxy) ─── */

describe("notes badges", () => {
  it("earns notes-1 at 1 page read", () => {
    const badges = evaluateBadges([], makeSummary({ totalPagesRead: 1 }));
    expect(badges.some((b) => b.id === "notes-1")).toBe(true);
  });

  it("does not earn notes-1 at 0 pages", () => {
    const badges = evaluateBadges([], makeSummary({ totalPagesRead: 0 }));
    expect(badges.some((b) => b.id === "notes-1")).toBe(false);
  });

  it("earns notes-10 at 10 pages", () => {
    const badges = evaluateBadges([], makeSummary({ totalPagesRead: 10 }));
    expect(badges.some((b) => b.id === "notes-10")).toBe(true);
  });

  it("earns notes-50 at 50 pages", () => {
    const badges = evaluateBadges([], makeSummary({ totalPagesRead: 50 }));
    expect(badges.some((b) => b.id === "notes-50")).toBe(true);
  });

  it("earns notes-200 at 200 pages", () => {
    const badges = evaluateBadges([], makeSummary({ totalPagesRead: 200 }));
    expect(badges.some((b) => b.id === "notes-200")).toBe(true);
  });
});

/* ─── Focus / deep reading badges ─── */

describe("focus badges", () => {
  it("earns focus-30m at 30 min longest session", () => {
    const badges = evaluateBadges([], makeSummary({ longestSessionTime: 30 }));
    expect(badges.some((b) => b.id === "focus-30m")).toBe(true);
  });

  it("does not earn focus-30m at 29 min", () => {
    const badges = evaluateBadges([], makeSummary({ longestSessionTime: 29 }));
    expect(badges.some((b) => b.id === "focus-30m")).toBe(false);
  });

  it("earns focus-1h at 60 min", () => {
    const badges = evaluateBadges([], makeSummary({ longestSessionTime: 60 }));
    expect(badges.some((b) => b.id === "focus-1h")).toBe(true);
  });

  it("earns focus-2h at 120 min", () => {
    const badges = evaluateBadges([], makeSummary({ longestSessionTime: 120 }));
    expect(badges.some((b) => b.id === "focus-2h")).toBe(true);
  });

  it("earns focus-3h at 180 min", () => {
    const badges = evaluateBadges([], makeSummary({ longestSessionTime: 180 }));
    expect(badges.some((b) => b.id === "focus-3h")).toBe(true);
  });
});

/* ─── Special / habit badges ─── */

describe("special badges", () => {
  it("earns early-bird when >50% reading between 4-8am", () => {
    const morningFact = makeFact({
      totalTime: 120,
      hourlyDistribution: Array.from({ length: 24 }, (_, h) => (h === 6 ? 100 : h === 15 ? 20 : 0)),
    });
    const badges = evaluateBadges([morningFact], makeSummary());
    expect(badges.some((b) => b.id === "early-bird")).toBe(true);
  });

  it("does not earn early-bird when mostly afternoon reading", () => {
    const afternoonFact = makeFact({
      totalTime: 120,
      hourlyDistribution: Array.from({ length: 24 }, (_, h) => (h === 14 ? 100 : h === 6 ? 10 : 0)),
    });
    const badges = evaluateBadges([afternoonFact], makeSummary());
    expect(badges.some((b) => b.id === "early-bird")).toBe(false);
  });

  it("earns night-owl when >50% reading after 22:00 or before 4:00", () => {
    const nightFact = makeFact({
      totalTime: 120,
      hourlyDistribution: Array.from({ length: 24 }, (_, h) =>
        h === 23 ? 100 : h === 10 ? 20 : 0,
      ),
    });
    const badges = evaluateBadges([nightFact], makeSummary());
    expect(badges.some((b) => b.id === "night-owl")).toBe(true);
  });

  it("does not earn night-owl when mostly daytime reading", () => {
    const dayFact = makeFact({
      totalTime: 120,
      hourlyDistribution: Array.from({ length: 24 }, (_, h) =>
        h === 10 ? 100 : h === 23 ? 10 : 0,
      ),
    });
    const badges = evaluateBadges([dayFact], makeSummary());
    expect(badges.some((b) => b.id === "night-owl")).toBe(false);
  });

  it("earns weekend-warrior when >70% reading days are weekends", () => {
    // 2026-04-11 = Saturday, 2026-04-12 = Sunday, 2026-04-18 = Saturday, 2026-04-19 = Sunday
    const weekendFacts = [
      makeFact({ date: "2026-04-11", totalTime: 60 }),
      makeFact({ date: "2026-04-12", totalTime: 60 }),
      makeFact({ date: "2026-04-18", totalTime: 60 }),
      makeFact({ date: "2026-04-19", totalTime: 60 }),
      makeFact({ date: "2026-04-13", totalTime: 10 }), // Monday — 1 weekday out of 5
    ];
    const badges = evaluateBadges(weekendFacts, makeSummary());
    expect(badges.some((b) => b.id === "weekend-warrior")).toBe(true);
  });

  it("does not earn weekend-warrior when mostly weekday reading", () => {
    const weekdayFacts = [
      makeFact({ date: "2026-04-13", totalTime: 60 }), // Monday
      makeFact({ date: "2026-04-14", totalTime: 60 }), // Tuesday
      makeFact({ date: "2026-04-15", totalTime: 60 }), // Wednesday
      makeFact({ date: "2026-04-16", totalTime: 60 }), // Thursday
      makeFact({ date: "2026-04-11", totalTime: 10 }), // Saturday — 1 weekend out of 5
    ];
    const badges = evaluateBadges(weekdayFacts, makeSummary());
    expect(badges.some((b) => b.id === "weekend-warrior")).toBe(false);
  });

  it("earns perfect-week when a week has 7 reading days", () => {
    // Generate 7 days in the same ISO week (2026-W16 = Mon Apr 13 to Sun Apr 19)
    const facts = [];
    for (let d = 13; d <= 19; d++) {
      facts.push(
        makeFact({
          date: `2026-04-${d}`,
          weekKey: "2026-W16",
          totalTime: 30,
        }),
      );
    }
    const badges = evaluateBadges(facts, makeSummary());
    expect(badges.some((b) => b.id === "perfect-week")).toBe(true);
  });

  it("does not earn perfect-week with only 6 days in a week", () => {
    const facts = [];
    for (let d = 13; d <= 18; d++) {
      facts.push(
        makeFact({
          date: `2026-04-${d}`,
          weekKey: "2026-W16",
          totalTime: 30,
        }),
      );
    }
    const badges = evaluateBadges(facts, makeSummary());
    expect(badges.some((b) => b.id === "perfect-week")).toBe(false);
  });

  it("earns midnight-reader when reading during 3-4am", () => {
    const lateNightFact = makeFact({
      totalTime: 30,
      hourlyDistribution: Array.from({ length: 24 }, (_, h) => (h === 3 ? 30 : 0)),
    });
    const badges = evaluateBadges([lateNightFact], makeSummary());
    expect(badges.some((b) => b.id === "midnight-reader")).toBe(true);
  });

  it("does not earn midnight-reader without 3-4am reading", () => {
    const normalFact = makeFact({
      totalTime: 30,
      hourlyDistribution: Array.from({ length: 24 }, (_, h) => (h === 10 ? 30 : 0)),
    });
    const badges = evaluateBadges([normalFact], makeSummary());
    expect(badges.some((b) => b.id === "midnight-reader")).toBe(false);
  });
});

/* ─── Multiple badges / cumulative ─── */

describe("multiple badges at once", () => {
  it("earns all lower-tier badges when exceeding top threshold", () => {
    const badges = evaluateBadges(
      [],
      makeSummary({
        longestStreak: 365,
        booksTouched: 100,
        totalReadingTime: 60000,
        longestSessionTime: 180,
        completedBooks: 100,
        totalPagesRead: 200,
      }),
    );
    const ids = new Set(badges.map((b) => b.id));

    // All streak tiers
    expect(ids.has("streak-7")).toBe(true);
    expect(ids.has("streak-14")).toBe(true);
    expect(ids.has("streak-30")).toBe(true);
    expect(ids.has("streak-100")).toBe(true);
    expect(ids.has("streak-365")).toBe(true);

    // All books tiers
    expect(ids.has("books-5")).toBe(true);
    expect(ids.has("books-100")).toBe(true);

    // All time tiers
    expect(ids.has("time-10h")).toBe(true);
    expect(ids.has("time-1000h")).toBe(true);

    // All focus tiers
    expect(ids.has("focus-30m")).toBe(true);
    expect(ids.has("focus-3h")).toBe(true);

    // All completed tiers
    expect(ids.has("completed-1")).toBe(true);
    expect(ids.has("completed-100")).toBe(true);

    // All notes tiers
    expect(ids.has("notes-1")).toBe(true);
    expect(ids.has("notes-200")).toBe(true);
  });
});

/* ─── Badge structure ─── */

describe("badge structure", () => {
  it("returns correct EarnedBadge shape", () => {
    const badges = evaluateBadges([], makeSummary({ longestStreak: 7 }));
    const badge = badges.find((b) => b.id === "streak-7");
    expect(badge).toBeDefined();
    expect(badge!.tier).toBe("bronze");
    expect(badge!.category).toBe("streak");
    expect(badge!.icon).toBe("flame");
    expect(badge!.titleKey).toBe("stats.desktop.badge_streak-7_title");
    expect(badge!.descKey).toBe("stats.desktop.badge_streak-7_desc");
    expect(badge!.earnedAt).toBe("lifetime");
  });

  it("tiers are assigned correctly across categories", () => {
    const badges = evaluateBadges(
      makeActiveDays(1000),
      makeSummary({
        longestStreak: 365,
        totalReadingTime: 60000,
        booksTouched: 100,
        completedBooks: 100,
        totalPagesRead: 200,
        longestSessionTime: 180,
      }),
    );

    const byId = new Map(badges.map((b) => [b.id, b]));

    // days tiers
    expect(byId.get("days-10")?.tier).toBe("bronze");
    expect(byId.get("days-30")?.tier).toBe("silver");
    expect(byId.get("days-100")?.tier).toBe("gold");
    expect(byId.get("days-200")?.tier).toBe("platinum");
    expect(byId.get("days-365")?.tier).toBe("diamond");
    expect(byId.get("days-1000")?.tier).toBe("legendary");

    // streak tiers
    expect(byId.get("streak-7")?.tier).toBe("bronze");
    expect(byId.get("streak-14")?.tier).toBe("silver");
    expect(byId.get("streak-30")?.tier).toBe("gold");
    expect(byId.get("streak-100")?.tier).toBe("platinum");
    expect(byId.get("streak-365")?.tier).toBe("diamond");

    // focus tiers
    expect(byId.get("focus-30m")?.tier).toBe("bronze");
    expect(byId.get("focus-1h")?.tier).toBe("silver");
    expect(byId.get("focus-2h")?.tier).toBe("gold");
    expect(byId.get("focus-3h")?.tier).toBe("platinum");
  });

  it("returns no badges when all stats are zero", () => {
    const badges = evaluateBadges([], makeSummary());
    expect(badges).toHaveLength(0);
  });
});
