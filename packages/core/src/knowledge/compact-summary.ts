import type { KnowledgeDocument } from "../types";

const DEFAULT_MIN_SOURCE_CHARS = 3200;
const DEFAULT_MAX_SOURCE_CHARS = 16000;
const DEFAULT_MAX_SUMMARY_CHARS = 2400;

export interface KnowledgeSummaryCompressionState {
  summaryMd?: string;
  sourceFingerprint?: string;
  sourceUpdatedAt?: number;
  compressedAt?: number;
}

export interface KnowledgeSummaryCompressionOptions {
  minSourceChars?: number;
  maxSourceChars?: number;
  maxSummaryChars?: number;
}

export interface KnowledgeSummaryCompressionPlan {
  shouldCompress: boolean;
  reason: "empty" | "below_threshold" | "unchanged" | "missing_summary" | "stale_summary";
  sourceFingerprint: string;
  sourceUpdatedAt?: number;
  sourceChars: number;
  maxSummaryChars: number;
  source?: string;
  systemPrompt?: string;
  userPrompt?: string;
}

export type KnowledgeSummaryDocument = Pick<
  KnowledgeDocument,
  | "id"
  | "bookId"
  | "type"
  | "title"
  | "contentMd"
  | "excerpt"
  | "summaryMd"
  | "summarySourceFingerprint"
  | "summarySourceUpdatedAt"
  | "summaryUpdatedAt"
  | "tags"
  | "sourceKind"
  | "sourceId"
  | "updatedAt"
>;

function clampPositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback;
}

