import { getKnowledgeLinks, insertKnowledgeLink } from "../db/knowledge-queries";
import type { KnowledgeLink, KnowledgeLinkTargetKind } from "../types";
import { generateId } from "../utils/generate-id";

export interface EnsureKnowledgeSourceLinkInput {
  documentId: string;
  toKind: KnowledgeLinkTargetKind;
  toId: string;
  label?: string;
  cfi?: string;
}

function sameSourceLink(link: KnowledgeLink, input: EnsureKnowledgeSourceLinkInput): boolean {
  return (
    link.relation === "source" &&
    link.toKind === input.toKind &&
    link.toId === input.toId &&
    (link.cfi ?? undefined) === (input.cfi ?? undefined)
  );
}

export async function ensureKnowledgeSourceLink(
  input: EnsureKnowledgeSourceLinkInput,
): Promise<boolean> {
  const links = await getKnowledgeLinks(input.documentId);
  if (links.some((link) => sameSourceLink(link, input))) return false;

  const now = Date.now();
  await insertKnowledgeLink({
    id: generateId(),
    fromDocumentId: input.documentId,
    toKind: input.toKind,
    toId: input.toId,
    relation: "source",
    label: input.label,
    cfi: input.cfi,
    createdAt: now,
    updatedAt: now,
  });
  return true;
}
