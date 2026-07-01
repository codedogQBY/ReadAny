import { getPlatformService } from "../services/platform";
import type { JSONValue } from "../types";

const DRAFT_DIR_NAME = "knowledge-editor-drafts";
export const KNOWLEDGE_EDITOR_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface KnowledgeEditorDraftValue {
  contentJson: JSONValue;
  contentMd: string;
  plainText: string;
}

export interface KnowledgeEditorDraft {
  key: string;
  updatedAt: number;
  baseFingerprint: string;
  contentFingerprint: string;
  value: KnowledgeEditorDraftValue;
}

export function createKnowledgeEditorDraftKey(documentId: string, scope = "knowledge"): string {
  return `${scope}:${documentId}`;
}

export function knowledgeEditorDraftFingerprint(contentJson: JSONValue): string {
  return JSON.stringify(contentJson);
}

function hashDraftKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

async function getDraftPath(key: string): Promise<string> {
  const platform = getPlatformService();
  const dataDir = await platform.getDataDir();
  const draftDir = await platform.joinPath(dataDir, DRAFT_DIR_NAME);
  await platform.mkdir(draftDir).catch(() => undefined);
  return platform.joinPath(draftDir, `draft-${hashDraftKey(key)}.json`);
}

function parseDraft(raw: string | null, key: string): KnowledgeEditorDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<KnowledgeEditorDraft>;
    if (
      parsed.key !== key ||
      typeof parsed.updatedAt !== "number" ||
      typeof parsed.baseFingerprint !== "string" ||
      typeof parsed.contentFingerprint !== "string" ||
      !parsed.value ||
      typeof parsed.value !== "object"
    ) {
      return null;
    }
    return parsed as KnowledgeEditorDraft;
  } catch {
    return null;
  }
}

export async function loadKnowledgeEditorDraft(key: string): Promise<KnowledgeEditorDraft | null> {
  try {
    const path = await getDraftPath(key);
    const raw = await getPlatformService().readTextFile(path);
    return parseDraft(raw, key);
  } catch {
    return null;
  }
}

export async function saveKnowledgeEditorDraft(
  key: string,
  value: KnowledgeEditorDraftValue,
  options: { baseFingerprint?: string; updatedAt?: number } = {},
): Promise<KnowledgeEditorDraft> {
  const draft: KnowledgeEditorDraft = {
    key,
    updatedAt: options.updatedAt ?? Date.now(),
    baseFingerprint: options.baseFingerprint ?? "",
    contentFingerprint: knowledgeEditorDraftFingerprint(value.contentJson),
    value,
  };
  const path = await getDraftPath(key);
  await getPlatformService().writeTextFile(path, JSON.stringify(draft));
  return draft;
}

export async function clearKnowledgeEditorDraft(key: string): Promise<void> {
  try {
    const path = await getDraftPath(key);
    await getPlatformService().deleteFile(path);
  } catch {
    // Draft cleanup should never interrupt editing.
  }
}

export function isKnowledgeEditorDraftRestorable(
  draft: KnowledgeEditorDraft | null,
  currentFingerprint: string,
  now = Date.now(),
  maxAgeMs = KNOWLEDGE_EDITOR_DRAFT_MAX_AGE_MS,
): draft is KnowledgeEditorDraft {
  if (!draft) return false;
  if (!draft.contentFingerprint || draft.contentFingerprint === currentFingerprint) return false;
  if (now - draft.updatedAt > maxAgeMs) return false;
  return true;
}
