import { getDB, getDeviceId, nextSyncVersion, nextUpdatedAt, parseJSON } from "./db-core";

export interface ChapterTranslationParagraphRecord {
  paragraphId: string;
  originalText: string;
  translatedText: string;
}

export interface ChapterTranslationRecord {
  id: string;
  bookId: string;
  sectionIndex: number;
  sourceLang: string;
  targetLang: string;
  provider: string;
  model?: string;
  sourceHash: string;
  paragraphs: ChapterTranslationParagraphRecord[];
  originalVisible: boolean;
  translationVisible: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertChapterTranslationInput {
  bookId: string;
  sectionIndex: number;
  sourceLang: string;
  targetLang: string;
  provider: string;
  model?: string;
  sourceHash: string;
  paragraphs: ChapterTranslationParagraphRecord[];
  originalVisible?: boolean;
  translationVisible?: boolean;
}

export interface ImportChapterTranslationInput extends ChapterTranslationRecord {}

type ChapterTranslationRow = {
  id: string;
  book_id: string;
  section_index: number;
  source_lang: string;
  target_lang: string;
  provider: string | null;
  model: string | null;
  source_hash: string;
  paragraphs: string;
  original_visible: number;
  translation_visible: number;
  created_at: number;
  updated_at: number;
};

export function buildChapterTranslationId(
  bookId: string,
  sectionIndex: number,
  sourceLang: string,
  targetLang: string,
): string {
  return `${bookId}:${sectionIndex}:${sourceLang}:${targetLang}`;
}

export function computeChapterSourceHash(
  paragraphs: Array<Pick<ChapterTranslationParagraphRecord, "paragraphId" | "originalText">>,
): string {
  let hash = 2166136261;
  for (const paragraph of paragraphs) {
    const text = `${paragraph.paragraphId}\u0000${paragraph.originalText}\u0001`;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(36);
}

export async function getChapterTranslation(
  bookId: string,
  sectionIndex: number,
  sourceLang: string,
  targetLang: string,
  currentSourceHash?: string,
): Promise<ChapterTranslationRecord | null> {
  const database = await getDB();
  await ensureChapterTranslationsTable(database);
  const id = buildChapterTranslationId(bookId, sectionIndex, sourceLang, targetLang);
  const rows = await database.select<ChapterTranslationRow>(
    "SELECT * FROM chapter_translations WHERE id = ?",
    [id],
  );
  if (rows.length === 0) return null;
  const record = rowToChapterTranslation(rows[0]);
  if (currentSourceHash && record.sourceHash !== currentSourceHash) return null;
  return record;
}

export async function upsertChapterTranslation(
  input: UpsertChapterTranslationInput,
): Promise<ChapterTranslationRecord> {
  const database = await getDB();
  await ensureChapterTranslationsTable(database);
  const now = Date.now();
  const id = buildChapterTranslationId(
    input.bookId,
    input.sectionIndex,
    input.sourceLang,
    input.targetLang,
  );
  const syncVersion = await nextSyncVersion(database, "chapter_translations");
  const deviceId = await getDeviceId();
  const originalVisible = input.originalVisible ?? true;
  const translationVisible = input.translationVisible ?? true;

  await database.execute(
    `INSERT INTO chapter_translations (
      id, book_id, section_index, source_lang, target_lang,
      provider, model, source_hash, paragraphs,
      original_visible, translation_visible, created_at, updated_at,
      sync_version, last_modified_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      model = excluded.model,
      source_hash = excluded.source_hash,
      paragraphs = excluded.paragraphs,
      original_visible = excluded.original_visible,
      translation_visible = excluded.translation_visible,
      updated_at = excluded.updated_at,
      sync_version = excluded.sync_version,
      last_modified_by = excluded.last_modified_by`,
    [
      id,
      input.bookId,
      input.sectionIndex,
      input.sourceLang,
      input.targetLang,
      input.provider,
      input.model || null,
      input.sourceHash,
      JSON.stringify(input.paragraphs),
      originalVisible ? 1 : 0,
      translationVisible ? 1 : 0,
      now,
      now,
      syncVersion,
      deviceId,
    ],
  );

  return {
    id,
    bookId: input.bookId,
    sectionIndex: input.sectionIndex,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    provider: input.provider,
    model: input.model,
    sourceHash: input.sourceHash,
    paragraphs: input.paragraphs,
    originalVisible,
    translationVisible,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateChapterTranslationVisibility(
  bookId: string,
  sectionIndex: number,
  sourceLang: string,
  targetLang: string,
  visibility: { originalVisible: boolean; translationVisible: boolean },
): Promise<void> {
  const database = await getDB();
  await ensureChapterTranslationsTable(database);
  const id = buildChapterTranslationId(bookId, sectionIndex, sourceLang, targetLang);
  const updatedAt = await nextUpdatedAt(database, "chapter_translations", id);
  const syncVersion = await nextSyncVersion(database, "chapter_translations");
  const deviceId = await getDeviceId();
  await database.execute(
    `UPDATE chapter_translations SET
      original_visible = ?,
      translation_visible = ?,
      updated_at = ?,
      sync_version = ?,
      last_modified_by = ?
    WHERE id = ?`,
    [
      visibility.originalVisible ? 1 : 0,
      visibility.translationVisible ? 1 : 0,
      updatedAt,
      syncVersion,
      deviceId,
      id,
    ],
  );
}

export async function importChapterTranslationRecord(
  input: ImportChapterTranslationInput,
): Promise<void> {
  const database = await getDB();
  await ensureChapterTranslationsTable(database);
  await database.execute(
    `INSERT INTO chapter_translations (
      id, book_id, section_index, source_lang, target_lang,
      provider, model, source_hash, paragraphs,
      original_visible, translation_visible, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      model = excluded.model,
      source_hash = excluded.source_hash,
      paragraphs = excluded.paragraphs,
      original_visible = excluded.original_visible,
      translation_visible = excluded.translation_visible,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at`,
    [
      input.id,
      input.bookId,
      input.sectionIndex,
      input.sourceLang,
      input.targetLang,
      input.provider,
      input.model || null,
      input.sourceHash,
      JSON.stringify(input.paragraphs),
      input.originalVisible ? 1 : 0,
      input.translationVisible ? 1 : 0,
      input.createdAt,
      input.updatedAt,
    ],
  );
}

export async function deleteChapterTranslationsForSection(
  bookId: string,
  sectionIndex: number,
): Promise<void> {
  const database = await getDB();
  await ensureChapterTranslationsTable(database);
  await database.execute(
    "DELETE FROM chapter_translations WHERE book_id = ? AND section_index = ?",
    [bookId, sectionIndex],
  );
}

async function ensureChapterTranslationsTable(
  database: Awaited<ReturnType<typeof getDB>>,
): Promise<void> {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS chapter_translations (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      section_index INTEGER NOT NULL,
      source_lang TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT,
      source_hash TEXT NOT NULL,
      paragraphs TEXT NOT NULL DEFAULT '[]',
      original_visible INTEGER NOT NULL DEFAULT 1,
      translation_visible INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sync_version INTEGER DEFAULT 0,
      last_modified_by TEXT,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )
  `);
}

function rowToChapterTranslation(row: ChapterTranslationRow): ChapterTranslationRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    sectionIndex: row.section_index,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    provider: row.provider || "",
    model: row.model || undefined,
    sourceHash: row.source_hash,
    paragraphs: parseJSON<ChapterTranslationParagraphRecord[]>(row.paragraphs, []),
    originalVisible: row.original_visible !== 0,
    translationVisible: row.translation_visible !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
