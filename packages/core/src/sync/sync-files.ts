/**
 * Sync file operations — sync book files and covers between local and remote.
 *
 * Remote layout (new): /readany/data/books/{sanitized-title}-{book.id}/{sanitized-title}.{ext}
 * Local layout (unchanged): {appData}/books/{book.id}.{ext} + {appData}/covers/{book.id}.{ext}
 *
 * Legacy remote layout (still read for migration + orphan cleanup):
 *   /readany/data/file/{book.id}.{ext}
 *   /readany/data/cover/{book.id}.{ext}
 */

import { getDB } from "../db/database";
import { getSyncAdapter } from "./sync-adapter";
import type { ISyncBackend, RemoteFile } from "./sync-backend";
import {
  buildBookFolderName,
  buildBookRemoteCover,
  buildBookRemoteDir,
  buildBookRemoteFile,
  isCoverFileName,
  parseBookFolderName,
  sanitizeBookTitleForFs,
} from "./sync-naming";
import { syncChapterTranslationFiles } from "./chapter-translation-files";
import { parallelLimit } from "./sync-transfer";
import {
  REMOTE_BOOKS_ROOT,
  REMOTE_COVERS,
  REMOTE_FILES,
  type SyncProgress,
} from "./sync-types";

/**
 * Per-phase parallelism for remote file ops. Tuned conservatively to avoid
 * triggering 401-throttle responses on consumer WebDAV providers (Jianguoyun,
 * some NAS) that reject under burst load. See issue #195. Pair with the
 * WebDavClient retry-on-transient-401 in webdav-client.ts.
 */
const UPLOAD_CONCURRENCY = 3;
const DOWNLOAD_CONCURRENCY = 5;
const MIGRATION_CONCURRENCY = 3;
const REMOTE_CLEANUP_CONCURRENCY = 3;

export interface SyncFilesOptions {
  forceUploadAll?: boolean;
  forceDownloadAll?: boolean;
  downloadRemoteBooks?: boolean;
  disableUploads?: boolean;
  disableRemoteDeletes?: boolean;
}

function isAbsoluteOrProtocolPath(path: string): boolean {
  return (
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith("\\\\") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path)
  );
}

function getDirName(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex > 0 ? path.substring(0, separatorIndex) : "";
}

function getExt(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1) : "";
}

type BookRow = {
  id: string;
  file_path: string;
  file_hash: string;
  cover_url: string;
  title: string;
};

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

type BookInfo = {
  book: BookRow;
  fileExt: string;
  coverExt: string;
  localFilePath: string;
  localCoverPath: string;
  remoteDir: string;
  expectedFolderName: string;
  remoteFilePath: string;        // {books root}/{folder}/{title}.{file ext}
  remoteCoverPath: string;       // {books root}/{folder}/{title}.{cover ext}
  legacyRemoteFileName: string;  // {id}.{file ext}, lives in REMOTE_FILES
  legacyRemoteCoverName: string; // {id}.{cover ext}, lives in REMOTE_COVERS
  hasFile: boolean;
  hasCover: boolean;
};

type RemoteListings = {
  bookDirByBookId: Map<string, string>;        // book.id -> existing folder name on remote
  legacyFileNames: Set<string>;                // names inside REMOTE_FILES
  legacyCoverNames: Set<string>;               // names inside REMOTE_COVERS
  /** Folders under REMOTE_BOOKS_ROOT shaped like {title}-{uuid} whose uuid is not in the DB. */
  orphanBookDirs: { folderName: string; bookId: string }[];
  /** Folders under REMOTE_BOOKS_ROOT with no valid uuid suffix and not matched to any book. */
  unknownBookDirs: { folderName: string }[];
};

type MigrationResult = {
  fileAtNew: boolean;
  coverAtNew: boolean;
};

/**
 * Sync book files and covers between local and remote.
 */
