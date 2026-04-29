/**
 * Content Analysis Tools — summarize, extractEntities, analyzeArguments, findQuotes, compareSections
 */
import { getChunks } from "../../db/database";
import { estimateTokens } from "../../rag/chunker";
import type { ToolDefinition } from "./tool-types";

/** Create summarize tool for a specific book */
export function createSummarizeTool(bookId: string): ToolDefinition {
  const MAX_CHAPTER_TOKENS_BRIEF = 1000;
  const MAX_CHAPTER_TOKENS_DETAILED = 2500;
  const MAX_BOOK_TOKENS_BRIEF = 1500;
  const MAX_BOOK_TOKENS_DETAILED = 3500;

  return {
    name: "summarize",
    description:
      "Generate a summary of a chapter or the entire book. Returns book content that YOU must summarize. After receiving the results, call addCitation to cite the source, then write your summary. Do NOT call content retrieval tools again.",
    parameters: {
      scope: {
        type: "string",
        description: "'chapter' for current chapter summary, 'book' for full book summary",
        required: true,
      },
      chapterIndex: {
        type: "number",
        description: "Chapter index (required when scope is 'chapter')",
      },
      style: {
        type: "string",
        description: "'brief' for short summary, 'detailed' for comprehensive summary",
      },
    },
    execute: async (args) => {
      const scope = args.scope as "chapter" | "book";
      const chapterIndex = args.chapterIndex as number | undefined;
      const style = (args.style as "brief" | "detailed") || "brief";

      const chunks = await getChunks(bookId);

      if (scope === "chapter" && chapterIndex !== undefined) {
        const chapterChunks = chunks.filter((c) => c.chapterIndex === chapterIndex);
        if (chapterChunks.length === 0) {
          return { error: `Chapter ${chapterIndex} not found` };
        }

        const maxTokens =
          style === "brief" ? MAX_CHAPTER_TOKENS_BRIEF : MAX_CHAPTER_TOKENS_DETAILED;
        const truncatedChunks: Array<{
          content: string;
          cfi: string;
          chapterTitle: string;
          chapterIndex: number;
        }> = [];
        let totalTokens = 0;

        for (const c of chapterChunks) {
          const chunkTokens = estimateTokens(c.content);
          if (totalTokens + chunkTokens > maxTokens) {
            const remaining = maxTokens - totalTokens;
            if (remaining > 100) {
              truncatedChunks.push({
                content: c.content.slice(0, remaining * 4),
                cfi: c.startCfi || "",
                chapterTitle: c.chapterTitle,
                chapterIndex: c.chapterIndex,
              });
            }
            break;
          }
          truncatedChunks.push({
            content: c.content,
            cfi: c.startCfi || "",
            chapterTitle: c.chapterTitle,
            chapterIndex: c.chapterIndex,
          });
          totalTokens += chunkTokens;
        }

        return {
          scope: "chapter",
          chapterTitle: chapterChunks[0]?.chapterTitle,
          chapterIndex: chapterIndex,
          content: truncatedChunks.map((c) => c.content).join("\n\n"),
          chunks: truncatedChunks,
          totalTokens,
          tokenBudget: maxTokens,
          instruction:
            style === "brief"
              ? "Generate a concise summary (2-3 sentences) of this chapter content. Use the 'chunks' array to extract CFI for citations."
              : "Generate a detailed summary covering main points, key arguments, and important details. Use the 'chunks' array to extract CFI for citations.",
        };
      }

      if (scope === "book") {
        const chapters = new Map<number, string>();

        for (const chunk of chunks) {
          if (!chapters.has(chunk.chapterIndex)) {
            chapters.set(chunk.chapterIndex, chunk.chapterTitle);
          }
        }

        const maxTokens = style === "brief" ? MAX_BOOK_TOKENS_BRIEF : MAX_BOOK_TOKENS_DETAILED;
        const sampledContent: string[] = [];
        const chapterCfiMap: Array<{
          chapterIndex: number;
          chapterTitle: string;
          firstChunkCfi: string;
        }> = [];
        let totalTokens = 0;

        const chapterList = Array.from(chapters.entries()).sort((a, b) => a[0] - b[0]);

        for (const [idx, title] of chapterList) {
          const chapterChunks = chunks.filter((c) => c.chapterIndex === idx);
          const firstChunk = chapterChunks[0];
          if (!firstChunk) continue;

          const chunkPreview = `\n## Chapter: ${title}\n${firstChunk.content.slice(0, 500)}`;
          const chunkTokens = estimateTokens(chunkPreview);

          if (totalTokens + chunkTokens > maxTokens) {
            break;
          }

          sampledContent.push(chunkPreview);
          chapterCfiMap.push({
            chapterIndex: idx,
            chapterTitle: title,
            firstChunkCfi: firstChunk.startCfi || "",
          });
          totalTokens += chunkTokens;
        }

        return {
          scope: "book",
          totalChapters: chapters.size,
          content: sampledContent.join("\n"),
          chapters: chapterCfiMap,
          totalTokens,
          tokenBudget: maxTokens,
          instruction:
            style === "brief"
              ? "Generate a concise book summary (1-2 paragraphs) covering the main theme and key points. Use the 'chapters' array to extract CFI for citations."
              : "Generate a comprehensive book summary covering: main theme, chapter-by-chapter overview, key arguments, and conclusions. Use the 'chapters' array to extract CFI for citations.",
        };
      }

      return { error: "Invalid scope. Use 'chapter' or 'book'." };
    },
  };
}

