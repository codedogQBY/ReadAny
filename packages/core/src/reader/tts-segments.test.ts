import { describe, expect, it } from "vitest";

import { splitTextIntoTTSSegmentRanges } from "./tts-segments";

describe("splitTextIntoTTSSegmentRanges", () => {
  it("keeps source offsets while trimming sentence whitespace", () => {
    const segments = splitTextIntoTTSSegmentRanges("  First sentence.  Second sentence!  ", "en");

    expect(segments).toEqual([
      { text: "First sentence.", start: 2, end: 17 },
      { text: "Second sentence!", start: 19, end: 35 },
    ]);
  });

  it("supports Chinese punctuation", () => {
    const segments = splitTextIntoTTSSegmentRanges("第一句。第二句！第三句？", "zh-CN");

    expect(segments).toEqual([
      { text: "第一句。", start: 0, end: 4 },
      { text: "第二句！", start: 4, end: 8 },
      { text: "第三句？", start: 8, end: 12 },
    ]);
  });
});
