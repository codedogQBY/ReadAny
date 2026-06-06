import {
  type ChapterTranslationParagraphRecord,
  type ChapterTranslationRecord,
  importChapterTranslationRecord,
} from "../db/database";
import type { ISyncBackend, RemoteFile } from "./sync-backend";
import { buildBookRemoteTranslationsDir, buildChapterTranslationRemoteFile } from "./sync-naming";
import { parallelLimit } from "./sync-transfer";

const TRANSLATION_FILE_SCHEMA_VERSION = 1;
const TRANSLATION_SYNC_CONCURRENCY = 3;

type ChapterTranslationFileRow = {
  id: string;
  book_id: string;
  book_title: string | null;
  section_index: number;
  source_lang: string;
  target_lang: string;
  provider: string | null;
  model: string | null;
  source_hash: string;
  paragraphs: string | null;
  original_visible: number;
  translation_visible: number;
  created_at: number;
  updated_at: number;
};

type ChapterTranslationFilePayload = {
  schemaVersion: number;
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
};

export type ChapterTranslationFileSyncResult = {
  uploaded: number;
  downloaded: number;
  uploadFailed: number;
  downloadFailed: number;
};

function parseParagraphs(value: string | null): ChapterTranslationParagraphRecord[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToPayload(row: ChapterTranslationFileRow): ChapterTranslationFilePayload {
  return {
    schemaVersion: TRANSLATION_FILE_SCHEMA_VERSION,
    id: row.id,
    bookId: row.book_id,
    sectionIndex: row.section_index,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    provider: row.provider || "",
    model: row.model || undefined,
    sourceHash: row.source_hash,
    paragraphs: parseParagraphs(row.paragraphs),
    originalVisible: row.original_visible !== 0,
    translationVisible: row.translation_visible !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function payloadToRecord(payload: ChapterTranslationFilePayload): ChapterTranslationRecord {
  return {
    id: payload.id,
    bookId: payload.bookId,
    sectionIndex: payload.sectionIndex,
    sourceLang: payload.sourceLang,
    targetLang: payload.targetLang,
    provider: payload.provider,
    model: payload.model,
    sourceHash: payload.sourceHash,
    paragraphs: payload.paragraphs,
    originalVisible: payload.originalVisible,
    translationVisible: payload.translationVisible,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  };
}

function encodePayload(payload: ChapterTranslationFilePayload): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
}

function decodePayload(data: Uint8Array): ChapterTranslationFilePayload {
  const raw = new TextDecoder().decode(data);
  const parsed = JSON.parse(raw) as ChapterTranslationFilePayload;
  if (parsed.schemaVersion !== TRANSLATION_FILE_SCHEMA_VERSION) {
    throw new Error(`Unsupported chapter translation file schema: ${parsed.schemaVersion}`);
  }
  if (!Array.isArray(parsed.paragraphs)) {
    throw new Error("Invalid chapter translation file: paragraphs must be an array");
  }
  return parsed;
}

function buildRemotePath(row: ChapterTranslationFileRow): string {
  return buildChapterTranslationRemoteFile(
    { id: row.book_id, title: row.book_title },
    {
      sectionIndex: row.section_index,
      sourceLang: row.source_lang,
      targetLang: row.target_lang,
      sourceHash: row.source_hash,
    },
  );
}

function fileNameFromPath(path: string): string {
  return path.substring(path.lastIndexOf("/") + 1);
}

async function listRemoteTranslations(
  backend: ISyncBackend,
  row: ChapterTranslationFileRow,
): Promise<Map<string, RemoteFile>> {
  try {
    const dir = buildBookRemoteTranslationsDir({ id: row.book_id, title: row.book_title });
    const files = await backend.listDir(dir);
    return new Map(files.filter((file) => !file.isDirectory).map((file) => [file.name, file]));
  } catch {
    return new Map();
  }
}

function isMeaningfulTranslationRow(row: ChapterTranslationFileRow): boolean {
  return (
    typeof row.id === "string" &&
    typeof row.book_id === "string" &&
    typeof row.section_index === "number" &&
    typeof row.source_lang === "string" &&
    typeof row.target_lang === "string" &&
    typeof row.source_hash === "string"
  );
}

export async function syncChapterTranslationFiles(
  backend: ISyncBackend,
  rows: ChapterTranslationFileRow[],
  options: {
    forceUploadAll?: boolean;
    forceDownloadAll?: boolean;
    disableUploads?: boolean;
  } = {},
): Promise<ChapterTranslationFileSyncResult> {
  const usableRows = rows.filter(isMeaningfulTranslationRow);
  if (usableRows.length === 0) {
    return { uploaded: 0, downloaded: 0, uploadFailed: 0, downloadFailed: 0 };
  }

  const remoteByBook = new Map<string, Map<string, RemoteFile>>();
  for (const row of usableRows) {
    if (!remoteByBook.has(row.book_id)) {
      remoteByBook.set(row.book_id, await listRemoteTranslations(backend, row));
    }
  }

  const uploadTasks: Array<() => Promise<boolean>> = [];
  const downloadTasks: Array<() => Promise<boolean>> = [];

  for (const row of usableRows) {
    const payload = rowToPayload(row);
    const remotePath = buildRemotePath(row);
    const remote = remoteByBook.get(row.book_id)?.get(fileNameFromPath(remotePath));
    const hasLocalParagraphs = payload.paragraphs.length > 0;

    if (!options.disableUploads && hasLocalParagraphs && (options.forceUploadAll || !remote)) {
      uploadTasks.push(async () => {
        try {
          await backend.put(remotePath, encodePayload(payload));
          return true;
        } catch (error) {
          console.warn(`[Sync] Failed to upload chapter translation ${row.id}:`, error);
          return false;
        }
      });
      continue;
    }

    if (remote && (!hasLocalParagraphs || options.forceDownloadAll)) {
      downloadTasks.push(async () => {
        try {
          const data = await backend.get(remotePath);
          const remotePayload = decodePayload(data);
          await importChapterTranslationRecord(payloadToRecord(remotePayload));
          return true;
        } catch (error) {
          console.warn(`[Sync] Failed to download chapter translation ${row.id}:`, error);
          return false;
        }
      });
    }
  }

  const uploadResults = await parallelLimit(uploadTasks, TRANSLATION_SYNC_CONCURRENCY);
  const downloadResults = await parallelLimit(downloadTasks, TRANSLATION_SYNC_CONCURRENCY);

  return {
    uploaded: uploadResults.filter(Boolean).length,
    downloaded: downloadResults.filter(Boolean).length,
    uploadFailed: uploadResults.filter((result) => !result).length,
    downloadFailed: downloadResults.filter((result) => !result).length,
  };
}