/** Create extract entities tool for a specific book */
export function createExtractEntitiesTool(bookId: string): ToolDefinition {
  const MAX_TOKENS_CHAPTER = 2000;
  const MAX_TOKENS_BOOK = 3000;

  return {
    name: "extractEntities",
    description:
      "Extract named entities from the book content. Returns raw text from the book — YOU must read through it and identify the entities (characters, places, concepts, etc.) yourself. After receiving results, call addCitation for the source, then analyze the content and answer the user. Do NOT call content retrieval tools again.",
    parameters: {
      entityType: {
        type: "string",
        description:
          "Type of entities to extract: 'characters', 'places', 'concepts', 'organizations', or 'all'",
      },
      chapterIndex: {
        type: "number",
        description:
          "Specific chapter index (optional, extracts from entire book if not specified)",
      },
    },
    execute: async (args) => {
      const entityType = (args.entityType as string) || "all";
      const chapterIndex = args.chapterIndex as number | undefined;

      const chunks = await getChunks(bookId);
      const targetChunks =
        chapterIndex !== undefined ? chunks.filter((c) => c.chapterIndex === chapterIndex) : chunks;

      if (targetChunks.length === 0) {
        return { error: "No content found" };
      }

      const maxTokens = chapterIndex !== undefined ? MAX_TOKENS_CHAPTER : MAX_TOKENS_BOOK;
      const sampledChunks: typeof targetChunks = [];
      let totalTokens = 0;

      if (chapterIndex !== undefined) {
        // Single chapter: take chunks until budget exhausted
        for (const c of targetChunks) {
          const chunkTokens = estimateTokens(c.content);
          if (totalTokens + chunkTokens > maxTokens) break;
          sampledChunks.push(c);
          totalTokens += chunkTokens;
        }
      } else {
        // Whole book: sample from each chapter
        const byChapter = new Map<number, typeof targetChunks>();
        for (const c of targetChunks) {
          const list = byChapter.get(c.chapterIndex) || [];
          list.push(c);
          byChapter.set(c.chapterIndex, list);
        }

        for (const [, chapterChunks] of byChapter) {
          for (const c of chapterChunks.slice(0, 2)) {
            const chunkTokens = estimateTokens(c.content);
            if (totalTokens + chunkTokens > maxTokens) break;
            sampledChunks.push(c);
            totalTokens += chunkTokens;
          }
          if (totalTokens >= maxTokens) break;
        }
      }

      return {
        entityType,
        chapterIndex,
        chapterTitle: targetChunks[0]?.chapterTitle,
        content: sampledChunks.map((c) => `[${c.chapterTitle}]\n${c.content}`).join("\n\n"),
        chunks: sampledChunks.map((c) => ({
          content: c.content,
          cfi: c.startCfi || "",
          chapterTitle: c.chapterTitle,
          chapterIndex: c.chapterIndex,
        })),
        totalTokens,
        tokenBudget: maxTokens,
        instruction: `The above is raw book content. Read through it carefully and identify all ${entityType === "all" ? "named entities (characters, places, organizations, key concepts)" : entityType}. List each entity with a brief description based ONLY on what appears in this text. Use the 'chunks' array to extract CFI for citations. This is all the data you need — do NOT call any more tools.`,
      };
    },
  };
}

