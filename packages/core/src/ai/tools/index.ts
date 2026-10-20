/**
 * AI Tool registration — conditional tool registration based on book state
 * Full implementation with RAG search pipeline integration
 *
 * Tool Categories:
 * - RAG Tools: ragSearch, ragToc, ragContext
 * - Analysis Tools: summarize, extractEntities, analyzeArguments, findQuotes, compareSections
 * - Annotation Tools: getAnnotations, addCitation
 * - Library Tools: listBooks, searchAllHighlights, searchAllNotes, readingStats, classifyBooks,
 *   tagBooks, manageBookTags, updateBookMetadata, manageBookGroups
 * - Skill Tools: getSkills, skillToTool
 * - Mindmap Tools: mindmap
 * - Context Tools: getCurrentChapter, getSelection, getReadingProgress, getRecentHighlights, getSurroundingContext
 */
import type { Skill } from "../../types";
import type { WebSearchContext } from "../parallel-search";
import {
  createAnalyzeArgumentsTool,
  createCompareSectionsTool,
  createExtractEntitiesTool,
  createFindQuotesTool,
  createSummarizeTool,
} from "./analysis-tools";
import { createAddCitationTool, createGetAnnotationsTool } from "./annotation-tools";
import { getContextTools } from "./context-tools";
import {
  createFallbackChapterContextTool,
  createFallbackResolveChapterReferenceTool,
  createFallbackSearchTool,
  createFallbackTocTool,
} from "./fallback-content-tools";
import {
  createClassifyBooksTool,
  createListBooksTool,
  createManageBookGroupsTool,
  createManageBookTagsTool,
  createReadingStatsTool,
  createSearchAllHighlightsTool,
  createSearchAllNotesTool,
  createTagBooksTool,
  createUpdateBookMetadataTool,
} from "./library-tools";
import { createMindmapTool } from "./mindmap-tools";
import {
  createRagContextTool,
  createRagSearchTool,
  createRagTocTool,
  createResolveChapterReferenceTool,
} from "./rag-tools";
import { createGetSkillsTool, skillToTool } from "./skill-tools";
import type { ToolDefinition } from "./tool-types";
import { getWebTools } from "./web-tools";

// Re-export types and key functions for external consumers
export type { ToolDefinition, ToolParameter } from "./tool-types";
export { getContextTools } from "./context-tools";

/** Get general (non-book-specific) tools */
function getGeneralTools(): ToolDefinition[] {
  return [
    createListBooksTool(),
    createSearchAllHighlightsTool(),
    createSearchAllNotesTool(),
    createReadingStatsTool(),
    createGetSkillsTool(),
    createMindmapTool(),
    createClassifyBooksTool(),
    createTagBooksTool(),
    createManageBookTagsTool(),
    createUpdateBookMetadataTool(),
    createManageBookGroupsTool(),
  ];
}

/** Get available tools based on current state */
export function getAvailableTools(options: {
  bookId?: string | null;
  isVectorized: boolean;
  enabledSkills: Skill[];
  webSearch?: WebSearchContext;
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
        createResolveChapterReferenceTool(options.bookId),
        createRagSearchTool(options.bookId),
        createRagTocTool(options.bookId),
        createRagContextTool(options.bookId),
      );

      // Content analysis tools (require chunks from vectorization)
      tools.push(
        createSummarizeTool(options.bookId),
        createExtractEntitiesTool(options.bookId),
        createAnalyzeArgumentsTool(options.bookId),
        createFindQuotesTool(options.bookId),
        createCompareSectionsTool(options.bookId),
      );
    } else {
      tools.push(
        createFallbackResolveChapterReferenceTool(options.bookId),
        createFallbackTocTool(options.bookId),
        createFallbackSearchTool(options.bookId),
        createFallbackChapterContextTool(options.bookId),
      );
    }

    // Citations are available for indexed chunks and for fallback sources that
    // can be validated against concrete reader segments.
    tools.push(createGetAnnotationsTool(options.bookId), createAddCitationTool(options.bookId));
  }

  if (options.webSearch) tools.push(...getWebTools(options.webSearch));

  // Add custom skills
  for (const skill of options.enabledSkills) {
    tools.push(skillToTool(skill));
  }

  return tools;
}
