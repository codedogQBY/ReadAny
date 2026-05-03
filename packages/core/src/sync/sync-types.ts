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
  message: string;
}

/** Progress callback for upload/download */
export type SyncProgressCallback = (progress: SyncProgress) => void;

/** Remote directory structure constants */
export const REMOTE_ROOT = "/readany";
export const REMOTE_DATA = "/readany/data";
export const REMOTE_FILES = "/readany/data/file";
export const REMOTE_COVERS = "/readany/data/cover";
