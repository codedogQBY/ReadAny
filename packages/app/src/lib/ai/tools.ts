import { getChunks } from "@/lib/db/database";
import { search } from "@/lib/rag/search";
/**
 * AI Tool registration — conditional tool registration based on book state
 * Full implementation with RAG search pipeline integration
 */
import type { SearchQuery, Skill } from "@/types";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

interface ToolParameter {
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

/** Get available tools based on current state */
export function getAvailableTools(options: {
  bookId?: string | null;
  isVectorized: boolean;
  enabledSkills: Skill[];
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // Only add RAG tools when book is vectorized
  if (options.isVectorized && options.bookId) {
    tools.push(
      createRagSearchTool(options.bookId),
      createRagTocTool(options.bookId),
      createRagContextTool(options.bookId),
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
