import type { PreparedDictionarySelection } from "./types";

const EDGE_PUNCTUATION = /^[\p{P}\p{Z}]+|[\p{P}\p{Z}]+$/gu;
const HAN = /\p{Script=Han}/u;
const LATIN = /\p{Script=Latin}/u;
const ALLOWED_EN = /^[\p{Script=Latin}\p{M}'’\-\s]+$/u;
const ALLOWED_ZH = /^[\p{Script=Han}\p{M}\s]+$/u;

export function prepareDictionarySelection(text: string): PreparedDictionarySelection {
  const displayText = text.normalize("NFKC").replace(EDGE_PUNCTUATION, "").trim();
  if (!displayText) return { ok: false, reason: "empty" };
  if (Array.from(displayText).length > 120) return { ok: false, reason: "too-long" };

  const hasHan = HAN.test(displayText);
  const hasLatin = LATIN.test(displayText);
  if (hasHan && hasLatin) return { ok: false, reason: "mixed-script" };
  if (hasHan && ALLOWED_ZH.test(displayText)) {
    return { ok: true, language: "zh", key: displayText.replace(/\s+/g, ""), displayText };
  }
  if (hasLatin && ALLOWED_EN.test(displayText)) {
    return {
      ok: true,
      language: "en",
      key: displayText.replace(/\s+/g, " ").toLocaleLowerCase("en-US"),
      displayText,
    };
  }
  return { ok: false, reason: "unsupported-script" };
}
