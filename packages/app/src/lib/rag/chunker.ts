/**
 * Markdown-aware chunker — splits content preserving structure
 * Default: 300 tokens target / 50 min / 20% overlap
 */
import type { Chunk } from "@/types";

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
): Chunk[] {
  const sections = splitBySections(content);
  const chunks: Chunk[] = [];
  let currentChunk = "";
  let currentTokens = 0;

  for (const section of sections) {
    const sectionTokens = estimateTokens(section);

    if (currentTokens + sectionTokens > config.targetTokens && currentTokens >= config.minTokens) {
      chunks.push(createChunk(currentChunk, bookId, chapterIndex, chapterTitle, chunks.length));

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
    chunks.push(createChunk(currentChunk, bookId, chapterIndex, chapterTitle, chunks.length));
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

function createChunk(
  content: string,
  bookId: string,
  chapterIndex: number,
  chapterTitle: string,
  index: number,
): Chunk {
  return {
    id: `${bookId}-${chapterIndex}-${index}`,
    bookId,
    chapterIndex,
    chapterTitle,
    content,
    tokenCount: estimateTokens(content),
    startCfi: "", // TODO: Map to EPUB CFI
    endCfi: "",
  };
}

function getOverlapText(text: string, targetTokens: number): string {
  const targetChars = targetTokens * 4;
  if (text.length <= targetChars) return text;
  return text.slice(-targetChars);
}
