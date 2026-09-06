import { describe, expect, it } from "vitest";
import { prepareDictionarySelection } from "./selection";

describe("prepareDictionarySelection", () => {
  it("normalizes English without changing display text", () => {
    expect(prepareDictionarySelection("  \u201cDesires,\u201d  ")).toEqual({
      ok: true,
      language: "en",
      key: "desires",
      displayText: "Desires",
    });
  });

  it("accepts a Chinese word and strips surrounding punctuation", () => {
    expect(prepareDictionarySelection("\u300a\u95b1\u8b80\u300b")).toEqual({
      ok: true,
      language: "zh",
      key: "\u95b1\u8b80",
      displayText: "\u95b1\u8b80",
    });
  });

  it.each([
    ["", "empty"],
    ["reading\u95b1\u8b80", "mixed-script"],
    ["\u95b1\u8b80\u304b\u306a", "unsupported-script"],
    ["\u0447\u0442\u0435\u043d\u0438\u0435", "unsupported-script"],
    ["a".repeat(121), "too-long"],
  ] as const)("rejects %j as %s", (text, reason) => {
    expect(prepareDictionarySelection(text)).toEqual({ ok: false, reason });
  });
});
