/**
 * Knowledge Tools — let AI read the user's ReadAny knowledge base.
 *
 * Read tools return exact vault context. Mutating tools only create
 * confirmation-required proposals so AI never silently overwrites a user's
 * durable notes.
 */
import {
  getKnowledgeBacklinks,
  getKnowledgeDocument,
  getKnowledgeDocuments,
  getKnowledgeLinks,
  searchKnowledgeDocuments,
} from "../../db/database";
import {
  buildKnowledgeDocumentTree,
  createKnowledgeDocumentSearchText,
  flattenKnowledgeDocumentTree,
  formatKnowledgeDocumentPath,
  orderKnowledgeDocuments,
  validateKnowledgeDocumentParent,
  validateKnowledgeDocumentSiblingTitle,
} from "../../knowledge/document-utils";
import { markdownToBasicTiptap } from "../../knowledge/editor-projection";
import type {
  AIConfig,
  JSONValue,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeLink,
  KnowledgeLinkRelation,
  KnowledgeLinkTargetKind,
} from "../../types";
import { generateId } from "../../utils/generate-id";
import { maybeCompressAndPersistKnowledgeSummary } from "../knowledge-memory";
import type { ToolDefinition } from "./tool-types";

const SEARCH_SCAN_LIMIT = 200;
const DEFAULT_RESULT_LIMIT = 8;
const MAX_CHILD_CONTEXT_COUNT = 8;
const MAX_LINK_CONTEXT_COUNT = 12;
const LINK_TARGET_KINDS = new Set<KnowledgeLinkTargetKind>([
  "book",
  "highlight",
  "document",
  "cfi",
  "url",
  "ai_message",
  "obsidian",
]);
const LINK_RELATIONS = new Set<KnowledgeLinkRelation>([
  "source",
  "references",
  "backlink",
  "related",
  "contains",
  "generated_from",
]);
const KNOWLEDGE_ROOT_TITLE = "Knowledge base";
const UNTITLED_DOCUMENT_TITLE = "Untitled document";
const ORPHANED_PARENT_TITLE = "Orphaned";
const KNOWLEDGE_SEARCH_MATCH_FIELDS = [
  "title",
  "path",
  "tags",
  "excerpt",
  "summary",
  "content",
] as const;

type KnowledgeSearchMatchField = (typeof KNOWLEDGE_SEARCH_MATCH_FIELDS)[number];

function asPositiveLimit(value: unknown, fallback: number): number {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 30) : fallback;
}

function asPositiveNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : undefined;
}

function normalizeQuery(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeType(value: unknown): KnowledgeDocumentType | undefined {
  const type = String(value ?? "").trim();
  if (!type || type === "all") return undefined;
  const allowed = new Set<KnowledgeDocumentType>([
    "book_home",
    "folder",
    "standalone_note",
    "highlight_note",
    "review",
    "summary",
    "imported_markdown",
  ]);
  return allowed.has(type as KnowledgeDocumentType) ? (type as KnowledgeDocumentType) : undefined;
}

function normalizeDocumentType(value: unknown): KnowledgeDocumentType {
  return normalizeType(value) ?? "standalone_note";
}

function normalizeParentId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = String(value).trim();
  if (!raw || ["root", "none", "null"].includes(raw.toLowerCase())) return undefined;
  return raw;
}

function normalizeLinkTargetKind(value: unknown): KnowledgeLinkTargetKind | null {
  const kind = String(value ?? "").trim();
  return LINK_TARGET_KINDS.has(kind as KnowledgeLinkTargetKind)
    ? (kind as KnowledgeLinkTargetKind)
    : null;
}

function normalizeLinkRelation(value: unknown): KnowledgeLinkRelation | null {
  const relation = String(value ?? "").trim();
  return LINK_RELATIONS.has(relation as KnowledgeLinkRelation)
    ? (relation as KnowledgeLinkRelation)
    : null;
}

function parseTags(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = String(value).trim();
  if (!raw) return [];

  let values: unknown[];
  if (raw.startsWith("[")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("tags JSON must be an array");
    values = parsed;
  } else {
    values = raw.split(/[,，\n]/);
  }

  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeTagMode(value: unknown): "add" | "remove" | "set" {
  const mode = String(value ?? "").trim();
  return mode === "remove" || mode === "set" ? mode : "add";
}

function applyTagMode(
  currentTags: readonly string[],
  requestedTags: readonly string[],
  mode: "add" | "remove" | "set",
): string[] {
  const normalizedCurrent = [...new Set(currentTags.map((tag) => tag.trim()).filter(Boolean))];
  const normalizedRequested = [...new Set(requestedTags.map((tag) => tag.trim()).filter(Boolean))];

  if (mode === "set") return normalizedRequested;
  if (mode === "remove") {
    const removeSet = new Set(normalizedRequested);
    return normalizedCurrent.filter((tag) => !removeSet.has(tag));
  }
  return [...new Set([...normalizedCurrent, ...normalizedRequested])];
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function createExcerpt(markdown: string): string | undefined {
  const text = compactText(
    markdown.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~\-[\]()]/g, " "),
  );
  return text ? text.slice(0, 220) : undefined;
}