export async function syncFiles(
  backend: ISyncBackend,
  onProgress?: (progress: SyncProgress) => void,
  options: SyncFilesOptions = {},
): Promise<{
  filesUploaded: number;
  filesDownloaded: number;
  filesUploadFailed: number;
  filesDownloadFailed: number;
}> {
  const syncFilesStart = Date.now();
  console.log("[Sync] 📁 Starting file sync...");

  const adapter = getSyncAdapter();
  const db = await getDB();
  const { setBookSyncStatus } = await import("../db/database");
  const {
    forceUploadAll = false,
    forceDownloadAll = false,
    downloadRemoteBooks = false,
    disableUploads = false,
    disableRemoteDeletes = false,
  } = options;
  let filesUploaded = 0;
  let filesDownloaded = 0;
  let filesUploadFailed = 0;
  let filesDownloadFailed = 0;

  const books = await db.select<BookRow>(
    "SELECT id, file_path, file_hash, cover_url, title FROM books WHERE deleted_at IS NULL",
    [],
  );

  const appDataDir = await adapter.getAppDataDir();
  const currentBookIds = new Set(books.map((b) => b.id));

  // --- Compute per-book info ---
  const bookInfos: BookInfo[] = books.map((book) => {
    const fileExt = book.file_path ? (getExt(book.file_path) || "epub") : "";
    const coverExt = book.cover_url ? (getExt(book.cover_url) || "jpg") : "";
    const localFilePath = book.file_path
      ? (isAbsoluteOrProtocolPath(book.file_path)
        ? book.file_path
        : adapter.joinPath(appDataDir, book.file_path))
      : "";
    const localCoverPath = book.cover_url
      ? (isAbsoluteOrProtocolPath(book.cover_url)
        ? book.cover_url
        : adapter.joinPath(appDataDir, book.cover_url))
      : "";
    return {
      book,
      fileExt,
      coverExt,
      localFilePath,
      localCoverPath,
      remoteDir: buildBookRemoteDir(book),
      expectedFolderName: buildBookFolderName(book),
      remoteFilePath: fileExt ? buildBookRemoteFile(book, fileExt) : "",
      remoteCoverPath: coverExt ? buildBookRemoteCover(book, coverExt) : "",
      legacyRemoteFileName: fileExt ? `${book.id}.${fileExt}` : "",
      legacyRemoteCoverName: coverExt ? `${book.id}.${coverExt}` : "",
      hasFile: !!book.file_path,
      hasCover: !!book.cover_url,
    };
  });

  // --- Check local file existence in parallel ---
  const allLocalPaths = bookInfos.flatMap((i) => [
    ...(i.hasFile ? [i.localFilePath] : []),
    ...(i.hasCover ? [i.localCoverPath] : []),
  ]);
  const localExistsResults = await Promise.all(allLocalPaths.map((p) => adapter.fileExists(p)));
  const localExistsMap = new Map<string, boolean>();
  allLocalPaths.forEach((p, i) => localExistsMap.set(p, localExistsResults[i]));

  // --- List remote directories (tolerant of failures) ---
  const listings = await loadRemoteListings(backend, currentBookIds);

  // --- Phase 1: migrate per-book remote state (folder rename + legacy → new) ---
  console.log(
    `[Sync] Pre-migration: ${listings.bookDirByBookId.size} book dirs on remote, ` +
    `${listings.legacyFileNames.size} legacy files, ${listings.legacyCoverNames.size} legacy covers`,
  );

  const migrationResults = new Map<string, MigrationResult>();
  const migrationTasks = bookInfos.map((info) => async () => {
    const result = await migrateBookRemoteState(backend, info, listings);
    migrationResults.set(info.book.id, result);
  });
  if (migrationTasks.length > 0) {
    await parallelLimit(migrationTasks, MIGRATION_CONCURRENCY);
  }

  // --- Phase 2: build upload/download task lists based on post-migration state ---
  const uploadTasks: (() => Promise<boolean>)[] = [];
  const downloadTasks: (() => Promise<boolean>)[] = [];

  for (const info of bookInfos) {
    const { book } = info;
    const migration = migrationResults.get(book.id) ?? { fileAtNew: false, coverAtNew: false };

    // --- Book file ---
    if (info.hasFile && info.fileExt) {
      const localExists = localExistsMap.get(info.localFilePath) ?? false;
      const remoteExists = migration.fileAtNew;

      if (!disableUploads && localExists && (forceUploadAll || !remoteExists)) {
        uploadTasks.push(buildUploadFileTask(backend, info));
      }

      if (remoteExists && (forceDownloadAll || (downloadRemoteBooks && !localExists))) {
        downloadTasks.push(buildDownloadFileTask(backend, info, setBookSyncStatus));
      } else if (!localExists && remoteExists) {
        try {
          await setBookSyncStatus(book.id, "remote");
        } catch (e) {
          console.warn(`[Sync] Failed to mark book as remote: ${e}`);
        }
      } else if (!localExists && !remoteExists) {
        // File is missing locally AND remotely — metadata-only orphan. Don't
        // lie to peers by flipping to "remote"; that's the bug that causes
        // mobile to show a download button for a file that doesn't exist
        // anywhere, leading to 404s. Leave syncStatus alone so the row is
        // visible as broken rather than as "downloadable".
        console.warn(
          `[Sync] Book "${book.title}" (${book.id}) has no file locally or remotely — keeping syncStatus as-is. Likely the local file was removed externally before it could be uploaded.`,
        );
      }
    }

    // --- Cover ---
    if (info.hasCover && info.coverExt) {
      const localExists = localExistsMap.get(info.localCoverPath) ?? false;
      const remoteExists = migration.coverAtNew;

      if (!disableUploads && localExists && (forceUploadAll || !remoteExists)) {
        uploadTasks.push(buildUploadCoverTask(backend, info));
      }

      if (remoteExists && (forceDownloadAll || !localExists)) {
        downloadTasks.push(buildDownloadCoverTask(backend, info));
      }
    }
  }

  console.log(
    `[Sync] Task summary: ${bookInfos.length} books, ` +
    `upload: ${uploadTasks.length}, download: ${downloadTasks.length}`,
  );

  if (uploadTasks.length > 0) {
    console.log(
      `[Sync] 📤 Starting upload of ${uploadTasks.length} files (${UPLOAD_CONCURRENCY} concurrent)...`,
    );
    const uploadStart = Date.now();
    let completed = 0;
    const total = uploadTasks.length;
    const tasksWithProgress = uploadTasks.map((task, index) => async () => {
      onProgress?.({
        phase: "files",
        operation: "upload",
        currentFile: `File ${index + 1}`,
        completedFiles: completed,
        totalFiles: total,
        message: `Uploading file ${completed + 1}/${total}...`,
      });
      const result = await task();
      completed++;
      return result;
    });
    const uploadResults = await parallelLimit(tasksWithProgress, UPLOAD_CONCURRENCY);
    filesUploaded = uploadResults.filter((r) => r).length;
    filesUploadFailed = uploadResults.length - filesUploaded;
    console.log(
      `[Sync] ✅ Upload completed: ${filesUploaded} succeeded, ${filesUploadFailed} failed in ${Date.now() - uploadStart}ms`,
    );
  }

  if (downloadTasks.length > 0) {
    console.log(
      `[Sync] 📥 Starting download of ${downloadTasks.length} files (${DOWNLOAD_CONCURRENCY} concurrent)...`,
    );
    const downloadStart = Date.now();
    let completed = 0;
    const total = downloadTasks.length;
    const tasksWithProgress = downloadTasks.map((task, index) => async () => {
      onProgress?.({
        phase: "files",
        operation: "download",
        currentFile: `File ${index + 1}`,
        completedFiles: completed,
        totalFiles: total,
        message: `Downloading file ${completed + 1}/${total}...`,
      });
      const result = await task();
      completed++;
      return result;
    });
    const downloadResults = await parallelLimit(tasksWithProgress, DOWNLOAD_CONCURRENCY);
    filesDownloaded = downloadResults.filter((r) => r).length;
    filesDownloadFailed = downloadResults.length - filesDownloaded;
    console.log(
      `[Sync] ✅ Download completed: ${filesDownloaded} succeeded, ${filesDownloadFailed} failed in ${Date.now() - downloadStart}ms`,
    );
  }

  const translationRows = await loadChapterTranslationRows(db);
  if (translationRows.length > 0) {
    const translationResult = await syncChapterTranslationFiles(backend, translationRows, {
      forceUploadAll,
      forceDownloadAll,
      disableUploads,
    });
    filesUploaded += translationResult.uploaded;
    filesDownloaded += translationResult.downloaded;
    filesUploadFailed += translationResult.uploadFailed;
    filesDownloadFailed += translationResult.downloadFailed;
  }

  // --- Phase 3: orphan cleanup ---
  if (!disableRemoteDeletes) {
    await cleanupRemoteOrphans(backend, listings, currentBookIds);
  }
  await cleanupLocalOrphans(adapter, appDataDir, currentBookIds);

  console.log(`[Sync] ✅ File sync completed in ${Date.now() - syncFilesStart}ms`);
  return { filesUploaded, filesDownloaded, filesUploadFailed, filesDownloadFailed };
}

