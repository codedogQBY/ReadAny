import type { PermissionScope } from "./profiles.js";

export type ToolRisk = "low" | "medium" | "high";

export type ReadAnyTool = {
  name: string;
  description: string;
  scopes: PermissionScope[];
  risk: ToolRisk;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
};

export const READANY_TOOLS: readonly ReadAnyTool[] = [
  {
    name: "books.list",
    description: "List books in the ReadAny library.",
    scopes: ["book.read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          minimum: 1,
          maximum: 200,
          description: "Maximum number of books to return.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "books.search",
    description: "Search books by metadata and query text.",
    scopes: ["book.read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "Search query.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 200,
          description: "Maximum number of books to return.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "books.get",
    description: "Get metadata for a single book.",
    scopes: ["book.read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        bookId: {
          type: "string",
          minLength: 1,
          description: "ReadAny book id.",
        },
      },
      required: ["bookId"],
      additionalProperties: false,
    },
  },
  {
    name: "chapters.list",
    description: "List chapters for a ReadAny book from indexed chunks, or fallback EPUB/PDF structure when no chunks exist.",
    scopes: ["content.read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        bookId: {
          type: "string",
          minLength: 1,
          description: "ReadAny book id.",
        },
      },
      required: ["bookId"],
      additionalProperties: false,
    },
  },
  {
    name: "chapters.get",
    description: "Read a chapter from indexed chunks, or fallback EPUB/PDF content when no chunks exist.",
    scopes: ["content.read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        bookId: {
          type: "string",
          minLength: 1,
          description: "ReadAny book id.",
        },
        chapterId: {
          type: "string",
          minLength: 1,
          description: "Chapter id returned by chapters.list.",
        },
        chunkStart: {
          type: "number",
          minimum: 1,
          description: "1-based chunk offset within an indexed chapter. Ignored for fallback EPUB/PDF reads.",
        },
        chunkCount: {
          type: "number",
          minimum: 1,
          maximum: 200,
          description: "Maximum number of indexed chunks to return. Ignored for fallback EPUB/PDF reads.",
        },
        contentLimit: {
          type: "number",
          minimum: 1,
          maximum: 50000,
          description: "Maximum number of content characters to return.",
        },
      },
      required: ["bookId", "chapterId"],
      additionalProperties: false,
    },
  },
  {
    name: "context.get",
    description: "Read the latest desktop reader context snapshot, including current book, chapter, position, selection, surrounding text, and recent highlights when available.",
    scopes: ["content.read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        includeSelection: {
          type: "boolean",
          description: "Include the currently selected text when present. Defaults to true.",
        },
        includeSurroundingText: {
          type: "boolean",
          description: "Include visible/surrounding reader text. Defaults to true.",
        },
        includeHighlights: {
          type: "boolean",
          description: "Include recent highlights from the snapshot. Defaults to true.",
        },
        contentLimit: {
          type: "number",
          minimum: 1,
          maximum: 50000,
          description: "Maximum number of characters to return for each text field.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "bookmarks.list",
    description: "List bookmarks for a ReadAny book.",
    scopes: ["note.read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        bookId: {
          type: "string",
          minLength: 1,
          description: "ReadAny book id.",
        },
      },
      required: ["bookId"],
      additionalProperties: false,
    },
  },
  {
    name: "skills.list",
    description: "List user-defined ReadAny AI skills and whether they are enabled.",
    scopes: ["stats.read"],
    risk: "low",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
  },
  {
    name: "notes.search",
    description: "Search notes in the ReadAny library.",
    scopes: ["note.read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "Search query.",
        },
        bookId: {
          type: "string",
          minLength: 1,
          description: "Optional ReadAny book id filter.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 200,
          description: "Maximum number of notes to return.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "notes.export",
    description: "Export notes and highlights for one book to a markdown, JSON, Obsidian, or Notion file.",
    scopes: ["epub.export"],
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        bookId: {
          type: "string",
          minLength: 1,
          description: "ReadAny book id to export annotations for.",
        },
        outputPath: {
          type: "string",
          minLength: 1,
          description: "Output file path to write. Existing files are not overwritten unless overwrite is true.",
        },
        format: {
          type: "string",
          enum: ["markdown", "json", "obsidian", "notion"],
          description: "Export format. Defaults to markdown.",
        },
        overwrite: {
          type: "boolean",
          description: "Allow replacing an existing output file.",
        },
      },
      required: ["bookId", "outputPath"],
      additionalProperties: false,
    },
  },
  {
    name: "knowledge.export",
    description: "Export the ReadAny library knowledge graph, including book metadata, notes, and highlights, to a file.",
    scopes: ["epub.export"],
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        outputPath: {
          type: "string",
          minLength: 1,
          description: "Output file path to write. Existing files are not overwritten unless overwrite is true.",
        },
        format: {
          type: "string",
          enum: ["markdown", "json", "obsidian"],
          description: "Export format. Defaults to markdown.",
        },
        overwrite: {
          type: "boolean",
          description: "Allow replacing an existing output file.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 10000,
          description: "Maximum notes and highlights to include from each collection.",
        },
        includeBooks: {
          type: "boolean",
          description: "Include book metadata. Defaults to true.",
        },
        includeNotes: {
          type: "boolean",
          description: "Include notes. Defaults to true.",
        },
        includeHighlights: {
          type: "boolean",
          description: "Include highlights. Defaults to true.",
        },
      },
      required: ["outputPath"],
      additionalProperties: false,
    },
  },
  {
    name: "knowledge.search",
    description: "Search ReadAny book metadata, notes, and highlights with bounded snippets and source references.",
    scopes: ["knowledge.read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "Search query.",
        },
        bookId: {
          type: "string",
          minLength: 1,
          description: "Optional ReadAny book id filter.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of results to return.",
        },
        contentLimit: {
          type: "number",
          minimum: 40,
          maximum: 1000,
          description: "Maximum characters in each returned snippet.",
        },
        scanLimit: {
          type: "number",
          minimum: 1,
          maximum: 10000,
          description: "Maximum notes and highlights to scan from each collection.",
        },
        includeBooks: {
          type: "boolean",
          description: "Include book metadata matches. Defaults to true.",
        },
        includeNotes: {
          type: "boolean",
          description: "Include notes. Defaults to true.",
        },
        includeHighlights: {
          type: "boolean",
          description: "Include highlights. Defaults to true.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "highlights.search",
    description: "Search highlights in the ReadAny library.",
    scopes: ["note.read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "Search query.",
        },
        bookId: {
          type: "string",
          minLength: 1,
          description: "Optional ReadAny book id filter.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 200,
          description: "Maximum number of highlights to return.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "rag.search",
    description: "Search indexed ReadAny book chunks using BM25 keyword retrieval.",
    scopes: ["rag.search"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "Search query.",
        },
        bookId: {
          type: "string",
          minLength: 1,
          description: "ReadAny book id to search within.",
        },
        mode: {
          type: "string",
          enum: ["bm25", "hybrid", "vector"],
          description:
            "Search mode. bm25 is always available; hybrid and vector require configured embedding support.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 50,
          description: "Maximum number of chunks to return.",
        },
      },
      required: ["query", "bookId"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.inspect",
    description: "Inspect EPUB package metadata, manifest, spine, and table of contents.",
    scopes: ["epub.inspect"],
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        bookId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB book id.",
        },
      },
      required: ["bookId"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.draft.create",
    description: "Create a draft workspace for an EPUB without modifying the original book file.",
    scopes: ["epub.draft"],
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        bookId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB book id.",
        },
      },
      required: ["bookId"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.draft.discard",
    description: "Discard an EPUB draft workspace and mark it as inactive.",
    scopes: ["epub.draft"],
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB draft id.",
        },
        reason: {
          type: "string",
          minLength: 1,
          description: "Optional discard reason.",
        },
      },
      required: ["draftId"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.chapter.read",
    description: "Read a chapter resource from an EPUB draft workspace.",
    scopes: ["epub.draft"],
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB draft id.",
        },
        chapterId: {
          type: "string",
          minLength: 1,
          description: "EPUB manifest item id for a readable XHTML chapter.",
        },
        contentLimit: {
          type: "number",
          minimum: 1,
          maximum: 50000,
          description: "Maximum number of content characters to return.",
        },
        contentFormat: {
          type: "string",
          enum: ["text", "xhtml"],
          description:
            "Return readable text by default, or full XHTML for controlled draft editing.",
        },
      },
      required: ["draftId", "chapterId"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.chapter.patch",
    description: "Replace a readable XHTML chapter resource inside an EPUB draft workspace.",
    scopes: ["epub.draft"],
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB draft id.",
        },
        chapterId: {
          type: "string",
          minLength: 1,
          description: "EPUB manifest item id for the XHTML chapter to replace.",
        },
        xhtml: {
          type: "string",
          minLength: 1,
          description: "Full replacement XHTML document for the chapter.",
        },
      },
      required: ["draftId", "chapterId", "xhtml"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.chapters.patch",
    description:
      "Apply a bounded batch of chapter XHTML replacements to the same EPUB draft workspace.",
    scopes: ["epub.draft"],
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB draft id.",
        },
        patches: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          description:
            "Ordered chapter replacement plan. Each item is applied through the same draft history path as epub.chapter.patch.",
          items: {
            type: "object",
            properties: {
              chapterId: {
                type: "string",
                minLength: 1,
                description: "EPUB manifest item id for the XHTML chapter to replace.",
              },
              xhtml: {
                type: "string",
                minLength: 1,
                description: "Full replacement XHTML document for the chapter.",
              },
            },
            required: ["chapterId", "xhtml"],
            additionalProperties: false,
          },
        },
      },
      required: ["draftId", "patches"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.metadata.patch",
    description: "Patch metadata fields inside an EPUB draft workspace package document.",
    scopes: ["epub.draft"],
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB draft id.",
        },
        metadata: {
          type: "object",
          description:
            "Metadata fields to patch: title, creator, language, publisher, description, modified, subjects.",
          properties: {
            title: { type: "string", minLength: 1 },
            creator: { type: "string", minLength: 1 },
            language: { type: "string", minLength: 1 },
            publisher: { type: "string", minLength: 1 },
            description: { type: "string", minLength: 1 },
            modified: { type: "string", minLength: 1 },
            subjects: {
              type: "array",
              maxItems: 50,
              items: { type: "string", minLength: 1 },
            },
          },
          additionalProperties: false,
        },
      },
      required: ["draftId", "metadata"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.toc.rebuild",
    description: "Rebuild the EPUB3 nav table of contents from draft spine chapters.",
    scopes: ["epub.draft"],
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB draft id.",
        },
      },
      required: ["draftId"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.history",
    description: "Read operation history for an EPUB draft workspace.",
    scopes: ["epub.draft"],
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB draft id.",
        },
      },
      required: ["draftId"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.diff",
    description: "Compare an EPUB draft workspace against its original source EPUB.",
    scopes: ["epub.draft"],
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB draft id.",
        },
      },
      required: ["draftId"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.undo",
    description: "Undo one EPUB draft patch operation when no later edit changed the same resource.",
    scopes: ["epub.draft"],
    risk: "medium",
    inputSchema: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB draft id.",
        },
        operationId: {
          type: "string",
          minLength: 1,
          description: "Operation id from epub.history to undo.",
        },
      },
      required: ["draftId", "operationId"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.validate",
    description: "Validate an active EPUB draft before export without modifying files.",
    scopes: ["epub.export"],
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB draft id.",
        },
      },
      required: ["draftId"],
      additionalProperties: false,
    },
  },
  {
    name: "epub.export",
    description: "Export a validated EPUB draft to a new EPUB file.",
    scopes: ["epub.export"],
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          minLength: 1,
          description: "ReadAny EPUB draft id.",
        },
        outputPath: {
          type: "string",
          minLength: 1,
          description: "Destination EPUB path. Existing files are rejected unless overwrite is true.",
        },
        overwrite: {
          type: "boolean",
          description: "Allow replacing an existing output file.",
        },
      },
      required: ["draftId", "outputPath"],
      additionalProperties: false,
    },
  },
];

export function listTools(): readonly ReadAnyTool[] {
  return READANY_TOOLS;
}