function markdownToKnowledgeJson(markdown: string): JSONValue {
  return markdownToBasicTiptap(markdown) as unknown as JSONValue;
}

function sameOptionalString(left: string | undefined, right: string | undefined): boolean {
  return (left || undefined) === (right || undefined);
}

function parentValidationError(reason: string): string {
  return `Invalid parentId: ${reason}`;
}

function titleValidationError(reason: string): string {
  return `Invalid title: ${reason}`;
}

async function resolveCreateParentContext({
  type,
  bookId,
  parentId,
}: {
  type: KnowledgeDocumentType;
  bookId?: string;
  parentId?: string;
}): Promise<{ bookId?: string; parent?: KnowledgeDocument; error?: string }> {
  if (!parentId) return { bookId };
  if (type === "book_home") return { bookId, error: parentValidationError("book_home_locked") };

  const parent = await getKnowledgeDocument(parentId);
  if (!parent) return { bookId, error: parentValidationError("missing_parent") };
  if (parent.type !== "folder")
    return { bookId, error: parentValidationError("parent_not_folder") };
  if (bookId && !sameOptionalString(bookId, parent.bookId)) {
    return { bookId, error: parentValidationError("book_mismatch") };
  }

  return { bookId: bookId ?? parent.bookId, parent };
}

async function validateUpdateParentChange(
  document: KnowledgeDocument,
  parentId: string | undefined,
): Promise<string | null> {
  const documents = await getKnowledgeDocuments({
    ...(document.bookId ? { bookId: document.bookId } : {}),
    limit: 5000,
  });
  const validation = validateKnowledgeDocumentParent(document.id, parentId, documents);
  if (!validation.ok) return parentValidationError(validation.reason ?? "invalid_parent");

  if (!parentId) return null;
  const parent = documents.find((item) => item.id === parentId);
  if (!parent) return parentValidationError("missing_parent");
  if (!sameOptionalString(parent.bookId, document.bookId)) {
    return parentValidationError("book_mismatch");
  }
  return null;
}

function createSnippet(document: KnowledgeDocument, query: string): string {
  const source = compactText(document.excerpt || document.summaryMd || document.contentMd || "");
  if (!source) return "";
  if (!query) return source.slice(0, 320);

  const lower = source.toLowerCase();
  const index = lower.indexOf(query);
  if (index === -1) return source.slice(0, 320);

  const start = Math.max(0, index - 120);
  const end = Math.min(source.length, index + query.length + 200);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < source.length ? "..." : "";
  return `${prefix}${source.slice(start, end)}${suffix}`;
}

function scoreDocument(
  document: KnowledgeDocument,
  query: string,
  documentsById = createDocumentMap([document]),
): number {
  if (!query) return 1;

  let score = 0;
  const title = document.title.toLowerCase();
  const path = createDocumentPath(document, documentsById).toLowerCase();
  const excerpt = (document.excerpt || "").toLowerCase();
  const summary = (document.summaryMd || "").toLowerCase();
  const content = document.contentMd.toLowerCase();
  const tags = document.tags.join(" ").toLowerCase();

  if (title.includes(query)) score += 8;
  if (path.includes(query)) score += 6;
  if (tags.includes(query)) score += 5;
  if (excerpt.includes(query)) score += 3;
  if (summary.includes(query)) score += 2;
  if (content.includes(query)) score += 1;
  return score;
}

function createKnowledgeSearchMatchFields(
  document: KnowledgeDocument,
  query: string,
  documentsById = createDocumentMap([document]),
): KnowledgeSearchMatchField[] {
  if (!query) return [];

  const fieldText: Record<KnowledgeSearchMatchField, string> = {
    title: document.title,
    path: createDocumentPath(document, documentsById),
    tags: document.tags.join(" "),
    excerpt: document.excerpt || "",
    summary: document.summaryMd || "",
    content: document.contentMd,
  };

  return KNOWLEDGE_SEARCH_MATCH_FIELDS.filter((field) =>
    fieldText[field].toLowerCase().includes(query),
  );
}

function bookKnowledgePriority(document: KnowledgeDocument): number {
  const typeScore: Record<KnowledgeDocumentType, number> = {
    book_home: 7,
    summary: 6,
    review: 5,
    standalone_note: 4,
    imported_markdown: 3,
    highlight_note: 2,
    folder: 1,
  };
  return typeScore[document.type];
}

function bookKnowledgeSignal(document: KnowledgeDocument): number {
  return (
    (document.summaryMd?.trim() ? 12 : 0) +
    (document.excerpt?.trim() ? 6 : 0) +
    (document.contentMd?.trim() ? 3 : 0)
  );
}

