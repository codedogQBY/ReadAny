import {
  type CreateKnowledgeDocumentInput,
  createKnowledgeDocument,
  getKnowledgeDocument,
  getKnowledgeDocuments,
  getKnowledgeLinks,
  insertKnowledgeLink,
  updateKnowledgeDocument,
} from "../db/database";
import type {
  JSONValue,
  KnowledgeCardTemplate,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeLink,
  KnowledgeLinkRelation,
  KnowledgeLinkTargetKind,
  KnowledgeSourceKind,
} from "../types";
import { eventBus } from "../utils/event-bus";
import { generateId } from "../utils/generate-id";
import {
  validateKnowledgeDocumentParent,
  validateKnowledgeDocumentSiblingTitle,
} from "./document-utils";
import { renderKnowledgeJsonToReadOnlyHtml } from "./editor-projection";
import { syncKnowledgeInternalDocumentLinks } from "./internal-links";

export type KnowledgeProposalAction = "create" | "update" | "link";
export type KnowledgeProposalConfirmationKind =
  | "knowledge_document_create"
  | "knowledge_document_update"
  | "knowledge_link_create";

export interface KnowledgeDocumentCreateProposal {
  success: true;
  action: "create";
  requiresConfirmation: true;
  confirmationKind: "knowledge_document_create";
  message?: string;
  targetPath?: string;
  draft: CreateKnowledgeDocumentInput;
}

export interface KnowledgeDocumentUpdateProposal {
  success: true;
  action: "update";
  requiresConfirmation: true;
  confirmationKind: "knowledge_document_update";
  message?: string;
  documentId: string;
  current?: {
    id: string;
    bookId?: string;
    parentId?: string;
    type?: KnowledgeDocumentType;
    title?: string;
    path?: string;
    tags?: string[];
    excerpt?: string;
    updatedAt?: number;
  };
  targetPath?: string;
  patch: Partial<
    Pick<KnowledgeDocument, "parentId" | "title" | "contentMd" | "contentJson" | "excerpt" | "tags">
  >;
  changedFields: string[];
}

export interface KnowledgeProposalDocumentContext {
  id: string;
  bookId?: string;
  parentId?: string;
  type?: KnowledgeDocumentType;
  title?: string;
  path?: string;
}

export interface KnowledgeLinkCreateProposal {
  success: true;
  action: "link";
  requiresConfirmation: true;
  confirmationKind: "knowledge_link_create";
  message?: string;
  source?: KnowledgeProposalDocumentContext;
  target?: KnowledgeProposalDocumentContext;
  link: {
    id?: string;
    fromDocumentId: string;
    toKind: KnowledgeLinkTargetKind;
    toId: string;
    relation: KnowledgeLinkRelation;
    label?: string;
    cfi?: string;
  };
}

export type KnowledgeWriteProposal =
  | KnowledgeDocumentCreateProposal
  | KnowledgeDocumentUpdateProposal
  | KnowledgeLinkCreateProposal;

export interface KnowledgeProposalApplyResult {
  action: KnowledgeProposalAction;
  documentId?: string;
  linkId?: string;
  alreadyApplied?: boolean;
}

export interface KnowledgeWriteProposalPreview {
  action: KnowledgeProposalAction;
  title: string;
  documentType?: KnowledgeDocumentType;
  linkType?: KnowledgeLinkTargetKind;
  tags: string[];
  contentPreview: string;
  contentPreviewHtml?: string;
  changedFields: string[];
  currentPath?: string;
  targetPath?: string;
  visiblePath?: string;
  hasPathChange: boolean;
  writeSafety: KnowledgeProposalWriteSafety;
}

export interface KnowledgeWriteProposalPreviewOptions {
  cardTemplates?: KnowledgeCardTemplate[];
}

export type KnowledgeProposalWriteSafetyState = "proposal_pending_confirmation";

export interface KnowledgeProposalWriteSafety {
  state: KnowledgeProposalWriteSafetyState;
  label: string;
  description: string;
}

export type KnowledgeProposalApplyErrorScope =
  | "parent"
  | "title"
  | "create"
  | "update"
  | "link";

export interface KnowledgeProposalApplyErrorDetails {
  scope: KnowledgeProposalApplyErrorScope;
  reason: string;
  message: string;
  i18nKey: string;
}

