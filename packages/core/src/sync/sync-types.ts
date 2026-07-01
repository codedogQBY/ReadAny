/**
 * Cloud sync types — shared types for database sync via WebDAV/S3/LAN.
 */

/** Sync direction determined by comparing local vs remote DB state */
export type SyncDirection = "upload" | "download" | "conflict" | "none";

/** Runtime status of the sync engine */
export type SyncStatusType =
  | "idle"
  | "checking"
  | "uploading"
  | "downloading"
  | "syncing-files"
  | "error";

/** Result of a completed sync operation */
export interface SyncResult {
  success: boolean;
  direction: SyncDirection;
  filesUploaded: number;
  filesDownloaded: number;
  /** Number of files that failed to upload to the remote in the file-sync phase. */
  filesUploadFailed: number;
  /** Number of files that failed to download from the remote in the file-sync phase. */
  filesDownloadFailed: number;
  durationMs: number;
  error?: string;
}

/** WebDAV resource from PROPFIND */
export interface DavResource {
  href: string;
  name: string;
  isCollection: boolean;
  contentLength?: number;
  lastModified?: string;
  etag?: string;
}

/** Detailed progress information for sync operations */
export interface SyncProgress {
  phase: "database" | "files";
  operation: "upload" | "download";
  currentFile?: string;
  completedFiles: number;
  totalFiles: number;
  currentBytes?: number;
  totalBytes?: number;
  /** Bytes transferred across the whole current file batch. */
  totalCurrentBytes?: number;
  /** Total bytes for the whole current file batch, when every task size is known. */
  totalTransferBytes?: number;
  message: string;
}

/** Progress callback for upload/download */
export type SyncProgressCallback = (progress: SyncProgress) => void;

/** Remote directory structure constants */
export const REMOTE_ROOT = "/readany";
export const REMOTE_DATA = "/readany/data";
/** Legacy flat layout — still read for migration detection / orphan cleanup. */
export const REMOTE_FILES = "/readany/data/file";
export const REMOTE_COVERS = "/readany/data/cover";
/** New layout: each book lives in its own folder under this root. */
export const REMOTE_BOOKS_ROOT = "/readany/data/books";
/** Knowledge-base assets used by Tiptap documents and custom cards. */
export const REMOTE_KNOWLEDGE_ROOT = "/readany/data/knowledge";
export const REMOTE_KNOWLEDGE_ATTACHMENTS = "/readany/data/knowledge/attachments";
/** Lightweight index for the canonical remote book/cover layout. */
export const REMOTE_FILE_MANIFEST = "/readany/data/file-manifest.json";

/** Known file extensions used to disambiguate cover vs book inside a book folder. */
export const COVER_EXTENSIONS = new Set<string>([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "avif",
  "gif",
  "bmp",
]);

export const BOOK_EXTENSIONS = new Set<string>([
  "epub",
  "pdf",
  "mobi",
  "azw",
  "azw3",
  "cbz",
  "cbr",
  "fb2",
  "txt",
  "umd",
]);
