import {
  createLegacyNoteProjection,
  hasLegacyNoteContent,
  isGeneratedLegacyNoteDocument,
} from "../knowledge/document-utils";
import { ensureKnowledgeSourceLink } from "../knowledge/source-links";
import { sortAnnotationsByPosition } from "../reader/annotation-order";
import type { IDatabase } from "../services/platform";
import type { Note } from "../types";
import {
  getDB,
  getDeviceId,
  insertTombstone,
  nextSyncVersion,
  nextUpdatedAt,
  parseJSON,
} from "./db-core";
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeDocuments,
  updateKnowledgeDocument,
} from "./knowledge-queries";

interface NoteRow {
  id: string;
  book_id: string;
  highlight_id: string | null;
  cfi: string | null;
  title: string;
  content: string;
  chapter_title: string | null;
  tags: string;
  created_at: number;
  updated_at: number;
}

function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    bookId: row.book_id,
    highlightId: row.highlight_id || undefined,
    cfi: row.cfi || undefined,
    title: row.title,
    content: row.content,
    chapterTitle: row.chapter_title || undefined,
    tags: parseJSON(row.tags, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getNoteById(database: IDatabase, id: string): Promise<Note | null> {
  const rows = await database.select<NoteRow>("SELECT * FROM notes WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? rowToNote(rows[0]) : null;
}

async function getLegacyNoteDocuments(noteId: string) {
  return getKnowledgeDocuments({
    type: "standalone_note",
    sourceKind: "note",
    sourceId: noteId,
    limit: 20,
  });
}

function isProjectionCurrent(
  document: Awaited<ReturnType<typeof getLegacyNoteDocuments>>[number],
  projection: ReturnType<typeof createLegacyNoteProjection>,
): boolean {
  return (
    document.title.trim() === projection.title.trim() &&
    document.contentMd.trim() === projection.contentMd.trim() &&
    JSON.stringify(document.contentJson) === JSON.stringify(projection.contentJson) &&
    (document.excerpt ?? undefined) === projection.excerpt &&
    JSON.stringify(document.tags) === JSON.stringify(projection.tags)
  );
}

async function ensureLegacyNoteSourceLink(documentId: string, note: Note): Promise<number> {
  if (note.highlightId) {
    const added = await ensureKnowledgeSourceLink({
      documentId,
      toKind: "highlight",
      toId: note.highlightId,
      label: note.chapterTitle,
      cfi: note.cfi,
    });
    return added ? 1 : 0;
  }

  if (note.cfi) {
    const added = await ensureKnowledgeSourceLink({
      documentId,
      toKind: "cfi",
      toId: note.cfi,
      label: note.chapterTitle,
      cfi: note.cfi,
    });
    return added ? 1 : 0;
  }

  return 0;
}

async function syncLegacyNoteDocument(note: Note, previousNote: Note = note): Promise<number> {
  const documents = await getLegacyNoteDocuments(note.id);
  const generatedDocuments = documents.filter((document) =>
    isGeneratedLegacyNoteDocument(document, previousNote),
  );

  if (!hasLegacyNoteContent(note)) {
    await Promise.all(generatedDocuments.map((document) => deleteKnowledgeDocument(document.id)));
    return generatedDocuments.length;
  }

  const projection = createLegacyNoteProjection(note);

  if (documents.length === 0) {
    const document = await createKnowledgeDocument({
      bookId: note.bookId,
      type: "standalone_note",
      title: projection.title,
      contentJson: projection.contentJson,
      contentMd: projection.contentMd,
      excerpt: projection.excerpt,
      tags: projection.tags,
      sourceKind: "note",
      sourceId: note.id,
    });
    return 1 + (await ensureLegacyNoteSourceLink(document.id, note));
  }

  const documentsToUpdate = generatedDocuments.filter(
    (document) => !isProjectionCurrent(document, projection),
  );
  await Promise.all(
    documentsToUpdate.map((document) =>
      updateKnowledgeDocument(document.id, {
        bookId: note.bookId,
        type: "standalone_note",
        title: projection.title,
        contentJson: projection.contentJson,
        contentMd: projection.contentMd,
        excerpt: projection.excerpt,
        tags: projection.tags,
        sourceKind: "note",
        sourceId: note.id,
      }),
    ),
  );
  const linkResults = await Promise.all(
    documents.map((document) => ensureLegacyNoteSourceLink(document.id, note)),
  );
  return documentsToUpdate.length + linkResults.reduce((total, count) => total + count, 0);
}

export async function getNotes(bookId: string): Promise<Note[]> {
  const database = await getDB();
  const rows = await database.select<NoteRow>(
    "SELECT * FROM notes WHERE book_id = ? ORDER BY created_at DESC",
    [bookId],
  );
  return sortAnnotationsByPosition(rows.map(rowToNote));
}

/** Get all notes across all books (for general chat without bookId) */
export async function getAllNotes(limit = 50): Promise<Note[]> {
  const database = await getDB();
  const rows = await database.select<NoteRow>(
    "SELECT * FROM notes ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
  return rows.map(rowToNote);
}

export async function ensureNoteKnowledgeDocuments(bookId: string, limit = 500): Promise<number> {
  const database = await getDB();
  const rows = await database.select<NoteRow>(
    `SELECT * FROM notes
     WHERE book_id = ?
       AND (TRIM(COALESCE(title, '')) <> '' OR TRIM(COALESCE(content, '')) <> '')
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ?`,
    [bookId, limit],
  );

  let changedCount = 0;
  for (const row of rows) {
    changedCount += await syncLegacyNoteDocument(rowToNote(row));
  }
  return changedCount;
}

export async function insertNote(note: Note): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "notes");
  await database.execute(
    "INSERT INTO notes (id, book_id, highlight_id, cfi, title, content, chapter_title, tags, created_at, updated_at, sync_version, last_modified_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      note.id,
      note.bookId,
      note.highlightId || null,
      note.cfi || null,
      note.title,
      note.content,
      note.chapterTitle || null,
      JSON.stringify(note.tags),
      note.createdAt,
      note.updatedAt,
      syncVersion,
      deviceId,
    ],
  );
  if (hasLegacyNoteContent(note)) {
    await syncLegacyNoteDocument(note);
  }
}