function sortBookKnowledgeDocuments(documents: KnowledgeDocument[]): KnowledgeDocument[] {
  return [...documents].sort(
    (left, right) =>
      bookKnowledgePriority(right) - bookKnowledgePriority(left) ||
      bookKnowledgeSignal(right) - bookKnowledgeSignal(left) ||
      right.updatedAt - left.updatedAt ||
      right.createdAt - left.createdAt,
  );
}

function createDocumentPath(
  document: KnowledgeDocument,
  documentsById: Map<string, KnowledgeDocument>,
): string {
  return formatKnowledgeDocumentPath(document, Array.from(documentsById.values()), {
    rootTitle: KNOWLEDGE_ROOT_TITLE,
    untitledTitle: UNTITLED_DOCUMENT_TITLE,
    orphanedParentTitle: ORPHANED_PARENT_TITLE,
    includeOrphanedParent: true,
  });
}

function createDocumentMap(documents: KnowledgeDocument[]): Map<string, KnowledgeDocument> {
  return new Map(documents.map((document) => [document.id, document]));
}

function createChildrenByParentId(
  documents: KnowledgeDocument[],
): Map<string, KnowledgeDocument[]> {
  const childrenByParentId = new Map<string, KnowledgeDocument[]>();
  for (const document of documents) {
    if (!document.parentId) continue;
    const children = childrenByParentId.get(document.parentId) ?? [];
    children.push(document);
    childrenByParentId.set(document.parentId, children);
  }

  for (const [parentId, children] of childrenByParentId) {
    childrenByParentId.set(parentId, orderKnowledgeDocuments(children));
  }

  return childrenByParentId;
}

function createDraftTargetPath({
  title,
  parentId,
  documentsById,
}: {
  title: string;
  parentId?: string;
  documentsById: Map<string, KnowledgeDocument>;
}): string {
  const safeTitle = title.trim() || UNTITLED_DOCUMENT_TITLE;
  if (!parentId) return [KNOWLEDGE_ROOT_TITLE, safeTitle].join(" / ");

  const parent = documentsById.get(parentId);
  if (!parent) return [KNOWLEDGE_ROOT_TITLE, ORPHANED_PARENT_TITLE, safeTitle].join(" / ");
  return [createDocumentPath(parent, documentsById), safeTitle].join(" / ");
}

function documentSummary(
  document: KnowledgeDocument,
  query = "",
  includeContent = false,
  documentsById = createDocumentMap([document]),
  childrenByParentId = createChildrenByParentId([...documentsById.values()]),
) {
  const parent = document.parentId ? documentsById.get(document.parentId) : undefined;
  const children = childrenByParentId.get(document.id) ?? [];
  const matchFields = createKnowledgeSearchMatchFields(document, query, documentsById);
  return {
    id: document.id,
    bookId: document.bookId,
    parentId: document.parentId,
    parentTitle: parent?.title,
    path: createDocumentPath(document, documentsById),
    type: document.type,
    isFolder: document.type === "folder",
    title: document.title,
    tags: document.tags,
    excerpt: document.excerpt,
    summary: document.summaryMd,
    snippet: createSnippet(document, query),
    matchFields: matchFields.length > 0 ? matchFields : undefined,
    childCount: children.length,
    children: children.slice(0, MAX_CHILD_CONTEXT_COUNT).map((child) => ({
      id: child.id,
      type: child.type,
      title: child.title,
      path: createDocumentPath(child, documentsById),
      updatedAt: child.updatedAt,
    })),
    updatedAt: document.updatedAt,
    content: includeContent ? document.contentMd : undefined,
  };
}

function documentPathContext(
  document: KnowledgeDocument,
  documentsById: Map<string, KnowledgeDocument>,
  childrenByParentId = createChildrenByParentId([...documentsById.values()]),
) {
  const summary = documentSummary(document, "", false, documentsById, childrenByParentId);
  return {
    id: summary.id,
    bookId: summary.bookId,
    parentId: summary.parentId,
    type: summary.type,
    title: summary.title,
    path: summary.path,
  };
}

function linkTargetContext(
  link: KnowledgeLink,
  documentsById: Map<string, KnowledgeDocument>,
  childrenByParentId = createChildrenByParentId([...documentsById.values()]),
) {
  const targetDocument = link.toKind === "document" ? documentsById.get(link.toId) : undefined;
  return {
    id: link.id,
    relation: link.relation,
    toKind: link.toKind,
    toId: link.toId,
    label: link.label,
    cfi: link.cfi,
    target: targetDocument
      ? documentPathContext(targetDocument, documentsById, childrenByParentId)
      : undefined,
  };
}

function backlinkContext(
  backlink: { link: KnowledgeLink; fromDocument: KnowledgeDocument },
  documentsById: Map<string, KnowledgeDocument>,
  childrenByParentId = createChildrenByParentId([...documentsById.values()]),
) {
  return {
    id: backlink.link.id,
    relation: backlink.link.relation,
    label: backlink.link.label,
    cfi: backlink.link.cfi,
    from: documentPathContext(backlink.fromDocument, documentsById, childrenByParentId),
  };
}

