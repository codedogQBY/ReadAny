import type { CreateKnowledgeDocumentInput } from "../db/database";
import {
  createKnowledgeExcerpt,
  formatKnowledgeDocumentPath,
  markdownToBasicTiptap,
} from "../knowledge";
import type {
  KnowledgeDocumentCreateProposal,
  KnowledgeDocumentUpdateProposal,
} from "../knowledge/proposals";
import type {
  JSONValue,
  KnowledgeCardTemplate,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeSourceKind,
} from "../types";
import {
  type KnowledgeExportManifest,
  type KnowledgeExportObservedFile,
  createKnowledgeExportHash,
} from "./knowledge-exporter";

export interface KnowledgeMarkdownImportInput {
  path?: string;
  relativePath?: string;
  content: string;
  defaultType?: KnowledgeDocumentType;
  defaultParentId?: string;
  bookId?: string;
  cardTemplates?: KnowledgeCardTemplate[];
}

export type KnowledgeMarkdownImportPlanFile = KnowledgeMarkdownImportInput;

export interface KnowledgeMarkdownImportPlanInput {
  files: KnowledgeMarkdownImportPlanFile[];
  defaultType?: KnowledgeDocumentType;
  defaultParentId?: string;
  bookId?: string;
  preservePathHierarchy?: boolean;
  currentDocuments?: KnowledgeDocument[];
  cardTemplates?: KnowledgeCardTemplate[];
}

export interface KnowledgeImportFrontmatter {
  type?: string;
  id?: string;
  documentType?: KnowledgeDocumentType;
  title?: string;
  bookId?: string;
  parentId?: string;
  book?: string;
  author?: string;
  sourceKind?: KnowledgeSourceKind;
  sourceId?: string;
  created?: number;
  updated?: number;
  tags: string[];
}

export interface KnowledgeImportDocumentDraft {
  path?: string;
  hash: string;
  isReadAnyExport: boolean;
  frontmatter: KnowledgeImportFrontmatter;
  contentMd: string;
  draft: CreateKnowledgeDocumentInput;
  warnings: string[];
}

export interface KnowledgeMarkdownImportPlanItem {
  path: string;
  relativePath: string;
  proposal: KnowledgeImportWriteProposal;
  warnings: string[];
}

export interface KnowledgeMarkdownImportPlan {
  items: KnowledgeMarkdownImportPlanItem[];
  folderItems: KnowledgeMarkdownImportPlanItem[];
  documentItems: KnowledgeMarkdownImportPlanItem[];
}

export type KnowledgeVaultImportEntryStatus =
  | "unchanged"
  | "modified"
  | "missing"
  | "modified_unreadable"
  | "conflict";

export type KnowledgeVaultImportResolutionKind =
  | "manual_merge"
  | "remove_duplicate"
  | "restore_missing"
  | "restore_readable"
  | "manual_review"
  | "keep_local_template";

export type KnowledgeVaultImportResolutionAction =
  | "merge_then_reimport"
  | "remove_duplicate_then_reimport"
  | "restore_file_or_export_again"
  | "grant_access_or_export_again"
  | "inspect_then_reimport"
  | "review_template_then_export_again";

export interface KnowledgeVaultImportResolution {
  kind: KnowledgeVaultImportResolutionKind;
  suggestedAction: KnowledgeVaultImportResolutionAction;
  safeDefault: "keep_readany" | "keep_local_template";
  blocksAutomaticApply: boolean;
}

export interface KnowledgeVaultImportEntry {
  documentId: string;
  path: string;
  status: KnowledgeVaultImportEntryStatus;
  previousHash: string;
  existingHash?: string;
  currentHash?: string;
  draft?: KnowledgeImportDocumentDraft;
  warnings: string[];
  resolution?: KnowledgeVaultImportResolution;
}

export interface KnowledgeVaultImportPlan {
  manifest: KnowledgeExportManifest;
  entries: KnowledgeVaultImportEntry[];
  modified: KnowledgeVaultImportEntry[];
  missing: KnowledgeVaultImportEntry[];
  unreadable: KnowledgeVaultImportEntry[];
  conflicts: KnowledgeVaultImportEntry[];
  cardTemplateChanges: KnowledgeVaultImportCardTemplateChange[];
  cardTemplateConflicts: KnowledgeVaultImportCardTemplateConflict[];
}

export interface KnowledgeVaultImportPlanInput {
  manifest: KnowledgeExportManifest;
  files: KnowledgeExportObservedFile[];
  currentFiles?: KnowledgeExportObservedFile[];
  cardTemplates?: KnowledgeCardTemplate[];
}

export type KnowledgeVaultImportCardTemplateChangeStatus = "missing" | "modified";

export interface KnowledgeVaultImportCardTemplateChange {
  template: KnowledgeCardTemplate;
  status: KnowledgeVaultImportCardTemplateChangeStatus;
  current?: KnowledgeCardTemplate;
  warnings: string[];
}

export interface KnowledgeVaultImportCardTemplateConflict {
  template: KnowledgeCardTemplate;
  current: KnowledgeCardTemplate;
  status: "conflict";
  warnings: string[];
  resolution: KnowledgeVaultImportResolution;
}

