import type { JSONValue } from "../types";

export interface KnowledgeEditorBridgeSelectionState {
  marks: {
    bold?: boolean;
    italic?: boolean;
    strike?: boolean;
    code?: boolean;
    bulletList?: boolean;
    orderedList?: boolean;
    taskList?: boolean;
    blockquote?: boolean;
    link?: boolean;
  };
  linkHref: string | null;
  headingLevel: number | null;
  canUndo: boolean;
  canRedo: boolean;
}

export type KnowledgeEditorBridgeMessage =
  | { type: "loaded" }
  | { type: "ready" }
  | { type: "heightChanged"; height?: unknown }
  | {
      type: "contentChanged";
      requestId?: unknown;
      contentJson?: unknown;
      plainText?: unknown;
    }
  | {
      type: "selectionChanged";
      marks?: KnowledgeEditorBridgeSelectionState["marks"];
      linkHref?: string | null;
      headingLevel?: number | null;
      canUndo?: boolean;
      canRedo?: boolean;
    }
  | { type: "focusChanged"; focused?: unknown }
  | { type: "error"; code?: string; message?: string };

export type KnowledgeEditorBridgeParseError = "invalid_json" | "missing_type";

export interface KnowledgeEditorBridgeParseResult {
  message: KnowledgeEditorBridgeMessage | null;
  error?: KnowledgeEditorBridgeParseError;
}

export const KNOWLEDGE_MOBILE_EDITOR_MIN_HEIGHT = 260;
export const KNOWLEDGE_MOBILE_EDITOR_MAX_HEIGHT = 560;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isKnowledgeEditorBridgeJsonValue(value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isKnowledgeEditorBridgeJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isKnowledgeEditorBridgeJsonValue);
}

export function parseKnowledgeEditorBridgeMessage(
  data: string,
): KnowledgeEditorBridgeParseResult {
  try {
    const parsed = JSON.parse(data);
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      return { message: null, error: "missing_type" };
    }
    return { message: parsed as KnowledgeEditorBridgeMessage };
  } catch {
    return { message: null, error: "invalid_json" };
  }
}

export function clampKnowledgeEditorBridgeHeight(height: number): number {
  return Math.min(
    Math.max(Math.ceil(height), KNOWLEDGE_MOBILE_EDITOR_MIN_HEIGHT),
    KNOWLEDGE_MOBILE_EDITOR_MAX_HEIGHT,
  );
}