export function createSearchKnowledgeBaseTool(): ToolDefinition {
  return {
    name: "searchKnowledgeBase",
    description:
      "Search the user's ReadAny knowledge base documents across books and standalone notes. Use this when the user asks about their saved knowledge, book home pages, reviews, summaries, or long-form notes.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are searching the knowledge base",
        required: true,
      },
      query: {
        type: "string",
        description:
          "Keyword or phrase to search for in titles, vault paths, tags, excerpts, and content",
      },
      bookId: {
        type: "string",
        description: "Optional book id to restrict the search to one book",
      },
      type: {
        type: "string",
        description:
          "Optional document type: book_home, folder, standalone_note, highlight_note, review, summary, imported_markdown, or all",
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (default 8, max 30)",
      },
    },
    execute: async (args) => {
      const query = normalizeQuery(args.query);
      const bookId = String(args.bookId ?? "").trim() || undefined;
      const type = normalizeType(args.type);
      const limit = asPositiveLimit(args.limit, DEFAULT_RESULT_LIMIT);
      const documents = await searchKnowledgeDocuments({
        query,
        bookId,
        type,
        limit: SEARCH_SCAN_LIMIT,
      });
      const pathContextDocuments = await getKnowledgeDocuments({
        ...(bookId ? { bookId } : {}),
        limit: 5000,
      });
      const documentsById = createDocumentMap([...pathContextDocuments, ...documents]);
      const childrenByParentId = createChildrenByParentId([...documentsById.values()]);
      const pathMatchedDocuments = query
        ? pathContextDocuments.filter((document) => {
            if (type && document.type !== type) return false;
            return createKnowledgeDocumentSearchText(document, [...documentsById.values()], {
              rootTitle: KNOWLEDGE_ROOT_TITLE,
              untitledTitle: UNTITLED_DOCUMENT_TITLE,
              orphanedParentTitle: ORPHANED_PARENT_TITLE,
              includeOrphanedParent: true,
            }).includes(query);
          })
        : [];
      const candidateDocuments = Array.from(
        new Map(
          [...documents, ...pathMatchedDocuments].map((document) => [document.id, document]),
        ).values(),
      );

      const scored = candidateDocuments
        .map((document) => ({ document, score: scoreDocument(document, query, documentsById) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.document.updatedAt - a.document.updatedAt);

      return {
        total: scored.length,
        showing: Math.min(scored.length, limit),
        documents: scored
          .slice(0, limit)
          .map((item) =>
            documentSummary(item.document, query, false, documentsById, childrenByParentId),
          ),
      };
    },
  };
}

export function createGetBookKnowledgeTool(bookId: string): ToolDefinition {
  return {
    name: "getBookKnowledge",
    description:
      "Get ReadAny knowledge documents for the current book, including the book home page, reviews, summaries, and expanded highlight notes. Use this to incorporate the user's own durable notes before answering.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you need this book's knowledge documents",
        required: true,
      },
      type: {
        type: "string",
        description:
          "Optional document type: book_home, folder, standalone_note, highlight_note, review, summary, imported_markdown, or all",
      },
      includeContent: {
        type: "boolean",
        description: "Return full Markdown content instead of only snippets and excerpts",
      },
      limit: {
        type: "number",
        description: "Maximum number of documents to return (default 8, max 30)",
      },
    },
    execute: async (args) => {
      const type = normalizeType(args.type);
      const includeContent = args.includeContent === true;
      const limit = asPositiveLimit(args.limit, DEFAULT_RESULT_LIMIT);
      const pathContextDocuments = await getKnowledgeDocuments({ bookId, limit: 5000 });
      const matchingDocuments =
        type === "folder"
          ? flattenKnowledgeDocumentTree(buildKnowledgeDocumentTree(pathContextDocuments).roots)
              .map((node) => node.document)
              .filter((document) => document.type === "folder")
          : sortBookKnowledgeDocuments(
              type
                ? pathContextDocuments.filter((document) => document.type === type)
                : pathContextDocuments.filter((document) => document.type !== "folder"),
            );
      const documents = matchingDocuments.slice(0, limit);
      const documentsById = createDocumentMap(pathContextDocuments);
      const childrenByParentId = createChildrenByParentId([...documentsById.values()]);

      return {
        bookId,
        total: matchingDocuments.length,
        showing: documents.length,
        documents: documents.map((document) =>
          documentSummary(document, "", includeContent, documentsById, childrenByParentId),
        ),
      };
    },
  };
}

