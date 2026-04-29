/**
 * TTS debug utility functions.
 * These are only active in __DEV__ mode and help diagnose
 * text-to-speech segment extraction issues.
 */

export type TTSDebuggableSegment = { text: string; cfi?: string | null };

export function normalizeTTSDebugText(text: string | null | undefined) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function logTTSDebugText(label: string, text: string | null | undefined, chunkSize = 220) {
  if (!__DEV__) return;
  const normalized = normalizeTTSDebugText(text);
  const chunkCount = normalized ? Math.ceil(normalized.length / chunkSize) : 0;
  console.log(`${label} summary`, {
    length: normalized.length,
    chunkCount,
  });
  if (!normalized) return;
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * chunkSize;
    const end = start + chunkSize;
    console.log(`${label}#${index + 1}/${chunkCount}`, normalized.slice(start, end));
  }
}

export function logTTSDebugSentenceList(
  label: string,
  sentences: Array<string | null | undefined>,
  limit = Number.POSITIVE_INFINITY,
) {
  if (!__DEV__) return;
  const normalized = sentences.map(normalizeTTSDebugText).filter(Boolean).slice(0, limit);
  console.log(`${label} summary`, {
    count: normalized.length,
  });
  normalized.forEach((sentence, index) => {
    console.log(`${label}[${index}]`, {
      length: sentence.length,
      text: sentence,
    });
  });
}

export function normalizeTTSDebugSegments(segments: TTSDebuggableSegment[]) {
  return segments
    .map((segment) => ({
      cfi: segment.cfi || null,
      text: normalizeTTSDebugText(segment.text),
    }))
    .filter((segment) => segment.text.length > 0);
}

export function logTTSDebugSegments(label: string, segments: TTSDebuggableSegment[]) {
  if (!__DEV__) return;
  const normalized = normalizeTTSDebugSegments(segments);
  console.log(`${label} summary`, {
    count: normalized.length,
    firstCfi: normalized[0]?.cfi || null,
    lastCfi: normalized[normalized.length - 1]?.cfi || null,
  });
  normalized.forEach((segment, index) => {
    console.log(`${label}[${index}]`, {
      cfi: segment.cfi || null,
      length: segment.text.length,
      text: segment.text,
    });
  });
}

export function collectMissingTTSDebugSentences(
  sentences: string[],
  segments: TTSDebuggableSegment[],
) {
  const segmentTexts = new Set(normalizeTTSDebugSegments(segments).map((segment) => segment.text));
  return sentences
    .map(normalizeTTSDebugText)
    .filter((sentence) => sentence.length > 0 && !segmentTexts.has(sentence));
}

export function findTTSDebugSentenceIndex(
  sentence: string | null | undefined,
  segments: TTSDebuggableSegment[],
) {
  const normalizedSentence = normalizeTTSDebugText(sentence);
  if (!normalizedSentence) return -1;
  return normalizeTTSDebugSegments(segments).findIndex(
    (segment) => segment.text === normalizedSentence,
  );
}
