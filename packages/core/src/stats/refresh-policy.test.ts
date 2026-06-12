import { describe, expect, it } from "vitest";

import { isStatsRelevantBookUpdate } from "./refresh-policy";

describe("refresh-policy", () => {
  it("refreshes stats when book metadata-like fields change", () => {
    expect(isStatsRelevantBookUpdate(["meta"])).toBe(true);
    expect(isStatsRelevantBookUpdate(["tags"])).toBe(true);
    expect(isStatsRelevantBookUpdate(["groupId"])).toBe(true);
    expect(isStatsRelevantBookUpdate(["deletedAt"])).toBe(true);
  });

  it("ignores high-frequency book fields that do not affect stats metadata", () => {
    expect(isStatsRelevantBookUpdate(["progress"])).toBe(false);
    expect(isStatsRelevantBookUpdate(["currentCfi", "lastOpenedAt"])).toBe(false);
    expect(isStatsRelevantBookUpdate(["vectorizeProgress"])).toBe(false);
  });

  it("refreshes stats when update fields are unknown", () => {
    expect(isStatsRelevantBookUpdate()).toBe(true);
    expect(isStatsRelevantBookUpdate([])).toBe(true);
  });
});