/** Create analyze arguments tool for a specific book */
export function createAnalyzeArgumentsTool(bookId: string): ToolDefinition {
  const MAX_TOKENS = 3000;

  return {
    name: "analyzeArguments",
    description:
      "Analyze the author's arguments, reasoning, and logical structure. Returns book content that YOU must analyze. After receiving the results, call addCitation to cite the source, then write your analysis. Do NOT call content retrieval tools again.",
    parameters: {
      chapterIndex: {
        type: "number",
        description: "Specific chapter index to analyze (optional)",
      },
      focusType: {
        type: "string",
        description:
          "'main' for main arguments, 'evidence' for supporting evidence, 'structure' for logical structure, or 'all'",
      },
    },
    execute: async (args) => {
      const chapterIndex = args.chapterIndex as number | undefined;
      const focusType = (args.focusType as string) || "all";

      const chunks = await getChunks(bookId);
      const targetChunks =
        chapterIndex !== undefined ? chunks.filter((c) => c.chapterIndex === chapterIndex) : chunks;

      if (targetChunks.length === 0) {
        return { error: "No content found" };
      }

      const sampledChunks: typeof targetChunks = [];
      let totalTokens = 0;

      for (const c of targetChunks) {
        const chunkTokens = estimateTokens(c.content);
        if (totalTokens + chunkTokens > MAX_TOKENS) break;
        sampledChunks.push(c);
        totalTokens += chunkTokens;
      }

      const focusInstructions: Record<string, string> = {
        main: "Identify and explain the main arguments or thesis presented. What is the author trying to prove or convey?",
        evidence:
          "Identify the evidence, examples, and data used to support arguments. How strong is the supporting evidence?",
        structure:
          "Analyze the logical structure: how are arguments organized? What is the reasoning chain?",
        all: "Provide a comprehensive analysis: main arguments, supporting evidence, logical structure, and overall persuasiveness.",
      };

      return {
        focusType,
        chapterIndex,
        chapterTitle: targetChunks[0]?.chapterTitle,
        content: sampledChunks.map((c) => `[${c.chapterTitle}]\n${c.content}`).join("\n\n"),
        chunks: sampledChunks.map((c) => ({
          content: c.content,
          cfi: c.startCfi || "",
          chapterTitle: c.chapterTitle,
          chapterIndex: c.chapterIndex,
        })),
        totalTokens,
        tokenBudget: MAX_TOKENS,
        instruction:
          (focusInstructions[focusType] || focusInstructions.all) +
          " Use the 'chunks' array to extract CFI for citations.",
      };
    },
  };
}

/** Create find quotes tool for a specific book */
export function createFindQuotesTool(bookId: string): ToolDefinition {
  const MAX_TOKENS = 4000;

  return {
    name: "findQuotes",
    description:
      "Find notable quotes, passages, and memorable sentences from the book. Returns book content that YOU must search through for quotes. After receiving the results, call addCitation for each quote's location, then present the quotes. Do NOT call content retrieval tools again.",
    parameters: {
      quoteType: {
        type: "string",
        description:
          "'insightful' for wisdom/insights, 'beautiful' for literary beauty, 'controversial' for debate-worthy, or 'all'",
      },
      chapterIndex: {
        type: "number",
        description: "Specific chapter index (optional)",
      },
      maxQuotes: {
        type: "number",
        description: "Maximum number of quotes to return (default: 5)",
      },
    },
    execute: async (args) => {
      const quoteType = (args.quoteType as string) || "all";
      const chapterIndex = args.chapterIndex as number | undefined;
      const maxQuotes = (args.maxQuotes as number) || 5;

      const chunks = await getChunks(bookId);
      const targetChunks =
        chapterIndex !== undefined ? chunks.filter((c) => c.chapterIndex === chapterIndex) : chunks;

      if (targetChunks.length === 0) {
        return { error: "No content found" };
      }

      const sampledChunks: typeof targetChunks = [];
      let totalTokens = 0;

      for (const c of targetChunks) {
        const chunkTokens = estimateTokens(c.content);
        if (totalTokens + chunkTokens > MAX_TOKENS) break;
        sampledChunks.push(c);
        totalTokens += chunkTokens;
      }

      const quoteInstructions: Record<string, string> = {
        insightful:
          "Find quotes containing wisdom, insights, or thought-provoking ideas. Explain why each quote is significant.",
        beautiful:
          "Find quotes with beautiful language, vivid imagery, or literary merit. Note the stylistic elements.",
        controversial:
          "Find quotes that present controversial opinions or debate-worthy points. Explain the controversy.",
        all: "Find a mix of insightful, beautiful, and notable quotes. For each, explain its significance and context.",
      };

      return {
        quoteType,
        maxQuotes,
        chapterIndex,
        content: sampledChunks.map((c) => `[${c.chapterTitle}]\n${c.content}`).join("\n\n"),
        chunks: sampledChunks.map((c) => ({
          content: c.content,
          cfi: c.startCfi || "",
          chapterTitle: c.chapterTitle,
          chapterIndex: c.chapterIndex,
        })),
        totalTokens,
        tokenBudget: MAX_TOKENS,
        instruction: `${quoteInstructions[quoteType] || quoteInstructions.all} Return at most ${maxQuotes} quotes with their locations. Use the 'chunks' array to extract CFI for citations.`,
      };
    },
  };
}

