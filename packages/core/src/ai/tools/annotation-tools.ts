/**
 * Annotation Tools — getAnnotations, addCitation
 */
import { getChunks, getHighlights, getNotes } from "../../db/database";
import { resolveFallbackCitationSource } from "../fallback-source-resolver";
import type { ToolDefinition } from "./tool-types";

/** Create get annotations tool for a specific book */
export function createGetAnnotationsTool(bookId: string): ToolDefinition {
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
        highlights?: Array<{
          id: string;
          text: string;
          note?: string;
          chapterTitle?: string;
          cfi: string;
          color: string;
          createdAt: number;
          updatedAt: number;
        }>;
        notes?: Array<{
          id: string;
          title: string;
          content: string;
          chapterTitle?: string;
          cfi?: string;
          tags: string[];
          createdAt: number;
          updatedAt: number;
        }>;
      } = {};

      if (type === "highlights" || type === "all") {
        const highlights = await getHighlights(bookId);
        result.highlights = highlights.slice(0, 20).map((h) => ({
          id: h.id,
          text: h.text,
          note: h.note,
          chapterTitle: h.chapterTitle,
          cfi: h.cfi,
          color: h.color,
          createdAt: h.createdAt,
          updatedAt: h.updatedAt,
        }));
      }

      if (type === "notes" || type === "all") {
        const notes = await getNotes(bookId);
        result.notes = notes.slice(0, 20).map((n) => ({
          id: n.id,
          title: n.title,
          content: n.content,
          chapterTitle: n.chapterTitle,
          cfi: n.cfi,
          tags: n.tags,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        }));
      }

      return result;
    },
  };
}

/** Create add citation tool for a specific book */
export function createAddCitationTool(bookId: string): ToolDefinition {
  return {
    name: "addCitation",
    description:
      "CRITICAL: Register a citation for specific content from the book. You MUST call this tool whenever you reference factual information from the book in your response. This creates a verifiable citation that users can click to jump to the exact location. Returns citation metadata that you should reference using [1], [2], [3] format in your response text. The citationIndex parameter determines the number — pass 1 for [1], 2 for [2], etc.",
    parameters: {
      citationIndex: {
        type: "number",
        description:
          "The citation number you will use in your response text. If you write [1] in your response, pass 1 here. If you write [2], pass 2. This MUST match the [N] marker in your response text.",
        required: true,
      },
      chapterTitle: {
        type: "string",
        description:
          "The chapter title where this content is from (get this from ragSearch or other tool results)",
        required: true,
      },
      chapterIndex: {
        type: "number",
        description: "The chapter index number (get this from ragSearch or other tool results)",
        required: true,
      },
      cfi: {
        type: "string",
        description:
          "REQUIRED: The exact CFI (Canonical Fragment Identifier) from ragSearch or other tool results. Extract the 'cfi' field from the search result or chunk that contains your quoted text. This CFI enables users to jump to the precise location in the book. NEVER pass empty string - if the tool result has a CFI, you MUST use it.",
        required: true,
      },
      quotedText: {
        type: "string",
        description:
          "A short excerpt of the actual text being cited (max 200 characters). This helps users verify the citation.",
        required: true,
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are citing this source",
        required: true,
      },
    },
    execute: async (args) => {
      const citationIndex = args.citationIndex as number;
      const chapterTitle = args.chapterTitle as string;
      const chapterIndex = args.chapterIndex as number;
      const aiCfi = (args.cfi as string) || "";
      const quotedText = (args.quotedText as string).slice(0, 200);

      // Refine CFI: the AI only gets chunk-level startCfi, which may point to the
      // beginning of a chunk while the quoted text is in the middle/end.
      // Use segmentCfis (per-paragraph CFIs) for precise navigation when available,
      // falling back to startCfi/endCfi heuristic for older data.
      let refinedCfi = aiCfi;
      let hasIndexedChapterChunks = false;
      let chunkLookupFailed = false;
      try {
        const chunks = await getChunks(bookId);
        const chapterChunks = chunks.filter((c) => c.chapterIndex === chapterIndex);
        hasIndexedChapterChunks = chapterChunks.length > 0;

        // Find the chunk that contains the quoted text
        const normalizedQuote = quotedText.replace(/\s+/g, "");
        let bestChunk = null;
        let bestPos = -1;
        for (const chunk of chapterChunks) {
          const normalizedContent = chunk.content.replace(/\s+/g, "");
          const pos = normalizedContent.indexOf(normalizedQuote);
          if (pos !== -1) {
            bestChunk = chunk;
            bestPos = pos;
            break;
          }
        }

        // Fallback: try partial match (first 30 chars of quoted text)
        if (!bestChunk && normalizedQuote.length > 30) {
          const partialQuote = normalizedQuote.slice(0, 30);
          for (const chunk of chapterChunks) {
            const normalizedContent = chunk.content.replace(/\s+/g, "");
            const pos = normalizedContent.indexOf(partialQuote);
            if (pos !== -1) {
              bestChunk = chunk;
              bestPos = pos;
              break;
            }
          }
        }

        if (bestChunk) {
          if (bestChunk.segmentCfis && bestChunk.segmentCfis.length > 0) {
            // Paragraph-level lookup: split chunk content into segments,
            // find which segment contains the quoted text, use that segment's CFI
            const segments = bestChunk.content.split("\n\n");
            let charsBefore = 0;
            let found = false;
            for (let i = 0; i < segments.length; i++) {
              const segLen = segments[i].replace(/\s+/g, "").length;
              if (charsBefore + segLen > bestPos && i < bestChunk.segmentCfis.length) {
                refinedCfi = bestChunk.segmentCfis[i];
                found = true;
                break;
              }
              charsBefore += segLen;
            }
            if (!found) {
              refinedCfi = bestChunk.startCfi || aiCfi;
            }
          } else {
            // No segmentCfis (old data): use startCfi/endCfi heuristic
            const normalizedContent = bestChunk.content.replace(/\s+/g, "");
            const contentLen = normalizedContent.length;
            if (bestPos > contentLen / 2 && bestChunk.endCfi) {
              refinedCfi = bestChunk.endCfi;
            } else {
              refinedCfi = bestChunk.startCfi || aiCfi;
            }
          }
        }
      } catch (e) {
        // If refinement fails, fall back to AI-provided CFI
        chunkLookupFailed = true;
        console.warn("[addCitation] CFI refinement failed, using AI-provided CFI:", e);
      }

      if (!hasIndexedChapterChunks && !chunkLookupFailed) {
        try {
          const fallbackSource = await resolveFallbackCitationSource({
            bookId,
            chapterIndex,
            quotedText,
            preferredCfi: aiCfi,
          });

          if (!fallbackSource) {
            return {
              error:
                "Could not resolve a precise CFI for this fallback citation. Use a plain chapter/source reference instead, or index the book for precise jump links.",
              chapterTitle,
              chapterIndex,
              quotedText,
            };
          }

          refinedCfi = fallbackSource.cfi;
        } catch (e) {
          return {
            error:
              e instanceof Error
                ? e.message
                : "Could not resolve a precise CFI for this fallback citation",
            chapterTitle,
            chapterIndex,
            quotedText,
          };
        }
      }

      // Return citation metadata
      // The message pipeline will assign citation numbers and create CitationPart objects
      return {
        type: "citation",
        bookId,
        chapterTitle,
        chapterIndex,
        cfi: refinedCfi,
        text: quotedText,
        citationIndex,
        timestamp: Date.now(),
        message: `Citation [${citationIndex}] registered: "${chapterTitle}" - Reference this in your response as [${citationIndex}].`,
      };
    },
  };
}
