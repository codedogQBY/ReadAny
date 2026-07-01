import type { Highlight, JSONValue, KnowledgeDocument, Note } from "../types";
import {
  type TiptapNode,
  markdownToBasicTiptap,
  normalizeTiptapDocument,
} from "./editor-projection";

export interface KnowledgeDocumentSnapshot {
  contentJson: unknown;
  contentMd: string;
}

export interface KnowledgeDocumentTreeNode {
  document: KnowledgeDocument;
  children: KnowledgeDocumentTreeNode[];
  depth: number;
}

export interface KnowledgeDocumentTree {
  roots: KnowledgeDocumentTreeNode[];
  nodesById: Map<string, KnowledgeDocumentTreeNode>;
  orphaned: KnowledgeDocument[];
}

export type KnowledgeDocumentOpenMode = "vault_root" | "folder_browser" | "document_editor";
export type KnowledgeDocumentWorkspaceMode = "vault" | "document";

export interface KnowledgeDocumentPathItem {
  id: string;
  title: string;
  type: KnowledgeDocument["type"];
}

export interface KnowledgeDocumentPathLabelOptions {
  rootTitle?: string;
  untitledTitle?: string;
  orphanedParentTitle?: string;
  includeOrphanedParent?: boolean;
  separator?: string;
}

export interface KnowledgeDocumentSearchTextOptions extends KnowledgeDocumentPathLabelOptions {
  typeLabel?: string;
}

export interface KnowledgeDocumentTreeSearchOptions extends KnowledgeDocumentPathLabelOptions {
  getTypeLabel?: (document: KnowledgeDocument) => string;
}

export interface KnowledgeDocumentMoveTargetOptions extends KnowledgeDocumentPathLabelOptions {
  rootTargetTitle?: string;
}

export interface KnowledgeDocumentMoveTarget {
  id?: string;
  title: string;
  path: string;
  depth: number;
}

export type KnowledgeDocumentSiblingTitleConflictReason =
  | "empty_title"
  | "duplicate_sibling_title";

export type KnowledgeDocumentSiblingTitleValidation =
  | { ok: true }
  | {
      ok: false;
      reason: KnowledgeDocumentSiblingTitleConflictReason;
      duplicate?: KnowledgeDocument;
    };

export interface KnowledgeFolderDisplaySections {
  home: KnowledgeDocument[];
  folders: KnowledgeDocument[];
  documents: KnowledgeDocument[];
}

export interface KnowledgeRootDisplaySections extends KnowledgeFolderDisplaySections {
  orphaned: KnowledgeDocument[];
}

export interface KnowledgeDocumentOutlineItem {
  id: string;
  index: number;
  level: number;
  title: string;
}

export interface HighlightNoteProjection {
  title: string;
  contentJson: JSONValue;
  contentMd: string;
  excerpt?: string;
}

export interface LegacyNoteProjection extends HighlightNoteProjection {
  tags: string[];
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDocumentTitleForSiblingCompare(value: string): string {
  return compactText(value).toLocaleLowerCase();
}

function sameOptionalValue(left: string | undefined, right: string | undefined): boolean {
  return (left || undefined) === (right || undefined);
}

function truncateText(value: string, maxLength: number): string {
  const compacted = compactText(value);
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function normalizeHeadingLevel(value: unknown): number {
  const numericLevel = Number(value ?? 1);
  if (!Number.isFinite(numericLevel)) return 1;
  return Math.min(Math.max(Math.round(numericLevel), 1), 6);
}

function extractTiptapText(node: TiptapNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";

  const childrenText = (node.content ?? []).map(extractTiptapText).join("");
  if (childrenText) return childrenText;

  if (typeof node.attrs?.label === "string") return node.attrs.label;
  if (typeof node.attrs?.title === "string") return node.attrs.title;
  return "";
}

function createOutlineItemId(index: number, title: string): string {
  const slug = compactText(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return `heading-${index + 1}${slug ? `-${slug}` : ""}`;
}

function stripMarkdownHeadingText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/<[^>]+>/g, "");
}

function extractOutlineFromMarkdown(markdown: string): KnowledgeDocumentOutlineItem[] {
  const outline: KnowledgeDocumentOutlineItem[] = [];
  let isCodeFence = false;

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      isCodeFence = !isCodeFence;
      continue;
    }
    if (isCodeFence) continue;

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;

