/**
 * Persistent lyric data for the reader UI.
 *
 * Lyric discovery is independent from audio synthesis. A provider may evict
 * an audio buffer from its LRU while the reader keeps the corresponding lyric
 * entry and can request the audio again when the user taps it.
 */
export interface TTSLyricSegment {
  text: string;
  cfi: string | null;
}

export type TTSLyricDirection = "above" | "below";

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeTTSLyricSegment(segment: {
  text?: string | null;
  cfi?: string | null;
}): TTSLyricSegment | null {
  const text = normalizeText(segment.text || "");
  if (!text) return null;
  return { text, cfi: segment.cfi || null };
}

export function getTTSLyricKey(segment: { text: string; cfi?: string | null }): string {
  return `${segment.cfi || ""}::${normalizeText(segment.text)}`;
}

export function normalizeTTSLyrics(
  segments: Array<{ text?: string | null; cfi?: string | null }>,
): TTSLyricSegment[] {
  const seen = new Set<string>();
  const result: TTSLyricSegment[] = [];
  for (const raw of segments) {
    const segment = normalizeTTSLyricSegment(raw);
    if (!segment) continue;
    // Selection text has no stable CFI; repeated sentences are meaningful in
    // that mode, so only deduplicate entries that have a document identity.
    if (!segment.cfi) {
      result.push(segment);
      continue;
    }
    const key = getTTSLyricKey(segment);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(segment);
  }
  return result;
}

export function mergeTTSLyrics(
  existing: TTSLyricSegment[],
  incoming: Array<{ text?: string | null; cfi?: string | null }>,
  direction: TTSLyricDirection = "below",
): TTSLyricSegment[] {
  const next = normalizeTTSLyrics(incoming);
  if (!next.length) return existing;

  const known = new Set(existing.filter((segment) => segment.cfi).map(getTTSLyricKey));
  const unique = next.filter((segment) => {
    if (!segment.cfi) return true;
    const key = getTTSLyricKey(segment);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  if (!unique.length) return existing;
  return direction === "above" ? [...unique, ...existing] : [...existing, ...unique];
}

export function mergeTTSLyricContext(
  existing: TTSLyricSegment[],
  before: Array<{ text?: string | null; cfi?: string | null }>,
  current: Array<{ text?: string | null; cfi?: string | null }>,
  after: Array<{ text?: string | null; cfi?: string | null }>,
): TTSLyricSegment[] {
  return mergeTTSLyrics(mergeTTSLyrics(mergeTTSLyrics(existing, before, "above"), current), after);
}

export function findTTSLyricIndex(
  lyrics: Array<{ text: string; cfi?: string | null }>,
  target: { cfi?: string | null; text?: string | null },
): number {
  const cfi = target.cfi || null;
  if (cfi) {
    const byCfi = lyrics.findIndex((segment) => segment.cfi === cfi);
    if (byCfi >= 0) return byCfi;
  }
  const text = normalizeText(target.text || "");
  if (!text) return -1;
  return lyrics.findIndex((segment) => segment.text === text);
}