export interface KnowledgeImportProposalOptions {
  mode?: "create" | "update";
  documentId?: string;
  message?: string;
  current?: KnowledgeDocumentUpdateProposal["current"];
}

export type KnowledgeImportWriteProposal =
  | KnowledgeDocumentCreateProposal
  | KnowledgeDocumentUpdateProposal;

function mergeKnowledgeCardTemplates(
  ...sources: Array<KnowledgeCardTemplate[] | undefined>
): KnowledgeCardTemplate[] | undefined {
  const templatesById = new Map<string, KnowledgeCardTemplate>();
  for (const source of sources) {
    for (const template of source ?? []) {
      if (templatesById.has(template.id)) continue;
      templatesById.set(template.id, template);
    }
  }
  return templatesById.size > 0 ? Array.from(templatesById.values()) : undefined;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function comparableCardTemplateSnapshot(template: KnowledgeCardTemplate): Record<string, unknown> {
  return {
    id: template.id,
    name: template.name,
    version: template.version,
    schemaJson: template.schemaJson,
    builtIn: template.builtIn,
    enabled: template.enabled,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

function areKnowledgeCardTemplatesEquivalent(
  left: KnowledgeCardTemplate,
  right: KnowledgeCardTemplate,
): boolean {
  return (
    stableStringify(comparableCardTemplateSnapshot(left)) ===
    stableStringify(comparableCardTemplateSnapshot(right))
  );
}

function createKnowledgeVaultImportCardTemplateDiff({
  manifestTemplates,
  currentTemplates,
}: {
  manifestTemplates?: KnowledgeCardTemplate[];
  currentTemplates?: KnowledgeCardTemplate[];
}): {
  changes: KnowledgeVaultImportCardTemplateChange[];
  conflicts: KnowledgeVaultImportCardTemplateConflict[];
} {
  const currentById = new Map((currentTemplates ?? []).map((template) => [template.id, template]));
  const changes: KnowledgeVaultImportCardTemplateChange[] = [];
  const conflicts: KnowledgeVaultImportCardTemplateConflict[] = [];

  for (const template of manifestTemplates ?? []) {
    if (template.builtIn) continue;

    const current = currentById.get(template.id);
    if (!current) {
      changes.push({
        template,
        status: "missing",
        warnings: ["card_template_missing"],
      });
      continue;
    }

    if (areKnowledgeCardTemplatesEquivalent(template, current)) continue;

    const manifestIsNewer =
      template.version > current.version ||
      (template.version === current.version && template.updatedAt >= current.updatedAt);

    if (manifestIsNewer) {
      changes.push({
        template,
        current,
        status: "modified",
        warnings: ["card_template_modified"],
      });
      continue;
    }

    conflicts.push({
      template,
      current,
      status: "conflict",
      warnings: ["local_card_template_newer"],
      resolution: {
        kind: "keep_local_template",
        suggestedAction: "review_template_then_export_again",
        safeDefault: "keep_local_template",
        blocksAutomaticApply: true,
      },
    });
  }

  return { changes, conflicts };
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

function createKnowledgeVaultImportResolution(
  status: KnowledgeVaultImportEntryStatus,
  warnings: readonly string[],
): KnowledgeVaultImportResolution | undefined {
  const warningSet = new Set(warnings);
  if (status === "conflict") {
    if (warningSet.has("multiple_files_with_same_document_id")) {
      return {
        kind: "remove_duplicate",
        suggestedAction: "remove_duplicate_then_reimport",
        safeDefault: "keep_readany",
        blocksAutomaticApply: true,
      };
    }
    if (warningSet.has("local_and_remote_modified")) {
      return {
        kind: "manual_merge",
        suggestedAction: "merge_then_reimport",
        safeDefault: "keep_readany",
        blocksAutomaticApply: true,
      };
    }
    return {
      kind: "manual_review",
      suggestedAction: "inspect_then_reimport",
      safeDefault: "keep_readany",
      blocksAutomaticApply: true,
    };
  }

  if (status === "missing") {
    return {
      kind: "restore_missing",
      suggestedAction: "restore_file_or_export_again",
      safeDefault: "keep_readany",
      blocksAutomaticApply: true,
    };
  }

  if (status === "modified_unreadable") {
    return {
      kind: "restore_readable",
      suggestedAction: "grant_access_or_export_again",
      safeDefault: "keep_readany",
      blocksAutomaticApply: true,
    };
  }

  return undefined;
}

const KNOWLEDGE_ROOT_TITLE = "Knowledge base";
const UNTITLED_DOCUMENT_TITLE = "Untitled document";
const ORPHANED_PARENT_TITLE = "Orphaned";

const SOURCE_KINDS = new Set<KnowledgeSourceKind>([
  "book",
  "highlight",
  "note",
  "cfi",
  "ai_message",
  "external",
  "obsidian",
]);

function parseQuotedValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\(["\\])/g, "$1")
      .trim();
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'").trim();
  }
  return trimmed;
}

function parseInlineListValue(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined;

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];

  const values: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (quote) {
      current += char;
      if (char === quote) {
        if (quote === "'" && inner[index + 1] === "'") {
          current += inner[index + 1];
          index += 1;
        } else if (quote === '"' && inner[index - 1] === "\\") {
          continue;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === ",") {
      const parsed = parseQuotedValue(current);
      if (parsed) values.push(parsed);
      current = "";
      continue;
    }

    current += char;
  }

  const parsed = parseQuotedValue(current);
  if (parsed) values.push(parsed);
  return values;
}

function parseScalar(value: string): string | string[] {
  const trimmed = value.trim();
  if (trimmed === "[]") return [];
  const inlineList = parseInlineListValue(trimmed);
  if (inlineList) return inlineList;
  return parseQuotedValue(trimmed);
}

function parseFrontmatterYaml(raw: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let listKey: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && listKey) {
      const existing = result[listKey];
      const values = Array.isArray(existing) ? existing : [];
      result[listKey] = [...values, parseQuotedValue(listItem[1])];
      continue;
    }

    const keyValue = line.match(/^([A-Za-z][\w-]*):(?:\s*(.*))?$/);
    if (!keyValue) continue;

    const key = keyValue[1];
    const value = keyValue[2] ?? "";
    if (value.trim()) {
      result[key] = parseScalar(value);
      listKey = null;
    } else {
      result[key] = [];
      listKey = key;
    }
  }

  return result;
}

function readString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  }
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readTimestamp(value: string | string[] | undefined): number | undefined {
  const raw = readString(value);
  if (!raw) return undefined;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function readDocumentType(value: string | string[] | undefined): KnowledgeDocumentType | undefined {
  const type = readString(value);
  return type && DOCUMENT_TYPES.has(type as KnowledgeDocumentType)
    ? (type as KnowledgeDocumentType)
    : undefined;
}

function readSourceKind(value: string | string[] | undefined): KnowledgeSourceKind | undefined {
  const sourceKind = readString(value);
  return sourceKind && SOURCE_KINDS.has(sourceKind as KnowledgeSourceKind)
    ? (sourceKind as KnowledgeSourceKind)
    : undefined;
}

function extractFrontmatter(content: string): {
  raw?: string;
  parsed: Record<string, string | string[]>;
  body: string;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { parsed: {}, body: normalized };
  }

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return { parsed: {}, body: normalized };
  }

  const afterEnd = normalized.slice(end + 4);
  const raw = normalized.slice(4, end);
  return {
    raw,
    parsed: parseFrontmatterYaml(raw),
    body: afterEnd.startsWith("\n") ? afterEnd.slice(1) : afterEnd,
  };
}