/* ─────────────────────────  helpers  ───────────────────────── */

async function loadChapterTranslationRows(
  db: Awaited<ReturnType<typeof getDB>>,
): Promise<ChapterTranslationFileRow[]> {
  try {
    const rows = await db.select<ChapterTranslationFileRow>(
      `SELECT
        ct.id,
        ct.book_id,
        b.title AS book_title,
        ct.section_index,
        ct.source_lang,
        ct.target_lang,
        ct.provider,
        ct.model,
        ct.source_hash,
        ct.paragraphs,
        ct.original_visible,
        ct.translation_visible,
        ct.created_at,
        ct.updated_at
      FROM chapter_translations ct
      JOIN books b ON b.id = ct.book_id
      WHERE b.deleted_at IS NULL`,
      [],
    );
    return rows.filter((row) => typeof row.paragraphs === "string" || row.paragraphs === null);
  } catch (error) {
    console.warn("[Sync] Failed to load chapter translations for file sync:", error);
    return [];
  }
}

async function loadRemoteListings(
  backend: ISyncBackend,
  currentBookIds: Set<string>,
): Promise<RemoteListings> {
  const settled = await Promise.allSettled([
    backend.listDir(REMOTE_BOOKS_ROOT),
    backend.listDir(REMOTE_FILES),
    backend.listDir(REMOTE_COVERS),
  ]);

  const bookDirs: RemoteFile[] = settled[0].status === "fulfilled" ? settled[0].value : [];
  const legacyFiles: RemoteFile[] = settled[1].status === "fulfilled" ? settled[1].value : [];
  const legacyCovers: RemoteFile[] = settled[2].status === "fulfilled" ? settled[2].value : [];

  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === "rejected") {
      const dirs = [REMOTE_BOOKS_ROOT, REMOTE_FILES, REMOTE_COVERS];
      console.warn(
        `[Sync] Failed to list remote dir ${dirs[i]}, assuming empty:`,
        (settled[i] as PromiseRejectedResult).reason,
      );
    }
  }

  const allDirNames = bookDirs.filter((e) => e.isDirectory).map((e) => e.name);

  // Match folders to known book ids by `endsWith(-{id})`. This works for any id format,
  // including non-UUID ids that may appear during development or in tests.
  const bookDirByBookId = new Map<string, string>();
  const matched = new Set<string>();
  for (const id of currentBookIds) {
    const suffix = `-${id}`;
    const match = allDirNames.find((name) => name.endsWith(suffix) && !matched.has(name));
    if (match) {
      bookDirByBookId.set(id, match);
      matched.add(match);
    }
  }

  const orphanBookDirs: { folderName: string; bookId: string }[] = [];
  const unknownBookDirs: { folderName: string }[] = [];
  for (const name of allDirNames) {
    if (matched.has(name)) continue;
    const parsedId = parseBookFolderName(name);
    if (parsedId) {
      orphanBookDirs.push({ folderName: name, bookId: parsedId });
    } else {
      unknownBookDirs.push({ folderName: name });
    }
  }

  return {
    bookDirByBookId,
    legacyFileNames: new Set(legacyFiles.filter((f) => !f.isDirectory).map((f) => f.name)),
    legacyCoverNames: new Set(legacyCovers.filter((f) => !f.isDirectory).map((f) => f.name)),
    orphanBookDirs,
    unknownBookDirs,
  };
}

