/**
 * Annotation Tools — getAnnotations, addCitation
 */
import { getChunks, getHighlights, getNotes } from "../../db/database";
import { resolveFallbackCitationSource } from "../fallback-source-resolver";
import type { ToolDefinition } from "./tool-types";

const DEFAULT_ANNOTATION_LIMIT = 20;
const MAX_ANNOTATION_LIMIT = 50;

interface AnnotationPageMetadata {
  total: number;
  returned: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeChapterTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return normalized || undefined;
}

function pageAnnotations<T extends { chapterTitle?: string }>(
  items: T[],
  options: { chapterTitle?: string; reverse: boolean; offset: number; limit: number },
): { page: T[]; metadata: AnnotationPageMetadata } {
  const matching = options.chapterTitle
    ? items.filter((item) => normalizeChapterTitle(item.chapterTitle) === options.chapterTitle)
    : items;
  const ordered = options.reverse ? [...matching].reverse() : matching;
  const page = ordered.slice(options.offset, options.offset + options.limit);

  return {
    page,
    metadata: {
      total: ordered.length,
      returned: page.length,
      offset: options.offset,
      limit: options.limit,
      hasMore: options.offset + page.length < ordered.length,
    },
  };
}

/** Create get annotations tool for a specific book */
export function createGetAnnotationsTool(bookId: string): ToolDefinition {
  return {
    name: "getAnnotations",
    description:
      "Get the user's highlights and notes from the book. For the current chapter, pass its exact chapterTitle. For recent or later chapters, use order 'reverse_book'. Results are paginated.",
    parameters: {
      type: {
        type: "string",
        description: "'highlights' for highlights only, 'notes' for notes only, 'all' for both",
      },
      chapterTitle: {
        type: "string",
        description:
          "Optional exact chapter title to filter before pagination. Match is case-insensitive and ignores surrounding/repeated whitespace.",
      },
      order: {
        type: "string",
        description:
          "'book' for beginning-to-end book position (default), or 'reverse_book' for later book positions first",
      },
      offset: {
        type: "number",
        description:
          "Zero-based annotation offset after chapter filtering and ordering (default 0)",
      },
      limit: {
        type: "number",
        description:
          "Maximum annotations of each requested type to return (default 20, maximum 50)",
      },
    },
    execute: async (args) => {
      const type = (args.type as string) || "all";
      const chapterTitle = normalizeChapterTitle(args.chapterTitle);
      const reverse = args.order === "reverse_book";
      const offset = clampInteger(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = clampInteger(args.limit, DEFAULT_ANNOTATION_LIMIT, 1, MAX_ANNOTATION_LIMIT);

      const result: {
        highlights?: Array<{ text: string; note?: string; chapterTitle?: string; color: string }>;
        notes?: Array<{ title: string; content: string; chapterTitle?: string }>;
        pagination: {
          highlights?: AnnotationPageMetadata;
          notes?: AnnotationPageMetadata;
        };
      } = { pagination: {} };

      if (type === "highlights" || type === "all") {
        const highlights = await getHighlights(bookId);
        const { page, metadata } = pageAnnotations(highlights, {
          chapterTitle,
          reverse,
          offset,
          limit,
        });
        result.highlights = page.map((h) => ({
          text: h.text,
          note: h.note,
          chapterTitle: h.chapterTitle,
          color: h.color,
        }));
        result.pagination.highlights = metadata;
      }

      if (type === "notes" || type === "all") {
        const notes = await getNotes(bookId);
        const { page, metadata } = pageAnnotations(notes, {
          chapterTitle,
          reverse,
          offset,
          limit,
        });
        result.notes = page.map((n) => ({
          title: n.title,
          content: n.content,
          chapterTitle: n.chapterTitle,
        }));
        result.pagination.notes = metadata;
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
      "Register a clickable citation for specific book content. Use a precise CFI returned by retrieval when available. For fallback content without a returned CFI, pass an empty cfi together with the exact chapterIndex and a verbatim quotedText excerpt; the tool will resolve the paragraph CFI. Never guess a CFI. After a successful call, use the matching [1], [2], [3] marker.",
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
