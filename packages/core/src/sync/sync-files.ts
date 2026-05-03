/**
 * Sync file operations — sync book files and covers between local and remote.
 */

import { getDB } from "../db/database";
import { getSyncAdapter } from "./sync-adapter";
import type { ISyncBackend } from "./sync-backend";
import { parallelLimit } from "./sync-transfer";
import { REMOTE_COVERS, REMOTE_FILES, type SyncProgress } from "./sync-types";

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

/**
 * Sync book files and covers between local and remote.
 * Files are downloaded in parallel (up to 8 concurrent downloads) for better performance.
 */
export async function syncFiles(
  backend: ISyncBackend,
  onProgress?: (progress: SyncProgress) => void,
  options: SyncFilesOptions = {},
): Promise<{
  filesUploaded: number;
  filesDownloaded: number;
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

  // Get all books from DB
  const books = await db.select<{
    id: string;
    file_path: string;
    file_hash: string;
    cover_url: string;
    title: string;
  }>("SELECT id, file_path, file_hash, cover_url, title FROM books", []);

  const appDataDir = await adapter.getAppDataDir();
  const currentBookIds = new Set(books.map((book) => book.id));

  const getManagedAssetBookId = (fileName: string): string | null => {
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex <= 0) return null;
    return fileName.slice(0, dotIndex);
  };

  // --- Pre-compute all local paths and remote names ---
  type BookFileInfo = {
    book: { id: string; file_path: string; file_hash: string; cover_url: string; title: string };
    localPath: string;
    remoteName: string;
    ext: string;
  };
  type CoverFileInfo = {
    book: { id: string; cover_url: string; title: string };
    coverLocalPath: string;
    coverRemoteName: string;
  };

  const bookFileInfos: BookFileInfo[] = [];
  for (const book of books) {
    if (!book.file_path) continue;
    const localPath = isAbsoluteOrProtocolPath(book.file_path)
      ? book.file_path
      : adapter.joinPath(appDataDir, book.file_path);
    const ext = book.file_path.split(".").pop() || "epub";
    const remoteName = `${book.id}.${ext}`;
    bookFileInfos.push({ book, localPath, remoteName, ext });
  }

  const coverFileInfos: CoverFileInfo[] = [];
  for (const book of books) {
    if (!book.cover_url) continue;
    const coverLocalPath = isAbsoluteOrProtocolPath(book.cover_url)
      ? book.cover_url
      : adapter.joinPath(appDataDir, book.cover_url);
    const coverExt = book.cover_url.split(".").pop() || "jpg";
    const coverRemoteName = `${book.id}.${coverExt}`;
    coverFileInfos.push({ book, coverLocalPath, coverRemoteName });
  }

  // --- Batch check all local file existence in parallel ---
  const allLocalPaths = [
    ...bookFileInfos.map((info) => info.localPath),
    ...coverFileInfos.map((info) => info.coverLocalPath),
  ];
  const existsResults = await Promise.all(allLocalPaths.map((p) => adapter.fileExists(p)));
  const localExistsMap = new Map<string, boolean>();
  allLocalPaths.forEach((p, i) => localExistsMap.set(p, existsResults[i]));

  // --- Fetch remote file/cover listings in parallel ---
  const [remoteFiles, remoteCovers] = await Promise.all([
    backend.listDir(REMOTE_FILES),
    backend.listDir(REMOTE_COVERS),
  ]);
  const remoteFileNames = new Set(remoteFiles.filter((f) => !f.isDirectory).map((f) => f.name));
  const remoteCoverNames = new Set(remoteCovers.filter((f) => !f.isDirectory).map((f) => f.name));

  // Collect upload and download tasks
  const uploadTasks: (() => Promise<boolean>)[] = [];
  const downloadTasks: (() => Promise<boolean>)[] = [];

  // --- Build book file tasks ---
  for (const { book, localPath, remoteName } of bookFileInfos) {
    const localExists = localExistsMap.get(localPath) ?? false;
    const remoteExists = remoteFileNames.has(remoteName);

    if (!disableUploads && localExists && (forceUploadAll || !remoteExists)) {
      uploadTasks.push(async () => {
        const taskStart = Date.now();
        const bookTitle = book.title || "未知书籍";
        try {
          console.log(`[Sync] 📤 Uploading book: ${bookTitle} (${remoteName})`);
          const data = await adapter.readFileBytes(localPath);
          const sizeMB = (data.length / 1024 / 1024).toFixed(2);
          await backend.put(`${REMOTE_FILES}/${remoteName}`, data);
          console.log(
            `[Sync] ✓ Uploaded "${bookTitle}" (${sizeMB} MB) in ${Date.now() - taskStart}ms`,
          );
          return true;
        } catch (e) {
          console.log(`[Sync] ✗ Failed to upload "${bookTitle}": ${e}`);
          return false;
        }
      });
    }

    if (remoteExists && (forceDownloadAll || (downloadRemoteBooks && !localExists))) {
      downloadTasks.push(async () => {
        const taskStart = Date.now();
        const bookTitle = book.title || "未知书籍";
        try {
          console.log(`[Sync] 📥 Downloading book: ${bookTitle} (${remoteName})`);
          const data = await backend.get(`${REMOTE_FILES}/${remoteName}`);
          const sizeMB = (data.length / 1024 / 1024).toFixed(2);
          const dir = localPath.substring(0, localPath.lastIndexOf("/"));
          if (dir) await adapter.ensureDir(dir);
          await adapter.writeFileBytes(localPath, data);
          await setBookSyncStatus(book.id, "local");
          console.log(
            `[Sync] ✓ Downloaded "${bookTitle}" (${sizeMB} MB) in ${Date.now() - taskStart}ms`,
          );
          return true;
        } catch (e) {
          console.log(`[Sync] ✗ Failed to download "${bookTitle}": ${e}`);
          return false;
        }
      });
    } else if (!localExists && remoteExists) {
      try {
        await setBookSyncStatus(book.id, "remote");
        const bookTitle = book.title || "未知书籍";
        console.log(`[Sync] Marked "${bookTitle}" as remote (on-demand download)`);
      } catch (e) {
        console.warn(`[Sync] Failed to mark book as remote: ${e}`);
      }
    } else if (!localExists && !remoteExists) {
      try {
        await setBookSyncStatus(book.id, "remote");
        const bookTitle = book.title || "未知书籍";
        console.log(`[Sync] Marked "${bookTitle}" as remote (file missing on both sides)`);
      } catch (e) {
        console.warn(`[Sync] Failed to mark book as remote: ${e}`);
      }
    }
  }

  // --- Build cover tasks ---
  for (const { book, coverLocalPath, coverRemoteName } of coverFileInfos) {
    const localExists = localExistsMap.get(coverLocalPath) ?? false;
    const remoteExists = remoteCoverNames.has(coverRemoteName);

    if (!disableUploads && localExists && (forceUploadAll || !remoteExists)) {
      uploadTasks.push(async () => {
        const taskStart = Date.now();
        const bookTitle = book.title || "未知书籍";
        try {
          console.log(`[Sync] 📤 Uploading cover: ${bookTitle} (${coverRemoteName})`);
          const data = await adapter.readFileBytes(coverLocalPath);
          const sizeKB = (data.length / 1024).toFixed(2);
          await backend.put(`${REMOTE_COVERS}/${coverRemoteName}`, data);
          console.log(
            `[Sync] ✓ Uploaded cover "${bookTitle}" (${sizeKB} KB) in ${Date.now() - taskStart}ms`,
          );
          return true;
        } catch (e) {
          console.log(`[Sync] ✗ Failed to upload cover "${bookTitle}": ${e}`);
          return false;
        }
      });
    }

    if (remoteExists && (forceDownloadAll || !localExists)) {
      downloadTasks.push(async () => {
        const taskStart = Date.now();
        const bookTitle = book.title || "未知书籍";
        try {
          console.log(`[Sync] 📥 Downloading cover: ${bookTitle} (${coverRemoteName})`);
          const data = await backend.get(`${REMOTE_COVERS}/${coverRemoteName}`);
          const sizeKB = (data.length / 1024).toFixed(2);
          const dir = coverLocalPath.substring(0, coverLocalPath.lastIndexOf("/"));
          if (dir) await adapter.ensureDir(dir);
          await adapter.writeFileBytes(coverLocalPath, data);
          console.log(
            `[Sync] ✓ Downloaded cover "${bookTitle}" (${sizeKB} KB) in ${Date.now() - taskStart}ms`,
          );
          return true;
        } catch (e) {
          console.log(`[Sync] ✗ Failed to download cover "${bookTitle}": ${e}`);
          return false;
        }
      });
    }
  }

  // Execute uploads in parallel (limit: 5 concurrent)
  if (uploadTasks.length > 0) {
    console.log(`[Sync] 📤 Starting upload of ${uploadTasks.length} files (5 concurrent)...`);
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
    const uploadResults = await parallelLimit(tasksWithProgress, 5);
    filesUploaded = uploadResults.filter((r) => r).length;
    const uploadFailed = uploadResults.length - filesUploaded;
    console.log(
      `[Sync] ✅ Upload completed: ${filesUploaded} succeeded, ${uploadFailed} failed in ${Date.now() - uploadStart}ms`,
    );
  }

  // Execute downloads in parallel (limit: 8 concurrent)
  if (downloadTasks.length > 0) {
    console.log(`[Sync] 📥 Starting download of ${downloadTasks.length} files (8 concurrent)...`);
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
    const downloadResults = await parallelLimit(tasksWithProgress, 8);
    filesDownloaded = downloadResults.filter((r) => r).length;
    const downloadFailed = downloadResults.length - filesDownloaded;
    console.log(
      `[Sync] ✅ Download completed: ${filesDownloaded} succeeded, ${downloadFailed} failed in ${Date.now() - downloadStart}ms`,
    );
  }

  // Clean up remote orphaned assets for books that no longer exist in the merged DB.
  const remoteDeleteTasks: (() => Promise<boolean>)[] = [];
  if (!disableRemoteDeletes) {
    for (const file of remoteFiles) {
      if (file.isDirectory) continue;
      const bookId = getManagedAssetBookId(file.name);
      if (bookId && !currentBookIds.has(bookId)) {
        remoteDeleteTasks.push(async () => {
          try {
            await backend.delete(`${REMOTE_FILES}/${file.name}`);
            console.log(`[Sync] 🗑️ Deleted remote orphaned book file: ${file.name}`);
            return true;
          } catch (e) {
            console.warn(`[Sync] Failed to delete remote orphaned book file ${file.name}:`, e);
            return false;
          }
        });
      }
    }
    for (const file of remoteCovers) {
      if (file.isDirectory) continue;
      const bookId = getManagedAssetBookId(file.name);
      if (bookId && !currentBookIds.has(bookId)) {
        remoteDeleteTasks.push(async () => {
          try {
            await backend.delete(`${REMOTE_COVERS}/${file.name}`);
            console.log(`[Sync] 🗑️ Deleted remote orphaned cover: ${file.name}`);
            return true;
          } catch (e) {
            console.warn(`[Sync] Failed to delete remote orphaned cover ${file.name}:`, e);
            return false;
          }
        });
      }
    }

    if (remoteDeleteTasks.length > 0) {
      console.log(`[Sync] 🧹 Cleaning up ${remoteDeleteTasks.length} remote orphaned assets...`);
      await parallelLimit(remoteDeleteTasks, 5);
    }
  }

  // Also clean up app-managed local orphaned assets after DB sync.
  const localDeleteTasks: (() => Promise<boolean>)[] = [];
  const [localManagedBookFiles, localManagedCovers] = await Promise.all([
    adapter.listFiles(adapter.joinPath(appDataDir, "books")),
    adapter.listFiles(adapter.joinPath(appDataDir, "covers")),
  ]);

  for (const fileName of localManagedBookFiles) {
    const bookId = getManagedAssetBookId(fileName);
    if (bookId && !currentBookIds.has(bookId)) {
      const localPath = adapter.joinPath(appDataDir, "books", fileName);
      localDeleteTasks.push(async () => {
        try {
          await adapter.deleteFile(localPath);
          console.log(`[Sync] 🗑️ Deleted local orphaned book file: ${fileName}`);
          return true;
        } catch (e) {
          console.warn(`[Sync] Failed to delete local orphaned book file ${fileName}:`, e);
          return false;
        }
      });
    }
  }

  for (const fileName of localManagedCovers) {
    const bookId = getManagedAssetBookId(fileName);
    if (bookId && !currentBookIds.has(bookId)) {
      const localPath = adapter.joinPath(appDataDir, "covers", fileName);
      localDeleteTasks.push(async () => {
        try {
          await adapter.deleteFile(localPath);
          console.log(`[Sync] 🗑️ Deleted local orphaned cover: ${fileName}`);
          return true;
        } catch (e) {
          console.warn(`[Sync] Failed to delete local orphaned cover ${fileName}:`, e);
          return false;
        }
      });
    }
  }

  if (localDeleteTasks.length > 0) {
    console.log(`[Sync] 🧹 Cleaning up ${localDeleteTasks.length} local orphaned assets...`);
    await parallelLimit(localDeleteTasks, 5);
  }

  console.log(`[Sync] ✅ File sync completed in ${Date.now() - syncFilesStart}ms`);
  return { filesUploaded, filesDownloaded };
}