export function createGetKnowledgeDocumentTool(): ToolDefinition {
  return {
    name: "getKnowledgeDocument",
    description:
      "Read one exact ReadAny knowledge document by stable document id after searchKnowledgeBase or another tool surfaces it. Use this before quoting or updating a specific knowledge document so the answer sees the current title, path, children, tags, summary, and optional full Markdown content.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why this exact knowledge document is needed",
        required: true,
      },
      documentId: {
        type: "string",
        description: "Stable ReadAny knowledge document id to read",
        required: true,
      },
      includeContent: {
        type: "boolean",
        description: "Return full Markdown content instead of only snippets and excerpts",
      },
    },
    execute: async (args) => {
      const documentId = String(args.documentId ?? "").trim();
      if (!documentId) return { success: false, error: "documentId is required" };

      const document = await getKnowledgeDocument(documentId);
      if (!document) {
        return {
          success: false,
          error: "Knowledge document not found",
          documentId,
        };
      }

      const includeContent = args.includeContent === true;
      const [pathContextDocuments, outgoingLinks, backlinks] = await Promise.all([
        getKnowledgeDocuments({
          ...(document.bookId ? { bookId: document.bookId } : {}),
          limit: 5000,
        }),
        getKnowledgeLinks(documentId),
        getKnowledgeBacklinks(documentId, MAX_LINK_CONTEXT_COUNT),
      ]);
      const pathContextDocumentsById = createDocumentMap([...pathContextDocuments, document]);
      const missingTargetDocumentIds = [
        ...new Set(
          outgoingLinks
            .filter(
              (link) => link.toKind === "document" && !pathContextDocumentsById.has(link.toId),
            )
            .map((link) => link.toId)
            .slice(0, MAX_LINK_CONTEXT_COUNT),
        ),
      ];
      const linkedTargetDocuments = (
        await Promise.all(
          missingTargetDocumentIds.map((targetId) => getKnowledgeDocument(targetId)),
        )
      ).filter((item): item is KnowledgeDocument => !!item);
      const documentsById = createDocumentMap([
        ...pathContextDocuments,
        document,
        ...linkedTargetDocuments,
        ...backlinks.map((backlink) => backlink.fromDocument),
      ]);
      const childrenByParentId = createChildrenByParentId([...documentsById.values()]);
      const summary = documentSummary(
        document,
        "",
        includeContent,
        documentsById,
        childrenByParentId,
      );

      return {
        success: true,
        documentId,
        bookId: document.bookId,
        path: summary.path,
        document: summary,
        outgoingLinks: outgoingLinks
          .slice(0, MAX_LINK_CONTEXT_COUNT)
          .map((link) => linkTargetContext(link, documentsById, childrenByParentId)),
        backlinks: backlinks.map((backlink) =>
          backlinkContext(backlink, documentsById, childrenByParentId),
        ),
      };
    },
  };
}

export function createCompressKnowledgeDocumentSummaryTool(aiConfig: AIConfig): ToolDefinition {
  return {
    name: "compressKnowledgeDocumentSummary",
    description:
      "Compress and persist a derived summary cache for a long ReadAny knowledge document. This does not rewrite the user's document content; it only updates the summary used for future retrieval and memory.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why this knowledge document needs compact memory",
        required: true,
      },
      documentId: {
        type: "string",
        description: "Knowledge document id to summarize",
        required: true,
      },
      minSourceChars: {
        type: "number",
        description:
          "Optional minimum source length before compression. Defaults to the app threshold.",
      },
      maxSourceChars: {
        type: "number",
        description:
          "Optional maximum source characters sent to the model. Defaults to the app threshold.",
      },
      maxSummaryChars: {
        type: "number",
        description:
          "Optional maximum summary characters to persist. Defaults to the app threshold.",
      },
    },
    execute: async (args) => {
      const documentId = String(args.documentId ?? "").trim();
      if (!documentId) return { success: false, error: "documentId is required" };

      const document = await getKnowledgeDocument(documentId);
      if (!document) return { success: false, error: "Knowledge document not found" };

      const minSourceChars = asPositiveNumber(args.minSourceChars);
      const maxSourceChars = asPositiveNumber(args.maxSourceChars);
      const maxSummaryChars = asPositiveNumber(args.maxSummaryChars);
      const compressionOptions = {
        ...(minSourceChars ? { minSourceChars } : {}),
        ...(maxSourceChars ? { maxSourceChars } : {}),
        ...(maxSummaryChars ? { maxSummaryChars } : {}),
      };
      const result = await maybeCompressAndPersistKnowledgeSummary(
        document,
        aiConfig,
        compressionOptions,
      );
      const projectedDocument =
        result.persisted && result.state
          ? {
              ...document,
              summaryMd: result.state.summaryMd,
              summarySourceFingerprint: result.state.sourceFingerprint,
              summarySourceUpdatedAt: result.state.sourceUpdatedAt,
              summaryUpdatedAt: result.state.compressedAt,
            }
          : document;
      const pathContextDocuments = await getKnowledgeDocuments({
        ...(document.bookId ? { bookId: document.bookId } : {}),
        limit: 5000,
      });
      const documentsById = createDocumentMap([...pathContextDocuments, projectedDocument]);
      const childrenByParentId = createChildrenByParentId([...documentsById.values()]);
      const summary = documentSummary(
        projectedDocument,
        "",
        false,
        documentsById,
        childrenByParentId,
      );

      return {
        success: result.status !== "failed",
        status: result.status,
        persisted: result.persisted,
        documentId,
        path: summary.path,
        document: summary,
        reason: result.plan.reason,
        sourceChars: result.plan.sourceChars,
        summaryMd: result.summaryMd ?? result.state?.summaryMd ?? document.summaryMd,
        error: result.error,
      };
    },
  };
}

