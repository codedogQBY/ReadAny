import type {
  JSONValue,
  KnowledgeAttachment,
  KnowledgeAttachmentKind,
  KnowledgeCardTemplate,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeLink,
  KnowledgeLinkRelation,
  KnowledgeLinkTargetKind,
  KnowledgeSourceKind,
} from "../types";
import type { KnowledgeSummaryCompressionState } from "../knowledge/compact-summary";
import { EMPTY_TIPTAP_DOCUMENT } from "../types";
import { generateId } from "../utils/generate-id";
import { eventBus } from "../utils/event-bus";
import {
  getDB,
  getDeviceId,
  insertTombstone,
  nextSyncVersion,
  nextUpdatedAt,
  parseJSON,
} from "./db-core";
import { syncKnowledgeDocumentToLegacySource } from "./knowledge-source-writeback";

const KNOWLEDGE_SCHEMA_VERSION = 1;

interface KnowledgeDocumentRow {
  id: string;
  book_id: string | null;
  parent_id: string | null;
  type: string;
  title: string;
  content_json: string;
  content_md: string;
  content_schema_version: number | null;
  excerpt: string | null;
  summary_md: string | null;
  summary_source_fingerprint: string | null;
  summary_source_updated_at: number | null;
  summary_updated_at: number | null;
  tags: string;
  source_kind: string | null;
  source_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface KnowledgeLinkRow {
  id: string;
  from_document_id: string;
  to_kind: string;
  to_id: string;
  relation: string;
  label: string | null;
  cfi: string | null;
  created_at: number;
  updated_at: number;
}

interface KnowledgeBacklinkRow extends KnowledgeLinkRow {
  document_id: string;
  document_book_id: string | null;
  document_parent_id: string | null;
  document_type: string;
  document_title: string;
  document_content_json: string;
  document_content_md: string;
  document_content_schema_version: number | null;
  document_excerpt: string | null;
  document_summary_md: string | null;
  document_summary_source_fingerprint: string | null;
  document_summary_source_updated_at: number | null;
  document_summary_updated_at: number | null;
  document_tags: string;
  document_source_kind: string | null;
  document_source_id: string | null;
  document_created_at: number;
  document_updated_at: number;
  document_deleted_at: number | null;
}

interface KnowledgeAttachmentRow {
  id: string;
  document_id: string | null;
  kind: string;
  file_name: string;
  mime_type: string | null;
  local_path: string | null;
  remote_path: string | null;
  size: number | null;
  hash: string | null;
  created_at: number;
  updated_at: number;
}

interface KnowledgeCardTemplateRow {
  id: string;
  name: string;
  version: number | null;
  schema_json: string;
  built_in: number | null;
  enabled: number | null;
  created_at: number;
  updated_at: number;
}

export interface GetKnowledgeCardTemplatesOptions {
  includeDisabled?: boolean;
}

export interface CreateKnowledgeDocumentInput {
  id?: string;
  bookId?: string;
  parentId?: string;
  type: KnowledgeDocumentType;
  title?: string;
  contentJson?: JSONValue;
  contentMd?: string;
  contentSchemaVersion?: number;
  excerpt?: string;
  summaryMd?: string;
  summarySourceFingerprint?: string;
  summarySourceUpdatedAt?: number;
  summaryUpdatedAt?: number;
  tags?: string[];
  sourceKind?: KnowledgeSourceKind;
  sourceId?: string;
}

export interface KnowledgeDocumentFilters {
  bookId?: string;
  parentId?: string | null;
  type?: KnowledgeDocumentType;
  sourceKind?: KnowledgeSourceKind;
  sourceId?: string;
  limit?: number;
}

export interface KnowledgeDocumentSearchFilters extends KnowledgeDocumentFilters {
  query?: string;
}

export interface KnowledgeBacklink {
  link: KnowledgeLink;
  fromDocument: KnowledgeDocument;
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function knowledgeDocumentWhereClauses(filters: KnowledgeDocumentFilters): {
  where: string[];
  params: unknown[];
} {
  const where: string[] = ["deleted_at IS NULL"];
  const params: unknown[] = [];

  if (filters.bookId !== undefined) {
    where.push("book_id = ?");
    params.push(filters.bookId);
  }
  if (Object.prototype.hasOwnProperty.call(filters, "parentId")) {
    if (filters.parentId === null) {
      where.push("parent_id IS NULL");
    } else {
      where.push("parent_id = ?");
      params.push(filters.parentId);
    }
  }
  if (filters.type !== undefined) {
    where.push("type = ?");
    params.push(filters.type);
  }
  if (filters.sourceKind !== undefined) {
    where.push("source_kind = ?");
    params.push(filters.sourceKind);
  }
  if (filters.sourceId !== undefined) {
    where.push("source_id = ?");
    params.push(filters.sourceId);
  }

  return { where, params };
}

function rowToKnowledgeDocument(row: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    bookId: row.book_id || undefined,
    parentId: row.parent_id || undefined,
    type: row.type as KnowledgeDocumentType,
    title: row.title,
    contentJson: parseJSON(row.content_json, EMPTY_TIPTAP_DOCUMENT) as JSONValue,
    contentMd: row.content_md || "",
    contentSchemaVersion: row.content_schema_version ?? KNOWLEDGE_SCHEMA_VERSION,
    excerpt: row.excerpt || undefined,
    summaryMd: row.summary_md || undefined,
    summarySourceFingerprint: row.summary_source_fingerprint || undefined,
    summarySourceUpdatedAt: row.summary_source_updated_at || undefined,
    summaryUpdatedAt: row.summary_updated_at || undefined,
    tags: parseJSON(row.tags, []) as string[],
    sourceKind: (row.source_kind as KnowledgeSourceKind | null) || undefined,
    sourceId: row.source_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || undefined,
  };
}

function rowToKnowledgeLink(row: KnowledgeLinkRow): KnowledgeLink {
  return {
    id: row.id,
    fromDocumentId: row.from_document_id,
    toKind: row.to_kind as KnowledgeLinkTargetKind,
    toId: row.to_id,
    relation: row.relation as KnowledgeLinkRelation,
    label: row.label || undefined,
    cfi: row.cfi || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToKnowledgeBacklink(row: KnowledgeBacklinkRow): KnowledgeBacklink {
  return {
    link: rowToKnowledgeLink(row),
    fromDocument: rowToKnowledgeDocument({
      id: row.document_id,
      book_id: row.document_book_id,
      parent_id: row.document_parent_id,
      type: row.document_type,
      title: row.document_title,
      content_json: row.document_content_json,
      content_md: row.document_content_md,
      content_schema_version: row.document_content_schema_version,
      excerpt: row.document_excerpt,
      summary_md: row.document_summary_md,
      summary_source_fingerprint: row.document_summary_source_fingerprint,
      summary_source_updated_at: row.document_summary_source_updated_at,
      summary_updated_at: row.document_summary_updated_at,
      tags: row.document_tags,
      source_kind: row.document_source_kind,
      source_id: row.document_source_id,
      created_at: row.document_created_at,
      updated_at: row.document_updated_at,
      deleted_at: row.document_deleted_at,
    }),
  };
}

function rowToKnowledgeAttachment(row: KnowledgeAttachmentRow): KnowledgeAttachment {
  return {
    id: row.id,
    documentId: row.document_id || undefined,
    kind: row.kind as KnowledgeAttachmentKind,
    fileName: row.file_name,
    mimeType: row.mime_type || undefined,
    localPath: row.local_path || undefined,
    remotePath: row.remote_path || undefined,
    size: row.size ?? 0,
    hash: row.hash || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToKnowledgeCardTemplate(row: KnowledgeCardTemplateRow): KnowledgeCardTemplate {
  return {
    id: row.id,
    name: row.name,
    version: row.version ?? 1,
    schemaJson: parseJSON(row.schema_json, {}) as JSONValue,
    builtIn: row.built_in === 1,
    enabled: row.enabled !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getKnowledgeDocumentById(
  database: Awaited<ReturnType<typeof getDB>>,
  id: string,
): Promise<KnowledgeDocument | null> {
  const rows = await database.select<KnowledgeDocumentRow>(
    "SELECT * FROM knowledge_documents WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] ? rowToKnowledgeDocument(rows[0]) : null;
}

export async function getKnowledgeDocument(id: string): Promise<KnowledgeDocument | null> {
  const database = await getDB();
  return getKnowledgeDocumentById(database, id);
}

export async function getKnowledgeDocuments(
  filters: KnowledgeDocumentFilters = {},
): Promise<KnowledgeDocument[]> {
  const database = await getDB();
  const { where, params } = knowledgeDocumentWhereClauses(filters);

  params.push(filters.limit ?? 200);
  const rows = await database.select<KnowledgeDocumentRow>(
    `SELECT * FROM knowledge_documents
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ?`,
    params,
  );
  return rows.map(rowToKnowledgeDocument);
}

export async function searchKnowledgeDocuments(
  filters: KnowledgeDocumentSearchFilters = {},
): Promise<KnowledgeDocument[]> {
  const query = filters.query?.trim();
  if (!query) return getKnowledgeDocuments(filters);

  const database = await getDB();
  const { where, params } = knowledgeDocumentWhereClauses(filters);
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 8);

  for (const token of tokens) {
    const pattern = `%${escapeSqlLike(token)}%`;
    where.push(`(
      LOWER(title) LIKE ? ESCAPE '\\'
      OR LOWER(excerpt) LIKE ? ESCAPE '\\'
      OR LOWER(summary_md) LIKE ? ESCAPE '\\'
      OR LOWER(content_md) LIKE ? ESCAPE '\\'
      OR LOWER(tags) LIKE ? ESCAPE '\\'
    )`);
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  params.push(filters.limit ?? 200);
  const rows = await database.select<KnowledgeDocumentRow>(
    `SELECT * FROM knowledge_documents
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ?`,
    params,
  );
  return rows.map(rowToKnowledgeDocument);
}

export async function getBookHomeDocument(bookId: string): Promise<KnowledgeDocument | null> {
  const rows = await getKnowledgeDocuments({ bookId, type: "book_home", limit: 1 });
  return rows[0] ?? null;
}

export async function createKnowledgeDocument(
  input: CreateKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  const now = Date.now();
  const document: KnowledgeDocument = {
    id: input.id ?? generateId(),
    bookId: input.bookId,
    parentId: input.parentId,
    type: input.type,
    title: input.title?.trim() ?? "",
    contentJson: input.contentJson ?? EMPTY_TIPTAP_DOCUMENT,
    contentMd: input.contentMd ?? "",
    contentSchemaVersion: input.contentSchemaVersion ?? KNOWLEDGE_SCHEMA_VERSION,
    excerpt: input.excerpt,
    summaryMd: input.summaryMd,
    summarySourceFingerprint: input.summarySourceFingerprint,
    summarySourceUpdatedAt: input.summarySourceUpdatedAt,
    summaryUpdatedAt: input.summaryUpdatedAt,
    tags: input.tags ?? [],
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    createdAt: now,
    updatedAt: now,
  };
  await insertKnowledgeDocument(document);
  return document;
}

export async function ensureBookHomeDocument(
  bookId: string,
  fallbackTitle = "",
): Promise<KnowledgeDocument> {
  const existing = await getBookHomeDocument(bookId);
  if (existing) return existing;
  return createKnowledgeDocument({
    bookId,
    type: "book_home",
    title: fallbackTitle,
    sourceKind: "book",
    sourceId: bookId,
  });
}

export async function insertKnowledgeDocument(document: KnowledgeDocument): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "knowledge_documents");

  await database.execute(
    `INSERT INTO knowledge_documents (
       id, book_id, parent_id, type, title, content_json, content_md,
       content_schema_version, excerpt, summary_md, summary_source_fingerprint,
       summary_source_updated_at, summary_updated_at, tags, source_kind, source_id,
       created_at, updated_at, deleted_at, sync_version, last_modified_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      document.id,
      document.bookId ?? null,
      document.parentId ?? null,
      document.type,
      document.title,
      JSON.stringify(document.contentJson),
      document.contentMd,
      document.contentSchemaVersion,
      document.excerpt ?? null,
      document.summaryMd ?? null,
      document.summarySourceFingerprint ?? null,
      document.summarySourceUpdatedAt ?? null,
      document.summaryUpdatedAt ?? null,
      JSON.stringify(document.tags),
      document.sourceKind ?? null,
      document.sourceId ?? null,
      document.createdAt,
      document.updatedAt,
      document.deletedAt ?? null,
      syncVersion,
      deviceId,
    ],
  );
}

export async function updateKnowledgeDocument(
  id: string,
  updates: Partial<
    Pick<
      KnowledgeDocument,
      | "bookId"
      | "parentId"
      | "type"
      | "title"
      | "contentJson"
      | "contentMd"
      | "contentSchemaVersion"
      | "excerpt"
      | "tags"
      | "sourceKind"
      | "sourceId"
      | "deletedAt"
    >
  >,
): Promise<void> {
  const database = await getDB();
  const sets: string[] = [];
  const values: unknown[] = [];
  const summarySourceFields: Array<keyof typeof updates> = [
    "bookId",
    "type",
    "title",
    "contentJson",
    "contentMd",
    "contentSchemaVersion",
    "excerpt",
    "tags",
    "sourceKind",
    "sourceId",
  ];
  const shouldClearSummary = summarySourceFields.some((field) =>
    Object.prototype.hasOwnProperty.call(updates, field),
  );

  const setNullable = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value ?? null);
  };

  if (Object.prototype.hasOwnProperty.call(updates, "bookId")) {
    setNullable("book_id", updates.bookId);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "parentId")) {
    setNullable("parent_id", updates.parentId);
  }
  if (updates.type !== undefined) {
    sets.push("type = ?");
    values.push(updates.type);
  }
  if (updates.title !== undefined) {
    sets.push("title = ?");
    values.push(updates.title.trim());
  }
  if (updates.contentJson !== undefined) {
    sets.push("content_json = ?");
    values.push(JSON.stringify(updates.contentJson));
  }
  if (updates.contentMd !== undefined) {
    sets.push("content_md = ?");
    values.push(updates.contentMd);
  }
  if (updates.contentSchemaVersion !== undefined) {
    sets.push("content_schema_version = ?");
    values.push(updates.contentSchemaVersion);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "excerpt")) {
    setNullable("excerpt", updates.excerpt);
  }
  if (updates.tags !== undefined) {
    sets.push("tags = ?");
    values.push(JSON.stringify(updates.tags));
  }
  if (Object.prototype.hasOwnProperty.call(updates, "sourceKind")) {
    setNullable("source_kind", updates.sourceKind);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "sourceId")) {
    setNullable("source_id", updates.sourceId);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "deletedAt")) {
    setNullable("deleted_at", updates.deletedAt);
  }
  if (shouldClearSummary) {
    sets.push(
      "summary_md = NULL",
      "summary_source_fingerprint = NULL",
      "summary_source_updated_at = NULL",
      "summary_updated_at = NULL",
    );
  }

  if (sets.length === 0) return;

  const deviceId = await getDeviceId();
  const updatedAt = await nextUpdatedAt(database, "knowledge_documents", id);
  const syncVersion = await nextSyncVersion(database, "knowledge_documents");
  sets.push("updated_at = ?");
  values.push(updatedAt);
  sets.push("sync_version = ?");
  values.push(syncVersion);
  sets.push("last_modified_by = ?");
  values.push(deviceId);
  values.push(id);

  await database.execute(`UPDATE knowledge_documents SET ${sets.join(", ")} WHERE id = ?`, values);

  const updatedDocument = await getKnowledgeDocumentById(database, id);
  if (updatedDocument) {
    await syncKnowledgeDocumentToLegacySource(updatedDocument, database);
  }
}

export async function updateKnowledgeDocumentSummary(
  id: string,
  state: KnowledgeSummaryCompressionState | null,
): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const updatedAt = await nextUpdatedAt(database, "knowledge_documents", id);
  const syncVersion = await nextSyncVersion(database, "knowledge_documents");
  const summaryMd = state?.summaryMd?.trim() || null;

  await database.execute(
    `UPDATE knowledge_documents
     SET summary_md = ?,
         summary_source_fingerprint = ?,
         summary_source_updated_at = ?,
         summary_updated_at = ?,
         updated_at = ?,
         sync_version = ?,
         last_modified_by = ?
     WHERE id = ?`,
    [
      summaryMd,
      summaryMd ? (state?.sourceFingerprint ?? null) : null,
      summaryMd ? (state?.sourceUpdatedAt ?? null) : null,
      summaryMd ? (state?.compressedAt ?? updatedAt) : null,
      updatedAt,
      syncVersion,
      deviceId,
      id,
    ],
  );
}

export async function deleteKnowledgeDocument(id: string): Promise<void> {
  const database = await getDB();
  const [linkRows, attachmentRows] = await Promise.all([
    database.select<{ id: string }>(
      `SELECT DISTINCT id
       FROM knowledge_links
       WHERE from_document_id = ?
          OR (to_kind = 'document' AND to_id = ?)`,
      [id, id],
    ),
    database.select<{ id: string }>(
      "SELECT id FROM knowledge_attachments WHERE document_id = ?",
      [id],
    ),
  ]);

  for (const row of linkRows) {
    await insertTombstone(database, row.id, "knowledge_links");
  }
  for (const row of attachmentRows) {
    await insertTombstone(database, row.id, "knowledge_attachments");
  }
  await insertTombstone(database, id, "knowledge_documents");
  await database.execute(
    `DELETE FROM knowledge_links
     WHERE from_document_id = ?
        OR (to_kind = 'document' AND to_id = ?)`,
    [id, id],
  );
  await database.execute("DELETE FROM knowledge_attachments WHERE document_id = ?", [id]);
  await database.execute("DELETE FROM knowledge_documents WHERE id = ?", [id]);
}

export async function getKnowledgeLinks(documentId: string): Promise<KnowledgeLink[]> {
  const database = await getDB();
  const rows = await database.select<KnowledgeLinkRow>(
    `SELECT * FROM knowledge_links
     WHERE from_document_id = ?
     ORDER BY created_at ASC`,
    [documentId],
  );
  return rows.map(rowToKnowledgeLink);
}

export async function getKnowledgeBacklinks(
  documentId: string,
  limit = 100,
): Promise<KnowledgeBacklink[]> {
  const database = await getDB();
  const rows = await database.select<KnowledgeBacklinkRow>(
    `SELECT
       kl.id, kl.from_document_id, kl.to_kind, kl.to_id, kl.relation, kl.label, kl.cfi,
       kl.created_at, kl.updated_at,
       kd.id AS document_id,
       kd.book_id AS document_book_id,
       kd.parent_id AS document_parent_id,
       kd.type AS document_type,
       kd.title AS document_title,
       kd.content_json AS document_content_json,
       kd.content_md AS document_content_md,
       kd.content_schema_version AS document_content_schema_version,
       kd.excerpt AS document_excerpt,
       kd.summary_md AS document_summary_md,
       kd.summary_source_fingerprint AS document_summary_source_fingerprint,
       kd.summary_source_updated_at AS document_summary_source_updated_at,
       kd.summary_updated_at AS document_summary_updated_at,
       kd.tags AS document_tags,
       kd.source_kind AS document_source_kind,
       kd.source_id AS document_source_id,
       kd.created_at AS document_created_at,
       kd.updated_at AS document_updated_at,
       kd.deleted_at AS document_deleted_at
     FROM knowledge_links kl
     INNER JOIN knowledge_documents kd ON kd.id = kl.from_document_id
     WHERE kl.to_kind = 'document'
       AND kl.to_id = ?
       AND kd.deleted_at IS NULL
     ORDER BY kl.updated_at DESC, kl.created_at DESC
     LIMIT ?`,
    [documentId, limit],
  );
  return rows.map(rowToKnowledgeBacklink);
}

export async function insertKnowledgeLink(link: KnowledgeLink): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "knowledge_links");

  await database.execute(
    `INSERT INTO knowledge_links (
       id, from_document_id, to_kind, to_id, relation, label, cfi,
       created_at, updated_at, sync_version, last_modified_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      link.id,
      link.fromDocumentId,
      link.toKind,
      link.toId,
      link.relation,
      link.label ?? null,
      link.cfi ?? null,
      link.createdAt,
      link.updatedAt,
      syncVersion,
      deviceId,
    ],
  );
}

export async function deleteKnowledgeLink(id: string): Promise<void> {
  const database = await getDB();
  await insertTombstone(database, id, "knowledge_links");
  await database.execute("DELETE FROM knowledge_links WHERE id = ?", [id]);
}

export async function getKnowledgeAttachments(documentId: string): Promise<KnowledgeAttachment[]> {
  const database = await getDB();
  const rows = await database.select<KnowledgeAttachmentRow>(
    `SELECT * FROM knowledge_attachments
     WHERE document_id = ?
     ORDER BY created_at ASC`,
    [documentId],
  );
  return rows.map(rowToKnowledgeAttachment);
}

export async function insertKnowledgeAttachment(attachment: KnowledgeAttachment): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "knowledge_attachments");

  await database.execute(
    `INSERT INTO knowledge_attachments (
       id, document_id, kind, file_name, mime_type, local_path, remote_path,
       size, hash, created_at, updated_at, sync_version, last_modified_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attachment.id,
      attachment.documentId ?? null,
      attachment.kind,
      attachment.fileName,
      attachment.mimeType ?? null,
      attachment.localPath ?? null,
      attachment.remotePath ?? null,
      attachment.size,
      attachment.hash ?? null,
      attachment.createdAt,
      attachment.updatedAt,
      syncVersion,
      deviceId,
    ],
  );
}

export async function deleteKnowledgeAttachment(id: string): Promise<void> {
  const database = await getDB();
  await insertTombstone(database, id, "knowledge_attachments");
  await database.execute("DELETE FROM knowledge_attachments WHERE id = ?", [id]);
}

export async function getKnowledgeCardTemplates(
  options: GetKnowledgeCardTemplatesOptions = {},
): Promise<KnowledgeCardTemplate[]> {
  const database = await getDB();
  const rows = await database.select<KnowledgeCardTemplateRow>(
    options.includeDisabled
      ? "SELECT * FROM knowledge_card_templates ORDER BY built_in DESC, enabled DESC, name ASC"
      : "SELECT * FROM knowledge_card_templates WHERE enabled = 1 ORDER BY built_in DESC, name ASC",
  );
  return rows.map(rowToKnowledgeCardTemplate);
}

export async function upsertKnowledgeCardTemplate(template: KnowledgeCardTemplate): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "knowledge_card_templates");

  await database.execute(
    `INSERT INTO knowledge_card_templates (
       id, name, version, schema_json, built_in, enabled, created_at, updated_at,
       sync_version, last_modified_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       version = excluded.version,
       schema_json = excluded.schema_json,
       built_in = excluded.built_in,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at,
       sync_version = excluded.sync_version,
       last_modified_by = excluded.last_modified_by`,
    [
      template.id,
      template.name,
      template.version,
      JSON.stringify(template.schemaJson),
      template.builtIn ? 1 : 0,
      template.enabled ? 1 : 0,
      template.createdAt,
      template.updatedAt,
      syncVersion,
      deviceId,
    ],
  );

  eventBus.emit("knowledge:card-templates-changed", {
    action: "upsert",
    templateId: template.id,
    timestamp: Date.now(),
  });
}

export async function disableKnowledgeCardTemplate(id: string): Promise<void> {
  const trimmedId = id.trim();
  if (!trimmedId) return;

  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "knowledge_card_templates");
  const now = Date.now();

  await database.execute(
    `UPDATE knowledge_card_templates
     SET enabled = 0, updated_at = ?, sync_version = ?, last_modified_by = ?
     WHERE id = ? AND built_in = 0`,
    [now, syncVersion, deviceId, trimmedId],
  );

  eventBus.emit("knowledge:card-templates-changed", {
    action: "disable",
    templateId: trimmedId,
    timestamp: now,
  });
}