const APPLY_ERROR_PREFIX: Record<KnowledgeProposalApplyErrorScope, string> = {
  parent: "Invalid knowledge document parent",
  title: "Invalid knowledge document title",
  create: "Invalid knowledge document create",
  update: "Invalid knowledge document update",
  link: "Invalid knowledge link",
};

const APPLY_ERROR_SCOPE_BY_PREFIX = new Map<string, KnowledgeProposalApplyErrorScope>(
  Object.entries(APPLY_ERROR_PREFIX).map(([scope, prefix]) => [
    prefix,
    scope as KnowledgeProposalApplyErrorScope,
  ]),
);

export class KnowledgeProposalApplyError extends Error {
  readonly scope: KnowledgeProposalApplyErrorScope;
  readonly reason: string;
  readonly i18nKey: string;

  constructor(scope: KnowledgeProposalApplyErrorScope, reason: string) {
    super(`${APPLY_ERROR_PREFIX[scope]}: ${reason}`);
    this.name = "KnowledgeProposalApplyError";
    this.scope = scope;
    this.reason = reason;
    this.i18nKey = `knowledgeProposal.errors.${scope}.${reason}`;
  }
}

const DOCUMENT_TYPES = new Set<KnowledgeDocumentType>([
  "book_home",
  "folder",
  "standalone_note",
  "highlight_note",
  "review",
  "summary",
  "imported_markdown",
]);

const SOURCE_KINDS = new Set<KnowledgeSourceKind>([
  "book",
  "highlight",
  "note",
  "cfi",
  "ai_message",
  "external",
  "obsidian",
]);

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
const KNOWLEDGE_PROPOSAL_WRITE_SAFETY: KnowledgeProposalWriteSafety = {
  state: "proposal_pending_confirmation",
  label: "Confirmation required",
  description:
    "AI only prepared this proposal. It will not write to the knowledge base until you apply it.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJSONValue(value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJSONValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJSONValue);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function asDocumentType(value: unknown): KnowledgeDocumentType | null {
  return typeof value === "string" && DOCUMENT_TYPES.has(value as KnowledgeDocumentType)
    ? (value as KnowledgeDocumentType)
    : null;
}

function asSourceKind(value: unknown): KnowledgeSourceKind | undefined {
  return typeof value === "string" && SOURCE_KINDS.has(value as KnowledgeSourceKind)
    ? (value as KnowledgeSourceKind)
    : undefined;
}

function asLinkTargetKind(value: unknown): KnowledgeLinkTargetKind | null {
  return typeof value === "string" && LINK_TARGET_KINDS.has(value as KnowledgeLinkTargetKind)
    ? (value as KnowledgeLinkTargetKind)
    : null;
}

function asLinkRelation(value: unknown): KnowledgeLinkRelation | null {
  return typeof value === "string" && LINK_RELATIONS.has(value as KnowledgeLinkRelation)
    ? (value as KnowledgeLinkRelation)
    : null;
}

function sameOptionalString(left: string | undefined, right: string | undefined): boolean {
  return (left || undefined) === (right || undefined);
}

function createInvalidProposalApplyError(
  scope: KnowledgeProposalApplyErrorScope,
  reason: string,
): KnowledgeProposalApplyError {
  return new KnowledgeProposalApplyError(scope, reason);
}

export function getKnowledgeProposalApplyErrorDetails(
  error: unknown,
): KnowledgeProposalApplyErrorDetails | null {
  if (error instanceof KnowledgeProposalApplyError) {
    return {
      scope: error.scope,
      reason: error.reason,
      message: error.message,
      i18nKey: error.i18nKey,
    };
  }

  if (error instanceof Error) {
    const match = error.message.match(/^(.+): ([a-z0-9_]+)$/);
    if (!match) return null;
    const scope = APPLY_ERROR_SCOPE_BY_PREFIX.get(match[1]);
    if (!scope) return null;
    const reason = match[2];
    return {
      scope,
      reason,
      message: error.message,
      i18nKey: `knowledgeProposal.errors.${scope}.${reason}`,
    };
  }

  return null;
}

