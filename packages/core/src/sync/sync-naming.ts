/**
 * Naming helpers for the per-book remote layout:
 *
 *     /readany/data/books/{sanitized-title}-{book.id}/{sanitized-title}.{ext}
 *
 * The folder name is `{sanitized-title}-{uuid}`; the file and cover share the
 * sanitized title as their stem and are distinguished by their extension.
 *
 * Local storage stays UUID-flat (`books/{id}.{ext}`, `covers/{id}.{ext}`).
 */

import { COVER_EXTENSIONS, REMOTE_BOOKS_ROOT } from "./sync-types";

const FALLBACK_TITLE = "未命名";
const MAX_TITLE_LEN = 64;
// UUID v4 form: 8-4-4-4-12 hex chars (36 chars total).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stripAsciiControlCharacters(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
}

/**
 * Strip filesystem / WebDAV-unsafe characters, collapse whitespace,
 * cap length, and fall back to a placeholder for empty input.
 */
export function sanitizeBookTitleForFs(title: string | null | undefined): string {
  if (!title) return FALLBACK_TITLE;
  const cleaned = stripAsciiControlCharacters(title.replace(/[\/\\:*?"<>|]/g, "_"))
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return FALLBACK_TITLE;
  return cleaned.slice(0, MAX_TITLE_LEN);
}

/** Build the per-book remote directory: /readany/data/books/{title}-{id}. */
export function buildBookRemoteDir(book: { id: string; title?: string | null }): string {
  return `${REMOTE_BOOKS_ROOT}/${buildBookFolderName(book)}`;
}

/** Build just the folder name segment (no leading path), `{title}-{id}`. */
export function buildBookFolderName(book: { id: string; title?: string | null }): string {
  return `${sanitizeBookTitleForFs(book.title)}-${book.id}`;
}

/** File path inside the book dir, e.g. {title}.epub. */
export function buildBookRemoteFile(
  book: { id: string; title?: string | null },
  ext: string,
): string {
  return `${buildBookRemoteDir(book)}/${sanitizeBookTitleForFs(book.title)}.${ext}`;
}

/** Cover path inside the book dir, e.g. {title}.jpg. */
export function buildBookRemoteCover(
  book: { id: string; title?: string | null },
  ext: string,
): string {
  return `${buildBookRemoteDir(book)}/${sanitizeBookTitleForFs(book.title)}.${ext}`;
}

function sanitizeTranslationPathSegment(value: string | number): string {
  const cleaned = stripAsciiControlCharacters(String(value).replace(/[\/\\:*?"<>|]/g, "_"))
    .replace(/\s+/g, "_")
    .trim();
  return cleaned || "unknown";
}

export function buildBookRemoteTranslationsDir(book: {
  id: string;
  title?: string | null;
}): string {
  return `${buildBookRemoteDir(book)}/translations`;
}

export function buildChapterTranslationRemoteFile(
  book: { id: string; title?: string | null },
  translation: {
    sectionIndex: number;
    sourceLang: string;
    targetLang: string;
    sourceHash?: string;
  },
): string {
  const section = String(translation.sectionIndex).padStart(5, "0");
  const sourceLang = sanitizeTranslationPathSegment(translation.sourceLang);
  const targetLang = sanitizeTranslationPathSegment(translation.targetLang);
  const hash = translation.sourceHash
    ? `-${sanitizeTranslationPathSegment(translation.sourceHash)}`
    : "";
  return `${buildBookRemoteTranslationsDir(book)}/${section}-${sourceLang}-${targetLang}${hash}.json`;
}

/**
 * Extract book.id from a folder name `{title}-{uuid}`.
 * Returns null when the trailing 36 chars do not match a UUID-v4-shaped string.
 */
export function parseBookFolderName(folderName: string): string | null {
  if (folderName.length < 37) return null;
  const candidateId = folderName.slice(-36);
  if (!UUID_RE.test(candidateId)) return null;
  if (folderName[folderName.length - 37] !== "-") return null;
  return candidateId;
}

/** Heuristic: file is a cover if its extension is a known image format. */
export function isCoverFileName(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = fileName.slice(dot + 1).toLowerCase();
  if (!ext) return false;
  return COVER_EXTENSIONS.has(ext);
}
