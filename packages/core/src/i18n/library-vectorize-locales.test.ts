import { describe, expect, it } from "vitest";
import en from "./locales/en/library.json";
import es from "./locales/es/library.json";
import fr from "./locales/fr/library.json";
import ja from "./locales/ja/library.json";
import ko from "./locales/ko/library.json";
import zhTW from "./locales/zh-TW/library.json";
import zh from "./locales/zh/library.json";

const locales = { en, es, fr, ja, ko, zh, "zh-TW": zhTW };
const VECTORIZE_ERROR_KEYS = [
  "protectedBookTitle",
  "protectedBookDesc",
  "malformedBookTitle",
  "malformedBookDesc",
  "unsupportedFormatTitle",
  "unsupportedFormatDesc",
  "extractionFailedTitle",
  "extractionFailedDesc",
  "vectorizationFailedTitle",
  "vectorizationFailedDesc",
  "cleanupFailedTitle",
  "cleanupFailedDesc",
] as const;

describe("library vectorization error translations", () => {
  it.each(Object.entries(locales))("defines every actionable message in %s", (_name, locale) => {
    for (const key of VECTORIZE_ERROR_KEYS) {
      expect(locale.vectorize[key]).toEqual(expect.any(String));
      expect(locale.vectorize[key].trim()).not.toBe("");
    }
  });

  it("states the DRM-free support boundary accurately in English", () => {
    expect(en.vectorize.protectedBookDesc).toBe(
      "ReadAny can vectorize DRM-free MOBI, AZW, and AZW3 books, but this file appears to be protected.",
    );
  });
});