function normalizeMarkdownForSummary(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function truncateAtBoundary(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;

  const hardLimit = Math.max(0, maxChars - "\n\n[Truncated]".length);
  const slice = value.slice(0, hardLimit);
  const paragraphBreak = slice.lastIndexOf("\n\n");
  const sentenceBreak = Math.max(
    slice.lastIndexOf("。"),
    slice.lastIndexOf("！"),
    slice.lastIndexOf("？"),
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  const boundary = paragraphBreak > hardLimit * 0.65 ? paragraphBreak : sentenceBreak;
  const body = slice.slice(0, boundary > hardLimit * 0.65 ? boundary + 1 : hardLimit).trimEnd();
  return `${body}\n\n[Truncated]`;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function createSourceFingerprint(document: KnowledgeSummaryDocument, source: string): string {
  return hashString(
    JSON.stringify({
      id: document.id,
      type: document.type,
      title: document.title.trim(),
      tags: [...new Set(document.tags.map((tag) => tag.trim()).filter(Boolean))].sort(),
      content: source,
    }),
  );
}

function metadataLine(label: string, value: string | undefined): string | undefined {
  return value?.trim() ? `${label}: ${value.trim()}` : undefined;
}

function buildDocumentMetadata(document: KnowledgeSummaryDocument): string {
  return [
    metadataLine("Document ID", document.id),
    metadataLine("Type", document.type),
    metadataLine("Title", document.title),
    metadataLine("Book ID", document.bookId),
    document.tags.length ? `Tags: ${document.tags.join(", ")}` : undefined,
    metadataLine("Source", document.sourceKind),
    metadataLine("Source ID", document.sourceId),
    metadataLine("Excerpt", document.excerpt),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCompressionSource(
  document: KnowledgeSummaryDocument,
  state: KnowledgeSummaryCompressionState | undefined,
  source: string,
  maxSourceChars: number,
): string {
  const sections = [
    "## Document",
    buildDocumentMetadata(document),
    state?.summaryMd?.trim()
      ? `## Existing Compressed Summary\n${state.summaryMd.trim()}`
      : undefined,
    `## Current Document Markdown\n${truncateAtBoundary(source, maxSourceChars)}`,
  ].filter(Boolean);
  return sections.join("\n\n");
}

function buildSystemPrompt(maxSummaryChars: number): string {
  return [
    "You maintain compact memory for a ReadAny knowledge-base document.",
    "Update the compressed summary from the existing summary and the current document markdown.",
    "Preserve only durable knowledge: main ideas, user interpretations, decisions, open questions, tasks, citations, and source references that will help future AI retrieval.",
    "Do not invent facts, quotes, sources, or conclusions that are not present in the source.",
    "Keep the user's language when it is clear. Return Markdown only.",
    `Keep the result under ${maxSummaryChars} characters.`,
  ].join("\n");
}

function buildUserPrompt(source: string): string {
  return [
    "Compress this ReadAny knowledge document into durable memory.",
    "If an existing compressed summary is present, merge it with the current document instead of appending duplicate bullets.",
    "",
    source,
  ].join("\n");
}

export function createKnowledgeSummarySourceFingerprint(
  document: KnowledgeSummaryDocument,
): string {
  const source = normalizeMarkdownForSummary(document.contentMd);
  return createSourceFingerprint(document, source);
}

export function createKnowledgeSummaryCompressionStateFromDocument(
  document: KnowledgeSummaryDocument,
): KnowledgeSummaryCompressionState | undefined {
  const summaryMd = document.summaryMd?.trim();
  const sourceFingerprint = document.summarySourceFingerprint?.trim();
  if (!summaryMd || !sourceFingerprint) return undefined;

  return {
    summaryMd,
    sourceFingerprint,
    sourceUpdatedAt: document.summarySourceUpdatedAt,
    compressedAt: document.summaryUpdatedAt,
  };
}

export function prepareKnowledgeSummaryCompression(
  document: KnowledgeSummaryDocument,
  state?: KnowledgeSummaryCompressionState,
  options: KnowledgeSummaryCompressionOptions = {},
): KnowledgeSummaryCompressionPlan {
  const minSourceChars = clampPositive(options.minSourceChars, DEFAULT_MIN_SOURCE_CHARS);
  const maxSourceChars = clampPositive(options.maxSourceChars, DEFAULT_MAX_SOURCE_CHARS);
  const maxSummaryChars = clampPositive(options.maxSummaryChars, DEFAULT_MAX_SUMMARY_CHARS);
  const normalizedSource = normalizeMarkdownForSummary(document.contentMd);
  const sourceFingerprint = createSourceFingerprint(document, normalizedSource);
  const sourceChars = normalizedSource.length;

  if (!normalizedSource) {
    return {
      shouldCompress: false,
      reason: "empty",
      sourceFingerprint,
      sourceUpdatedAt: document.updatedAt,
      sourceChars,
      maxSummaryChars,
    };
  }

  if (sourceChars < minSourceChars) {
    return {
      shouldCompress: false,
      reason: "below_threshold",
      sourceFingerprint,
      sourceUpdatedAt: document.updatedAt,
      sourceChars,
      maxSummaryChars,
    };
  }

  if (state?.sourceFingerprint === sourceFingerprint && state.summaryMd?.trim()) {
    return {
      shouldCompress: false,
      reason: "unchanged",
      sourceFingerprint,
      sourceUpdatedAt: document.updatedAt,
      sourceChars,
      maxSummaryChars,
    };
  }

  const source = buildCompressionSource(document, state, normalizedSource, maxSourceChars);
  return {
    shouldCompress: true,
    reason: state?.summaryMd?.trim() ? "stale_summary" : "missing_summary",
    sourceFingerprint,
    sourceUpdatedAt: document.updatedAt,
    sourceChars,
    maxSummaryChars,
    source,
    systemPrompt: buildSystemPrompt(maxSummaryChars),
    userPrompt: buildUserPrompt(source),
  };
}

export function createKnowledgeSummaryCompressionState(
  summaryMd: string,
  plan: Pick<
    KnowledgeSummaryCompressionPlan,
    "sourceFingerprint" | "sourceUpdatedAt" | "maxSummaryChars"
  >,
  now = Date.now(),
): KnowledgeSummaryCompressionState {
  return {
    summaryMd: summaryMd.trim().slice(0, plan.maxSummaryChars || DEFAULT_MAX_SUMMARY_CHARS),
    sourceFingerprint: plan.sourceFingerprint,
    sourceUpdatedAt: plan.sourceUpdatedAt,
    compressedAt: now,
  };
}
