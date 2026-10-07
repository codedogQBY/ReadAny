import { describe, expect, it } from "vitest";
import { SegmentPlanner } from "./segment-planner";

describe("SegmentPlanner", () => {
  it("splits text and maps offsets", () => {
    const segments = new SegmentPlanner({ maxCharacters: 5 }).plan("abcdef");
    expect(segments.map((segment) => segment.text)).toEqual(["abcde", "f"]);
    expect(segments[1].startOffset).toBe(5);
  });

  it("finds a segment by offset or CFI", () => {
    const planner = new SegmentPlanner({ maxCharacters: 5 });
    const segments = planner.plan("abcdefghij");
    segments[1].cfi = "epubcfi(/6/2)";
    expect(planner.findStart(segments, { offset: 6 })).toBe(1);
    expect(planner.findStart(segments, { cfi: "epubcfi(/6/2)" })).toBe(1);
  });
});