    const title = compactText(stripMarkdownHeadingText(heading[2]));
    if (!title) continue;

    outline.push({
      id: createOutlineItemId(outline.length, title),
      index: outline.length,
      level: heading[1].length,
      title,
    });
  }

  return outline;
}

export function extractKnowledgeDocumentOutline(
  contentJson: JSONValue | null | undefined,
  contentMd = "",
): KnowledgeDocumentOutlineItem[] {
  const outline: KnowledgeDocumentOutlineItem[] = [];
  const visitNode = (node: TiptapNode) => {
    if (node.type === "heading") {
      const title = compactText((node.content ?? []).map(extractTiptapText).join(""));
      if (title) {
        outline.push({
          id: createOutlineItemId(outline.length, title),
          index: outline.length,
          level: normalizeHeadingLevel(node.attrs?.level),
          title,
        });
      }
      return;
    }

    for (const child of node.content ?? []) {
      visitNode(child);
    }
  };

  visitNode(normalizeTiptapDocument(contentJson));
  return outline.length > 0 ? outline : extractOutlineFromMarkdown(contentMd);
}

function blockquoteMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function normalizeGeneratedMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function normalizeComparableMarkdown(value: string): string {
  return normalizeGeneratedMarkdown(value).replace(/\s+/g, " ");
}

function markdownBlocks(value: string): string[] {
  return normalizeGeneratedMarkdown(value)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function isBlockquoteBlock(block: string): boolean {
  const lines = block.split("\n").filter((line) => line.trim());
  return lines.length > 0 && lines.every((line) => line.trimStart().startsWith(">"));
}

function unquoteMarkdownBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join("\n")
    .trim();
}

function isGeneratedQuoteBlock(block: string, quote: string): boolean {
  return (
    isBlockquoteBlock(block) &&
    normalizeComparableMarkdown(unquoteMarkdownBlock(block)) === normalizeComparableMarkdown(quote)
  );
}

function isGeneratedSourceBlock(block: string, chapterTitle?: string): boolean {
  const normalizedBlock = normalizeComparableMarkdown(block);
  const normalizedChapterTitle = chapterTitle?.trim();
  if (normalizedChapterTitle) {
    return normalizedBlock === normalizeComparableMarkdown(`_Source: ${normalizedChapterTitle}_`);
  }
  return /^_Source:\s.+_$/.test(normalizedBlock);
}

function joinMarkdownBlocks(blocks: string[]): string {
  return blocks.join("\n\n").trim();
}

export function createKnowledgeExcerpt(markdown: string, maxLength = 220): string | undefined {
  const text = markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, maxLength) : undefined;
}

export function hasHighlightNoteContent(highlight: Pick<Highlight, "note">): boolean {
  return !!highlight.note?.trim();
}

export function createHighlightNoteTitle(highlight: Pick<Highlight, "note" | "text">): string {
  return truncateText(highlight.note?.trim() || highlight.text || "Highlight note", 80);
}

export function createHighlightNoteMarkdown(
  highlight: Pick<Highlight, "note" | "text" | "chapterTitle">,
): string {
  const note = highlight.note?.trim();
  const quote = highlight.text.trim();
  const chapterTitle = highlight.chapterTitle?.trim();
  const sections: string[] = [];

  if (note) sections.push(note);
  if (quote) sections.push(blockquoteMarkdown(quote));
  if (chapterTitle) sections.push(`_Source: ${chapterTitle}_`);

  return sections.join("\n\n");
}

export function extractHighlightNoteContentForLegacyField(
  markdown: string,
  highlight: Pick<Highlight, "text" | "chapterTitle">,
): string {
  return joinMarkdownBlocks(
    markdownBlocks(markdown).filter(
      (block) =>
        !isGeneratedQuoteBlock(block, highlight.text) &&
        !isGeneratedSourceBlock(block, highlight.chapterTitle),
    ),
  );
}