export function createProposeKnowledgeDocumentCreateTool(): ToolDefinition {
  return {
    name: "proposeKnowledgeDocumentCreate",
    description:
      "Create a confirmation-required draft for a new ReadAny knowledge document. This tool NEVER saves data. Use it when the user asks AI to create a durable note, summary, review, or knowledge document, then ask the user to confirm applying the draft.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are drafting a new knowledge document",
        required: true,
      },
      title: {
        type: "string",
        description: "Proposed document title",
        required: true,
      },
      contentMd: {
        type: "string",
        description:
          "Proposed Markdown content for the document. Omit or pass an empty string when creating a structural folder.",
      },
      type: {
        type: "string",
        description:
          "Document type: folder, standalone_note, review, summary, highlight_note, imported_markdown, or book_home. Defaults to standalone_note.",
      },
      bookId: {
        type: "string",
        description: "Optional book id to attach the draft to a book",
      },
      parentId: {
        type: "string",
        description:
          "Optional parent folder document id. Use root, none, null, or omit to place the draft at the knowledge root.",
      },
      tags: {
        type: "string",
        description: 'Optional tags as comma-separated text or JSON array, e.g. "reading,summary"',
      },
    },
    execute: async (args) => {
      const title = String(args.title ?? "").trim();
      const contentMd = String(args.contentMd ?? "");
      if (!title) return { success: false, error: "title is required" };

      let tags: string[] | undefined;
      try {
        tags = parseTags(args.tags);
      } catch (error) {
        return { success: false, error: `Invalid tags: ${(error as Error).message}` };
      }

      const bookId = String(args.bookId ?? "").trim() || undefined;
      const parentId = normalizeParentId(args.parentId);
      const type = normalizeDocumentType(args.type);
      const parentContext = await resolveCreateParentContext({ type, bookId, parentId });
      if (parentContext.error) return { success: false, error: parentContext.error };
      const contentJson = markdownToKnowledgeJson(contentMd);
      const pathContextDocuments = await getKnowledgeDocuments({
        ...(parentContext.bookId ? { bookId: parentContext.bookId } : {}),
        limit: 5000,
      });
      const titleValidation = validateKnowledgeDocumentSiblingTitle({
        bookId: parentContext.bookId,
        parentId,
        title,
        documents: pathContextDocuments,
      });
      if (!titleValidation.ok) {
        return { success: false, error: titleValidationError(titleValidation.reason) };
      }

      const documentsById = createDocumentMap(pathContextDocuments);
      if (parentContext.parent) {
        documentsById.set(parentContext.parent.id, parentContext.parent);
      }

      return {
        success: true,
        action: "create",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_create",
        message: "Draft generated only. No knowledge document has been saved.",
        targetPath: createDraftTargetPath({ title, parentId, documentsById }),
        draft: {
          id: generateId(),
          type,
          title,
          bookId: parentContext.bookId,
          parentId,
          tags: tags ?? [],
          contentMd,
          contentJson,
          excerpt: createExcerpt(contentMd),
          sourceKind: bookId ? "book" : undefined,
          sourceId: bookId,
        },
      };
    },
  };
}

