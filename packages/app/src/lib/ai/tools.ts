import { getChunks, getHighlights, getNotes, getBooks, getAllHighlights, getAllNotes, getReadingSessionsByDateRange } from "@/lib/db/database";
import { search } from "@/lib/rag/search";
import { getContextTools } from "./context-tools";
/**
 * AI Tool registration — conditional tool registration based on book state
 * Full implementation with RAG search pipeline integration
 * 
 * Tool Categories:
 * - RAG Tools: ragSearch, ragToc, ragContext
 * - Analysis Tools: summarize, extractEntities, analyzeArguments, findQuotes
 * - Annotation Tools: getAnnotations
 */
import type { SearchQuery, Skill } from "@/types";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

/** Create RAG search tool for a specific book */
function createRagSearchTool(bookId: string): ToolDefinition {
  return {
    name: "ragSearch",
    description:
      "Search book content using semantic or keyword search. Use this when the user asks about specific content, themes, or topics in the book.",
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

      return {
        results: results.map((r) => ({
          chapter: r.chunk.chapterTitle,
          content: r.chunk.content.slice(0, 500), // Truncate for context window
          score: Math.round(r.score * 1000) / 1000,
          matchType: r.matchType,
          highlights: r.highlights,
        })),
        totalResults: results.length,
      };
    },
  };
}

/** Create RAG TOC tool for a specific book */
function createRagTocTool(bookId: string): ToolDefinition {
  return {
    name: "ragToc",
    description:
      "Get the table of contents of the current book. Use this when the user wants to see the book structure or navigate to a specific chapter.",
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

      return {
        chapters: Array.from(chapters.entries()).map(([index, title]) => ({
          index,
          title,
        })),
        totalChapters: chapters.size,
      };
    },
  };
}

/** Create RAG context tool for a specific book */
function createRagContextTool(bookId: string): ToolDefinition {
  return {
    name: "ragContext",
    description:
      "Get surrounding text context for a specific chapter. Use this when the user asks about content near a specific location.",
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

      // Get surrounding chunks
      const contextChunks = chapterChunks.slice(0, range * 2 + 1);

      return {
        chapterTitle: chapterChunks[0]?.chapterTitle || "Unknown",
        context: contextChunks.map((c) => c.content).join("\n\n"),
        chunksIncluded: contextChunks.length,
      };
    },
  };
}

// ============================================
// Content Analysis Tools
// ============================================

/** Create summarize tool for a specific book */
function createSummarizeTool(bookId: string): ToolDefinition {
  return {
    name: "summarize",
    description:
      "Generate a summary of a chapter or the entire book. Use this when the user asks for a summary, overview, or brief of the content.",
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
        const content = chapterChunks.map((c) => c.content).join("\n\n");
        const truncatedContent = style === "brief" 
          ? content.slice(0, 3000) 
          : content.slice(0, 8000);

        return {
          scope: "chapter",
          chapterTitle: chapterChunks[0]?.chapterTitle,
          content: truncatedContent,
          instruction: style === "brief"
            ? "Generate a concise summary (2-3 sentences) of this chapter content."
            : "Generate a detailed summary covering main points, key arguments, and important details.",
        };
      }

      if (scope === "book") {
        const chapters = new Map<number, string>();

        for (const chunk of chunks) {
          if (!chapters.has(chunk.chapterIndex)) {
            chapters.set(chunk.chapterIndex, chunk.chapterTitle);
          }
        }

        const sampledContent: string[] = [];
        const chapterList = Array.from(chapters.entries()).sort((a, b) => a[0] - b[0]);

        for (const [idx, title] of chapterList) {
          const chapterChunks = chunks.filter((c) => c.chapterIndex === idx);
          const firstChunk = chapterChunks[0];
          if (firstChunk) {
            sampledContent.push(`\n## Chapter: ${title}\n${firstChunk.content.slice(0, 500)}`);
          }
        }

        return {
          scope: "book",
          totalChapters: chapters.size,
          content: sampledContent.join("\n").slice(0, style === "brief" ? 4000 : 10000),
          instruction: style === "brief"
            ? "Generate a concise book summary (1-2 paragraphs) covering the main theme and key points."
            : "Generate a comprehensive book summary covering: main theme, chapter-by-chapter overview, key arguments, and conclusions.",
        };
      }

      return { error: "Invalid scope. Use 'chapter' or 'book'." };
    },
  };
}

