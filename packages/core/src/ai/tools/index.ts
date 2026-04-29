/**
 * AI Tool registration — conditional tool registration based on book state
 * Full implementation with RAG search pipeline integration
 *
 * Tool Categories:
 * - RAG Tools: ragSearch, ragToc, ragContext
 * - Analysis Tools: summarize, extractEntities, analyzeArguments, findQuotes, compareSections
 * - Annotation Tools: getAnnotations, addCitation
 * - Library Tools: listBooks, searchAllHighlights, searchAllNotes, readingStats, classifyBooks, tagBooks, manageBookTags
 * - Skill Tools: getSkills, skillToTool
 * - Mindmap Tools: mindmap
 * - Context Tools: getCurrentChapter, getSelection, getReadingProgress, getRecentHighlights, getSurroundingContext
 */
import type { Skill } from "../../types";
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
  createClassifyBooksTool,
  createListBooksTool,
  createManageBookTagsTool,
  createReadingStatsTool,
  createSearchAllHighlightsTool,
  createSearchAllNotesTool,
  createTagBooksTool,
} from "./library-tools";
import { createMindmapTool } from "./mindmap-tools";
import { createRagContextTool, createRagSearchTool, createRagTocTool } from "./rag-tools";
import { createGetSkillsTool, skillToTool } from "./skill-tools";
import type { ToolDefinition } from "./tool-types";

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

      // Content analysis tools (require chunks from vectorization)
      tools.push(
        createSummarizeTool(options.bookId),
        createExtractEntitiesTool(options.bookId),
        createAnalyzeArgumentsTool(options.bookId),
        createFindQuotesTool(options.bookId),
        createCompareSectionsTool(options.bookId),
      );
    }

    // Annotation & citation tools (always available when book is loaded)
    tools.push(createGetAnnotationsTool(options.bookId), createAddCitationTool(options.bookId));
  }

  // Add custom skills
  for (const skill of options.enabledSkills) {
    tools.push(skillToTool(skill));
  }

  return tools;
}