/**
 * Bring the remote state for one book up to the current layout:
 *   - If a folder exists under a stale name (title changed) → rename folder contents.
 *   - If only legacy `/file/{id}.ext` / `/cover/{id}.ext` exist → move them into the per-book folder.
 *   - Otherwise inspect the existing folder to confirm what is already at the expected new path.
 *
 * Returns whether file/cover are now present at their *new* canonical paths.
 */
async function migrateBookRemoteState(
  backend: ISyncBackend,
  info: BookInfo,
  listings: RemoteListings,
): Promise<MigrationResult> {
  const { book } = info;
  const existingFolderName = listings.bookDirByBookId.get(book.id);
  let fileAtNew = false;
  let coverAtNew = false;

  if (existingFolderName) {
    if (existingFolderName !== info.expectedFolderName) {
      // Title changed (or sanitized form changed): rename folder by moving every child.
      const oldDir = `${REMOTE_BOOKS_ROOT}/${existingFolderName}`;
      let oldFiles: RemoteFile[] = [];
      try {
        oldFiles = await backend.listDir(oldDir);
      } catch (e) {
        console.warn(`[Sync] Failed to list old book folder ${oldDir}:`, e);
      }
      for (const f of oldFiles) {
        if (f.isDirectory) continue;
        const ext = getExt(f.name);
        if (!ext) continue;
        const cover = isCoverFileName(f.name);
        const target = cover
          ? buildBookRemoteCover(book, ext)
          : buildBookRemoteFile(book, ext);
        try {
          await backend.move(`${oldDir}/${f.name}`, target);
          if (cover) coverAtNew = true;
          else fileAtNew = true;
        } catch (e) {
          console.warn(`[Sync] Folder-rename MOVE failed for ${book.id} (${f.name}):`, e);
          if (await backend.exists(target)) {
            try { await backend.delete(`${oldDir}/${f.name}`); } catch {}
            if (cover) coverAtNew = true;
            else fileAtNew = true;
          }
        }
      }
      try { await backend.delete(oldDir); } catch {}
      // Update in-memory map so orphan cleanup downstream doesn't see this as unknown.
      listings.bookDirByBookId.delete(book.id);
      listings.bookDirByBookId.set(book.id, info.expectedFolderName);
    } else {
      // Folder name matches. Peek inside to verify which files are present.
      const dir = `${REMOTE_BOOKS_ROOT}/${existingFolderName}`;
      let current: RemoteFile[] = [];
      try {
        current = await backend.listDir(dir);
      } catch (e) {
        console.warn(`[Sync] Failed to list book folder ${dir}:`, e);
      }
      const sanitized = sanitizeBookTitleForFs(book.title);
      const expectedFileName = info.fileExt ? `${sanitized}.${info.fileExt}` : "";
      const expectedCoverName = info.coverExt ? `${sanitized}.${info.coverExt}` : "";
      for (const f of current) {
        if (f.isDirectory) continue;
        if (expectedFileName && f.name === expectedFileName) fileAtNew = true;
        if (expectedCoverName && f.name === expectedCoverName) coverAtNew = true;
      }
    }
  }

  // Migrate legacy file → new path if needed.
  if (!fileAtNew && info.fileExt && listings.legacyFileNames.has(info.legacyRemoteFileName)) {
    const legacy = `${REMOTE_FILES}/${info.legacyRemoteFileName}`;
    try {
      await backend.move(legacy, info.remoteFilePath);
      fileAtNew = true;
      console.log(`[Sync] 🔁 Migrated legacy file → ${info.remoteFilePath}`);
    } catch (e) {
      console.warn(`[Sync] Legacy file MOVE failed for ${book.id}:`, e);
      if (await backend.exists(info.remoteFilePath)) {
        try {
          await backend.delete(legacy);
          fileAtNew = true;
          console.log(`[Sync] 🧹 Deleted redundant legacy file ${info.legacyRemoteFileName}`);
        } catch {}
      }
    }
  }

  if (!coverAtNew && info.coverExt && listings.legacyCoverNames.has(info.legacyRemoteCoverName)) {
    const legacy = `${REMOTE_COVERS}/${info.legacyRemoteCoverName}`;
    try {
      await backend.move(legacy, info.remoteCoverPath);
      coverAtNew = true;
      console.log(`[Sync] 🔁 Migrated legacy cover → ${info.remoteCoverPath}`);
    } catch (e) {
      console.warn(`[Sync] Legacy cover MOVE failed for ${book.id}:`, e);
      if (await backend.exists(info.remoteCoverPath)) {
        try {
          await backend.delete(legacy);
          coverAtNew = true;
          console.log(`[Sync] 🧹 Deleted redundant legacy cover ${info.legacyRemoteCoverName}`);
        } catch {}
      }
    }
  }

  return { fileAtNew, coverAtNew };
}