function createInvalidParentError(reason: string): Error {
  return createInvalidProposalApplyError("parent", reason);
}

function createInvalidTitleError(reason: string): Error {
  return createInvalidProposalApplyError("title", reason);
}

function createInvalidCreateError(reason: string): Error {
  return createInvalidProposalApplyError("create", reason);
}

function createInvalidUpdateError(reason: string): Error {
  return createInvalidProposalApplyError("update", reason);
}

function createInvalidLinkError(reason: string): Error {
  return createInvalidProposalApplyError("link", reason);
}

function emitKnowledgeChanged(data: {
  action: KnowledgeProposalAction;
  documentId?: string;
  linkId?: string;
  bookId?: string;
}) {
  eventBus.emit("knowledge:changed", {
    ...data,
    timestamp: Date.now(),
  });
}

async function syncAppliedDocumentInternalLinks(
  document: Pick<KnowledgeDocument, "id" | "bookId">,
  contentJson: JSONValue,
) {
  const documents = await getKnowledgeDocuments({
    ...(document.bookId ? { bookId: document.bookId } : {}),
    limit: 5000,
  });
  const validDocumentIds = [...new Set([...documents.map((item) => item.id), document.id])];
  await syncKnowledgeInternalDocumentLinks({
    documentId: document.id,
    contentJson,
    validDocumentIds,
  });
}

async function assertCreateProposalParent(proposal: KnowledgeDocumentCreateProposal) {
  const { parentId, type, bookId } = proposal.draft;
  if (!parentId) return;
  if (type === "book_home") throw createInvalidParentError("book_home_locked");

  const parent = await getKnowledgeDocument(parentId);
  if (!parent) throw createInvalidParentError("missing_parent");
  if (parent.type !== "folder") throw createInvalidParentError("parent_not_folder");
  if (!sameOptionalString(parent.bookId, bookId)) {
    throw createInvalidParentError("book_mismatch");
  }
}

async function assertCreateProposalTitle(proposal: KnowledgeDocumentCreateProposal) {
  const { bookId, parentId, id } = proposal.draft;
  const title = proposal.draft.title ?? "";
  const documents = await getKnowledgeDocuments({
    ...(bookId ? { bookId } : {}),
    limit: 5000,
  });
  const validation = validateKnowledgeDocumentSiblingTitle({
    documentId: id,
    bookId,
    parentId,
    title,
    documents,
  });
  if (!validation.ok) throw createInvalidTitleError(validation.reason);
}

function isExistingCreateProposalDocument(
  proposal: KnowledgeDocumentCreateProposal,
  existing: KnowledgeDocument,
): boolean {
  if (existing.type !== proposal.draft.type) return false;
  if (!sameOptionalString(existing.bookId, proposal.draft.bookId)) return false;
  if (!sameOptionalString(existing.sourceKind, proposal.draft.sourceKind)) return false;
  if (!sameOptionalString(existing.sourceId, proposal.draft.sourceId)) return false;
  return true;
}

async function getValidatedUpdateDocument(
  proposal: KnowledgeDocumentUpdateProposal,
): Promise<KnowledgeDocument> {
  const document = await getKnowledgeDocument(proposal.documentId);
  if (!document) throw createInvalidParentError("missing_document");
  if (
    typeof proposal.current?.updatedAt === "number" &&
    proposal.current.updatedAt !== document.updatedAt
  ) {
    throw createInvalidUpdateError("stale_document");
  }

  const hasParentPatch = Object.prototype.hasOwnProperty.call(proposal.patch, "parentId");
  const hasTitlePatch = Object.prototype.hasOwnProperty.call(proposal.patch, "title");
  if (!hasParentPatch && !hasTitlePatch) return document;

  const documents = await getKnowledgeDocuments({
    ...(document.bookId ? { bookId: document.bookId } : {}),
    limit: 5000,
  });
  if (hasParentPatch) {
    const validation = validateKnowledgeDocumentParent(
      proposal.documentId,
      proposal.patch.parentId,
      documents,
    );
    if (!validation.ok) throw createInvalidParentError(validation.reason ?? "invalid_parent");

    if (proposal.patch.parentId) {
      const parent = documents.find((item) => item.id === proposal.patch.parentId);
      if (!parent) throw createInvalidParentError("missing_parent");
      if (!sameOptionalString(parent.bookId, document.bookId)) {
        throw createInvalidParentError("book_mismatch");
      }
    }
  }

  const nextTitle = hasTitlePatch ? (proposal.patch.title ?? "").trim() : document.title;
  const nextParentId = hasParentPatch ? proposal.patch.parentId : document.parentId;
  const titleValidation = validateKnowledgeDocumentSiblingTitle({
    documentId: document.id,
    bookId: document.bookId,
    parentId: nextParentId,
    title: nextTitle,
    documents,
  });
  if (!titleValidation.ok) throw createInvalidTitleError(titleValidation.reason);

  return document;
}

