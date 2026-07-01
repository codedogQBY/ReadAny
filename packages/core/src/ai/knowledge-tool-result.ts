import type { ReadAnyCardAttrs } from "../knowledge/card-registry";
import { renderReadAnyCardMarkdownFallback } from "../knowledge/card-registry";

export type KnowledgeToolResultKind =
  | "search"
  | "document"
  | "bookKnowledge"
  | "summary"
  | "failure";

export interface KnowledgeToolResultDocument {
  id?: string;
  bookId?: string;
  title: string;
  path?: string;
  type?: string;
  snippet?: string;
  matchFields?: KnowledgeToolResultMatchField[];
  childCount?: number;
}

export type KnowledgeToolResultMatchField =
  | "title"
  | "path"
  | "tags"
  | "excerpt"
  | "summary"
  | "content";

export interface KnowledgeToolResultRelation {
  id?: string;
  direction: "outgoing" | "backlink";
  relation?: string;
  label?: string;
  document: KnowledgeToolResultDocument;
}

export type KnowledgeToolResultWriteSafetyState =
  | "read_only"
  | "memory_persisted"
  | "memory_skipped"
  | "no_write_failed";

export interface KnowledgeToolResultWriteSafety {
  state: KnowledgeToolResultWriteSafetyState;
  label: string;
  description: string;
}

export interface KnowledgeToolResultDisplay {
  kind: KnowledgeToolResultKind;
  toolName?: string;
  total?: number;
  showing?: number;
  bookId?: string;
  status?: string;
  persisted?: boolean;
  reason?: string;
  error?: string;
  safeNoWriteHint?: string;
  sourceChars?: number;
  documentId?: string;
  summaryPreview?: string;
  writeSafety: KnowledgeToolResultWriteSafety;
  failureCardAttrs?: ReadAnyCardAttrs;
  failureCardMarkdown?: string;
  documents: KnowledgeToolResultDocument[];
  relations?: KnowledgeToolResultRelation[];
}

export interface KnowledgeToolResultDisplayOptions {
  error?: unknown;
}

const KNOWLEDGE_TOOL_NAMES = new Set([
  "searchKnowledgeBase",
  "getKnowledgeDocument",
  "getBookKnowledge",
  "compressKnowledgeDocumentSummary",
  "proposeKnowledgeDocumentCreate",
  "proposeKnowledgeDocumentUpdate",
  "proposeKnowledgeDocumentTagsUpdate",
  "proposeKnowledgeLinkCreate",
]);
const KNOWLEDGE_FAILURE_SAFE_NO_WRITE_HINT =
  "No knowledge document or link was saved or changed by this failed tool call.";
const KNOWLEDGE_TOOL_WRITE_SAFETY: Record<
  KnowledgeToolResultWriteSafetyState,
  KnowledgeToolResultWriteSafety