/** Create compare sections tool for a specific book */
export function createCompareSectionsTool(bookId: string): ToolDefinition {
  const MAX_TOKENS_PER_CHAPTER = 1500;

  return {
    name: "compareSections",
    description:
      "Compare two sections or chapters of the book. Use this when the user asks to compare, contrast, or find differences between parts of the book.",
    parameters: {
      chapterIndex1: {
        type: "number",
        description: "First chapter index to compare",
        required: true,
      },
      chapterIndex2: {
        type: "number",
        description: "Second chapter index to compare",
        required: true,
      },
      compareType: {
        type: "string",
        description:
          "'themes' for theme comparison, 'arguments' for argument comparison, 'style' for writing style, or 'all'",
      },
    },
    execute: async (args) => {
      const chapterIndex1 = args.chapterIndex1 as number;
      const chapterIndex2 = args.chapterIndex2 as number;
      const compareType = (args.compareType as string) || "all";

      const chunks = await getChunks(bookId);

      const chapter1Chunks = chunks.filter((c) => c.chapterIndex === chapterIndex1);
      const chapter2Chunks = chunks.filter((c) => c.chapterIndex === chapterIndex2);

      if (chapter1Chunks.length === 0 || chapter2Chunks.length === 0) {
        return { error: "One or both chapters not found" };
      }

      // Sample content with token budget for each chapter
      const sampleChapter = (chapterChunks: typeof chapter1Chunks) => {
        const sampled: typeof chapterChunks = [];
        let totalTokens = 0;

        for (const c of chapterChunks) {
          const chunkTokens = estimateTokens(c.content);
          if (totalTokens + chunkTokens > MAX_TOKENS_PER_CHAPTER) break;
          sampled.push(c);
          totalTokens += chunkTokens;
        }

        return {
          content: sampled.map((c) => c.content).join("\n\n"),
          chunks: sampled.map((c) => ({
            content: c.content,
            cfi: c.startCfi || "",
            chapterTitle: c.chapterTitle,
            chapterIndex: c.chapterIndex,
          })),
          totalTokens,
        };
      };

      const chapter1Sample = sampleChapter(chapter1Chunks);
      const chapter2Sample = sampleChapter(chapter2Chunks);

      const compareInstructions: Record<string, string> = {
        themes:
          "Compare the themes discussed in both sections. What themes are shared? What themes are unique to each?",
        arguments:
          "Compare the arguments presented. Are they consistent? Contradictory? Complementary?",
        style: "Compare the writing style, tone, and language used in both sections.",
        all: "Provide a comprehensive comparison: themes, arguments, writing style, and any connections or contrasts.",
      };

      return {
        chapter1: {
          index: chapterIndex1,
          title: chapter1Chunks[0]?.chapterTitle,
          content: chapter1Sample.content,
          chunks: chapter1Sample.chunks,
          totalTokens: chapter1Sample.totalTokens,
        },
        chapter2: {
          index: chapterIndex2,
          title: chapter2Chunks[0]?.chapterTitle,
          content: chapter2Sample.content,
          chunks: chapter2Sample.chunks,
          totalTokens: chapter2Sample.totalTokens,
        },
        compareType,
        tokenBudgetPerChapter: MAX_TOKENS_PER_CHAPTER,
        instruction:
          (compareInstructions[compareType] || compareInstructions.all) +
          " Use the 'chunks' arrays in chapter1 and chapter2 to extract CFI for citations.",
      };
    },
  };
}
