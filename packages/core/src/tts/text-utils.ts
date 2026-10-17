/**
 * TTS text processing utilities — platform agnostic.
 */

const FOOTNOTE_MARKER_PATTERN =
  /(?:\s*(?:\[(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})\]|［(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})］|【(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})】|〔(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})〕|［?（(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})）］?|\((?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})\)))+/gu;

const FOOTNOTE_MARKER_ONLY_PATTERN =
  /^(?:\s*(?:\[(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})\]|［(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})］|【(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})】|〔(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})〕|［?（(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})）］?|\((?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})\)))+\s*$/u;

const TTS_SKIPPED_ELEMENT_SELECTOR = [
  "script",
  "style",
  "rt",
  "rp",
  "sup",
  ".readany-translation",
  '[role="doc-noteref"]',
  '[role="doc-footnote"]',
  '[epub\\:type~="noteref"]',
  '[epub\\:type~="footnote"]',
  '[type~="noteref"]',
  '[type~="footnote"]',
  'a[href^="#fn"]',
  'a[href^="#footnote"]',
  'a[href*="footnote"]',
  'a[href*="note"]',
  "a.noteref",
  "a.footnote",
  ".noteref",
  ".footnote",
  ".footnote-ref",
  ".endnote",
  ".duokan-footnote",
  ".calibre-footnote",
].join(",");

/** Return true when a text node only contains a footnote marker such as [12] or [十二]. */
export function isTTSFootnoteMarker(text: string): boolean {
  return FOOTNOTE_MARKER_ONLY_PATTERN.test(text);
}

/** Return true when text contains a letter or digit that can produce speech. */
export function hasSpeakableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** Return true when an element should not contribute text to TTS. */
export function shouldSkipTTSNode(element: Element | null | undefined): boolean {
  if (!element) return false;
  return Boolean(element.closest(TTS_SKIPPED_ELEMENT_SELECTOR));
}

/** Clean text for TTS: remove footnote references and extra whitespace. */
export function cleanText(text: string): string {
  return text.replace(FOOTNOTE_MARKER_PATTERN, "").replace(/\s+/g, " ").trim();
}

/** Count characters (CJK = 2 units, others = 1) */
export function countChars(text: string): number {
  let count = 0;
  for (const ch of text) {
    count += /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(ch) ? 2 : 1;
  }
  return count;
}

/** Split text into chunks at sentence boundaries */
export function splitIntoChunks(text: string, maxChars = 500): string[] {
  const cleaned = cleanText(text);
  if (hasSpeakableText(cleaned) && countChars(cleaned) <= maxChars) return [cleaned];

  const sentences = cleaned.split(/(?<=[。！？.!?\n])\s*/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (countChars(current + sentence) > maxChars && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (hasSpeakableText(current)) chunks.push(current.trim());
  return chunks.filter(hasSpeakableText);
}