> = {
  read_only: {
    state: "read_only",
    label: "Read-only",
    description: "This tool only read knowledge context. It did not save or change anything.",
  },
  memory_persisted: {
    state: "memory_persisted",
    label: "Memory updated",
    description:
      "This tool updated compact retrieval memory. It did not rewrite user-authored document content.",
  },
  memory_skipped: {
    state: "memory_skipped",
    label: "No write",
    description: "This tool did not persist a summary or change user-authored content.",
  },
  no_write_failed: {
    state: "no_write_failed",
    label: "No write",
    description: KNOWLEDGE_FAILURE_SAFE_NO_WRITE_HINT,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asErrorString(value: unknown): string | undefined {
  if (value instanceof Error) return asString(value.message);
  return asString(value);
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asMatchFields(value: unknown): KnowledgeToolResultMatchField[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<KnowledgeToolResultMatchField>([
    "title",
    "path",
    "tags",
    "excerpt",
    "summary",
    "content",
  ]);
  const fields = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item): item is KnowledgeToolResultMatchField =>
      allowed.has(item as KnowledgeToolResultMatchField),
    );
  return fields.length > 0 ? [...new Set(fields)] : undefined;
}

function compactKnowledgePreview(value: unknown): string | undefined {
  const markdown = asString(value);
  if (!markdown) return undefined;
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[#>*_`~\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
}

function asResultRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asFailureDisplay(
  toolName: string,
  result: Record<string, unknown>,
): KnowledgeToolResultDisplay | null {
  const error = asString(result.error);
  const message = asString(result.message);
  const reason = asString(result.reason);
  const success = asBoolean(result.success);
  if (success !== false && !error) return null;

  return withFailureCard({
    kind: "failure",
    toolName,
    status: asString(result.status),
    documentId: asString(result.documentId) || asString(result.fromDocumentId),
    reason,
    error: error || message || reason || "Tool execution failed",
    safeNoWriteHint: KNOWLEDGE_FAILURE_SAFE_NO_WRITE_HINT,
    writeSafety: KNOWLEDGE_TOOL_WRITE_SAFETY.no_write_failed,
    documents: contextDocumentsFromResult(result),
  });
}

function createFailureDisplay(
  toolName: string,
  error: string,
  result?: Record<string, unknown>,
): KnowledgeToolResultDisplay {
  return withFailureCard({
    kind: "failure",
    toolName,
    status: result ? asString(result.status) : undefined,
    documentId: result ? asString(result.documentId) || asString(result.fromDocumentId) : undefined,
    reason: result ? asString(result.reason) : undefined,
    error,
    safeNoWriteHint: KNOWLEDGE_FAILURE_SAFE_NO_WRITE_HINT,
    writeSafety: KNOWLEDGE_TOOL_WRITE_SAFETY.no_write_failed,
    documents: result ? contextDocumentsFromResult(result) : [],
  });
}

function createFailureCardAttrs(display: KnowledgeToolResultDisplay): ReadAnyCardAttrs {
  const primaryDocument = display.documents[0];
  const pathLines = display.documents
    .map((document) => document.path || document.title)
    .filter((path): path is string => Boolean(path?.trim()));
  const uniquePathLines = [...new Set(pathLines)];
  const markdown = [
    display.toolName ? `Tool: ${display.toolName}` : undefined,
    display.status ? `Status: ${display.status}` : undefined,
    display.error ? `Error: ${display.error}` : undefined,
    display.reason ? `Reason: ${display.reason}` : undefined,
    display.documentId ? `Document: ${display.documentId}` : undefined,
    uniquePathLines.length === 1 ? `Path: ${uniquePathLines[0]}` : undefined,
    uniquePathLines.length > 1
      ? ["Paths:", ...uniquePathLines.map((path) => `- ${path}`)].join("\n")
      : undefined,
    display.safeNoWriteHint,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    cardType: "aiToolFailure",
    version: 1,
    title: display.toolName || "AI/tool failure",
    markdown,
    text: markdown,
    sourceId: display.documentId,
    sourceTitle: primaryDocument?.path || primaryDocument?.title,
    data: {
      toolName: display.toolName,
      status: display.status,
      error: display.error,
      reason: display.reason,
      documentId: display.documentId,
      safeNoWriteHint: display.safeNoWriteHint,
      writeSafety: display.writeSafety,
      documents: display.documents,
    },
  };
}

function withFailureCard(display: KnowledgeToolResultDisplay): KnowledgeToolResultDisplay {
  const displayWithSafety = {
    ...display,
    writeSafety: KNOWLEDGE_TOOL_WRITE_SAFETY.no_write_failed,
  };
  const failureCardAttrs = createFailureCardAttrs(displayWithSafety);
  return {
    ...displayWithSafety,
    failureCardAttrs,
    failureCardMarkdown: renderReadAnyCardMarkdownFallback(failureCardAttrs, {
      body: failureCardAttrs.markdown || "",
    }),
  };
}

function asDocumentSummary(value: unknown): KnowledgeToolResultDocument | null {
  if (!isRecord(value)) return null;

  const title = asString(value.title) || asString(value.id);
  if (!title) return null;

  return {
    id: asString(value.id),
    bookId: asString(value.bookId),
    title,
    path: asString(value.path),
    type: asString(value.type),
    snippet:
      asString(value.snippet) ||
      asString(value.excerpt) ||
      asString(value.summary) ||
      compactKnowledgePreview(value.content),
    matchFields: asMatchFields(value.matchFields),
    childCount: asNumber(value.childCount),
  };
}

function asDocumentList(value: unknown): KnowledgeToolResultDocument[] {
  if (!Array.isArray(value)) return [];
  return value.map(asDocumentSummary).filter((item): item is KnowledgeToolResultDocument => !!item);
}

function relationDocumentsFromResult(
  result: Record<string, unknown>,
): KnowledgeToolResultRelation[] {
  const relations: KnowledgeToolResultRelation[] = [];
  const seen = new Set<string>();
  const addRelation = (
    relation: Omit<KnowledgeToolResultRelation, "document"> & {
      document: KnowledgeToolResultDocument | null;
    },
  ) => {
    if (!relation.document) return;
    const key = [
      relation.direction,
      relation.id,
      relation.relation,
      relation.label,
      relation.document.id,
      relation.document.path,
      relation.document.title,
    ]
      .filter(Boolean)
      .join("|");
    if (seen.has(key)) return;
    seen.add(key);
    relations.push({
      ...relation,
      document: relation.document,
    });
  };

  if (Array.isArray(result.outgoingLinks)) {
    for (const link of result.outgoingLinks) {
      if (!isRecord(link)) continue;
      addRelation({
        id: asString(link.id),
        direction: "outgoing",
        relation: asString(link.relation),
        label: asString(link.label),
        document: isRecord(link.target) ? asDocumentSummary(link.target) : null,
      });
    }
  }

  if (Array.isArray(result.backlinks)) {
    for (const backlink of result.backlinks) {
      if (!isRecord(backlink)) continue;
      addRelation({
        id: asString(backlink.id),
        direction: "backlink",
        relation: asString(backlink.relation),
        label: asString(backlink.label),
        document: isRecord(backlink.from) ? asDocumentSummary(backlink.from) : null,
      });
    }
  }

  return relations;
}

function contextDocumentsFromResult(
  result: Record<string, unknown>,
): KnowledgeToolResultDocument[] {
  const documents: KnowledgeToolResultDocument[] = [];
  const seen = new Set<string>();
  const addDocument = (document: KnowledgeToolResultDocument | null) => {
    if (!document) return;
    const key = [document.id, document.path, document.title].filter(Boolean).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    documents.push(document);
  };

  addDocument(asDocumentSummary(result.document));
  for (const document of asDocumentList(result.documents)) {
    addDocument(document);
  }
  addDocument(isRecord(result.source) ? asDocumentSummary(result.source) : null);
  addDocument(isRecord(result.current) ? asDocumentSummary(result.current) : null);
  addDocument(isRecord(result.target) ? asDocumentSummary(result.target) : null);
  if (Array.isArray(result.outgoingLinks)) {
    for (const link of result.outgoingLinks) {
      if (isRecord(link)) {
        addDocument(isRecord(link.target) ? asDocumentSummary(link.target) : null);
      }
    }
  }
  if (Array.isArray(result.backlinks)) {
    for (const backlink of result.backlinks) {
      if (isRecord(backlink)) {
        addDocument(isRecord(backlink.from) ? asDocumentSummary(backlink.from) : null);
      }
    }
  }

  if (documents.length > 0) return documents;

  const documentId = asString(result.documentId) || asString(result.fromDocumentId);
  const path =
    asString(result.path) ||
    asString(result.visiblePath) ||
    asString(result.targetPath) ||
    asString(result.currentPath) ||
    (isRecord(result.target) ? asString(result.target.path) : undefined) ||
    (isRecord(result.current) ? asString(result.current.path) : undefined);
  const title = asString(result.title) || path;

  return title
    ? [
        {
          id: documentId,
          title,
          path,
        },
      ]
    : [];
}

function compactMarkdownPreview(value: unknown): string | undefined {
  return compactKnowledgePreview(value);
}

export function getKnowledgeToolResultDisplay(
  toolName: string,
  result: unknown,
  options: KnowledgeToolResultDisplayOptions = {},
): KnowledgeToolResultDisplay | null {
  if (!KNOWLEDGE_TOOL_NAMES.has(toolName)) return null;

  const directError = asErrorString(options.error);
  const resultRecord = asResultRecord(result);
  if (!resultRecord) return directError ? createFailureDisplay(toolName, directError) : null;

  const failureDisplay = asFailureDisplay(toolName, resultRecord);
  if (failureDisplay) return failureDisplay;
  if (directError) return createFailureDisplay(toolName, directError, resultRecord);

  if (toolName === "searchKnowledgeBase") {
    return {
      kind: "search",
      toolName,
      total: asNumber(resultRecord.total),
      showing: asNumber(resultRecord.showing),
      writeSafety: KNOWLEDGE_TOOL_WRITE_SAFETY.read_only,
      documents: asDocumentList(resultRecord.documents),
    };
  }

  if (toolName === "getKnowledgeDocument") {
    return {
      kind: "document",
      toolName,
      total: 1,
      bookId: asString(resultRecord.bookId),
      documentId: asString(resultRecord.documentId),
      writeSafety: KNOWLEDGE_TOOL_WRITE_SAFETY.read_only,
      documents: contextDocumentsFromResult(resultRecord),
      relations: relationDocumentsFromResult(resultRecord),
    };
  }

  if (toolName === "getBookKnowledge") {
    return {
      kind: "bookKnowledge",
      toolName,
      total: asNumber(resultRecord.total),
      showing: asNumber(resultRecord.showing),
      bookId: asString(resultRecord.bookId),
      writeSafety: KNOWLEDGE_TOOL_WRITE_SAFETY.read_only,
      documents: asDocumentList(resultRecord.documents),
    };
  }

  if (toolName !== "compressKnowledgeDocumentSummary") return null;

  const summaryDocument = asDocumentSummary(resultRecord.document);
  const summaryPath = asString(resultRecord.path);
  const summaryDocumentId = asString(resultRecord.documentId);

  return {
    kind: "summary",
    toolName,
    status: asString(resultRecord.status),
    persisted: asBoolean(resultRecord.persisted),
    reason: asString(resultRecord.reason),
    sourceChars: asNumber(resultRecord.sourceChars),
    documentId: summaryDocumentId,
    summaryPreview: compactMarkdownPreview(resultRecord.summaryMd),
    writeSafety: asBoolean(resultRecord.persisted)
      ? KNOWLEDGE_TOOL_WRITE_SAFETY.memory_persisted
      : KNOWLEDGE_TOOL_WRITE_SAFETY.memory_skipped,
    documents: summaryDocument
      ? [summaryDocument]
      : summaryPath || summaryDocumentId
        ? [
            {
              id: summaryDocumentId,
              title: summaryPath || summaryDocumentId || "Knowledge document",
              path: summaryPath,
            },
          ]
        : [],
  };
}