function normalizeCreateProposal(
  result: Record<string, unknown>,
): KnowledgeDocumentCreateProposal | null {
  if (result.action !== "create" || result.confirmationKind !== "knowledge_document_create") {
    return null;
  }

  const draft = result.draft;
  if (!isRecord(draft)) return null;

  const type = asDocumentType(draft.type);
  const title = stringOrUndefined(draft.title);
  const contentMd = typeof draft.contentMd === "string" ? draft.contentMd : "";
  const contentJson = isJSONValue(draft.contentJson) ? draft.contentJson : null;
  if (!type || !title || !contentJson) return null;

  return {
    success: true,
    action: "create",
    requiresConfirmation: true,
    confirmationKind: "knowledge_document_create",
    message: stringOrUndefined(result.message),
    targetPath: stringOrUndefined(result.targetPath),
    draft: {
      id: stringOrUndefined(draft.id),
      bookId: stringOrUndefined(draft.bookId),
      parentId: stringOrUndefined(draft.parentId),
      type,
      title,
      contentJson,
      contentMd,
      contentSchemaVersion:
        typeof draft.contentSchemaVersion === "number" ? draft.contentSchemaVersion : undefined,
      excerpt: stringOrUndefined(draft.excerpt),
      tags: asStringArray(draft.tags),
      sourceKind: asSourceKind(draft.sourceKind),
      sourceId: stringOrUndefined(draft.sourceId),
    },
  };
}

function normalizeUpdateProposal(
  result: Record<string, unknown>,
): KnowledgeDocumentUpdateProposal | null {
  if (result.action !== "update" || result.confirmationKind !== "knowledge_document_update") {
    return null;
  }

  const documentId = stringOrUndefined(result.documentId);
  const patchResult = result.patch;
  if (!documentId || !isRecord(patchResult)) return null;

  const patch: KnowledgeDocumentUpdateProposal["patch"] = {};
  if (Object.prototype.hasOwnProperty.call(patchResult, "parentId")) {
    patch.parentId = stringOrUndefined(patchResult.parentId);
  }
  if (typeof patchResult.title === "string") patch.title = patchResult.title;
  if (typeof patchResult.contentMd === "string") {
    if (!isJSONValue(patchResult.contentJson)) return null;
    patch.contentMd = patchResult.contentMd;
    patch.contentJson = patchResult.contentJson;
  } else if (isJSONValue(patchResult.contentJson)) {
    patch.contentJson = patchResult.contentJson;
  }
  if (Object.prototype.hasOwnProperty.call(patchResult, "excerpt")) {
    patch.excerpt = stringOrUndefined(patchResult.excerpt);
  }
  if (Array.isArray(patchResult.tags)) patch.tags = asStringArray(patchResult.tags);

  if (Object.keys(patch).length === 0) return null;

  const current = isRecord(result.current)
    ? {
        id: String(result.current.id ?? documentId),
        bookId: stringOrUndefined(result.current.bookId),
        parentId: stringOrUndefined(result.current.parentId),
        type: asDocumentType(result.current.type) ?? undefined,
        title: stringOrUndefined(result.current.title),
        path: stringOrUndefined(result.current.path),
        tags: asStringArray(result.current.tags),
        excerpt: stringOrUndefined(result.current.excerpt),
        updatedAt:
          typeof result.current.updatedAt === "number" ? result.current.updatedAt : undefined,
      }
    : undefined;

  return {
    success: true,
    action: "update",
    requiresConfirmation: true,
    confirmationKind: "knowledge_document_update",
    message: stringOrUndefined(result.message),
    documentId,
    current,
    targetPath: stringOrUndefined(result.targetPath),
    patch,
    changedFields: asStringArray(result.changedFields),
  };
}