function buildUploadFileTask(backend: ISyncBackend, info: BookInfo): () => Promise<boolean> {
  return async () => {
    const adapter = getSyncAdapter();
    const taskStart = Date.now();
    const bookTitle = info.book.title || "未知书籍";
    try {
      console.log(`[Sync] 📤 Uploading book: ${bookTitle} → ${info.remoteFilePath}`);
      const data = await adapter.readFileBytes(info.localFilePath);
      const sizeMB = (data.length / 1024 / 1024).toFixed(2);
      await backend.put(info.remoteFilePath, data);
      console.log(`[Sync] ✓ Uploaded "${bookTitle}" (${sizeMB} MB) in ${Date.now() - taskStart}ms`);
      return true;
    } catch (e) {
      console.log(`[Sync] ✗ Failed to upload "${bookTitle}": ${e}`);
      return false;
    }
  };
}

function buildDownloadFileTask(
  backend: ISyncBackend,
  info: BookInfo,
  setBookSyncStatus: (id: string, status: "local" | "remote") => Promise<void>,
): () => Promise<boolean> {
  return async () => {
    const adapter = getSyncAdapter();
    const taskStart = Date.now();
    const bookTitle = info.book.title || "未知书籍";
    try {
      console.log(`[Sync] 📥 Downloading book: ${bookTitle} ← ${info.remoteFilePath}`);
      const data = await backend.get(info.remoteFilePath);
      const sizeMB = (data.length / 1024 / 1024).toFixed(2);
      const dir = getDirName(info.localFilePath);
      if (dir) await adapter.ensureDir(dir);
      await adapter.writeFileBytes(info.localFilePath, data);
      await setBookSyncStatus(info.book.id, "local");
      console.log(`[Sync] ✓ Downloaded "${bookTitle}" (${sizeMB} MB) in ${Date.now() - taskStart}ms`);
      return true;
    } catch (e) {
      console.log(`[Sync] ✗ Failed to download "${bookTitle}": ${e}`);
      return false;
    }
  };
}

