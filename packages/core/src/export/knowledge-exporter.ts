import { createKnowledgeAttachmentUri } from "../knowledge/attachments";
import { collectKnowledgeDocumentSubtree } from "../knowledge/document-utils";
import {
  encodeReadAnyUriComponent,
  renderKnowledgeJsonToMarkdown,
} from "../knowledge/editor-projection";
import type {
  Book,
  KnowledgeAttachment,
  KnowledgeCardTemplate,
  KnowledgeDocument,
  KnowledgeLink,
} from "../types";

export type KnowledgeExportFormat = "markdown" | "obsidian";

export interface KnowledgeExportFile {
  path: string;
  content: string;
  mimeType: string;
  sourcePath?: string;
}

export interface KnowledgeExportInput {
  documents: KnowledgeDocument[];
  books?: Book[];
  links?: KnowledgeLink[];
  attachments?: KnowledgeAttachment[];
  cardTemplates?: KnowledgeCardTemplate[];
}

export interface KnowledgeExportOptions {
  format?: KnowledgeExportFormat;
  rootDir?: string;
  includeDeleted?: boolean;
  includeReadAnyCardMetadata?: boolean;
}

export interface KnowledgeBundleExportOptions extends KnowledgeExportOptions {
  title?: string;
  path?: string;
  exportedAt?: number;
}

export interface KnowledgeExportManifestDocument {
  id: string;
  type: KnowledgeDocument["type"];
  title: string;
  path: string;
  hash: string;
  updatedAt: number;
  contentSchemaVersion: number;
  bookId?: string;
  parentId?: string;
  sourceKind?: KnowledgeDocument["sourceKind"];
  sourceId?: string;
  deletedAt?: number;
}

export interface KnowledgeExportManifestAttachment {
  id: string;
  kind: KnowledgeAttachment["kind"];
  fileName: string;
  path: string;
  size: number;
  updatedAt: number;
  documentId?: string;
  mimeType?: string;
  hash?: string;
}

export interface KnowledgeExportManifest {
  version: 1;
  app: "ReadAny";
  format: KnowledgeExportFormat;
  rootDir: string;
  exportedAt: number;
  documents: Record<string, KnowledgeExportManifestDocument>;
  attachments: Record<string, KnowledgeExportManifestAttachment>;
  cardTemplates?: KnowledgeCardTemplate[];
}

export interface KnowledgeExportObservedFile {
  path: string;
  content?: string;
  hash?: string;
}

export interface KnowledgeExportConflict {
  kind: "external_modified";
  documentId: string;
  path: string;
  previousHash: string;
  existingHash: string;
  nextHash: string;
}

export interface KnowledgeVaultExportOptions extends KnowledgeExportOptions {
  exportedAt?: number;
  includeManifest?: boolean;
  manifestPath?: string;
  previousManifest?: KnowledgeExportManifest;
  existingFiles?: KnowledgeExportObservedFile[];
}

export interface KnowledgeVaultPackage {
  files: KnowledgeExportFile[];
  manifest: KnowledgeExportManifest;
  conflicts: KnowledgeExportConflict[];
}

export function scopeKnowledgeExportInputToDocumentSubtree(
  input: KnowledgeExportInput,
  rootDocument: KnowledgeDocument,
): KnowledgeExportInput {
  const homeDocumentId = input.documents.find((document) => document.type === "book_home")?.id;
  const documents = collectKnowledgeDocumentSubtree(
    rootDocument.id,
    input.documents,
    homeDocumentId,
  );
  const documentIds = new Set(documents.map((document) => document.id));

  return {
    ...input,
    documents,
    links: input.links?.filter(
      (link) =>
        documentIds.has(link.fromDocumentId) &&
        (link.toKind !== "document" || documentIds.has(link.toId)),
    ),
    attachments: input.attachments?.filter(
      (attachment) => !!attachment.documentId && documentIds.has(attachment.documentId),
    ),
  };
}

interface ExportContext {
  booksById: Map<string, Book>;
  documentsById: Map<string, KnowledgeDocument>;
  documentExportPathsById: Map<string, string>;
  linksByDocumentId: Map<string, KnowledgeLink[]>;
  attachmentsByDocumentId: Map<string, KnowledgeAttachment[]>;
  attachmentExportPathsById: Map<string, string>;
  cardTemplates: KnowledgeCardTemplate[];
}

type ResolvedKnowledgeExportOptions = Required<KnowledgeExportOptions>;