export async function updateNote(id: string, updates: Partial<Note>): Promise<void> {
  const database = await getDB();
  const shouldSyncKnowledgeDocument =
    updates.title !== undefined || updates.content !== undefined || updates.tags !== undefined;
  const previousNote = shouldSyncKnowledgeDocument ? await getNoteById(database, id) : null;
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    sets.push("title = ?");
    values.push(updates.title);
  }
  if (updates.content !== undefined) {
    sets.push("content = ?");
    values.push(updates.content);
  }
  if (updates.tags !== undefined) {
    sets.push("tags = ?");
    values.push(JSON.stringify(updates.tags));
  }
  // Add sync tracking
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "notes");
  const updatedAt = await nextUpdatedAt(database, "notes", id);
  sets.push("updated_at = ?");
  values.push(updatedAt);
  sets.push("sync_version = ?");
  values.push(syncVersion);
  sets.push("last_modified_by = ?");
  values.push(deviceId);

  if (sets.length === 0) return;
  values.push(id);
  await database.execute(`UPDATE notes SET ${sets.join(", ")} WHERE id = ?`, values);

  if (previousNote) {
    await syncLegacyNoteDocument(
      {
        ...previousNote,
        title: updates.title ?? previousNote.title,
        content: updates.content ?? previousNote.content,
        tags: updates.tags ?? previousNote.tags,
        updatedAt,
      },
      previousNote,
    );
  }
}

export async function deleteNote(id: string): Promise<void> {
  const database = await getDB();
  const previousNote = await getNoteById(database, id);
  await insertTombstone(database, id, "notes");
  await database.execute("DELETE FROM notes WHERE id = ?", [id]);
  if (previousNote) {
    await syncLegacyNoteDocument({ ...previousNote, title: "", content: "" }, previousNote);
  }
}