function fileTitle(path?: string): string | undefined {
  if (!path) return undefined;
  const fileName = path.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return fileName?.replace(/\.[^.]+$/, "").trim() || undefined;
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+/g, "/");
}

function isJsonRecord(value: JSONValue | undefined): value is Record<string, JSONValue> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringJsonAttr(attrs: Record<string, JSONValue>, key: string): string | undefined {
  const value = attrs[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stripMarkdownExtension(path: string): string {
  return normalizePath(path).replace(/\.md$/i, "");
}

function stripFolderIndex(path: string): string {
  return path.replace(/\/(?:README|index)$/i, "");
}

function stripRootDir(path: string, rootDir: string): string {
  const normalizedRoot = normalizePath(rootDir);
  if (!normalizedRoot) return path;
  return path === normalizedRoot
    ? ""
    : path.startsWith(`${normalizedRoot}/`)
      ? path.slice(normalizedRoot.length + 1)
      : path;
}

function createManifestDocumentIdsByPath(manifest: KnowledgeExportManifest): Map<string, string> {
  const idsByPath = new Map<string, string>();

  for (const [documentId, document] of Object.entries(manifest.documents)) {
    const normalized = stripMarkdownExtension(document.path);
    const withoutRoot = stripRootDir(normalized, manifest.rootDir);
    const aliases = new Set([
      normalized,
      stripFolderIndex(normalized),
      withoutRoot,
      stripFolderIndex(withoutRoot),
    ]);

    for (const alias of aliases) {
      if (alias) idsByPath.set(alias, documentId);
    }
  }

  return idsByPath;
}

function resolveManifestDocumentIdByPath(
  targetPath: string,
  documentIdsByPath: Map<string, string>,
): string | undefined {
  const normalized = stripMarkdownExtension(targetPath);
  return documentIdsByPath.get(normalized) ?? documentIdsByPath.get(stripFolderIndex(normalized));
}

function resolveInternalLinkTargetPaths(
  contentJson: JSONValue,
  documentIdsByPath: Map<string, string>,
): JSONValue {
  if (Array.isArray(contentJson)) {
    return contentJson.map((item) => resolveInternalLinkTargetPaths(item, documentIdsByPath));
  }
  if (!isJsonRecord(contentJson)) return contentJson;

  const next: Record<string, JSONValue> = {};
  for (const [key, value] of Object.entries(contentJson)) {
    next[key] = resolveInternalLinkTargetPaths(value, documentIdsByPath);
  }

  if (contentJson.type === "readanyInternalLink" && isJsonRecord(contentJson.attrs)) {
    const targetPath = stringJsonAttr(contentJson.attrs, "targetPath");
    const documentId = stringJsonAttr(contentJson.attrs, "documentId");
    const resolvedDocumentId = targetPath
      ? resolveManifestDocumentIdByPath(targetPath, documentIdsByPath)
      : undefined;

    if (resolvedDocumentId && resolvedDocumentId !== documentId) {
      next.attrs = {
        ...(next.attrs && isJsonRecord(next.attrs) ? next.attrs : {}),
        documentId: resolvedDocumentId,
      };
    }
  }

  return next as JSONValue;
}

function splitPath(path: string): string[] {
  return path
    .replace(/\\/g, "/")
    .replace(/^file:\/+/, "")
    .replace(/\/+/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function fileNameFromPath(path?: string): string | undefined {
  if (!path) return undefined;
  const parts = splitPath(path);
  return parts[parts.length - 1];
}

function directoryParts(path: string): string[] {
  const parts = splitPath(path);
  return parts.slice(0, -1);
}

function commonDirectoryParts(paths: string[]): string[] {
  const directories = paths.map(directoryParts).filter((parts) => parts.length > 0);
  if (directories.length === 0) return [];

  const shortest = Math.min(...directories.map((parts) => parts.length));
  const common: string[] = [];
  for (let index = 0; index < shortest; index += 1) {
    const candidate = directories[0][index];
    if (directories.every((parts) => parts[index] === candidate)) {
      common.push(candidate);
    } else {
      break;
    }
  }
  return common;
}

function relativePathFromCommonDirectory(path: string, commonParts: string[]): string {
  const parts = splitPath(path);
  const hasCommonPrefix =
    commonParts.length > 0 && commonParts.every((part, index) => parts[index] === part);
  const relativeParts = hasCommonPrefix ? parts.slice(commonParts.length) : parts.slice(-1);
  return relativeParts.join("/") || fileNameFromPath(path) || path;
}

function sanitizeImportPathSegment(segment: string): string {
  return segment
    .trim()
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeImportSiblingTitle(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function importSiblingKey(input: {
  bookId?: string;
  parentId?: string;
  title?: string;
}): string {
  return [input.bookId ?? "", input.parentId ?? "", normalizeImportSiblingTitle(input.title)].join(
    "\u0000",
  );
}

function folderIdForImportPath({
  bookId,
  baseParentId,
  relativeDirPath,
}: {
  bookId?: string;
  baseParentId?: string;
  relativeDirPath: string;
}): string {
  const hash = createKnowledgeExportHash(
    ["knowledge-import-folder-v1", bookId ?? "", baseParentId ?? "", relativeDirPath].join("\n"),
  ).replace(/[^a-zA-Z0-9]+/g, "-");
  return `import-folder-${hash}`;
}

function firstHeadingTitle(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function removeLeadingDocumentTitle(markdown: string, title: string): string {
  const lines = markdown.trim().split("\n");
  if (lines[0]?.trim() === `# ${title.trim()}`) {
    lines.shift();
    if (lines[0]?.trim() === "") lines.shift();
  }
  return lines.join("\n").trim();
}

type GeneratedReadAnySectionTitle = "ReadAny Links" | "Attachments";

function generatedReadAnySectionTitle(line: string): GeneratedReadAnySectionTitle | undefined {
  const match = line.trim().match(/^##\s+(ReadAny Links|Attachments)\s*$/);
  return match?.[1] as GeneratedReadAnySectionTitle | undefined;
}

function generatedReadAnySectionMarker(title: GeneratedReadAnySectionTitle): string {
  return title === "ReadAny Links"
    ? "<!-- readany:generated-links -->"
    : "<!-- readany:generated-attachments -->";
}

function trailingMarkdownH2Section(
  lines: string[],
  endExclusive: number,
): { index: number; title?: GeneratedReadAnySectionTitle } | undefined {
  for (let index = endExclusive - 1; index >= 0; index -= 1) {
    if (!/^##\s+.+$/.test(lines[index].trim())) continue;
    return { index, title: generatedReadAnySectionTitle(lines[index]) };
  }
  return undefined;
}

function looksLikeLegacyGeneratedReadAnySection(
  title: GeneratedReadAnySectionTitle,
  sectionLines: string[],
): boolean {
  const contentLines = sectionLines.map((line) => line.trim()).filter(Boolean);
  if (contentLines.length === 0) return false;

  if (contentLines[0] === generatedReadAnySectionMarker(title)) return true;

  if (title === "ReadAny Links") {
    return contentLines.every((line) => /^-\s+\*\*[^*]+:\*\*\s+.+$/.test(line));
  }

  return contentLines.every((line) => /^-\s+\[[^\]]+\]\(.+\)$/.test(line));
}

function stripGeneratedReadAnySections(markdown: string): string {
  const lines = markdown.trim().split("\n");
  let endExclusive = lines.length;

  while (endExclusive > 0) {
    const section = trailingMarkdownH2Section(lines, endExclusive);
    if (!section?.title) break;

    const trailingLines = lines.slice(section.index + 1, endExclusive);
    if (!looksLikeLegacyGeneratedReadAnySection(section.title, trailingLines)) break;
    endExclusive = section.index;
  }

  return lines.slice(0, endExclusive).join("\n").trim();
}

function normalizeFrontmatter(
  parsed: Record<string, string | string[]>,
): KnowledgeImportFrontmatter {
  return {
    type: readString(parsed.type),
    id: readString(parsed.id),
    documentType: readDocumentType(parsed.documentType),
    title: readString(parsed.title),
    bookId: readString(parsed.bookId),
    parentId: readString(parsed.parentId),
    book: readString(parsed.book),
    author: readString(parsed.author),
    sourceKind: readSourceKind(parsed.sourceKind),
    sourceId: readString(parsed.sourceId),
    created: readTimestamp(parsed.created),
    updated: readTimestamp(parsed.updated),
    tags: readStringList(parsed.tags),
  };
}

export function parseKnowledgeMarkdownDocument(
  input: KnowledgeMarkdownImportInput,
): KnowledgeImportDocumentDraft {
  const frontmatter = extractFrontmatter(input.content);
  const metadata = normalizeFrontmatter(frontmatter.parsed);
  const isReadAnyExport = metadata.type === "readany-knowledge";
  const warnings: string[] = [];

  if (frontmatter.raw && !isReadAnyExport) {
    warnings.push("frontmatter_not_readany");
  }
  if (frontmatter.raw && !metadata.documentType && isReadAnyExport) {
    warnings.push("missing_document_type");
  }

  const title =
    metadata.title ??
    firstHeadingTitle(frontmatter.body) ??
    fileTitle(input.relativePath ?? input.path) ??
    "Imported Knowledge";
  const documentType = metadata.documentType ?? input.defaultType ?? "imported_markdown";
  const contentMd = removeLeadingDocumentTitle(
    isReadAnyExport ? stripGeneratedReadAnySections(frontmatter.body) : frontmatter.body.trim(),
    title,
  );
  const contentJson = markdownToBasicTiptap(contentMd, {
    cardTemplates: input.cardTemplates,
  }) as unknown as JSONValue;
  const sourceId = metadata.sourceId ?? input.path;
  const sourceKind = metadata.sourceKind ?? (input.path ? "obsidian" : "external");
  const bookId = input.bookId ?? metadata.bookId;
  const parentId =
    metadata.parentId ??
    (!isReadAnyExport && documentType !== "book_home" ? input.defaultParentId : undefined);

  return {
    path: input.path,
    hash: createKnowledgeExportHash(input.content),
    isReadAnyExport,
    frontmatter: metadata,
    contentMd,
    draft: {
      id: metadata.id,
      parentId,
      type: documentType,
      title,
      bookId,
      contentJson,
      contentMd,
      contentSchemaVersion: 1,
      excerpt: createKnowledgeExcerpt(contentMd),
      tags: metadata.tags,
      sourceKind,
      sourceId,
    },
    warnings,
  };
}

function observedFileHash(file: KnowledgeExportObservedFile): string | undefined {
  if (file.hash) return file.hash;
  if (typeof file.content === "string") return createKnowledgeExportHash(file.content);
  return undefined;
}

function createReadAnyFilesByDocumentId(
  files: KnowledgeExportObservedFile[],
): Map<string, KnowledgeExportObservedFile[]> {
  const filesByDocumentId = new Map<string, KnowledgeExportObservedFile[]>();

  for (const file of files) {
    if (typeof file.content !== "string") continue;
    const frontmatter = normalizeFrontmatter(extractFrontmatter(file.content).parsed);
    if (frontmatter.type !== "readany-knowledge" || !frontmatter.id) continue;
    const filesForDocument = filesByDocumentId.get(frontmatter.id) ?? [];
    filesForDocument.push(file);
    filesByDocumentId.set(frontmatter.id, filesForDocument);
  }

  return filesByDocumentId;
}

export function createKnowledgeVaultImportPlan(
  input: KnowledgeVaultImportPlanInput,
): KnowledgeVaultImportPlan {
  const cardTemplates = mergeKnowledgeCardTemplates(
    input.manifest.cardTemplates,
    input.cardTemplates,
  );
  const cardTemplateDiff = createKnowledgeVaultImportCardTemplateDiff({
    manifestTemplates: input.manifest.cardTemplates,
    currentTemplates: input.cardTemplates,
  });
  const filesByPath = new Map(input.files.map((file) => [normalizePath(file.path), file] as const));
  const filesByDocumentId = createReadAnyFilesByDocumentId(input.files);
  const documentIdsByPath = createManifestDocumentIdsByPath(input.manifest);
  const currentHashesByPath = new Map(
    (input.currentFiles ?? [])
      .map((file) => [normalizePath(file.path), observedFileHash(file)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
  const entries: KnowledgeVaultImportEntry[] = [];

  for (const [documentId, manifestDocument] of Object.entries(input.manifest.documents)) {
    const manifestPath = normalizePath(manifestDocument.path);
    let path = manifestPath;
    let file = filesByPath.get(manifestPath);
    let pathWarnings: string[] = [];
    const relocatedFiles = (filesByDocumentId.get(documentId) ?? []).filter(
      (candidate) => normalizePath(candidate.path) !== manifestPath,
    );
    const currentHash = currentHashesByPath.get(manifestPath);
    if (file && relocatedFiles.length > 0) {
      entries.push({
        documentId,
        path: manifestPath,
        status: "conflict",
        previousHash: manifestDocument.hash,
        existingHash: observedFileHash(file),
        currentHash,
        warnings: ["multiple_files_with_same_document_id"],
        resolution: createKnowledgeVaultImportResolution("conflict", [
          "multiple_files_with_same_document_id",
        ]),
      });
      continue;
    }
    if (!file) {
      if (relocatedFiles.length > 1) {
        entries.push({
          documentId,
          path: manifestPath,
          status: "conflict",
          previousHash: manifestDocument.hash,
          currentHash,
          warnings: ["multiple_files_with_same_document_id"],
          resolution: createKnowledgeVaultImportResolution("conflict", [
            "multiple_files_with_same_document_id",
          ]),
        });
        continue;
      }
      if (relocatedFiles.length === 1) {
        file = relocatedFiles[0];
        path = normalizePath(file.path);
        pathWarnings = ["manifest_path_changed"];
      }
    }
    const hasLocalChange = Boolean(currentHash && currentHash !== manifestDocument.hash);

    if (!file) {
      entries.push({
        documentId,
        path,
        status: "missing",
        previousHash: manifestDocument.hash,
        currentHash,
        warnings: ["manifest_file_missing"],
        resolution: createKnowledgeVaultImportResolution("missing", ["manifest_file_missing"]),
      });
      continue;
    }

    const existingHash = observedFileHash(file);
    if (existingHash === manifestDocument.hash) {
      entries.push({
        documentId,
        path,
        status: "unchanged",
        previousHash: manifestDocument.hash,
        existingHash,
        currentHash,
        warnings: pathWarnings,
      });
      continue;
    }

    if (existingHash && hasLocalChange && existingHash === currentHash) {
      entries.push({
        documentId,
        path,
        status: "unchanged",
        previousHash: manifestDocument.hash,
        existingHash,
        currentHash,
        warnings: [...pathWarnings, "remote_matches_current_local"],
      });
      continue;
    }

    if (existingHash && hasLocalChange) {
      const warnings = [...pathWarnings, "local_and_remote_modified"];
      entries.push({
        documentId,
        path,
        status: "conflict",
        previousHash: manifestDocument.hash,
        existingHash,
        currentHash,
        warnings,
        resolution: createKnowledgeVaultImportResolution("conflict", warnings),
      });
      continue;
    }

    if (typeof file.content !== "string") {
      const warnings = [...pathWarnings, "modified_file_content_missing"];
      entries.push({
        documentId,
        path,
        status: "modified_unreadable",
        previousHash: manifestDocument.hash,
        existingHash,
        currentHash,
        warnings,
        resolution: createKnowledgeVaultImportResolution("modified_unreadable", warnings),
      });
      continue;
    }

    const draft = parseKnowledgeMarkdownDocument({
      path,
      content: file.content,
      defaultType: manifestDocument.type,
      bookId: manifestDocument.bookId,
      cardTemplates,
    });
    draft.draft.contentJson = resolveInternalLinkTargetPaths(
      draft.draft.contentJson ?? ({ type: "doc", content: [] } as unknown as JSONValue),
      documentIdsByPath,
    );
    const warnings = [...draft.warnings];
    if (!draft.draft.id) {
      warnings.push("frontmatter_id_missing_using_manifest");
      draft.draft.id = documentId;
    }
    draft.draft.type = draft.draft.type ?? manifestDocument.type;
    draft.draft.bookId = draft.draft.bookId ?? manifestDocument.bookId;
    draft.draft.sourceKind = draft.draft.sourceKind ?? manifestDocument.sourceKind;
    draft.draft.sourceId = draft.draft.sourceId ?? manifestDocument.sourceId;

    entries.push({
      documentId,
      path,
      status: "modified",
      previousHash: manifestDocument.hash,
      existingHash: createKnowledgeExportHash(file.content),
      currentHash,
      draft,
      warnings: [...pathWarnings, ...warnings],
    });
  }

  return {
    manifest: input.manifest,
    entries,
    modified: entries.filter((entry) => entry.status === "modified"),
    missing: entries.filter((entry) => entry.status === "missing"),
    unreadable: entries.filter((entry) => entry.status === "modified_unreadable"),
    conflicts: entries.filter((entry) => entry.status === "conflict"),
    cardTemplateChanges: cardTemplateDiff.changes,
    cardTemplateConflicts: cardTemplateDiff.conflicts,
  };
}

function requireImportedContentJson(imported: KnowledgeImportDocumentDraft): JSONValue {
  return imported.draft.contentJson ?? ({ type: "doc", content: [] } as unknown as JSONValue);
}

function createKnowledgeImportCreateProposal(
  imported: KnowledgeImportDocumentDraft,
  message?: string,
): KnowledgeDocumentCreateProposal {
  return {
    success: true,
    action: "create",
    requiresConfirmation: true,
    confirmationKind: "knowledge_document_create",
    message: message ?? "Imported knowledge draft generated. No document has been saved.",
    draft: {
      ...imported.draft,
      contentJson: requireImportedContentJson(imported),
      contentMd: imported.contentMd,
      tags: imported.draft.tags ?? [],
      sourceKind: imported.draft.sourceKind ?? (imported.path ? "obsidian" : "external"),
      sourceId: imported.draft.sourceId ?? imported.path,
    },
  };
}

function createKnowledgeImportUpdateProposal(
  imported: KnowledgeImportDocumentDraft,
  options: KnowledgeImportProposalOptions,
): KnowledgeDocumentUpdateProposal {
  const documentId = options.documentId ?? imported.draft.id;
  if (!documentId) {
    throw new Error("documentId is required to create a knowledge import update proposal");
  }

  const patch: KnowledgeDocumentUpdateProposal["patch"] = {
    parentId: imported.draft.parentId,
    title: imported.draft.title ?? options.current?.title ?? "Imported Knowledge",
    contentMd: imported.contentMd,
    contentJson: requireImportedContentJson(imported),
    excerpt: imported.draft.excerpt,
    tags: imported.draft.tags ?? [],
  };

  const changedFields = ["parentId", "title", "contentMd", "contentJson", "excerpt", "tags"].filter(
    (field) => {
      if (field === "parentId") return patch.parentId !== options.current?.parentId;
      if (field === "title") return patch.title !== options.current?.title;
      if (field === "tags") {
        return JSON.stringify(patch.tags ?? []) !== JSON.stringify(options.current?.tags ?? []);
      }
      return true;
    },
  );

  return {
    success: true,
    action: "update",
    requiresConfirmation: true,
    confirmationKind: "knowledge_document_update",
    message:
      options.message ??
      "Imported knowledge update generated. The existing document has not been changed.",
    documentId,
    current: options.current,
    patch,
    changedFields,
  };
}

export function createKnowledgeImportWriteProposal(
  imported: KnowledgeImportDocumentDraft,
  options: KnowledgeImportProposalOptions = {},
): KnowledgeImportWriteProposal {
  if (options.mode === "update" || options.documentId) {
    return createKnowledgeImportUpdateProposal(imported, options);
  }
  return createKnowledgeImportCreateProposal(imported, options.message);
}

function createKnowledgeImportFolderProposal({
  id,
  title,
  parentId,
  bookId,
  targetPath,
  sourcePath,
}: {
  id: string;
  title: string;
  parentId?: string;
  bookId?: string;
  targetPath: string;
  sourcePath: string;
}): KnowledgeDocumentCreateProposal {
  return {
    success: true,
    action: "create",
    requiresConfirmation: true,
    confirmationKind: "knowledge_document_create",
    message: "Imported folder draft generated. No document has been saved.",
    targetPath,
    draft: {
      id,
      parentId,
      bookId,
      type: "folder",
      title,
      contentJson: { type: "doc", content: [] } as unknown as JSONValue,
      contentMd: "",
      contentSchemaVersion: 1,
      tags: [],
      sourceKind: "obsidian",
      sourceId: sourcePath,
    },
  };
}

function joinImportVaultPath(...parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" / ");
}

function createImportBaseVaultPath({
  parentId,
  documents,
}: {
  parentId?: string;
  documents: KnowledgeDocument[];
}): string {
  if (!parentId) return KNOWLEDGE_ROOT_TITLE;

  const parent = documents.find((document) => document.id === parentId);
  if (!parent) return joinImportVaultPath(KNOWLEDGE_ROOT_TITLE, parentId);

  return formatKnowledgeDocumentPath(parent, documents, {
    rootTitle: KNOWLEDGE_ROOT_TITLE,
    untitledTitle: UNTITLED_DOCUMENT_TITLE,
    orphanedParentTitle: ORPHANED_PARENT_TITLE,
    includeOrphanedParent: true,
  });
}

function createImportDraftVaultPath({
  draft,
  documents,
}: {
  draft: CreateKnowledgeDocumentInput;
  documents: KnowledgeDocument[];
}): string {
  return joinImportVaultPath(
    createImportBaseVaultPath({ parentId: draft.parentId, documents }),
    draft.title || UNTITLED_DOCUMENT_TITLE,
  );
}

function importRelativePathForFile(
  file: KnowledgeMarkdownImportPlanFile,
  commonParts: string[],
): string {
  if (file.relativePath?.trim()) return normalizePath(file.relativePath);
  if (file.path?.trim())
    return normalizePath(relativePathFromCommonDirectory(file.path, commonParts));
  return fileNameFromPath(file.path) ?? "Imported Knowledge.md";
}

function shouldPreserveImportHierarchy(imported: KnowledgeImportDocumentDraft): boolean {
  if (imported.isReadAnyExport) return false;
  if (imported.draft.type === "book_home") return false;
  if (imported.frontmatter.parentId) return false;
  return true;
}

export function createKnowledgeMarkdownImportPlan(
  input: KnowledgeMarkdownImportPlanInput,
): KnowledgeMarkdownImportPlan {
  const preservePathHierarchy = input.preservePathHierarchy ?? true;
  const existingFolderIdBySiblingKey = new Map<string, string>();
  const siblingDocumentIdByTitleKey = new Map<string, string>();

  for (const document of input.currentDocuments ?? []) {
    if (document.deletedAt) continue;
    const key = importSiblingKey({
      bookId: document.bookId,
      parentId: document.parentId,
      title: document.title,
    });
    if (normalizeImportSiblingTitle(document.title) && !siblingDocumentIdByTitleKey.has(key)) {
      siblingDocumentIdByTitleKey.set(key, document.id);
    }
    if (document.type === "folder" && !existingFolderIdBySiblingKey.has(key)) {
      existingFolderIdBySiblingKey.set(key, document.id);
    }
  }

  const commonParts = commonDirectoryParts(
    input.files
      .map((file) => file.relativePath ?? file.path ?? "")
      .filter((path) => path.trim().length > 0),
  );
  const folderItemsById = new Map<string, KnowledgeMarkdownImportPlanItem>();
  const documentItems: KnowledgeMarkdownImportPlanItem[] = [];
  const currentDocuments = [...(input.currentDocuments ?? [])];

  for (const file of input.files) {
    const relativePath = importRelativePathForFile(file, commonParts);
    const bookId = file.bookId ?? input.bookId;
    const baseParentId = file.defaultParentId ?? input.defaultParentId;
    const baseVaultPath = createImportBaseVaultPath({
      parentId: baseParentId,
      documents: currentDocuments,
    });
    const imported = parseKnowledgeMarkdownDocument({
      ...file,
      relativePath,
      bookId,
      defaultType: file.defaultType ?? input.defaultType,
      defaultParentId: baseParentId,
      cardTemplates: input.cardTemplates,
    });

    if (preservePathHierarchy && shouldPreserveImportHierarchy(imported)) {
      const segments = splitPath(relativePath).map(sanitizeImportPathSegment).filter(Boolean);
      const directorySegments = segments.slice(0, -1);
      let parentId = baseParentId;
      const pathSegments: string[] = [];
      const generatedFolderDocuments: KnowledgeDocument[] = [];

      for (const segment of directorySegments) {
        pathSegments.push(segment);
        const relativeDirPath = pathSegments.join("/");
        const vaultDirPath = joinImportVaultPath(baseVaultPath, ...pathSegments);
        const titleKey = importSiblingKey({ bookId, parentId, title: segment });
        const existingFolderId = existingFolderIdBySiblingKey.get(titleKey);
        const folderId =
          existingFolderId ?? folderIdForImportPath({ bookId, baseParentId, relativeDirPath });
        if (!existingFolderId && !folderItemsById.has(folderId)) {
          const proposal = createKnowledgeImportFolderProposal({
            id: folderId,
            title: segment,
            parentId,
            bookId,
            targetPath: vaultDirPath,
            sourcePath: relativeDirPath,
          });
          folderItemsById.set(folderId, {
            path: relativeDirPath,
            relativePath: relativeDirPath,
            proposal,
            warnings: ["created_folder_from_import_path"],
          });
          existingFolderIdBySiblingKey.set(titleKey, folderId);
          siblingDocumentIdByTitleKey.set(titleKey, folderId);
          generatedFolderDocuments.push({
            id: folderId,
            bookId,
            parentId,
            type: "folder",
            title: segment,
            contentJson: { type: "doc", content: [] },
            contentMd: "",
            contentSchemaVersion: 1,
            tags: [],
            sourceKind: "obsidian",
            sourceId: relativeDirPath,
            createdAt: 0,
            updatedAt: 0,
          });
        }
        parentId = folderId;
      }

      if (directorySegments.length > 0) {
        imported.draft.parentId = parentId;
      }
      if (generatedFolderDocuments.length > 0) {
        currentDocuments.push(...generatedFolderDocuments);
      }
    }

    const proposal = createKnowledgeImportWriteProposal(imported, {
      message: "Imported knowledge draft generated. No document has been saved.",
    });
    if (proposal.action === "create" || proposal.action === "update") {
      proposal.targetPath =
        proposal.action === "create"
          ? createImportDraftVaultPath({
              draft: proposal.draft,
              documents: currentDocuments,
            })
          : relativePath;
    }
    const warnings = [...imported.warnings];
    if (proposal.action === "create") {
      const titleKey = importSiblingKey({
        bookId: proposal.draft.bookId,
        parentId: proposal.draft.parentId,
        title: proposal.draft.title,
      });
      const existingDocumentId = siblingDocumentIdByTitleKey.get(titleKey);
      if (existingDocumentId && existingDocumentId !== proposal.draft.id) {
        warnings.push("duplicate_sibling_title");
      } else if (normalizeImportSiblingTitle(proposal.draft.title)) {
        siblingDocumentIdByTitleKey.set(titleKey, proposal.draft.id ?? `${relativePath}\u0000doc`);
      }
    }
    documentItems.push({
      path: file.path ?? relativePath,
      relativePath,
      proposal,
      warnings,
    });
  }

  const folderItems = Array.from(folderItemsById.values());
  return {
    items: [...folderItems, ...documentItems],
    folderItems,
    documentItems,
  };
}

export function createKnowledgeVaultImportWriteProposals(
  plan: KnowledgeVaultImportPlan,
): KnowledgeDocumentUpdateProposal[] {
  return plan.modified
    .filter((entry): entry is KnowledgeVaultImportEntry & { draft: KnowledgeImportDocumentDraft } =>
      Boolean(entry.draft),
    )
    .map((entry) => {
      const manifestDocument = plan.manifest.documents[entry.documentId];
      const proposal = createKnowledgeImportUpdateProposal(entry.draft, {
        mode: "update",
        documentId: entry.documentId,
        message: `Imported changes from ${entry.path}. The knowledge document has not been changed.`,
        current: {
          id: entry.documentId,
          bookId: manifestDocument?.bookId,
          parentId: manifestDocument?.parentId,
          type: manifestDocument?.type,
          title: manifestDocument?.title,
          path: manifestDocument?.path,
          updatedAt: manifestDocument?.updatedAt,
        },
      });
      proposal.targetPath = entry.path;
      return proposal;
    });
}
