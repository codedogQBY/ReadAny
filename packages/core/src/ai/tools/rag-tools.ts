/**
 * RAG Tools — search, table of contents, and context retrieval
 */
import { getChunks } from "../../db/database";
import { estimateTokens } from "../../rag/chunker";
import { search } from "../../rag/search";
import type { SearchQuery } from "../../types";
import { fallbackContentService } from "../fallback-content-service";
import { getFallbackChaptersForBook } from "../fallback-source-resolver";
import type { ToolDefinition } from "./tool-types";

function isGenericSectionTitle(title: string): boolean {
  return /^Section\s+\d+$/i.test(title.trim());
}

function shouldPreferOriginalToc(chapters: Map<number, string>): boolean {
  if (chapters.size === 0) return false;
  const titles = Array.from(chapters.values());
  const genericCount = titles.filter(isGenericSectionTitle).length;
  return genericCount >= Math.max(2, Math.ceil(titles.length * 0.6));
}

function getTocDebugInfo(
  chapters: Map<number, string>,
  fallback?: { attempted: boolean; error?: string; chapterCount?: number; sampleTitles?: string[] },
) {
  const titles = Array.from(chapters.values());
  const genericCount = titles.filter(isGenericSectionTitle).length;
  return {
    vectorChapterCount: chapters.size,
    genericSectionCount: genericCount,
    genericSectionRatio: titles.length > 0 ? Math.round((genericCount / titles.length) * 100) / 100 : 0,
    preferOriginalToc: shouldPreferOriginalToc(chapters),
    vectorSampleTitles: titles.slice(0, 8),
    fallback,
  };
}

/** Create RAG search tool for a specific book */
export function createRagSearchTool(bookId: string): ToolDefinition {
  const MAX_TOTAL_TOKENS = 4000; // Token budget for all results combined
  const MIN_CONTENT_TOKENS = 100; // Minimum tokens per result

  return {
    name: "ragSearch",
    description:
      "Search book content using semantic or keyword search. Returns results with 'cfi' field for precise location. CRITICAL: When you cite content from search results, you MUST extract and pass the 'cfi' field to addCitation - this enables users to jump to the exact location in the book.",
    parameters: {
      query: {
        type: "string",
        description: "The search query describing what to find",
        required: true,
      },
      mode: {
        type: "string",
        description:
          'Search mode: "hybrid" (recommended), "vector" (semantic), or "bm25" (keyword)',
      },
      topK: { type: "number", description: "Number of results to return (default: 5)" },
    },
    execute: async (args) => {
      const query: SearchQuery = {
        query: args.query as string,
        bookId,
        mode: (args.mode as "hybrid" | "vector" | "bm25") || "hybrid",
        topK: (args.topK as number) || 5,
        threshold: 0.3,
      };

      const results = await search(query);

      // Smart truncation with token budget
      let totalTokens = 0;
      const truncatedResults = [];

      for (const r of results) {
        const fullContent = r.chunk.content;
        const fullTokens = estimateTokens(fullContent);

        // Calculate remaining budget
        const remainingBudget = MAX_TOTAL_TOKENS - totalTokens;

        if (remainingBudget <= MIN_CONTENT_TOKENS) {
          // Budget exhausted, stop adding results
          break;
        }

        let content = fullContent;
        let contentTokens = fullTokens;

        // Truncate if exceeds remaining budget
        if (contentTokens > remainingBudget) {
          // Estimate character limit based on remaining tokens
          const charLimit = remainingBudget * 4; // ~4 chars per token
          content = fullContent.slice(0, charLimit);
          contentTokens = estimateTokens(content);
        }

        totalTokens += contentTokens;

        truncatedResults.push({
          chapter: r.chunk.chapterTitle,
          chapterIndex: r.chunk.chapterIndex,
          content,
          score: Math.round(r.score * 1000) / 1000,
          matchType: r.matchType,
          highlights: r.highlights,
          cfi: r.chunk.startCfi || "",
          truncated: fullTokens > contentTokens,
        });
      }

      return {
        results: truncatedResults,
        totalResults: results.length,
        returnedResults: truncatedResults.length,
        totalTokens,
        tokenBudget: MAX_TOTAL_TOKENS,
      };
    },
  };
}