/** Create extract entities tool for a specific book */
function createExtractEntitiesTool(bookId: string): ToolDefinition {
  return {
    name: "extractEntities",
    description:
      "Extract named entities from the book content such as characters, places, concepts, organizations, and key terms. Use this when the user asks about characters, people, places, or concepts in the book.",
    parameters: {
      entityType: {
        type: "string",
        description: "Type of entities to extract: 'characters', 'places', 'concepts', 'organizations', or 'all'",
      },
      chapterIndex: {
        type: "number",
        description: "Specific chapter index (optional, extracts from entire book if not specified)",
      },
    },
    execute: async (args) => {
      const entityType = (args.entityType as string) || "all";
      const chapterIndex = args.chapterIndex as number | undefined;

      const chunks = await getChunks(bookId);
      const targetChunks = chapterIndex !== undefined
        ? chunks.filter((c) => c.chapterIndex === chapterIndex)
        : chunks;

      if (targetChunks.length === 0) {
        return { error: "No content found" };
      }

      const content = targetChunks
        .slice(0, 20)
        .map((c) => `[${c.chapterTitle}]\n${c.content}`)
        .join("\n\n")
        .slice(0, 8000);

      const entityInstructions: Record<string, string> = {
        characters: "Extract all character/person names mentioned. For each character, note their role and first appearance context.",
        places: "Extract all place names (cities, countries, locations). For each place, note its significance in the story.",
        concepts: "Extract key concepts, themes, and abstract ideas discussed. Explain each concept briefly.",
        organizations: "Extract organization names (companies, institutions, groups). Note their role in the content.",
        all: "Extract all named entities: characters, places, organizations, and key concepts. Categorize each entity.",
      };

      return {
        entityType,
        chapterIndex,
        chapterTitle: targetChunks[0]?.chapterTitle,
        content,
        instruction: entityInstructions[entityType] || entityInstructions.all,
      };
    },
  };
}

/** Create analyze arguments tool for a specific book */
function createAnalyzeArgumentsTool(bookId: string): ToolDefinition {
  return {
    name: "analyzeArguments",
    description:
      "Analyze the author's arguments, reasoning, and logical structure. Use this when the user asks about the author's viewpoint, arguments, logic, or critical analysis of the content.",
    parameters: {
      chapterIndex: {
        type: "number",
        description: "Specific chapter index to analyze (optional)",
      },
      focusType: {
        type: "string",
        description: "'main' for main arguments, 'evidence' for supporting evidence, 'structure' for logical structure, or 'all'",
      },
    },
    execute: async (args) => {
      const chapterIndex = args.chapterIndex as number | undefined;
      const focusType = (args.focusType as string) || "all";

      const chunks = await getChunks(bookId);
      const targetChunks = chapterIndex !== undefined
        ? chunks.filter((c) => c.chapterIndex === chapterIndex)
        : chunks.slice(0, 15);

      if (targetChunks.length === 0) {
        return { error: "No content found" };
      }

      const content = targetChunks
        .map((c) => `[${c.chapterTitle}]\n${c.content}`)
        .join("\n\n")
        .slice(0, 10000);

      const focusInstructions: Record<string, string> = {
        main: "Identify and explain the main arguments or thesis presented. What is the author trying to prove or convey?",
        evidence: "Identify the evidence, examples, and data used to support arguments. How strong is the supporting evidence?",
        structure: "Analyze the logical structure: how are arguments organized? What is the reasoning chain?",
        all: "Provide a comprehensive analysis: main arguments, supporting evidence, logical structure, and overall persuasiveness.",
      };

      return {
        focusType,
        chapterIndex,
        chapterTitle: targetChunks[0]?.chapterTitle,
        content,
        instruction: focusInstructions[focusType] || focusInstructions.all,
      };
    },
  };
}