function normalizeLinkProposal(
  result: Record<string, unknown>,
): KnowledgeLinkCreateProposal | null {
  if (result.action !== "link" || result.confirmationKind !== "knowledge_link_create") {
    return null;
  }

  const link = result.link;
  if (!isRecord(link)) return null;

  const fromDocumentId = stringOrUndefined(link.fromDocumentId);
  const toKind = asLinkTargetKind(link.toKind);
  const toId = stringOrUndefined(link.toId);
  const relation = asLinkRelation(link.relation);
  if (!fromDocumentId || !toKind || !toId || !relation) return null;

  return {
    success: true,
    action: "link",
    requiresConfirmation: true,
    confirmationKind: "knowledge_link_create",
    message: stringOrUndefined(result.message),
    source: normalizeProposalDocumentContext(result.source),
    target: normalizeProposalDocumentContext(result.target),
    link: {
      id: stringOrUndefined(link.id),
      fromDocumentId,
      toKind,
      toId,
      relation,
      label: stringOrUndefined(link.label),
      cfi: stringOrUndefined(link.cfi),
    },
  };
}

function normalizeProposalDocumentContext(
  value: unknown,
): KnowledgeProposalDocumentContext | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringOrUndefined(value.id);
  if (!id) return undefined;
  return {
    id,
    bookId: stringOrUndefined(value.bookId),
    parentId: stringOrUndefined(value.parentId),
    type: asDocumentType(value.type) ?? undefined,
    title: stringOrUndefined(value.title),
    path: stringOrUndefined(value.path),
  };
}

export function getKnowledgeWriteProposal(value: unknown): KnowledgeWriteProposal | null {
  if (!isRecord(value) || value.success !== true || value.requiresConfirmation !== true) {
    return null;
  }
  return (
    normalizeCreateProposal(value) ?? normalizeUpdateProposal(value) ?? normalizeLinkProposal(value)
  );
}