export function createHighlightNoteProjection(highlight: Highlight): HighlightNoteProjection {
  const contentMd = createHighlightNoteMarkdown(highlight);
  return {
    title: createHighlightNoteTitle(highlight),
    contentMd,
    contentJson: markdownToBasicTiptap(contentMd) as unknown as JSONValue,
    excerpt: createKnowledgeExcerpt(contentMd),
  };
}

export function isGeneratedHighlightNoteDocument(
  document: KnowledgeDocument,
  highlight: Highlight,
): boolean {
  if (document.type !== "highlight_note") return false;
  if (document.sourceKind !== "highlight" || document.sourceId !== highlight.id) return false;
  const content = normalizeGeneratedMarkdown(document.contentMd);
  return !content || content === normalizeGeneratedMarkdown(createHighlightNoteMarkdown(highlight));
}

export function hasLegacyNoteContent(note: Pick<Note, "title" | "content">): boolean {
  return !!note.title.trim() || !!note.content.trim();
}

export function createLegacyNoteTitle(note: Pick<Note, "title" | "content">): string {
  return truncateText(note.title || note.content || "Note", 80);
}

export function createLegacyNoteMarkdown(note: Pick<Note, "content" | "chapterTitle">): string {
  const content = note.content.trim();
  const chapterTitle = note.chapterTitle?.trim();
  const sections: string[] = [];

  if (content) sections.push(content);
  if (chapterTitle) sections.push(`_Source: ${chapterTitle}_`);

  return sections.join("\n\n");
}

export function extractLegacyNoteContentForLegacyField(
  markdown: string,
  note: Pick<Note, "chapterTitle">,
): string {
  return joinMarkdownBlocks(
    markdownBlocks(markdown).filter((block) => !isGeneratedSourceBlock(block, note.chapterTitle)),
  );
}

export function createLegacyNoteProjection(note: Note): LegacyNoteProjection {
  const contentMd = createLegacyNoteMarkdown(note);
  return {
    title: createLegacyNoteTitle(note),
    contentMd,
    contentJson: markdownToBasicTiptap(contentMd) as unknown as JSONValue,
    excerpt: createKnowledgeExcerpt(contentMd),
    tags: note.tags,
  };
}

export function isGeneratedLegacyNoteDocument(document: KnowledgeDocument, note: Note): boolean {
  if (document.type !== "standalone_note") return false;
  if (document.sourceKind !== "note" || document.sourceId !== note.id) return false;
  if (document.title.trim() !== createLegacyNoteTitle(note)) return false;
  const content = normalizeGeneratedMarkdown(document.contentMd);
  return !content || content === normalizeGeneratedMarkdown(createLegacyNoteMarkdown(note));
}

export function knowledgeValueFingerprint(value: KnowledgeDocumentSnapshot): string {
  return JSON.stringify({
    contentJson: value.contentJson,
    contentMd: value.contentMd,
  });
}

export function knowledgeDocumentFingerprint(
  title: string,
  value: KnowledgeDocumentSnapshot,
  tags: readonly string[] = [],
): string {
  return JSON.stringify({
    title: title.trim(),
    tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort(),
    value: knowledgeValueFingerprint(value),
  });
}

export function orderKnowledgeDocuments(
  documents: KnowledgeDocument[],
  homeDocumentId?: string,
): KnowledgeDocument[] {
  const uniqueDocuments = Array.from(
    new Map(documents.map((document) => [document.id, document])).values(),
  );
  return uniqueDocuments.sort((left, right) =>
    compareKnowledgeDocuments(left, right, homeDocumentId),
  );
}

export function createKnowledgeFolderDisplaySections(
  orderedItems: KnowledgeDocument[],
  homeDocumentId?: string,
): KnowledgeFolderDisplaySections {
  const home: KnowledgeDocument[] = [];
  const folders: KnowledgeDocument[] = [];
  const documents: KnowledgeDocument[] = [];

  for (const item of orderedItems) {
    if (item.id === homeDocumentId || item.type === "book_home") home.push(item);
    else if (item.type === "folder") folders.push(item);
    else documents.push(item);
  }

  return { home, folders, documents };
}

