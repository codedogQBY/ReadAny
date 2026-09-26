import { describe, expect, it } from "vitest";
import {
  findTTSLyricIndex,
  mergeTTSLyricContext,
  mergeTTSLyrics,
  normalizeTTSLyrics,
} from "./lyrics";

describe("TTS lyric model", () => {
  it("normalizes text and preserves repeated selection lines", () => {
    expect(
      normalizeTTSLyrics([
        { text: "  one  two ", cfi: "a" },
        { text: "one two", cfi: "a" },
        { text: "same", cfi: null },
        { text: "same", cfi: null },
      ]),
    ).toEqual([
      { text: "one two", cfi: "a" },
      { text: "same", cfi: null },
      { text: "same", cfi: null },
    ]);
  });

  it("appends and prepends discovered context without coupling to cache eviction", () => {
    const initial = [{ text: "current", cfi: "b" }];
    expect(mergeTTSLyrics(initial, [{ text: "next", cfi: "c" }])).toEqual([
      { text: "current", cfi: "b" },
      { text: "next", cfi: "c" },
    ]);
    expect(mergeTTSLyrics(initial, [{ text: "previous", cfi: "a" }], "above")).toEqual([
      { text: "previous", cfi: "a" },
      { text: "current", cfi: "b" },
    ]);
  });

  it("merges a context window in document order and locates by CFI first", () => {
    const lyrics = mergeTTSLyricContext(
      [],
      [{ text: "before", cfi: "a" }],
      [{ text: "current", cfi: "b" }],
      [{ text: "after", cfi: "c" }],
    );
    expect(lyrics.map((item) => item.text)).toEqual(["before", "current", "after"]);
    expect(findTTSLyricIndex(lyrics, { cfi: "b", text: "wrong" })).toBe(1);
  });
});