/**
 * Download a single book file on-demand.
 * Used when user opens a book marked as "remote".
 */
export async function downloadBookFile(
  backend: ISyncBackend,
  bookId: string,
  filePath: string,
  onProgress?: (progress: { downloaded: number; total: number }) => void,
): Promise<boolean> {
  const adapter = getSyncAdapter();
  const { setBookSyncStatus } = await import("../db/database");

  try {
    // Determine remote name
    const ext = filePath.split(".").pop() || "epub";
    const remoteName = `${bookId}.${ext}`;

    // Check if file exists on remote
    const remotePath = `${REMOTE_FILES}/${remoteName}`;
    const exists = await backend.exists(remotePath);
    if (!exists) {
      console.log(`[Sync] Book file not found on remote: ${remotePath}`);
      await setBookSyncStatus(bookId, "remote");
      return false;
    }

    // Download file
    console.log(`[Sync] Downloading book file: ${remoteName}`);
    onProgress?.({ downloaded: 0, total: 100 });

    const data = await backend.get(remotePath);
    const sizeMB = (data.length / 1024 / 1024).toFixed(2);
    console.log(`[Sync] Downloaded ${remoteName} (${sizeMB} MB)`);

    // Save to local
    const appDataDir = await adapter.getAppDataDir();
    const localPath = isAbsoluteOrProtocolPath(filePath)
      ? filePath
      : adapter.joinPath(appDataDir, filePath);

    const dir = getDirName(localPath);
    if (dir) await adapter.ensureDir(dir);
    await adapter.writeFileBytes(localPath, data);

    onProgress?.({ downloaded: 100, total: 100 });

    // Update book sync status
    await setBookSyncStatus(bookId, "local");

    console.log(`[Sync] ✓ Book ${bookId} downloaded and marked as local`);
    return true;
  } catch (e) {
    console.error(`[Sync] Failed to download book ${bookId}:`, e);
    await setBookSyncStatus(bookId, "remote");
    return false;
  }
}
