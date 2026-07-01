import {
  deleteKnowledgeLink,
  getKnowledgeLinks,
  insertKnowledgeLink,
} from "../db/knowledge-queries";
import type { JSONValue, KnowledgeLink } from "../types";

const AUTO_INTERNAL_LINK_ID_PREFIX = "auto:internal-link:";

export interface ExtractKnowledgeInternalDocumentLinksOptions {
  sourceDocumentId?: string;
  validDocumentIds?: Iterable<string>;
}

export interface SyncKnowledgeInternalDocumentLinksInput
  extends ExtractKnowledgeInternalDocumentLinksOptions {
  documentId: string;
  contentJson: JSONValue;
}

export interface SyncKnowledgeInternalDocumentLinksResult {
  targetDocumentIds: string[];
  added: number;
  deleted: number;
}

function isJsonRecord(value: JSONValue | undefined): value is Record<string, JSONValue> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringAttr(attrs: JSONValue | undefined, key: string): string | undefined {
  if (!isJsonRecord(attrs)) return undefined;
  const value = attrs[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function walkJson(value: JSONValue, visit: (node: Record<string, JSONValue>) => void) {
  if (Array.isArray(value)) {
    for (const child of value) walkJson(child, visit);
    return;
  }

  if (!isJsonRecord(value)) return;
  visit(value);
  for (const child of Object.values(value)) {
    walkJson(child, visit);
  }
}

export function createAutoKnowledgeInternalLinkId(
  fromDocumentId: string,
  toDocumentId: string,
): string {
  return `${AUTO_INTERNAL_LINK_ID_PREFIX}${encodeURIComponent(fromDocumentId)}:${encodeURIComponent(
    toDocumentId,
  )}`;
}

function isAutoInternalDocumentLink(link: KnowledgeLink, fromDocumentId: string): boolean {
  return (
    link.fromDocumentId === fromDocumentId &&
    link.toKind === "document" &&
    link.relation === "references" &&
    link.id.startsWith(`${AUTO_INTERNAL_LINK_ID_PREFIX}${encodeURIComponent(fromDocumentId)}:`)
  );
}

export function extractKnowledgeInternalDocumentLinkIds(
  contentJson: JSONValue,
  options: ExtractKnowledgeInternalDocumentLinksOptions = {},
): string[] {
  const validDocumentIds = options.validDocumentIds
    ? new Set(Array.from(options.validDocumentIds).filter(Boolean))
    : null;
  const targetIds = new Set<string>();

  walkJson(contentJson, (node) => {
    if (node.type !== "readanyInternalLink") return;
    const documentId = stringAttr(node.attrs, "documentId");
    if (!documentId) return;
    if (documentId === options.sourceDocumentId) return;
    if (validDocumentIds && !validDocumentIds.has(documentId)) return;
    targetIds.add(documentId);
  });

  return Array.from(targetIds);
}

export async function syncKnowledgeInternalDocumentLinks(
  input: SyncKnowledgeInternalDocumentLinksInput,
): Promise<SyncKnowledgeInternalDocumentLinksResult> {
  const targetDocumentIds = extractKnowledgeInternalDocumentLinkIds(input.contentJson, {
    sourceDocumentId: input.documentId,
    validDocumentIds: input.validDocumentIds,
  });
  const targetDocumentIdSet = new Set(targetDocumentIds);
  const existingLinks = await getKnowledgeLinks(input.documentId);
  const existingAutoLinks = existingLinks.filter((link) =>
    isAutoInternalDocumentLink(link, input.documentId),
  );
  const existingLinkedDocumentIds = new Set(
    existingLinks
      .filter((link) => link.toKind === "document")
      .map((link) => link.toId)
      .filter(Boolean),
  );

  let deleted = 0;
  for (const link of existingAutoLinks) {
    if (targetDocumentIdSet.has(link.toId)) continue;
    await deleteKnowledgeLink(link.id);
    deleted += 1;
  }

  let added = 0;
  const now = Date.now();
  for (const targetDocumentId of targetDocumentIds) {
    if (existingLinkedDocumentIds.has(targetDocumentId)) continue;
    await insertKnowledgeLink({
      id: createAutoKnowledgeInternalLinkId(input.documentId, targetDocumentId),
      fromDocumentId: input.documentId,
      toKind: "document",
      toId: targetDocumentId,
      relation: "references",
      createdAt: now,
      updatedAt: now,
    });
    added += 1;
  }

  return { targetDocumentIds, added, deleted };
}
