/**
 * Markdown-aware chunker — splits content preserving structure
 * Default: 300 tokens target / 50 min / 20% overlap
 *
 * Supports optional TextSegment mapping from book-extractor
 * to record precise EPUB CFI positions for each chunk.
 */
import type { Chunk } from "@/types";
import type { TextSegment } from "./book-extractor";

export interface ChunkerConfig {
  targetTokens: number; // default 300
  minTokens: number; // default 50
  overlapRatio: number; // default 0.2
}

const DEFAULT_CONFIG: ChunkerConfig = {
  targetTokens: 300,
  minTokens: 50,
  overlapRatio: 0.2,
};

/** Split book content into chunks preserving markdown structure */
export function chunkContent(
  content: string,
  bookId: string,
  chapterIndex: number,
  chapterTitle: string,
  config: ChunkerConfig = DEFAULT_CONFIG,
  segments?: TextSegment[],
): Chunk[] {
  const sections = splitBySections(content);
  const chunks: Chunk[] = [];
  let currentChunk = "";
  let currentTokens = 0;

  for (const section of sections) {
    const sectionTokens = estimateTokens(section);

    if (currentTokens + sectionTokens > config.targetTokens && currentTokens >= config.minTokens) {
      chunks.push(createChunk(currentChunk, bookId, chapterIndex, chapterTitle, chunks.length, segments));

      // Apply overlap
      const overlapTokens = Math.floor(currentTokens * config.overlapRatio);
      currentChunk = getOverlapText(currentChunk, overlapTokens) + section;
      currentTokens = estimateTokens(currentChunk);
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + section;
      currentTokens += sectionTokens;
    }
  }

  if (currentTokens >= config.minTokens) {
    chunks.push(createChunk(currentChunk, bookId, chapterIndex, chapterTitle, chunks.length, segments));
  }

  return chunks;
}

/** Split content by markdown headers and paragraphs */
function splitBySections(content: string): string[] {
  return content
    .split(/\n(?=#{1,6}\s)|\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Rough token estimation (~4 chars per token for English) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Find the best matching CFI for a chunk by matching its text content
 * against the TextSegments extracted from the DOM.
 *
 * Strategy: find the first segment whose text appears in the chunk content
 * (as startCfi) and the last such segment (as endCfi).
 */
function findCfiForChunk(
  chunkContent: string,
  segments: TextSegment[],
): { startCfi: string; endCfi: string } {
  if (!segments || segments.length === 0) {
    return { startCfi: "", endCfi: "" };
  }

  let startCfi = "";
  let endCfi = "";

  // Normalize chunk text for matching (collapse whitespace)
  const normalizedChunk = chunkContent.replace(/\s+/g, " ").trim();

  for (const seg of segments) {
    const normalizedSeg = seg.text.replace(/\s+/g, " ").trim();
    if (!normalizedSeg || normalizedSeg.length < 2) continue;

    // Check if this segment's text appears in the chunk
    // Use a substring of the segment (first 40 chars) for fuzzy matching
    // since chunker may have split or merged text differently
    const matchText = normalizedSeg.slice(0, Math.min(40, normalizedSeg.length));
    if (normalizedChunk.includes(matchText)) {
      if (!startCfi) {
        startCfi = seg.cfi;
      }
      endCfi = seg.cfi;
    }
  }

  return { startCfi, endCfi };
}

function createChunk(
  content: string,
  bookId: string,
  chapterIndex: number,
  chapterTitle: string,
  index: number,
  segments?: TextSegment[],
): Chunk {
  const { startCfi, endCfi } = segments
    ? findCfiForChunk(content, segments)
    : { startCfi: "", endCfi: "" };

  return {
    id: `${bookId}-${chapterIndex}-${index}`,
    bookId,
    chapterIndex,
    chapterTitle,
    content,
    tokenCount: estimateTokens(content),
    startCfi,
    endCfi,
  };
}

function getOverlapText(text: string, targetTokens: number): string {
  const targetChars = targetTokens * 4;
  if (text.length <= targetChars) return text;
  return text.slice(-targetChars);
}