/** Create find quotes tool for a specific book */
function createFindQuotesTool(bookId: string): ToolDefinition {
  return {
    name: "findQuotes",
    description:
      "Find notable quotes, passages, and memorable sentences from the book. Use this when the user asks for quotes, memorable passages, or beautiful language.",
    parameters: {
      quoteType: {
        type: "string",
        description: "'insightful' for wisdom/insights, 'beautiful' for literary beauty, 'controversial' for debate-worthy, or 'all'",
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
      const targetChunks = chapterIndex !== undefined
        ? chunks.filter((c) => c.chapterIndex === chapterIndex)
        : chunks;

      if (targetChunks.length === 0) {
        return { error: "No content found" };
      }

      const content = targetChunks
        .slice(0, 30)
        .map((c) => `[${c.chapterTitle}]\n${c.content}`)
        .join("\n\n")
        .slice(0, 12000);

      const quoteInstructions: Record<string, string> = {
        insightful: "Find quotes containing wisdom, insights, or thought-provoking ideas. Explain why each quote is significant.",
        beautiful: "Find quotes with beautiful language, vivid imagery, or literary merit. Note the stylistic elements.",
        controversial: "Find quotes that present controversial opinions or debate-worthy points. Explain the controversy.",
        all: "Find a mix of insightful, beautiful, and notable quotes. For each, explain its significance and context.",
      };

      return {
        quoteType,
        maxQuotes,
        chapterIndex,
        content,
        instruction: `${quoteInstructions[quoteType] || quoteInstructions.all} Return at most ${maxQuotes} quotes with their locations.`,
      };
    },
  };
}

/** Create get annotations tool for a specific book */
function createGetAnnotationsTool(bookId: string): ToolDefinition {
  return {
    name: "getAnnotations",
    description:
      "Get the user's highlights and notes from the book. Use this to reference what the user has marked as important.",
    parameters: {
      type: {
        type: "string",
        description: "'highlights' for highlights only, 'notes' for notes only, 'all' for both",
      },
    },
    execute: async (args) => {
      const type = (args.type as string) || "all";

      const result: {
        highlights?: Array<{ text: string; note?: string; chapterTitle?: string; color: string }>;
        notes?: Array<{ title: string; content: string; chapterTitle?: string }>;
      } = {};

      if (type === "highlights" || type === "all") {
        const highlights = await getHighlights(bookId);
        result.highlights = highlights.slice(0, 20).map((h) => ({
          text: h.text,
          note: h.note,
          chapterTitle: h.chapterTitle,
          color: h.color,
        }));
      }

      if (type === "notes" || type === "all") {
        const notes = await getNotes(bookId);
        result.notes = notes.slice(0, 20).map((n) => ({
          title: n.title,
          content: n.content,
          chapterTitle: n.chapterTitle,
        }));
      }

      return result;
    },
  };
}

/** Create compare sections tool for a specific book */
function createCompareSectionsTool(bookId: string): ToolDefinition {
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
        description: "'themes' for theme comparison, 'arguments' for argument comparison, 'style' for writing style, or 'all'",
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

      const content1 = chapter1Chunks.map((c) => c.content).join("\n\n").slice(0, 4000);
      const content2 = chapter2Chunks.map((c) => c.content).join("\n\n").slice(0, 4000);

      const compareInstructions: Record<string, string> = {
        themes: "Compare the themes discussed in both sections. What themes are shared? What themes are unique to each?",
        arguments: "Compare the arguments presented. Are they consistent? Contradictory? Complementary?",
        style: "Compare the writing style, tone, and language used in both sections.",
        all: "Provide a comprehensive comparison: themes, arguments, writing style, and any connections or contrasts.",
      };

      return {
        chapter1: {
          index: chapterIndex1,
          title: chapter1Chunks[0]?.chapterTitle,
          content: content1,
        },
        chapter2: {
          index: chapterIndex2,
          title: chapter2Chunks[0]?.chapterTitle,
          content: content2,
        },
        compareType,
        instruction: compareInstructions[compareType] || compareInstructions.all,
      };
    },
  };
}

// ============================================
// General Tools (no bookId required)
// ============================================

/** List all books in the user's library */
function createListBooksTool(): ToolDefinition {
  return {
    name: "listBooks",
    description:
      "List all books in the user's library, including titles, authors, reading progress, and basic metadata. Use this when the user asks about their books, reading list, or library.",
    parameters: {
      limit: {
        type: "number",
        description: "Maximum number of books to return (default: 20)",
      },
    },
    execute: async (args) => {
      const limit = (args.limit as number) || 20;
      const books = await getBooks();
      const result = books.slice(0, limit).map((b) => ({
        id: b.id,
        title: b.meta.title,
        author: b.meta.author,
        format: b.format,
        progress: b.progress,
        isVectorized: b.isVectorized,
        addedAt: b.addedAt,
        lastOpenedAt: b.lastOpenedAt,
      }));
      return { total: books.length, books: result };
    },
  };
}

/** Search highlights across all books */
function createSearchAllHighlightsTool(): ToolDefinition {
  return {
    name: "searchAllHighlights",
    description:
      "Get the user's recent highlights and annotations across ALL books. Use this when the user asks about their highlights, marked passages, or important notes without specifying a particular book.",
    parameters: {
      limit: {
        type: "number",
        description: "Maximum number of highlights to return (default: 20)",
      },
    },
    execute: async (args) => {
      const limit = (args.limit as number) || 20;
      const highlights = await getAllHighlights(limit);
      const books = await getBooks();
      const bookMap = new Map(books.map((b) => [b.id, b.meta.title]));

      return {
        total: highlights.length,
        highlights: highlights.map((h) => ({
          text: h.text,
          note: h.note,
          bookTitle: bookMap.get(h.bookId) || "Unknown",
          chapterTitle: h.chapterTitle,
          color: h.color,
          createdAt: h.createdAt,
        })),
      };
    },
  };
}