export function createProposeKnowledgeDocumentUpdateTool(): ToolDefinition {
  return {
    name: "proposeKnowledgeDocumentUpdate",
    description:
      "Create a confirmation-required patch for an existing ReadAny knowledge document. This tool NEVER saves data. Use it when the user asks AI to update a knowledge note, summary, review, tags, or title, then ask the user to confirm applying the patch.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are drafting a document update",
        required: true,
      },
      documentId: {
        type: "string",
        description: "Knowledge document id to update",
        required: true,
      },
      title: {
        type: "string",
        description: "Optional replacement title",
      },
      contentMd: {
        type: "string",
        description: "Optional replacement Markdown content",
      },
      tags: {
        type: "string",
        description: "Optional replacement tags as comma-separated text or JSON array",
      },
      parentId: {
        type: "string",
        description:
          "Optional parent folder document id to move the document. Use root, none, or null to move it to the knowledge root.",
      },
    },
    execute: async (args) => {
      const documentId = String(args.documentId ?? "").trim();
      if (!documentId) return { success: false, error: "documentId is required" };

      const document = await getKnowledgeDocument(documentId);
      if (!document) return { success: false, error: "Knowledge document not found" };

      const patch: Partial<
        Pick<
          KnowledgeDocument,
          "parentId" | "title" | "contentMd" | "contentJson" | "excerpt" | "tags"
        >
      > = {};
      const changedFields: string[] = [];

      if (Object.prototype.hasOwnProperty.call(args, "parentId")) {
        const parentId = normalizeParentId(args.parentId);
        if ((parentId || undefined) !== (document.parentId || undefined)) {
          const parentError = await validateUpdateParentChange(document, parentId);
          if (parentError) return { success: false, error: parentError, documentId };
          patch.parentId = parentId;
          changedFields.push("parentId");
        }
      }

      if (Object.prototype.hasOwnProperty.call(args, "title")) {
        const title = String(args.title ?? "").trim();
        if (title && title !== document.title) {
          patch.title = title;
          changedFields.push("title");
        }
      }

      if (Object.prototype.hasOwnProperty.call(args, "contentMd")) {
        const contentMd = String(args.contentMd ?? "");
        if (contentMd !== document.contentMd) {
          patch.contentMd = contentMd;
          patch.contentJson = markdownToKnowledgeJson(contentMd);
          patch.excerpt = createExcerpt(contentMd);
          changedFields.push("contentMd", "contentJson", "excerpt");
        }
      }

      if (Object.prototype.hasOwnProperty.call(args, "tags")) {
        let tags: string[] | undefined;
        try {
          tags = parseTags(args.tags) ?? [];
        } catch (error) {
          return { success: false, error: `Invalid tags: ${(error as Error).message}` };
        }
        if (JSON.stringify(tags) !== JSON.stringify(document.tags)) {
          patch.tags = tags;
          changedFields.push("tags");
        }
      }

      if (changedFields.length === 0) {
        return {
          success: false,
          error: "No changes were proposed",
          documentId,
        };
      }
      const pathContextDocuments = await getKnowledgeDocuments({
        ...(document.bookId ? { bookId: document.bookId } : {}),
        limit: 5000,
      });
      const currentDocumentsById = createDocumentMap([...pathContextDocuments, document]);
      const isParentPatch = Object.prototype.hasOwnProperty.call(patch, "parentId");
      if (changedFields.includes("title") || isParentPatch) {
        const targetTitle = patch.title ?? document.title;
        const targetParentId = isParentPatch ? patch.parentId : document.parentId;
        const titleValidation = validateKnowledgeDocumentSiblingTitle({
          documentId: document.id,
          bookId: document.bookId,
          parentId: targetParentId,
          title: targetTitle,
          documents: [...currentDocumentsById.values()],
        });
        if (!titleValidation.ok) {
          return {
            success: false,
            error: titleValidationError(titleValidation.reason),
            documentId,
          };
        }
      }
      const currentChildrenByParentId = createChildrenByParentId([
        ...currentDocumentsById.values(),
      ]);
      const projectedDocument: KnowledgeDocument = {
        ...document,
        ...(patch.parentId !== undefined || Object.prototype.hasOwnProperty.call(patch, "parentId")
          ? { parentId: patch.parentId }
          : {}),
        ...(patch.title ? { title: patch.title } : {}),
      };
      const targetDocumentsById = createDocumentMap([...pathContextDocuments, projectedDocument]);
      const targetChildrenByParentId = createChildrenByParentId([...targetDocumentsById.values()]);

      return {
        success: true,
        action: "update",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_update",
        message: "Patch generated only. The existing knowledge document has not been changed.",
        documentId,
        current: documentSummary(
          document,
          "",
          false,
          currentDocumentsById,
          currentChildrenByParentId,
        ),
        targetPath: createDocumentPath(projectedDocument, targetDocumentsById),
        target: documentSummary(
          projectedDocument,
          "",
          false,
          targetDocumentsById,
          targetChildrenByParentId,
        ),
        patch,
        changedFields,
      };
    },
  };
}

