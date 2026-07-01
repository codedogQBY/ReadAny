import {
  getKnowledgeBacklinks,
  getKnowledgeCardTemplates,
  getKnowledgeDocuments,
  getKnowledgeLinks,
  searchKnowledgeDocuments,
} from "../db/database";
import type { KnowledgeBacklink } from "../db/database";
import { formatKnowledgeDocumentPath } from "../knowledge/document-utils";
import { renderKnowledgeJsonToMarkdown } from "../knowledge/editor-projection";
import type { KnowledgeCardTemplate, KnowledgeDocument, KnowledgeLink } from "../types";

const DEFAULT_MAX_DOCUMENTS = 6;
const DEFAULT_MAX_CHARS = 2600;
const DOCUMENT_SCAN_LIMIT = 5000;
const MAX_PROMPT_LINKS_PER_DOCUMENT = 3;
const ROOT_TITLE = "Knowledge base";
const UNTITLED_TITLE = "Untitled document";
const ORPHANED_TITLE = "Orphaned";

interface KnowledgePromptRelationContext {
  backlinks: string[];
  outgoing: string[];
}

export interface KnowledgePromptContextOptions {
  bookId?: string | null;
  query?: string;
  maxDocuments?: number;
  maxChars?: number;
  cardTemplates?: KnowledgeCardTemplate[];
  relationContextByDocumentId?: Map<string, KnowledgePromptRelationContext>;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdown(value: string): string {
  return compactText(
    value
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/[#>*_`~|[\]()]/g, " "),
  );
}

function normalizeQuery(value?: string): string {
  return compactText(value ?? "").toLowerCase();
}

function truncateText(value: string, maxLength: number): string {
  const compacted = compactText(value);
  if (compacted.length <= maxLength) return compacted;
  if (maxLength <= 3) return ".".repeat(Math.max(0, maxLength));
  return `${compacted.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function documentPriority(document: KnowledgeDocument): number {
  const typeScore: Record<KnowledgeDocument["type"], number> = {
    book_home: 100,
    summary: 85,
    review: 80,
    standalone_note: 65,
    imported_markdown: 55,
    highlight_note: 45,
    folder: 10,
  };
  const contentScore =
    (document.summaryMd?.trim() ? 14 : 0) +
    (document.excerpt?.trim() ? 8 : 0) +
    (document.contentMd?.trim() ? 4 : 0);
  return typeScore[document.type] + contentScore;
}

function createPathSearchText(
  document: KnowledgeDocument,
  documentsById: Map<string, KnowledgeDocument>,
): string {
  const segments: string[] = [];
  const seen = new Set<string>();
  let current: KnowledgeDocument | undefined = document;

  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    segments.unshift(current.title || UNTITLED_TITLE);
    current = current.parentId ? documentsById.get(current.parentId) : undefined;
  }

  return [ROOT_TITLE, ...segments].join(" / ").toLowerCase();
}

function queryScore(
  document: KnowledgeDocument,
  normalizedQuery: string,
  documentsById: Map<string, KnowledgeDocument>,
): number {
  if (!normalizedQuery) return 0;

  const path = createPathSearchText(document, documentsById);
  const haystacks = [
    path,
    document.title,
    document.excerpt ?? "",
    document.summaryMd ?? "",
    document.contentMd,
    document.tags.join(" "),
  ].map((value) => value.toLowerCase());
  if (haystacks.some((value) => value.includes(normalizedQuery))) return 200;

  const tokens = normalizedQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length === 0) return 0;

  return tokens.reduce(
    (score, token) => score + (haystacks.some((value) => value.includes(token)) ? 24 : 0),
    0,
  );
}

function sortKnowledgeContextDocuments(
  documents: KnowledgeDocument[],
  normalizedQuery = "",
): KnowledgeDocument[] {
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  return [...documents].sort(
    (left, right) =>
      queryScore(right, normalizedQuery, documentsById) -
        queryScore(left, normalizedQuery, documentsById) ||
      documentPriority(right) - documentPriority(left) ||
      right.updatedAt - left.updatedAt ||
      right.createdAt - left.createdAt,
  );
}

function selectKnowledgeContextDocuments(
  documents: KnowledgeDocument[],
  normalizedQuery: string,
  maxDocuments: number,
): KnowledgeDocument[] {
  return sortKnowledgeContextDocuments(documents, normalizedQuery)
    .filter((document) => !document.deletedAt && document.type !== "folder")
    .slice(0, maxDocuments);
}

function renderDocumentContentPreviewMarkdown(
  document: KnowledgeDocument,
  cardTemplates?: KnowledgeCardTemplate[],
): string {
  if (!document.contentJson) return document.contentMd;
  const rendered = renderKnowledgeJsonToMarkdown(document.contentJson, { cardTemplates }).trim();
  return rendered || document.contentMd;
}

function createDocumentPreview(
  document: KnowledgeDocument,
  cardTemplates?: KnowledgeCardTemplate[],
): string {
  const source =
    document.summaryMd ||
    document.excerpt ||
    renderDocumentContentPreviewMarkdown(document, cardTemplates);
  return source ? truncateText(stripMarkdown(source), 280) : "";
}

function formatDocumentForPrompt(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
  options: Pick<KnowledgePromptContextOptions, "cardTemplates" | "relationContextByDocumentId">,
): string {
  const title = compactText(document.title) || UNTITLED_TITLE;
  const path = formatKnowledgeDocumentPath(document, documents, {
    rootTitle: ROOT_TITLE,
    untitledTitle: UNTITLED_TITLE,
    orphanedParentTitle: ORPHANED_TITLE,
    includeOrphanedParent: true,
  });
  const tags = document.tags.length > 0 ? `\n  tags: ${document.tags.join(", ")}` : "";
  const relations = options.relationContextByDocumentId?.get(document.id);
  const outgoing = relations?.outgoing.length ? `\n  links: ${relations.outgoing.join("; ")}` : "";
  const backlinks = relations?.backlinks.length
    ? `\n  backlinks: ${relations.backlinks.join("; ")}`
    : "";
  const preview = createDocumentPreview(document, options.cardTemplates);
  const previewLine = preview ? `\n  note: ${preview}` : "";

  return `- [${document.type}] ${title}\n  id: ${document.id}\n  path: ${path}${tags}${outgoing}${backlinks}${previewLine}`;
}

function formatPromptDocumentPath(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
): string {
  return formatKnowledgeDocumentPath(document, documents, {
    rootTitle: ROOT_TITLE,
    untitledTitle: UNTITLED_TITLE,
    orphanedParentTitle: ORPHANED_TITLE,
    includeOrphanedParent: true,
  });
}

function formatKnowledgeLinkDetails(link: Pick<KnowledgeLink, "label" | "cfi">): string {
  const details = [
    link.label ? compactText(link.label) : "",
    link.cfi ? `cfi: ${link.cfi}` : "",
  ].filter(Boolean);
  return details.length > 0 ? ` (${details.join("; ")})` : "";
}

function formatOutgoingKnowledgeLink(
  link: KnowledgeLink,
  documentsById: Map<string, KnowledgeDocument>,
  documents: KnowledgeDocument[],
): string {
  if (link.toKind === "document") {
    const target = documentsById.get(link.toId);
    if (target) {
      return `${link.relation} -> ${formatPromptDocumentPath(
        target,
        documents,
      )}${formatKnowledgeLinkDetails(link)}`;
    }
  }

  const label = compactText(link.label || link.toId);
  const cfi = link.cfi ? ` @ ${link.cfi}` : "";
  return `${link.relation} -> ${link.toKind}: ${label}${cfi}`;
}

function formatKnowledgeBacklink(
  backlink: KnowledgeBacklink,
  documents: KnowledgeDocument[],
): string {
  return `${backlink.link.relation} <- ${formatPromptDocumentPath(
    backlink.fromDocument,
    documents,
  )}${formatKnowledgeLinkDetails(backlink.link)}`;
}

async function loadKnowledgeRelationPromptContext(
  candidates: KnowledgeDocument[],
  contextDocuments: KnowledgeDocument[],
): Promise<Map<string, KnowledgePromptRelationContext>> {
  if (candidates.length === 0) return new Map();

  try {
    const rows = await Promise.all(
      candidates.map(async (document) => {
        const [outgoingLinks, backlinks] = await Promise.all([
          getKnowledgeLinks(document.id),
          getKnowledgeBacklinks(document.id, MAX_PROMPT_LINKS_PER_DOCUMENT),
        ]);
        return { backlinks, document, outgoingLinks };
      }),
    );
    const documents = [
      ...contextDocuments,
      ...rows.flatMap((row) => row.backlinks.map((backlink) => backlink.fromDocument)),
    ];
    const documentsById = new Map(documents.map((document) => [document.id, document]));
    const relationContextByDocumentId = new Map<string, KnowledgePromptRelationContext>();

    for (const row of rows) {
      const outgoing = row.outgoingLinks
        .slice(0, MAX_PROMPT_LINKS_PER_DOCUMENT)
        .map((link) => formatOutgoingKnowledgeLink(link, documentsById, documents));
      const backlinks = row.backlinks
        .slice(0, MAX_PROMPT_LINKS_PER_DOCUMENT)
        .map((backlink) => formatKnowledgeBacklink(backlink, documents));

      if (outgoing.length > 0 || backlinks.length > 0) {
        relationContextByDocumentId.set(row.document.id, { backlinks, outgoing });
      }
    }

    return relationContextByDocumentId;
  } catch (error) {
    console.warn("[knowledge-context] Failed to load knowledge relation context:", error);
    return new Map();
  }
}

export function buildKnowledgePromptContext(
  documents: KnowledgeDocument[],
  options: Omit<KnowledgePromptContextOptions, "bookId"> = {},
): string | undefined {
  const maxDocuments = Math.max(1, Math.floor(options.maxDocuments ?? DEFAULT_MAX_DOCUMENTS));
  const maxChars = Math.max(600, Math.floor(options.maxChars ?? DEFAULT_MAX_CHARS));
  const normalizedQuery = normalizeQuery(options.query);
  const candidates = selectKnowledgeContextDocuments(documents, normalizedQuery, maxDocuments);

  if (candidates.length === 0) return undefined;

  const intro =
    "Bounded snapshot of the user's durable knowledge documents for the current book. It is prioritized by the current question when available, then by high-value book home, summaries, reviews, and recent notes. This is not the full vault. Use document ids with getKnowledgeDocument for exact reads before quoting, updating, or relying on a long document.";
  const lines = [intro];

  for (const document of candidates) {
    const nextLine = formatDocumentForPrompt(document, documents, options);
    const nextText = [...lines, nextLine].join("\n");
    if (nextText.length > maxChars) {
      if (lines.length === 1) {
        lines.push(truncateText(nextLine, maxChars - intro.length - 1));
      }
      break;
    }
    lines.push(nextLine);
  }

  return lines.length > 1 ? lines.join("\n") : undefined;
}

export async function loadKnowledgePromptContext(
  options: KnowledgePromptContextOptions,
): Promise<string | undefined> {
  const bookId = options.bookId?.trim();
  if (!bookId) return undefined;

  try {
    const query = normalizeQuery(options.query);
    const [documents, queryMatches, cardTemplates] = await Promise.all([
      getKnowledgeDocuments({ bookId, limit: DOCUMENT_SCAN_LIMIT }),
      query
        ? searchKnowledgeDocuments({
            bookId,
            query,
            limit: Math.max(options.maxDocuments ?? DEFAULT_MAX_DOCUMENTS, 12),
          })
        : Promise.resolve([]),
      getKnowledgeCardTemplates({ includeDisabled: true }).catch((error) => {
        console.warn("[knowledge-context] Failed to load card templates:", error);
        return [] as KnowledgeCardTemplate[];
      }),
    ]);
    const mergedDocuments = Array.from(
      new Map([...queryMatches, ...documents].map((document) => [document.id, document])).values(),
    );
    const candidates = selectKnowledgeContextDocuments(
      mergedDocuments,
      query,
      Math.max(1, Math.floor(options.maxDocuments ?? DEFAULT_MAX_DOCUMENTS)),
    );
    const relationContextByDocumentId = await loadKnowledgeRelationPromptContext(
      candidates,
      mergedDocuments,
    );
    return buildKnowledgePromptContext(mergedDocuments, {
      ...options,
      cardTemplates,
      relationContextByDocumentId,
    });
  } catch (error) {
    console.warn("[knowledge-context] Failed to load knowledge prompt context:", error);
    return undefined;
  }
}