/** Search notes across all books */
function createSearchAllNotesTool(): ToolDefinition {
  return {
    name: "searchAllNotes",
    description:
      "Get the user's notes across ALL books. Use this when the user asks about their notes, thoughts, or writings without specifying a particular book.",
    parameters: {
      limit: {
        type: "number",
        description: "Maximum number of notes to return (default: 20)",
      },
    },
    execute: async (args) => {
      const limit = (args.limit as number) || 20;
      const notes = await getAllNotes(limit);
      const books = await getBooks();
      const bookMap = new Map(books.map((b) => [b.id, b.meta.title]));

      return {
        total: notes.length,
        notes: notes.map((n) => ({
          title: n.title,
          content: n.content,
          bookTitle: bookMap.get(n.bookId) || "Unknown",
          chapterTitle: n.chapterTitle,
          tags: n.tags,
          createdAt: n.createdAt,
        })),
      };
    },
  };
}

/** Get reading statistics across all books */
function createReadingStatsTool(): ToolDefinition {
  return {
    name: "getReadingStats",
    description:
      "Get the user's reading statistics, including total books, reading time, and recent activity. Use this when the user asks about their reading habits, statistics, or activity summary.",
    parameters: {
      days: {
        type: "number",
        description: "Number of recent days to include for activity stats (default: 30)",
      },
    },
    execute: async (args) => {
      const days = (args.days as number) || 30;
      const books = await getBooks();
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const sessions = await getReadingSessionsByDateRange(startDate, endDate);

      const totalReadingTimeMs = sessions.reduce((sum, s) => sum + s.totalActiveTime, 0);
      const totalPagesRead = sessions.reduce((sum, s) => sum + s.pagesRead, 0);
      const booksInProgress = books.filter((b) => b.progress > 0 && b.progress < 1);
      const booksCompleted = books.filter((b) => b.progress >= 1);

      return {
        library: {
          totalBooks: books.length,
          inProgress: booksInProgress.length,
          completed: booksCompleted.length,
        },
        recentActivity: {
          periodDays: days,
          totalSessions: sessions.length,
          totalReadingMinutes: Math.round(totalReadingTimeMs / 60000),
          totalPagesRead,
        },
        recentBooks: books.slice(0, 5).map((b) => ({
          title: b.meta.title,
          author: b.meta.author,
          progress: Math.round((b.progress || 0) * 100),
        })),
      };
    },
  };
}

/** Get general (non-book-specific) tools */
function getGeneralTools(): ToolDefinition[] {
  return [
    createListBooksTool(),
    createSearchAllHighlightsTool(),
    createSearchAllNotesTool(),
    createReadingStatsTool(),
  ];
}

/** Get available tools based on current state */
export function getAvailableTools(options: {
  bookId?: string | null;
  isVectorized: boolean;
  enabledSkills: Skill[];
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // General tools are always available (no bookId required)
  tools.push(...getGeneralTools());

  if (options.bookId) {
    // Context tools (always available when book is loaded)
    tools.push(...getContextTools(options.bookId));

    // RAG tools (require vectorization)
    if (options.isVectorized) {
      tools.push(
        createRagSearchTool(options.bookId),
        createRagTocTool(options.bookId),
        createRagContextTool(options.bookId),
      );
    }

    // Content analysis tools (always available when book is loaded)
    tools.push(
      createSummarizeTool(options.bookId),
      createExtractEntitiesTool(options.bookId),
      createAnalyzeArgumentsTool(options.bookId),
      createFindQuotesTool(options.bookId),
      createGetAnnotationsTool(options.bookId),
      createCompareSectionsTool(options.bookId),
    );
  }

  // Add custom skills
  for (const skill of options.enabledSkills) {
    tools.push(skillToTool(skill));
  }

  return tools;
}

/** Convert a Skill to a ToolDefinition */
function skillToTool(skill: Skill): ToolDefinition {
  const parameters: Record<string, ToolParameter> = {};
  for (const param of skill.parameters) {
    parameters[param.name] = {
      type: param.type,
      description: param.description,
      required: param.required,
    };
  }

  return {
    name: skill.name,
    description: skill.description,
    parameters,
    execute: async (args) => {
      // Custom skill execution — placeholder for user-defined logic
      return { result: `Skill '${skill.name}' executed`, args };
    },
  };
}