interface DocumentExportFile extends KnowledgeExportFile {
  documentId: string;
  document: KnowledgeDocument;
}

interface AttachmentExportFile extends KnowledgeExportFile {
  attachmentId: string;
  attachment: KnowledgeAttachment;
}

function slugPart(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 80);
}

function joinPath(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+/g, "/");
}

function splitPathExtension(path: string): [string, string] {
  const lastSlash = path.lastIndexOf("/");
  const lastDot = path.lastIndexOf(".");
  if (lastDot <= lastSlash) return [path, ""];
  return [path.slice(0, lastDot), path.slice(lastDot)];
}

function ensureUniquePath(path: string, usedPaths: Set<string>): string {
  const normalized = normalizePath(path);
  if (!usedPaths.has(normalized)) {
    usedPaths.add(normalized);
    return path;
  }

  const [base, extension] = splitPathExtension(path);
  let index = 2;
  while (usedPaths.has(normalizePath(`${base}-${index}${extension}`))) {
    index += 1;
  }
  const nextPath = `${base}-${index}${extension}`;
  usedPaths.add(normalizePath(nextPath));
  return nextPath;
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlList(values: string[]): string[] {
  if (values.length === 0) return ["tags: []"];
  return ["tags:", ...values.map((value) => `  - ${yamlString(value)}`)];
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function createKnowledgeExportHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function createContext(
  input: KnowledgeExportInput,
  attachmentExportPathsById = new Map<string, string>(),
  documentExportPathsById = new Map<string, string>(),
): ExportContext {
  const booksById = new Map((input.books ?? []).map((book) => [book.id, book]));
  const documentsById = new Map(input.documents.map((document) => [document.id, document]));
  const linksByDocumentId = new Map<string, KnowledgeLink[]>();
  const attachmentsByDocumentId = new Map<string, KnowledgeAttachment[]>();

  for (const link of input.links ?? []) {
    const links = linksByDocumentId.get(link.fromDocumentId) ?? [];
    links.push(link);
    linksByDocumentId.set(link.fromDocumentId, links);
  }

  for (const attachment of input.attachments ?? []) {
    if (!attachment.documentId) continue;
    const attachments = attachmentsByDocumentId.get(attachment.documentId) ?? [];
    attachments.push(attachment);
    attachmentsByDocumentId.set(attachment.documentId, attachments);
  }

  return {
    booksById,
    documentsById,
    documentExportPathsById,
    linksByDocumentId,
    attachmentsByDocumentId,
    attachmentExportPathsById,
    cardTemplates: input.cardTemplates ?? [],
  };
}

function documentBody(
  document: KnowledgeDocument,
  context: ExportContext,
  options: Required<KnowledgeExportOptions>,
  documentFilePath?: string,
) {
  return (
    renderKnowledgeJsonToMarkdown(document.contentJson, {
      includeReadAnyCardMetadata: options.includeReadAnyCardMetadata,
      cardTemplates: context.cardTemplates,
      resolveImageSrc: (attrs, fallbackSrc) => {
        if (!documentFilePath) return undefined;
        const attachmentId = typeof attrs.attachmentId === "string" ? attrs.attachmentId : "";
        if (!attachmentId) return undefined;
        const exportedPath = context.attachmentExportPathsById.get(attachmentId);
        if (exportedPath) return relativeMarkdownPath(documentFilePath, exportedPath);
        return fallbackSrc || createKnowledgeAttachmentUri(attachmentId);
      },
      resolveInternalLinkTarget: (attrs, fallbackTarget) => {
        const documentId = typeof attrs.documentId === "string" ? attrs.documentId.trim() : "";
        if (!documentId) return fallbackTarget;
        const exportedPath = context.documentExportPathsById.get(documentId);
        return exportedPath ? stripMarkdownExtension(exportedPath) : fallbackTarget;
      },
    }) ||
    document.contentMd ||
    ""
  ).trim();
}

function documentPath(
  document: KnowledgeDocument,
  context: ExportContext,
  options: ResolvedKnowledgeExportOptions,
): string {
  const book = document.bookId ? context.booksById.get(document.bookId) : undefined;
  const hierarchySegments: string[] = [];
  const visited = new Set<string>([document.id]);
  let parentId = document.parentId;

  while (parentId) {
    const parent = context.documentsById.get(parentId);
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    if (parent.type !== "book_home") {
      hierarchySegments.unshift(slugPart(parent.title, parent.id));
    }
    parentId = parent.parentId;
  }

  if (document.type === "folder") {
    hierarchySegments.push(slugPart(document.title, document.id));
  }

  const fileName =
    (document.type === "book_home" && book) || document.type === "folder"
      ? "README"
      : slugPart(document.title, document.type || "knowledge");

  const scopedPath = book
    ? joinPath(
        "Books",
        slugPart(book.meta.title, document.bookId ?? "book"),
        ...hierarchySegments,
        `${fileName}.md`,
      )
    : joinPath("Notes", ...hierarchySegments, `${fileName}.md`);

  return joinPath(options.rootDir, scopedPath);
}

function stripMarkdownExtension(path: string): string {
  return normalizePath(path).replace(/\.md$/i, "");
}

function wikiLinkPart(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function documentWikiLink(link: KnowledgeLink, context: ExportContext): string {
  const target = context.documentsById.get(link.toId);
  if (!target) return `[[${wikiLinkPart(link.toId)}]]`;

  const targetPath = context.documentExportPathsById.get(target.id);
  const title = target.title.trim() || target.id;
  const label = wikiLinkPart(link.label || title);
  if (!targetPath) return `[[${wikiLinkPart(title)}]]`;

  const wikilinkTarget = wikiLinkPart(stripMarkdownExtension(targetPath));
  return label && label !== wikilinkTarget
    ? `[[${wikilinkTarget}|${label}]]`
    : `[[${wikilinkTarget}]]`;
}

function renderLinkItem(link: KnowledgeLink, context: ExportContext): string {
  const label = link.label || link.relation;

  if (link.toKind === "document") {
    return `- **${link.relation}:** ${documentWikiLink(link, context)}`;
  }

  const target =
    link.toKind === "url"
      ? link.toId
      : link.cfi
        ? [
            `readany://cfi/${encodeReadAnyUriComponent(link.cfi)}`,
            link.toKind !== "cfi" ? `sourceId=${encodeReadAnyUriComponent(link.toId)}` : "",
          ]
            .filter(Boolean)
            .join("?")
        : `readany://${link.toKind}/${encodeReadAnyUriComponent(link.toId)}`;
  return `- **${link.relation}:** [${label}](${target})`;
}

function renderLinks(document: KnowledgeDocument, context: ExportContext): string[] {
  const links = context.linksByDocumentId.get(document.id) ?? [];
  if (links.length === 0) return [];

  return [
    "## ReadAny Links",
    "<!-- readany:generated-links -->",
    "",
    ...links.map((link) => renderLinkItem(link, context)),
  ];
}

function relativeMarkdownPath(fromFilePath: string, toFilePath: string): string {
  const fromParts = normalizePath(fromFilePath).split("/").filter(Boolean);
  const toParts = normalizePath(toFilePath).split("/").filter(Boolean);
  fromParts.pop();

  while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }

  const relativeParts = [...fromParts.map(() => ".."), ...toParts];
  return relativeParts.join("/") || ".";
}

function renderAttachments(
  document: KnowledgeDocument,
  context: ExportContext,
  documentFilePath: string,
): string[] {
  const attachments = context.attachmentsByDocumentId.get(document.id) ?? [];
  if (attachments.length === 0) return [];

  return [
    "## Attachments",
    "<!-- readany:generated-attachments -->",
    "",
    ...attachments.map((attachment) => {
      const exportedPath = context.attachmentExportPathsById.get(attachment.id);
      const target = exportedPath
        ? relativeMarkdownPath(documentFilePath, exportedPath)
        : attachment.remotePath || attachment.localPath || attachment.fileName;
      return `- [${attachment.fileName}](${target})`;
    }),
  ];
}

function renderFrontmatter(document: KnowledgeDocument, context: ExportContext): string[] {
  const book = document.bookId ? context.booksById.get(document.bookId) : undefined;
  const lines = [
    "---",
    "type: readany-knowledge",
    `id: ${yamlString(document.id)}`,
    `documentType: ${yamlString(document.type)}`,
    `title: ${yamlString(document.title)}`,
  ];

  if (document.bookId) lines.push(`bookId: ${yamlString(document.bookId)}`);
  if (document.parentId) lines.push(`parentId: ${yamlString(document.parentId)}`);
  if (book) {
    lines.push(`book: ${yamlString(book.meta.title)}`);
    if (book.meta.author) lines.push(`author: ${yamlString(book.meta.author)}`);
  }
  if (document.sourceKind) lines.push(`sourceKind: ${yamlString(document.sourceKind)}`);
  if (document.sourceId) lines.push(`sourceId: ${yamlString(document.sourceId)}`);
  lines.push(`created: ${yamlString(isoDate(document.createdAt))}`);
  lines.push(`updated: ${yamlString(isoDate(document.updatedAt))}`);
  lines.push(...yamlList(document.tags));
  lines.push("---");
  return lines;
}

function renderDocument(
  document: KnowledgeDocument,
  context: ExportContext,
  options: ResolvedKnowledgeExportOptions,
  path: string,
): string {
  const body = documentBody(document, context, options, path);
  const sections = [
    ...(options.format === "obsidian" ? renderFrontmatter(document, context) : []),
    `# ${document.title}`,
    "",
    body,
    "",
    ...renderLinks(document, context),
    "",
    ...renderAttachments(document, context, path),
  ];

  return sections
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

function withUniquePaths(files: KnowledgeExportFile[]): KnowledgeExportFile[] {
  const usedPaths = new Set<string>();
  return files.map((file) => {
    const path = ensureUniquePath(file.path, usedPaths);
    if (path === file.path) return file;
    return { ...file, path };
  });
}

function createDocumentExportFiles(
  input: KnowledgeExportInput,
  options: ResolvedKnowledgeExportOptions,
  previousManifest?: KnowledgeExportManifest,
  usedPaths = new Set<string>(),
  attachmentExportPathsById = new Map<string, string>(),
): DocumentExportFile[] {
  const context = createContext(input, attachmentExportPathsById);
  const documents = options.includeDeleted
    ? input.documents
    : input.documents.filter((document) => !document.deletedAt);
  const canReuseManifestPaths = previousManifest?.rootDir === options.rootDir;
  const pathsById = new Map<string, string>();
  const fileDrafts = documents.map((document) => {
    const previousPath = canReuseManifestPaths
      ? previousManifest?.documents[document.id]?.path
      : undefined;
    const path = ensureUniquePath(
      previousPath || documentPath(document, context, options),
      usedPaths,
    );
    pathsById.set(document.id, path);

    return {
      documentId: document.id,
      document,
      path,
    };
  });
  const renderContext = createContext(input, attachmentExportPathsById, pathsById);

  return fileDrafts.map<DocumentExportFile>((file) => {
    return {
      ...file,
      content: renderDocument(file.document, renderContext, options, file.path),
      mimeType: "text/markdown",
    };
  });
}

function createAttachmentExportFiles(
  input: KnowledgeExportInput,
  options: ResolvedKnowledgeExportOptions,
  previousManifest?: KnowledgeExportManifest,
  usedPaths = new Set<string>(),
): {
  files: AttachmentExportFile[];
  attachmentExportPathsById: Map<string, string>;
} {
  const files: AttachmentExportFile[] = [];
  const attachmentExportPathsById = new Map<string, string>();
  const canReuseManifestPaths = previousManifest?.rootDir === options.rootDir;

  for (const attachment of input.attachments ?? []) {
    if (!attachment.localPath) continue;

    const previousPath = canReuseManifestPaths
      ? previousManifest?.attachments[attachment.id]?.path
      : undefined;
    const path = ensureUniquePath(
      previousPath ||
        joinPath(options.rootDir, "Assets", slugPart(attachment.fileName, attachment.id)),
      usedPaths,
    );
    attachmentExportPathsById.set(attachment.id, path);
    files.push({
      attachmentId: attachment.id,
      attachment,
      path,
      content: "",
      mimeType: attachment.mimeType || "application/octet-stream",
      sourcePath: attachment.localPath,
    });
  }

  return { files, attachmentExportPathsById };
}

function createAttachmentManifestEntries(
  input: KnowledgeExportInput,
  rootDir: string,
  attachmentExportPathsById = new Map<string, string>(),
): Record<string, KnowledgeExportManifestAttachment> {
  const entries: Record<string, KnowledgeExportManifestAttachment> = {};

  for (const attachment of input.attachments ?? []) {
    const fallbackPath = joinPath("Assets", slugPart(attachment.fileName, attachment.id));
    const exportedPath = attachmentExportPathsById.get(attachment.id);
    entries[attachment.id] = {
      id: attachment.id,
      kind: attachment.kind,
      fileName: attachment.fileName,
      path: normalizePath(exportedPath ?? joinPath(rootDir, attachment.remotePath || fallbackPath)),
      size: attachment.size,
      updatedAt: attachment.updatedAt,
      ...(attachment.documentId ? { documentId: attachment.documentId } : {}),
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      ...(attachment.hash ? { hash: attachment.hash } : {}),
    };
  }

  return entries;
}

function createCardTemplateManifestEntries(input: KnowledgeExportInput): KnowledgeCardTemplate[] {
  return (input.cardTemplates ?? [])
    .filter((template) => !template.builtIn)
    .map((template) => ({
      id: template.id,
      name: template.name,
      version: template.version,
      schemaJson: template.schemaJson,
      builtIn: template.builtIn,
      enabled: template.enabled,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }));
}

function createManifest(
  input: KnowledgeExportInput,
  files: DocumentExportFile[],
  options: ResolvedKnowledgeExportOptions,
  exportedAt: number,
  attachmentExportPathsById = new Map<string, string>(),
): KnowledgeExportManifest {
  const documents: Record<string, KnowledgeExportManifestDocument> = {};
  const cardTemplates = createCardTemplateManifestEntries(input);

  for (const file of files) {
    documents[file.documentId] = {
      id: file.document.id,
      type: file.document.type,
      title: file.document.title,
      path: normalizePath(file.path),
      hash: createKnowledgeExportHash(file.content),
      updatedAt: file.document.updatedAt,
      contentSchemaVersion: file.document.contentSchemaVersion,
      ...(file.document.bookId ? { bookId: file.document.bookId } : {}),
      ...(file.document.parentId ? { parentId: file.document.parentId } : {}),
      ...(file.document.sourceKind ? { sourceKind: file.document.sourceKind } : {}),
      ...(file.document.sourceId ? { sourceId: file.document.sourceId } : {}),
      ...(file.document.deletedAt ? { deletedAt: file.document.deletedAt } : {}),
    };
  }

  return {
    version: 1,
    app: "ReadAny",
    format: options.format,
    rootDir: options.rootDir,
    exportedAt,
    documents,
    attachments: createAttachmentManifestEntries(input, options.rootDir, attachmentExportPathsById),
    ...(cardTemplates.length ? { cardTemplates } : {}),
  };
}

function observedHash(file: KnowledgeExportObservedFile): string | null {
  if (file.hash) return file.hash;
  if (typeof file.content === "string") return createKnowledgeExportHash(file.content);
  return null;
}

function detectConflicts(
  manifest: KnowledgeExportManifest,
  previousManifest?: KnowledgeExportManifest,
  existingFiles: KnowledgeExportObservedFile[] = [],
): KnowledgeExportConflict[] {
  if (!previousManifest || existingFiles.length === 0) return [];

  const existingByPath = new Map<string, string>();
  for (const file of existingFiles) {
    const hash = observedHash(file);
    if (!hash) continue;
    existingByPath.set(normalizePath(file.path), hash);
  }

  const conflicts: KnowledgeExportConflict[] = [];
  for (const [documentId, nextEntry] of Object.entries(manifest.documents)) {
    const previousEntry = previousManifest.documents[documentId];
    if (!previousEntry) continue;

    const existingHash =
      existingByPath.get(normalizePath(previousEntry.path)) ??
      existingByPath.get(normalizePath(nextEntry.path));
    if (!existingHash) continue;

    if (existingHash !== previousEntry.hash && existingHash !== nextEntry.hash) {
      conflicts.push({
        kind: "external_modified",
        documentId,
        path: previousEntry.path,
        previousHash: previousEntry.hash,
        existingHash,
        nextHash: nextEntry.hash,
      });
    }
  }

  return conflicts;
}

function removeLeadingDocumentTitle(markdown: string, title: string): string {
  const lines = markdown.trim().split("\n");
  if (lines[0]?.trim() === `# ${title.trim()}`) {
    lines.shift();
    if (lines[0]?.trim() === "") lines.shift();
  }
  return lines.join("\n").trim();
}

function demoteMarkdownHeadings(markdown: string): string {
  return markdown.replace(/^(#{1,5})(\s+)/gm, "#$1$2");
}

function renderBundleFrontmatter(
  title: string,
  documentCount: number,
  exportedAt: number,
): string[] {
  return [
    "---",
    "type: readany-knowledge-bundle",
    `title: ${yamlString(title)}`,
    `exported: ${yamlString(isoDate(exportedAt))}`,
    `documentCount: ${documentCount}`,
    "---",
    "",
  ];
}

function createBundleExportFile(
  input: KnowledgeExportInput,
  options: ResolvedKnowledgeExportOptions,
  bundleOptions: KnowledgeBundleExportOptions,
): KnowledgeExportFile {
  const title = bundleOptions.title?.trim() || "ReadAny Knowledge Export";
  const exportedAt = bundleOptions.exportedAt ?? Date.now();
  const documentFiles = createDocumentExportFiles(input, { ...options, format: "markdown" });
  const lines = [
    ...(options.format === "obsidian"
      ? renderBundleFrontmatter(title, documentFiles.length, exportedAt)
      : []),
    `# ${title}`,
    "",
    `Exported: ${isoDate(exportedAt)}`,
    `Documents: ${documentFiles.length}`,
    "",
  ];

  for (const file of documentFiles) {
    const body = demoteMarkdownHeadings(
      removeLeadingDocumentTitle(file.content, file.document.title),
    );
    lines.push(
      "---",
      "",
      `## ${file.document.title || file.document.type}`,
      "",
      `_Source: \`${normalizePath(file.path)}\`_`,
      "",
    );
    if (body) lines.push(body, "");
  }

  const path = normalizePath(
    bundleOptions.path ?? joinPath(options.rootDir, `${slugPart(title, "ReadAny Knowledge")}.md`),
  );

  return {
    path,
    content: lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd()
      .concat("\n"),
    mimeType: "text/markdown",
  };
}

export class KnowledgeExporter {
  export(input: KnowledgeExportInput, options: KnowledgeExportOptions = {}): KnowledgeExportFile[] {
    const opts: ResolvedKnowledgeExportOptions = {
      format: options.format ?? "obsidian",
      rootDir: options.rootDir ?? "",
      includeDeleted: options.includeDeleted ?? false,
      includeReadAnyCardMetadata: options.includeReadAnyCardMetadata ?? false,
    };
    return createDocumentExportFiles(input, opts).map(({ document, documentId, ...file }) => file);
  }

  exportBundle(
    input: KnowledgeExportInput,
    options: KnowledgeBundleExportOptions = {},
  ): KnowledgeExportFile {
    const opts: ResolvedKnowledgeExportOptions = {
      format: options.format ?? "obsidian",
      rootDir: options.rootDir ?? "",
      includeDeleted: options.includeDeleted ?? false,
      includeReadAnyCardMetadata: options.includeReadAnyCardMetadata ?? false,
    };
    return createBundleExportFile(input, opts, options);
  }

  buildVaultPackage(
    input: KnowledgeExportInput,
    options: KnowledgeVaultExportOptions = {},
  ): KnowledgeVaultPackage {
    const opts: ResolvedKnowledgeExportOptions = {
      format: options.format ?? "obsidian",
      rootDir: options.rootDir ?? "",
      includeDeleted: options.includeDeleted ?? false,
      includeReadAnyCardMetadata: options.includeReadAnyCardMetadata ?? false,
    };
    const exportedAt = options.exportedAt ?? Date.now();
    const usedPaths = new Set<string>();
    const { files: attachmentFiles, attachmentExportPathsById } = createAttachmentExportFiles(
      input,
      opts,
      options.previousManifest,
      usedPaths,
    );
    const documentFiles = createDocumentExportFiles(
      input,
      opts,
      options.previousManifest,
      usedPaths,
      attachmentExportPathsById,
    );
    const manifest = createManifest(
      input,
      documentFiles,
      opts,
      exportedAt,
      attachmentExportPathsById,
    );
    const conflicts = detectConflicts(manifest, options.previousManifest, options.existingFiles);
    const files: KnowledgeExportFile[] = documentFiles.map(
      ({ document, documentId, ...file }) => file,
    );
    files.push(...attachmentFiles.map(({ attachment, attachmentId, ...file }) => file));

    if (options.includeManifest ?? true) {
      files.push({
        path: normalizePath(
          options.manifestPath ?? joinPath(opts.rootDir, ".readany/manifest.json"),
        ),
        content: `${JSON.stringify(manifest, null, 2)}\n`,
        mimeType: "application/json",
      });
    }

    return { files: withUniquePaths(files), manifest, conflicts };
  }
}

export const knowledgeExporter = new KnowledgeExporter();