function buildUploadCoverTask(backend: ISyncBackend, info: BookInfo): () => Promise<boolean> {
  return async () => {
    const adapter = getSyncAdapter();
    const taskStart = Date.now();
    const bookTitle = info.book.title || "未知书籍";
    try {
      console.log(`[Sync] 📤 Uploading cover: ${bookTitle} → ${info.remoteCoverPath}`);
      const data = await adapter.readFileBytes(info.localCoverPath);
      const sizeKB = (data.length / 1024).toFixed(2);
      await backend.put(info.remoteCoverPath, data);
      console.log(`[Sync] ✓ Uploaded cover "${bookTitle}" (${sizeKB} KB) in ${Date.now() - taskStart}ms`);
      return true;
    } catch (e) {
      console.log(`[Sync] ✗ Failed to upload cover "${bookTitle}": ${e}`);
      return false;
    }
  };
}

function buildDownloadCoverTask(backend: ISyncBackend, info: BookInfo): () => Promise<boolean> {
  return async () => {
    const adapter = getSyncAdapter();
    const taskStart = Date.now();
    const bookTitle = info.book.title || "未知书籍";
    try {
      console.log(`[Sync] 📥 Downloading cover: ${bookTitle} ← ${info.remoteCoverPath}`);
      const data = await backend.get(info.remoteCoverPath);
      const sizeKB = (data.length / 1024).toFixed(2);
      const dir = getDirName(info.localCoverPath);
      if (dir) await adapter.ensureDir(dir);
      await adapter.writeFileBytes(info.localCoverPath, data);
      console.log(`[Sync] ✓ Downloaded cover "${bookTitle}" (${sizeKB} KB) in ${Date.now() - taskStart}ms`);
      return true;
    } catch (e) {
      console.log(`[Sync] ✗ Failed to download cover "${bookTitle}": ${e}`);
      return false;
    }
  };
}

async function cleanupRemoteOrphans(
  backend: ISyncBackend,
  listings: RemoteListings,
  currentBookIds: Set<string>,
): Promise<void> {
  const tasks: (() => Promise<boolean>)[] = [];

  // New-layout orphans: per-book folder shaped like {title}-{uuid} whose uuid isn't in DB.
  for (const orphan of listings.orphanBookDirs) {
    if (currentBookIds.has(orphan.bookId)) continue; // shouldn't happen, but guard.
    const dir = `${REMOTE_BOOKS_ROOT}/${orphan.folderName}`;
    tasks.push(async () => {
      try {
        let children: RemoteFile[] = [];
        try { children = await backend.listDir(dir); } catch {}
        for (const c of children) {
          if (c.isDirectory) continue;
          try { await backend.delete(`${dir}/${c.name}`); } catch {}
        }
        try { await backend.delete(dir); } catch {}
        console.log(`[Sync] 🗑️ Deleted remote orphan book folder: ${orphan.folderName}`);
        return true;
      } catch (e) {
        console.warn(`[Sync] Failed to delete remote orphan folder ${orphan.folderName}:`, e);
        return false;
      }
    });
  }

  // Unknown-shape folders under REMOTE_BOOKS_ROOT — leave them alone (could be user-placed content).
  if (listings.unknownBookDirs.length > 0) {
    console.log(
      `[Sync] ⚠️ Skipped ${listings.unknownBookDirs.length} folders under books root with no valid uuid suffix.`,
    );
  }

  // Legacy orphans (file/cover dirs): files for books no longer in DB → delete.
  for (const fileName of listings.legacyFileNames) {
    const bookId = fileName.slice(0, fileName.lastIndexOf(".")) || "";
    if (!bookId || !currentBookIds.has(bookId)) {
      tasks.push(async () => {
        try {
          await backend.delete(`${REMOTE_FILES}/${fileName}`);
          console.log(`[Sync] 🗑️ Deleted legacy orphan file: ${fileName}`);
          return true;
        } catch (e) {
          console.warn(`[Sync] Failed to delete legacy orphan file ${fileName}:`, e);
          return false;
        }
      });
    }
  }

  for (const fileName of listings.legacyCoverNames) {
    const bookId = fileName.slice(0, fileName.lastIndexOf(".")) || "";
    if (!bookId || !currentBookIds.has(bookId)) {
      tasks.push(async () => {
        try {
          await backend.delete(`${REMOTE_COVERS}/${fileName}`);
          console.log(`[Sync] 🗑️ Deleted legacy orphan cover: ${fileName}`);
          return true;
        } catch (e) {
          console.warn(`[Sync] Failed to delete legacy orphan cover ${fileName}:`, e);
          return false;
        }
      });
    }
  }

  if (tasks.length > 0) {
    console.log(`[Sync] 🧹 Cleaning up ${tasks.length} remote orphans...`);
    await parallelLimit(tasks, REMOTE_CLEANUP_CONCURRENCY);
  }
}