export function createKnowledgeRootDisplaySections(
  documents: KnowledgeDocument[],
  homeDocumentId?: string,
): KnowledgeRootDisplaySections {
  const tree = buildKnowledgeDocumentTree(documents, homeDocumentId);
  const orphanedIds = new Set(tree.orphaned.map((document) => document.id));
  const home: KnowledgeDocument[] = [];
  const folders: KnowledgeDocument[] = [];
  const regularDocuments: KnowledgeDocument[] = [];
  const orphaned: KnowledgeDocument[] = [];

  for (const node of tree.roots) {
    const document = node.document;
    if (document.id === homeDocumentId || document.type === "book_home") home.push(document);
    else if (orphanedIds.has(document.id)) orphaned.push(document);
    else if (document.type === "folder") folders.push(document);
    else regularDocuments.push(document);
  }

  return { home, folders, documents: regularDocuments, orphaned };
}

export function getKnowledgeDocumentOpenMode(input: {
  document?: Pick<KnowledgeDocument, "type"> | null;
  isVaultRootOpen?: boolean;
}): KnowledgeDocumentOpenMode {
  if (input.isVaultRootOpen || !input.document) return "vault_root";
  return input.document.type === "folder" ? "folder_browser" : "document_editor";
}

export function getKnowledgeDocumentWorkspaceMode(
  document?: Pick<KnowledgeDocument, "type"> | null,
): KnowledgeDocumentWorkspaceMode {
  return getKnowledgeDocumentOpenMode({ document }) === "document_editor" ? "document" : "vault";
}

export function getKnowledgeDocumentCreateParentId(input: {
  document?: Pick<KnowledgeDocument, "id" | "parentId" | "type"> | null;
  isVaultRootOpen?: boolean;
}): string | undefined {
  if (input.isVaultRootOpen || !input.document) return undefined;
  if (input.document.type === "folder") return input.document.id;
  return input.document.parentId || undefined;
}

export function validateKnowledgeDocumentSiblingTitle(input: {
  documentId?: string;
  bookId?: string;
  parentId?: string;
  title: string;
  documents: readonly KnowledgeDocument[];
}): KnowledgeDocumentSiblingTitleValidation {
  const normalizedTitle = normalizeDocumentTitleForSiblingCompare(input.title);
  if (!normalizedTitle) return { ok: false, reason: "empty_title" };

  const duplicate = input.documents.find(
    (document) =>
      !document.deletedAt &&
      document.id !== input.documentId &&
      sameOptionalValue(document.bookId, input.bookId) &&
      sameOptionalValue(document.parentId, input.parentId) &&
      normalizeDocumentTitleForSiblingCompare(document.title) === normalizedTitle,
  );

  if (duplicate) {
    return { ok: false, reason: "duplicate_sibling_title", duplicate };
  }

  return { ok: true };
}

