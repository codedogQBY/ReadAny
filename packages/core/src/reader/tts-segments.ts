export interface TTSTextSegmentRange {
  text: string;
  start: number;
  end: number;
}

type SentenceSegmenter = new (
  locales?: string | string[],
  options?: { granularity?: "grapheme" | "word" | "sentence" },
) => {
  segment(input: string): Iterable<{ index: number; segment: string }>;
};

const FALLBACK_SENTENCE_RE =
  /[^\r\n.!?;:\u3002\uff01\uff1f\uff1b\uff1a]+[.!?;:\u3002\uff01\uff1f\uff1b\uff1a\u2026]*/gu;

export function splitTextIntoTTSSegmentRanges(
  text: string,
  locale?: string | string[],
): TTSTextSegmentRange[] {
  if (!text.trim()) return [];

  const SegmenterCtor = (
    Intl as typeof Intl & {
      Segmenter?: SentenceSegmenter;
    }
  ).Segmenter;

  const rawRanges = SegmenterCtor
    ? Array.from(new SegmenterCtor(locale, { granularity: "sentence" }).segment(text)).map(
        (item) => ({
          start: item.index,
          end: item.index + item.segment.length,
        }),
      )
    : Array.from(text.matchAll(FALLBACK_SENTENCE_RE)).map((match) => ({
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
      }));

  const ranges = rawRanges.length ? rawRanges : [{ start: 0, end: text.length }];
  const result: TTSTextSegmentRange[] = [];

  for (const range of ranges) {
    let start = range.start;
    let end = range.end;
    while (start < end && /\s/u.test(text[start] ?? "")) start++;
    while (end > start && /\s/u.test(text[end - 1] ?? "")) end--;
    const segmentText = text.slice(start, end).replace(/\s+/g, " ").trim();
    if (segmentText.length < 1) continue;
    result.push({ text: segmentText, start, end });
  }

  return result;
}