async function cleanupLocalOrphans(
  adapter: ReturnType<typeof getSyncAdapter>,
  appDataDir: string,
  currentBookIds: Set<string>,
): Promise<void> {
  const tasks: (() => Promise<boolean>)[] = [];
  const [localManagedBookFiles, localManagedCovers] = await Promise.all([
    adapter.listFiles(adapter.joinPath(appDataDir, "books")),
    adapter.listFiles(adapter.joinPath(appDataDir, "covers")),
  ]);

  const idFromLocalName = (name: string): string | null => {
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return null;
    return name.slice(0, dot);
  };

  for (const fileName of localManagedBookFiles) {
    const bookId = idFromLocalName(fileName);
    if (bookId && !currentBookIds.has(bookId)) {
      const localPath = adapter.joinPath(appDataDir, "books", fileName);
      tasks.push(async () => {
        try {
          await adapter.deleteFile(localPath);
          console.log(`[Sync] 🗑️ Deleted local orphan book file: ${fileName}`);
          return true;
        } catch (e) {
          console.warn(`[Sync] Failed to delete local orphan ${fileName}:`, e);
          return false;
        }
      });
    }
  }

  for (const fileName of localManagedCovers) {
    const bookId = idFromLocalName(fileName);
    if (bookId && !currentBookIds.has(bookId)) {
      const localPath = adapter.joinPath(appDataDir, "covers", fileName);
      tasks.push(async () => {
        try {
          await adapter.deleteFile(localPath);
          console.log(`[Sync] 🗑️ Deleted local orphan cover: ${fileName}`);
          return true;
        } catch (e) {
          console.warn(`[Sync] Failed to delete local orphan cover ${fileName}:`, e);
          return false;
        }
      });
    }
  }

  if (tasks.length > 0) {
    console.log(`[Sync] 🧹 Cleaning up ${tasks.length} local orphans...`);
    await parallelLimit(tasks, 5);
  }
}

/**
 * Outcome of an on-demand download.
 *
 * - `"ok"`        — file downloaded and written locally.
 * - `"not-found"` — exhausted every candidate path on the remote; the file
 *                   isn't there. Most likely the desktop never uploaded it
 *                   (e.g. the local copy was missing at push time).
 * - `"error"`     — transient failure (network, permission, disk). Retrying
 *                   later may succeed.
 */
export type DownloadBookOutcome = "ok" | "not-found" | "error";

/**
 * Download a single book file on-demand.
 * Tries the new layout first; falls back to the legacy flat path so devices that have not yet
 * pushed (and therefore not yet migrated) can still serve the book.
 */