function compareKnowledgeDocuments(
  left: KnowledgeDocument,
  right: KnowledgeDocument,
  homeDocumentId?: string,
): number {
  if (left.id === homeDocumentId) return -1;
  if (right.id === homeDocumentId) return 1;
  if (left.type === "book_home") return -1;
  if (right.type === "book_home") return 1;
  if (left.type === "folder" && right.type !== "folder") return -1;
  if (left.type !== "folder" && right.type === "folder") return 1;
  if (left.type === "folder" && right.type === "folder") {
    const titleSort = left.title.localeCompare(right.title, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (titleSort !== 0) return titleSort;
  }
  return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt;
}

function hasAncestryCycle(
  documentId: string,
  parentId: string,
  documentsById: Map<string, KnowledgeDocument>,
): boolean {
  const visited = new Set<string>();
  let nextParentId: string | undefined = parentId;

  while (nextParentId) {
    if (nextParentId === documentId) return true;
    if (visited.has(nextParentId)) return true;
    visited.add(nextParentId);
    nextParentId = documentsById.get(nextParentId)?.parentId;
  }

  return false;
}

export function buildKnowledgeDocumentTree(
  documents: KnowledgeDocument[],
  homeDocumentId?: string,
): KnowledgeDocumentTree {
  const uniqueDocuments = orderKnowledgeDocuments(documents, homeDocumentId);
  const documentsById = new Map(uniqueDocuments.map((document) => [document.id, document]));
  const childDocumentsByParentId = new Map<string, KnowledgeDocument[]>();
  const rootDocuments: KnowledgeDocument[] = [];
  const orphaned: KnowledgeDocument[] = [];

  for (const document of uniqueDocuments) {
    const parentId = document.parentId;
    const hasValidParent =
      !!parentId &&
      parentId !== document.id &&
      documentsById.has(parentId) &&
      !hasAncestryCycle(document.id, parentId, documentsById);

    if (hasValidParent) {
      const children = childDocumentsByParentId.get(parentId) ?? [];
      children.push(document);
      childDocumentsByParentId.set(parentId, children);
    } else {
      rootDocuments.push(document);
      if (parentId) orphaned.push(document);
    }
  }

  const nodesById = new Map<string, KnowledgeDocumentTreeNode>();
  const createNode = (document: KnowledgeDocument, depth: number): KnowledgeDocumentTreeNode => {
    const children = (childDocumentsByParentId.get(document.id) ?? [])
      .sort((left, right) => compareKnowledgeDocuments(left, right, homeDocumentId))
      .map((child) => createNode(child, depth + 1));
    const node: KnowledgeDocumentTreeNode = { document, children, depth };
    nodesById.set(document.id, node);
    return node;
  };

  return {
    roots: rootDocuments
      .sort((left, right) => compareKnowledgeDocuments(left, right, homeDocumentId))
      .map((document) => createNode(document, 0)),
    nodesById,
    orphaned,
  };
}

export function flattenKnowledgeDocumentTree(
  nodes: KnowledgeDocumentTreeNode[],
): KnowledgeDocumentTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenKnowledgeDocumentTree(node.children)]);
}

export function collectKnowledgeDocumentSubtree(
  rootDocumentId: string,
  documents: KnowledgeDocument[],
  homeDocumentId?: string,
): KnowledgeDocument[] {
  const tree = buildKnowledgeDocumentTree(documents, homeDocumentId);
  const rootNode = tree.nodesById.get(rootDocumentId);
  if (!rootNode) return [];
  return flattenKnowledgeDocumentTree([rootNode]).map((node) => node.document);
}

export function resolveKnowledgeDocumentPath(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
): KnowledgeDocumentPathItem[] {
  const documentsById = new Map(documents.map((item) => [item.id, item]));
  const path: KnowledgeDocumentPathItem[] = [];
  const seen = new Set<string>();
  let current: KnowledgeDocument | undefined = document;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift({
      id: current.id,
      title: current.title,
      type: current.type,
    });
    current = current.parentId ? documentsById.get(current.parentId) : undefined;
  }

  return path;
}

export function formatKnowledgeDocumentPath(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
  options: KnowledgeDocumentPathLabelOptions = {},
): string {
  const rootTitle = options.rootTitle ?? "Knowledge base";
  const untitledTitle = options.untitledTitle ?? "Untitled document";
  const orphanedParentTitle = options.orphanedParentTitle ?? "Orphaned";
  const separator = options.separator ?? " / ";
  const documentsById = new Map(documents.map((item) => [item.id, item]));
  const segments: string[] = [];
  const seen = new Set<string>();
  let current: KnowledgeDocument | undefined = document;
  let interrupted = false;

  while (current) {
    if (seen.has(current.id)) {
      interrupted = true;
      break;
    }
    seen.add(current.id);
    segments.unshift(current.title.trim() || untitledTitle);

    if (!current.parentId) break;
    const parent = documentsById.get(current.parentId);
    if (!parent) {
      interrupted = true;
      break;
    }
    current = parent;
  }

  if (interrupted && options.includeOrphanedParent) {
    segments.unshift(orphanedParentTitle);
  }

  return [rootTitle, ...segments].filter(Boolean).join(separator);
}