export function createKnowledgeWriteProposalPreview(
  proposal: KnowledgeWriteProposal,
  options: KnowledgeWriteProposalPreviewOptions = {},
): KnowledgeWriteProposalPreview {
  if (proposal.action === "create") {
    const contentPreview = proposal.draft.excerpt || proposal.draft.contentMd || "";
    const contentPreviewHtml = renderKnowledgeJsonToReadOnlyHtml(proposal.draft.contentJson, {
      cardTemplates: options.cardTemplates,
    });
    return {
      action: proposal.action,
      title: proposal.draft.title ?? "",
      documentType: proposal.draft.type,
      tags: proposal.draft.tags ?? [],
      contentPreview,
      ...(contentPreviewHtml ? { contentPreviewHtml } : {}),
      changedFields: [],
      targetPath: proposal.targetPath,
      visiblePath: proposal.targetPath,
      hasPathChange: false,
      writeSafety: KNOWLEDGE_PROPOSAL_WRITE_SAFETY,
    };
  }

  if (proposal.action === "update") {
    const contentPreview =
      proposal.patch.excerpt || proposal.patch.contentMd || proposal.current?.excerpt || "";
    const contentPreviewHtml =
      proposal.patch.contentJson || proposal.patch.contentMd
        ? renderKnowledgeJsonToReadOnlyHtml(proposal.patch.contentJson, {
            cardTemplates: options.cardTemplates,
          })
        : "";
    const currentPath = proposal.current?.path;
    const targetPath = proposal.targetPath;

    return {
      action: proposal.action,
      title: proposal.patch.title ?? proposal.current?.title ?? proposal.documentId,
      documentType: proposal.current?.type,
      tags: proposal.patch.tags ?? proposal.current?.tags ?? [],
      contentPreview,
      ...(contentPreviewHtml ? { contentPreviewHtml } : {}),
      changedFields: proposal.changedFields,
      currentPath,
      targetPath,
      visiblePath: targetPath || currentPath,
      hasPathChange: Boolean(currentPath && targetPath && currentPath !== targetPath),
      writeSafety: KNOWLEDGE_PROPOSAL_WRITE_SAFETY,
    };
  }

  return {
    action: proposal.action,
    title: proposal.link.label || `${proposal.link.relation}: ${proposal.link.toId}`,
    linkType: proposal.link.toKind,
    tags: [],
    contentPreview: [
      `${proposal.link.relation} -> ${proposal.link.toKind}: ${proposal.link.toId}`,
      proposal.link.cfi ? `CFI: ${proposal.link.cfi}` : "",
      proposal.source?.path ? `From: ${proposal.source.path}` : "",
      proposal.target?.path ? `To: ${proposal.target.path}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    changedFields: [proposal.link.relation],
    currentPath: proposal.source?.path,
    targetPath: proposal.target?.path,
    visiblePath:
      proposal.source?.path && proposal.target?.path
        ? `${proposal.source.path} -> ${proposal.target.path}`
        : proposal.source?.path || proposal.target?.path,
    hasPathChange: false,
    writeSafety: KNOWLEDGE_PROPOSAL_WRITE_SAFETY,
  };
}

export async function applyKnowledgeWriteProposal(
  proposal: KnowledgeWriteProposal,
): Promise<KnowledgeProposalApplyResult> {
  if (proposal.action === "create") {
    if (proposal.draft.id) {
      const existing = await getKnowledgeDocument(proposal.draft.id);
      if (existing) {
        if (!isExistingCreateProposalDocument(proposal, existing)) {
          throw createInvalidCreateError("create_id_conflict");
        }
        return { action: "create", documentId: existing.id, alreadyApplied: true };
      }
    }
    await assertCreateProposalParent(proposal);
    await assertCreateProposalTitle(proposal);
    const document = await createKnowledgeDocument(proposal.draft);
    await syncAppliedDocumentInternalLinks(document, proposal.draft.contentJson ?? null);
    emitKnowledgeChanged({
      action: "create",
      documentId: document.id,
      bookId: document.bookId,
    });
    return { action: "create", documentId: document.id };
  }

  if (proposal.action === "update") {
    const document = await getValidatedUpdateDocument(proposal);
    await updateKnowledgeDocument(proposal.documentId, proposal.patch);
    if (Object.prototype.hasOwnProperty.call(proposal.patch, "contentJson")) {
      await syncAppliedDocumentInternalLinks(document, proposal.patch.contentJson ?? null);
    }
    emitKnowledgeChanged({
      action: "update",
      documentId: proposal.documentId,
      bookId: document.bookId,
    });
    return { action: "update", documentId: proposal.documentId };
  }

  const sourceDocument = await getKnowledgeDocument(proposal.link.fromDocumentId);
  if (!sourceDocument) throw createInvalidLinkError("missing_source_document");

  if (proposal.link.toKind === "document") {
    const targetDocument = await getKnowledgeDocument(proposal.link.toId);
    if (!targetDocument) throw createInvalidLinkError("missing_target_document");
  }

  const existingLinks = await getKnowledgeLinks(proposal.link.fromDocumentId);
  const existing = existingLinks.find(
    (link) =>
      (proposal.link.id && link.id === proposal.link.id) ||
      (link.toKind === proposal.link.toKind &&
        link.toId === proposal.link.toId &&
        link.relation === proposal.link.relation &&
        (link.cfi ?? "") === (proposal.link.cfi ?? "")),
  );
  if (existing) {
    return {
      action: "link",
      documentId: proposal.link.fromDocumentId,
      linkId: existing.id,
      alreadyApplied: true,
    };
  }

  const now = Date.now();
  const link: KnowledgeLink = {
    id: proposal.link.id ?? generateId(),
    fromDocumentId: proposal.link.fromDocumentId,
    toKind: proposal.link.toKind,
    toId: proposal.link.toId,
    relation: proposal.link.relation,
    label: proposal.link.label,
    cfi: proposal.link.cfi,
    createdAt: now,
    updatedAt: now,
  };
  await insertKnowledgeLink(link);
  emitKnowledgeChanged({
    action: "link",
    documentId: link.fromDocumentId,
    linkId: link.id,
    bookId: sourceDocument?.bookId,
  });
  return { action: "link", documentId: link.fromDocumentId, linkId: link.id };
}