/** Create RAG TOC tool for a specific book */
export function createRagTocTool(bookId: string): ToolDefinition {
  return {
    name: "ragToc",
    description:
      "Get the table of contents of the current book. Use this when the user wants to see the book structure or navigate to a specific chapter. Use the returned 'index' when calling chapter tools; 'number' is the human-readable chapter order.",
    parameters: {},
    execute: async () => {
      // Get unique chapter titles from chunks
      const chunks = await getChunks(bookId);
      const chapters = new Map<number, string>();
      for (const chunk of chunks) {
        if (!chapters.has(chunk.chapterIndex)) {
          chapters.set(chunk.chapterIndex, chunk.chapterTitle);
        }
      }

      if (shouldPreferOriginalToc(chapters)) {
        fallbackContentService.clear(bookId);
        const fallback = await getFallbackChaptersForBook(bookId);
        if (!("error" in fallback) && fallback.chapters.length > 0) {
          console.log("[ragToc] Rebuilt generic section TOC from original book", {
            bookId,
            chapters: fallback.chapters.length,
            sampleTitles: fallback.chapters.slice(0, 5).map((chapter) => chapter.title),
          });
          return {
            bookTitle: fallback.bookTitle,
            chapters: fallback.chapters.map((chapter, ordinal) => ({
              index: chapter.index,
              number: ordinal + 1,
              title: chapter.title,
            })),
            totalChapters: fallback.chapters.length,
            source: "original-file",
            debug: getTocDebugInfo(chapters, {
              attempted: true,
              chapterCount: fallback.chapters.length,
              sampleTitles: fallback.chapters.slice(0, 8).map((chapter) => chapter.title),
            }),
            instruction:
              "The vector index has generic Section titles, so this TOC was rebuilt from the original book file. Re-vectorize the book to refresh RAG chapter titles.",
          };
        }

        const fallbackError = "error" in fallback ? fallback.error : "Original file TOC was empty";
        console.warn("[ragToc] Failed to rebuild generic section TOC from original book", {
          bookId,
          error: fallbackError,
        });
        return {
          chapters: Array.from(chapters.entries()).map(([index, title], ordinal) => ({
            index,
            number: ordinal + 1,
            title,
          })),
          totalChapters: chapters.size,
          source: "vector-index",
          debug: getTocDebugInfo(chapters, {
            attempted: true,
            error: fallbackError,
          }),
          warning:
            "The vector index has mostly generic Section titles, but rebuilding the TOC from the original book failed. See debug.fallback.error.",
        };
      }

      return {
        chapters: Array.from(chapters.entries()).map(([index, title], ordinal) => ({
          index,
          number: ordinal + 1,
          title,
        })),
        totalChapters: chapters.size,
        source: "vector-index",
        debug: getTocDebugInfo(chapters, { attempted: false }),
      };
    },
  };
}

/** Create RAG context tool for a specific book */
export function createRagContextTool(bookId: string): ToolDefinition {
  const MAX_TOTAL_TOKENS = 3000;

  return {
    name: "ragContext",
    description:
      "Get surrounding text context for a specific chapter. Use this when the user asks about content near a specific location. Returns chunks with CFI information - use the CFI from the chunk containing your quoted text when calling addCitation.",
    parameters: {
      chapterIndex: { type: "number", description: "The chapter index", required: true },
      range: {
        type: "number",
        description: "Number of chunks to include before and after (default: 2)",
      },
    },
    execute: async (args) => {
      const chapterIndex = args.chapterIndex as number;
      const range = (args.range as number) || 2;

      const chunks = await getChunks(bookId);
      const chapterChunks = chunks.filter((c) => c.chapterIndex === chapterIndex);

      // Get surrounding chunks with token budget
      const contextChunks: Array<{ content: string; cfi: string }> = [];
      let totalTokens = 0;

      for (const c of chapterChunks.slice(0, range * 2 + 1)) {
        const chunkTokens = estimateTokens(c.content);
        if (totalTokens + chunkTokens > MAX_TOTAL_TOKENS) {
          // Truncate to fit budget
          const remaining = MAX_TOTAL_TOKENS - totalTokens;
          if (remaining > 100) {
            const charLimit = remaining * 4;
            contextChunks.push({
              content: c.content.slice(0, charLimit),
              cfi: c.startCfi || "",
            });
          }
          break;
        }
        contextChunks.push({
          content: c.content,
          cfi: c.startCfi || "",
        });
        totalTokens += chunkTokens;
      }

      return {
        chapterTitle: chapterChunks[0]?.chapterTitle || "Unknown",
        chapterIndex: chapterIndex,
        context: contextChunks.map((c) => c.content).join("\n\n"),
        chunks: contextChunks,
        chunksIncluded: contextChunks.length,
        totalTokens,
        tokenBudget: MAX_TOTAL_TOKENS,
      };
    },
  };
}