export function createKnowledgeDocumentSearchText(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
  options: KnowledgeDocumentSearchTextOptions = {},
): string {
  return [
    formatKnowledgeDocumentPath(document, documents, {
      ...options,
      includeOrphanedParent: options.includeOrphanedParent ?? true,
    }),
    document.title,
    options.typeLabel ?? document.type,
    document.excerpt ?? "",
    document.summaryMd ?? "",
    document.contentMd,
    ...document.tags,
  ]
    .join(" ")
    .toLowerCase();
}

function knowledgeSearchQueryMatchesText(searchText: string, normalizedQuery: string): boolean {
  if (searchText.includes(normalizedQuery)) return true;

  const tokens = normalizedQuery
    .split(/[\s/\\>]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.length > 1 && tokens.every((token) => searchText.includes(token));
}

export function filterKnowledgeDocumentTreeNodesForSearch(
  nodes: KnowledgeDocumentTreeNode[],
  documents: KnowledgeDocument[],
  query: string,
  options: KnowledgeDocumentTreeSearchOptions = {},
): KnowledgeDocumentTreeNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  return nodes.filter((node) =>
    knowledgeSearchQueryMatchesText(
      createKnowledgeDocumentSearchText(node.document, documents, {
        ...options,
        typeLabel: options.getTypeLabel?.(node.document),
      }),
      normalizedQuery,
    ),
  );
}

export function createKnowledgeDocumentMoveTargets(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
  options: KnowledgeDocumentMoveTargetOptions = {},
): KnowledgeDocumentMoveTarget[] {
  if (document.type === "book_home") return [];

  const rootTitle = options.rootTitle ?? "Knowledge base";
  const rootTargetTitle = options.rootTargetTitle ?? rootTitle;
  const untitledTitle = options.untitledTitle ?? "Untitled document";
  const homeDocumentId = documents.find((item) => item.type === "book_home")?.id;
  const tree = buildKnowledgeDocumentTree(documents, homeDocumentId);
  const folderTargets = flattenKnowledgeDocumentTree(tree.roots)
    .filter((node) => node.document.type === "folder")
    .map((node) => ({
      id: node.document.id,
      title: node.document.title.trim() || untitledTitle,
      path: formatKnowledgeDocumentPath(node.document, documents, {
        ...options,
        includeOrphanedParent: options.includeOrphanedParent ?? true,
      }),
      depth: node.depth + 1,
    }));

  return [
    { id: undefined, title: rootTargetTitle, path: rootTitle, depth: 0 },
    ...folderTargets,
  ].filter((target) => validateKnowledgeDocumentParent(document.id, target.id, documents).ok);
}

export type KnowledgeDocumentParentValidationReason =
  | "missing_document"
  | "book_home_locked"
  | "same_parent"
  | "missing_parent"
  | "parent_not_folder"
  | "self_parent"
  | "descendant_parent";

export interface KnowledgeDocumentParentValidation {
  ok: boolean;
  reason?: KnowledgeDocumentParentValidationReason;
}

export function validateKnowledgeDocumentParent(
  documentId: string,
  parentId: string | undefined | null,
  documents: KnowledgeDocument[],
): KnowledgeDocumentParentValidation {
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const document = documentsById.get(documentId);
  const normalizedParentId = parentId || undefined;

  if (!document) return { ok: false, reason: "missing_document" };
  if (document.type === "book_home") return { ok: false, reason: "book_home_locked" };
  if ((document.parentId || undefined) === normalizedParentId) {
    return { ok: false, reason: "same_parent" };
  }
  if (!normalizedParentId) return { ok: true };
  if (normalizedParentId === documentId) return { ok: false, reason: "self_parent" };

  const parent = documentsById.get(normalizedParentId);
  if (!parent) return { ok: false, reason: "missing_parent" };
  if (parent.type !== "folder") return { ok: false, reason: "parent_not_folder" };
  if (hasAncestryCycle(documentId, normalizedParentId, documentsById)) {
    return { ok: false, reason: "descendant_parent" };
  }

  return { ok: true };
}
