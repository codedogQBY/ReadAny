import { describe, expect, it } from "vitest";
import { getBookProgressPercent, normalizeBookProgress } from "./book-progress";

describe("book progress utils", () => {
  it("normalizes invalid progress to zero", () => {
    expect(normalizeBookProgress(undefined)).toBe(0);
    expect(normalizeBookProgress(Number.NaN)).toBe(0);
    expect(getBookProgressPercent(Number.NaN)).toBe(0);
  });

  it("clamps progress into the valid reading range", () => {
    expect(getBookProgressPercent(-0.2)).toBe(0);
    expect(getBookProgressPercent(0.42)).toBe(42);
    expect(getBookProgressPercent(1.8)).toBe(100);
  });
});
