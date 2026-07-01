import {
  extractHighlightNoteContentForLegacyField,
  extractLegacyNoteContentForLegacyField,
} from "../knowledge/document-utils";
import type { IDatabase } from "../services/platform";
import type { KnowledgeDocument } from "../types";
import { getDB, getDeviceId, nextSyncVersion, nextUpdatedAt, parseJSON } from "./db-core";

export type KnowledgeSourceWritebackStatus = "skipped" | "missing_source" | "unchanged" | "updated";

export interface KnowledgeSourceWritebackResult {
  status: KnowledgeSourceWritebackStatus;
  sourceTable?: "highlights" | "notes";
  sourceId?: string;
}

interface HighlightSourceRow {
  id: string;
  text: string;
  note: string | null;
  chapter_title: string | null;
}

interface NoteSourceRow {
  id: string;
  title: string;
  content: string;
  chapter_title: string | null;
  tags: string;
}

function normalizeLegacyContent(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort();
}

function parseLegacyTags(value: string): string[] {
  const parsed = parseJSON<unknown[]>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((tag): tag is string => typeof tag === "string");
}

function writebackSkipped(): KnowledgeSourceWritebackResult {
  return { status: "skipped" };
}

async function writebackHighlightNote(
  document: KnowledgeDocument,
  database: IDatabase,
): Promise<KnowledgeSourceWritebackResult> {
  const sourceId = document.sourceId;
  if (!sourceId || document.type !== "highlight_note" || document.sourceKind !== "highlight") {
    return writebackSkipped();
  }

  const rows = await database.select<HighlightSourceRow>(
    "SELECT id, text, note, chapter_title FROM highlights WHERE id = ? LIMIT 1",
    [sourceId],
  );
  const highlight = rows[0];
  if (!highlight) {
    return { status: "missing_source", sourceTable: "highlights", sourceId };
  }

  const nextNote = normalizeLegacyContent(
    extractHighlightNoteContentForLegacyField(document.contentMd, {
      text: highlight.text,
      chapterTitle: highlight.chapter_title || undefined,
    }),
  );
  const currentNote = normalizeLegacyContent(highlight.note);
  if (currentNote === nextNote) {
    return { status: "unchanged", sourceTable: "highlights", sourceId };
  }

  const deviceId = await getDeviceId();
  const updatedAt = await nextUpdatedAt(database, "highlights", sourceId);
  const syncVersion = await nextSyncVersion(database, "highlights");
  await database.execute(
    `UPDATE highlights
     SET note = ?, updated_at = ?, sync_version = ?, last_modified_by = ?
     WHERE id = ?`,
    [nextNote || null, updatedAt, syncVersion, deviceId, sourceId],
  );

  return { status: "updated", sourceTable: "highlights", sourceId };
}

async function writebackLegacyNote(
  document: KnowledgeDocument,
  database: IDatabase,
): Promise<KnowledgeSourceWritebackResult> {
  const sourceId = document.sourceId;
  if (!sourceId || document.type !== "standalone_note" || document.sourceKind !== "note") {
    return writebackSkipped();
  }

  const rows = await database.select<NoteSourceRow>(
    "SELECT id, title, content, chapter_title, tags FROM notes WHERE id = ? LIMIT 1",
    [sourceId],
  );
  const note = rows[0];
  if (!note) {
    return { status: "missing_source", sourceTable: "notes", sourceId };
  }

  const nextTitle = document.title.trim();
  const nextContent = normalizeLegacyContent(
    extractLegacyNoteContentForLegacyField(document.contentMd, {
      chapterTitle: note.chapter_title || undefined,
    }),
  );
  const nextTags = normalizeTags(document.tags);
  const currentTags = normalizeTags(parseLegacyTags(note.tags));

  if (
    note.title.trim() === nextTitle &&
    normalizeLegacyContent(note.content) === nextContent &&
    JSON.stringify(currentTags) === JSON.stringify(nextTags)
  ) {
    return { status: "unchanged", sourceTable: "notes", sourceId };
  }

  const deviceId = await getDeviceId();
  const updatedAt = await nextUpdatedAt(database, "notes", sourceId);
  const syncVersion = await nextSyncVersion(database, "notes");
  await database.execute(
    `UPDATE notes
     SET title = ?, content = ?, tags = ?, updated_at = ?, sync_version = ?, last_modified_by = ?
     WHERE id = ?`,
    [nextTitle, nextContent, JSON.stringify(nextTags), updatedAt, syncVersion, deviceId, sourceId],
  );

  return { status: "updated", sourceTable: "notes", sourceId };
}

export async function syncKnowledgeDocumentToLegacySource(
  document: KnowledgeDocument,
  database?: IDatabase,
): Promise<KnowledgeSourceWritebackResult> {
  if (document.deletedAt) return writebackSkipped();

  const db = database ?? (await getDB());
  const highlightResult = await writebackHighlightNote(document, db);
  if (highlightResult.status !== "skipped") return highlightResult;
  return writebackLegacyNote(document, db);
}