export async function downloadBookFile(
  backend: ISyncBackend,
  bookId: string,
  filePath: string,
  onProgress?: (progress: { downloaded: number; total: number }) => void,
): Promise<DownloadBookOutcome> {
  const adapter = getSyncAdapter();
  const { setBookSyncStatus } = await import("../db/database");

  try {
    const ext = getExt(filePath) || "epub";

    // Resolve book title for new-path computation.
    const db = await getDB();
    const rows = await db.select<{ id: string; title: string }>(
      "SELECT id, title FROM books WHERE id = ?",
      [bookId],
    );
    const book = rows[0] ?? null;

    const newPath = book ? buildBookRemoteFile(book, ext) : "";
    const legacyPath = `${REMOTE_FILES}/${bookId}.${ext}`;

    onProgress?.({ downloaded: 0, total: 100 });

    // Use progress-aware download if backend supports it
    const getWithProgress = (p: string) => {
      if (backend.getWithProgress) {
        return backend.getWithProgress(p, (loaded, total) => {
          if (total > 0) onProgress?.({ downloaded: loaded, total });
        });
      }
      return backend.get(p);
    };

    // Track whether *every* failure we saw was a 404. If so, the remote
    // genuinely doesn't have the file. If at least one attempt failed with
    // some other error, it's an "error" outcome — the caller can retry.
    let sawNon404Error = false;
    const noteFailure = (e: unknown) => {
      const msg = (e as { message?: string })?.message ?? "";
      if (!/404|not found/i.test(msg)) sawNon404Error = true;
    };

    let data: Uint8Array | null = null;
    if (newPath) {
      try {
        data = await getWithProgress(newPath);
        console.log(`[Sync] Downloaded ${newPath} (new layout)`);
      } catch (e) {
        noteFailure(e);
        const msg = (e as { message?: string })?.message ?? "";
        if (!/404|not found/i.test(msg)) {
          console.warn(`[Sync] New-layout fetch failed (${msg}); trying legacy path`);
        }
      }
    }
    if (!data) {
      try {
        data = await getWithProgress(legacyPath);
        console.log(`[Sync] Downloaded ${legacyPath} (legacy layout)`);
      } catch (e) {
        noteFailure(e);
        const msg = (e as { message?: string })?.message ?? "";
        if (!/404|not found/i.test(msg)) {
          console.warn(`[Sync] Legacy fetch failed (${msg}); trying title-based fallback`);
        }
      }
    }
    // Title-based fallback: same book imported separately on each device gets different UUIDs.
    // The DB sync brings both rows over, but the file is only on one id. Match by sanitized title.
    if (!data && book?.title) {
      try {
        const sanitizedTitle = sanitizeBookTitleForFs(book.title);
        const entries = await backend.listDir(REMOTE_BOOKS_ROOT);
        const candidates = entries.filter(
          (e) =>
            e.isDirectory &&
            e.name.startsWith(`${sanitizedTitle}-`) &&
            parseBookFolderName(e.name) !== null,
        );
        for (const folder of candidates) {
          const folderPath = `${REMOTE_BOOKS_ROOT}/${folder.name}`;
          const guess = `${folderPath}/${sanitizedTitle}.${ext}`;
          try {
            data = await getWithProgress(guess);
            console.log(`[Sync] Downloaded via title match: ${guess}`);
            break;
          } catch {
            // Try scanning inside the folder for any file with matching extension
            try {
              const inside = await backend.listDir(folderPath);
              const hit = inside.find(
                (f) => !f.isDirectory && getExt(f.name).toLowerCase() === ext.toLowerCase(),
              );
              if (hit) {
                const hitPath = `${folderPath}/${hit.name}`;
                data = await getWithProgress(hitPath);
                console.log(`[Sync] Downloaded via folder scan: ${hitPath}`);
                break;
              }
            } catch {}
          }
        }
      } catch (e) {
        noteFailure(e);
        console.warn(`[Sync] Title-based fallback failed:`, e);
      }
    }
    if (!data) {
      console.log(
        `[Sync] Book file not found on remote (new=${newPath}, legacy=${legacyPath}, title=${book?.title ?? "?"})`,
      );
      await setBookSyncStatus(bookId, "remote");
      return sawNon404Error ? "error" : "not-found";
    }

    const sizeMB = (data.length / 1024 / 1024).toFixed(2);
    console.log(`[Sync] Book ${bookId} fetched (${sizeMB} MB)`);

    const appDataDir = await adapter.getAppDataDir();
    const localPath = isAbsoluteOrProtocolPath(filePath)
      ? filePath
      : adapter.joinPath(appDataDir, filePath);
    const dir = getDirName(localPath);
    if (dir) await adapter.ensureDir(dir);
    await adapter.writeFileBytes(localPath, data);

    onProgress?.({ downloaded: 100, total: 100 });
    await setBookSyncStatus(bookId, "local");
    console.log(`[Sync] ✓ Book ${bookId} downloaded and marked as local`);
    return "ok";
  } catch (e) {
    console.error(`[Sync] Failed to download book ${bookId}:`, e);
    await setBookSyncStatus(bookId, "remote");
    return "error";
  }
}