export function createProposeKnowledgeDocumentTagsUpdateTool(): ToolDefinition {
  return {
    name: "proposeKnowledgeDocumentTagsUpdate",
    description:
      "Create a confirmation-required tag update for an existing ReadAny knowledge document. This tool NEVER saves data. Use it when the user asks AI to organize, add, remove, or replace tags on knowledge documents.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are changing knowledge document tags",
        required: true,
      },
      documentId: {
        type: "string",
        description: "Knowledge document id whose tags should change",
        required: true,
      },
      mode: {
        type: "string",
        description: "Tag operation: add, remove, or set. Defaults to add.",
      },
      tags: {
        type: "string",
        description: 'Tags as comma-separated text or JSON array, e.g. "theme,memory"',
        required: true,
      },
    },
    execute: async (args) => {
      const documentId = String(args.documentId ?? "").trim();
      if (!documentId) return { success: false, error: "documentId is required" };

      const document = await getKnowledgeDocument(documentId);
      if (!document) return { success: false, error: "Knowledge document not found" };

      let requestedTags: string[] | undefined;
      try {
        requestedTags = parseTags(args.tags);
      } catch (error) {
        return { success: false, error: `Invalid tags: ${(error as Error).message}` };
      }
      if (!requestedTags || requestedTags.length === 0) {
        return { success: false, error: "tags is required" };
      }

      const mode = normalizeTagMode(args.mode);
      const nextTags = applyTagMode(document.tags, requestedTags, mode);
      if (JSON.stringify(nextTags) === JSON.stringify(document.tags)) {
        return {
          success: false,
          error: "No tag changes were proposed",
          documentId,
        };
      }

      const pathContextDocuments = await getKnowledgeDocuments({
        ...(document.bookId ? { bookId: document.bookId } : {}),
        limit: 5000,
      });
      const documentsById = createDocumentMap([...pathContextDocuments, document]);
      const childrenByParentId = createChildrenByParentId([...documentsById.values()]);

      return {
        success: true,
        action: "update",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_update",
        message: "Tag update generated only. The existing knowledge document has not been changed.",
        documentId,
        current: documentSummary(document, "", false, documentsById, childrenByParentId),
        targetPath: createDocumentPath(document, documentsById),
        target: documentSummary(
          { ...document, tags: nextTags },
          "",
          false,
          documentsById,
          childrenByParentId,
        ),
        patch: {
          tags: nextTags,
        },
        changedFields: ["tags"],
        tagMode: mode,
      };
    },
  };
}

export function createProposeKnowledgeLinkCreateTool(): ToolDefinition {
  return {
    name: "proposeKnowledgeLinkCreate",
    description:
      "Create a confirmation-required draft for linking a ReadAny knowledge document to another document, highlight, CFI, book, URL, Obsidian path, or AI message. This tool NEVER saves data; the user must confirm applying the link.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why this knowledge link is useful",
        required: true,
      },
      fromDocumentId: {
        type: "string",
        description: "Source knowledge document id",
        required: true,
      },
      toKind: {
        type: "string",
        description: "Target kind: book, highlight, document, cfi, url, ai_message, or obsidian",
        required: true,
      },
      toId: {
        type: "string",
        description: "Target id, URL, CFI, or Obsidian path",
        required: true,
      },
      relation: {
        type: "string",
        description: "Relation: source, references, backlink, related, contains, or generated_from",
      },
      label: {
        type: "string",
        description: "Optional human-readable label for the link",
      },
      cfi: {
        type: "string",
        description: "Optional CFI when linking to an exact book location or highlight",
      },
    },
    execute: async (args) => {
      const fromDocumentId = String(args.fromDocumentId ?? "").trim();
      const toId = String(args.toId ?? "").trim();
      const toKind = normalizeLinkTargetKind(args.toKind);
      const relation = normalizeLinkRelation(args.relation) ?? "related";
      const label = String(args.label ?? "").trim() || undefined;
      const cfi = String(args.cfi ?? "").trim() || undefined;

      if (!fromDocumentId) return { success: false, error: "fromDocumentId is required" };
      if (!toKind) return { success: false, error: "Invalid toKind" };
      if (!toId) return { success: false, error: "toId is required" };

      const source = await getKnowledgeDocument(fromDocumentId);
      if (!source) return { success: false, error: "Source knowledge document not found" };

      let targetDocument: KnowledgeDocument | undefined;
      if (toKind === "document") {
        const target = await getKnowledgeDocument(toId);
        if (!target) return { success: false, error: "Target knowledge document not found" };
        targetDocument = target;
      }

      const sourceContextDocuments = await getKnowledgeDocuments({
        ...(source.bookId ? { bookId: source.bookId } : {}),
        limit: 5000,
      });
      const targetContextDocuments =
        targetDocument && !sameOptionalString(targetDocument.bookId, source.bookId)
          ? await getKnowledgeDocuments({
              ...(targetDocument.bookId ? { bookId: targetDocument.bookId } : {}),
              limit: 5000,
            })
          : [];
      const documentsById = createDocumentMap([
        ...sourceContextDocuments,
        ...targetContextDocuments,
        source,
        ...(targetDocument ? [targetDocument] : []),
      ]);
      const childrenByParentId = createChildrenByParentId([...documentsById.values()]);

      return {
        success: true,
        action: "link",
        requiresConfirmation: true,
        confirmationKind: "knowledge_link_create",
        message: "Link draft generated only. No knowledge link has been saved.",
        source: documentPathContext(source, documentsById, childrenByParentId),
        target: targetDocument
          ? documentPathContext(targetDocument, documentsById, childrenByParentId)
          : undefined,
        link: {
          id: generateId(),
          fromDocumentId,
          toKind,
          toId,
          relation,
          label,
          cfi,
        },
      };
    },
  };
}
