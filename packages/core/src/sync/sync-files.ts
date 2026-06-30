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
import { parallelLimit } from "./sync-transfer";
import {
  REMOTE_BOOKS_ROOT,
  REMOTE_COVERS,
  REMOTE_FILES,
  REMOTE_FILE_MANIFEST,
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

function isDirectFileTransferUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not support direct file|Platform does not support direct file/i.test(message);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

async function makeTempTransferPath(finalPath: string): Promise<string> {
  const adapter = getSyncAdapter();
  const tempDir = await adapter.getTempDir();
  await adapter.ensureDir(tempDir);
  const ext = getExt(finalPath) || "tmp";
  return adapter.joinPath(
    tempDir,
    `readany-transfer-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
  );
}

async function uploadFileToRemote(
  backend: ISyncBackend,
  remotePath: string,
  localPath: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<number | null> {
  const adapter = getSyncAdapter();
  if (backend.putFile) {
    try {
      await backend.putFile(remotePath, localPath, onProgress);
      return null;
    } catch (e) {
      if (!isDirectFileTransferUnsupported(e)) throw e;
      console.warn(
        `[Sync] Direct upload unsupported for ${remotePath}; falling back to buffered upload`,
      );
    }
  }

  if (adapter.maxBufferedTransferBytes != null) {
    const fileSize = await adapter.getFileSize(localPath);
    if (fileSize != null && fileSize > adapter.maxBufferedTransferBytes) {
      throw new Error(
        `Buffered upload would exceed platform memory limit for ${remotePath}: ${formatBytes(fileSize)} > ${formatBytes(adapter.maxBufferedTransferBytes)}`,
      );
    }
  }

  const data = await adapter.readFileBytes(localPath);
  onProgress?.(0, data.length);
  await backend.put(remotePath, data);
  onProgress?.(data.length, data.length);
  return data.length;
}

async function downloadRemoteFileToPath(
  backend: ISyncBackend,
  remotePath: string,
  localPath: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<number | null> {
  const adapter = getSyncAdapter();

  if (backend.getFileToPath) {
    const tempPath = await makeTempTransferPath(localPath);
    try {
      await backend.getFileToPath(remotePath, tempPath, onProgress);
      const dir = getDirName(localPath);
      if (dir) await adapter.ensureDir(dir);
      await adapter.copyFile(tempPath, localPath);
      return null;
    } catch (e) {
      if (!isDirectFileTransferUnsupported(e)) throw e;
      console.warn(
        `[Sync] Direct download unsupported for ${remotePath}; falling back to buffered download`,
      );
    } finally {
      try {
        await adapter.deleteFile(tempPath);
      } catch {}
    }
  }

  const data = backend.getWithProgress
    ? await backend.getWithProgress(remotePath, onProgress)
    : await backend.get(remotePath);
  const dir = getDirName(localPath);
  if (dir) await adapter.ensureDir(dir);
  await adapter.writeFileBytes(localPath, data);
  onProgress?.(data.length, data.length);
  return data.length;
}

type BookRow = {
  id: string;
  file_path: string;
  file_hash: string;
  cover_url: string;
  title: string;
};

type BookInfo = {
  book: BookRow;
  fileExt: string;
  coverExt: string;
  localFilePath: string;
  localCoverPath: string;
  remoteDir: string;
  expectedFolderName: string;
  remoteFilePath: string; // {books root}/{folder}/{title}.{file ext}
  remoteCoverPath: string; // {books root}/{folder}/{title}.{cover ext}
  legacyRemoteFileName: string; // {id}.{file ext}, lives in REMOTE_FILES
  legacyRemoteCoverName: string; // {id}.{cover ext}, lives in REMOTE_COVERS
  hasFile: boolean;
  hasCover: boolean;
};

type RemoteListings = {
  source: "manifest" | "scan";
  manifest: RemoteFileManifest | null;
  bookDirByBookId: Map<string, string>; // book.id -> existing folder name on remote
  filePathByBookId: Map<string, string>;
  coverPathByBookId: Map<string, string>;
  fileSizeByBookId: Map<string, number>;
  coverSizeByBookId: Map<string, number>;
  legacyFileNames: Set<string>; // names inside REMOTE_FILES
  legacyCoverNames: Set<string>; // names inside REMOTE_COVERS
  legacyFileSizeByName: Map<string, number>;
  legacyCoverSizeByName: Map<string, number>;
  /** Folders under REMOTE_BOOKS_ROOT shaped like {title}-{uuid} whose uuid is not in the DB. */
  orphanBookDirs: { folderName: string; bookId: string }[];
  /** Folders under REMOTE_BOOKS_ROOT with no valid uuid suffix and not matched to any book. */
  unknownBookDirs: { folderName: string }[];
};

type MigrationResult = {
  fileAtNew: boolean;
  coverAtNew: boolean;
  fileSize?: number;
  coverSize?: number;
};

type RemoteFileManifestEntry = {
  folderName: string;
  filePath?: string;
  coverPath?: string;
  fileSize?: number;
  coverSize?: number;
  updatedAt?: number;
};

type RemoteFileManifest = {
  version: 1;
  generatedAt: number;
  books: Record<string, RemoteFileManifestEntry>;
};

type FileTask = {
  label: string;
  sizeBytes?: number | null;
  run: (onProgress?: (loaded: number, total: number) => void) => Promise<boolean>;
};

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function runFileTasks(
  tasks: FileTask[],
  operation: "upload" | "download",
  concurrency: number,
  onProgress?: (progress: SyncProgress) => void,
): Promise<boolean[]> {
  let completed = 0;
  const total = tasks.length;
  const operationLabel = operation === "upload" ? "Uploading" : "Downloading";
  const taskLoadedBytes = new Map<number, number>();
  const taskTotalBytes = new Map<number, number>();
  for (let i = 0; i < tasks.length; i++) {
    const size = tasks[i].sizeBytes;
    if (isPositiveFiniteNumber(size)) {
      taskTotalBytes.set(i, size);
      taskLoadedBytes.set(i, 0);
    }
  }

  const getTotalTransferBytes = () => {
    if (taskTotalBytes.size !== tasks.length) return undefined;
    const totalBytes = Array.from(taskTotalBytes.values()).reduce((sum, bytes) => sum + bytes, 0);
    return totalBytes > 0 ? totalBytes : undefined;
  };

  const getTotalCurrentBytes = () =>
    Array.from(taskLoadedBytes.values()).reduce((sum, bytes) => sum + bytes, 0);

  const tasksWithProgress = tasks.map((task, index) => async () => {
    const fileNumber = index + 1;
    const emitProgress = (currentBytes?: number, totalBytes?: number) => {
      if (isPositiveFiniteNumber(totalBytes)) {
        taskTotalBytes.set(index, totalBytes);
      }
      if (currentBytes !== undefined) {
        const knownTotal = taskTotalBytes.get(index);
        const boundedBytes = knownTotal
          ? Math.max(0, Math.min(currentBytes, knownTotal))
          : Math.max(0, currentBytes);
        taskLoadedBytes.set(index, boundedBytes);
      }
      const totalTransferBytes = getTotalTransferBytes();
      onProgress?.({
        phase: "files",
        operation,
        currentFile: task.label,
        completedFiles: completed,
        totalFiles: total,
        ...(currentBytes !== undefined ? { currentBytes } : {}),
        ...(totalBytes !== undefined ? { totalBytes } : {}),
        ...(taskLoadedBytes.size > 0 ? { totalCurrentBytes: getTotalCurrentBytes() } : {}),
        ...(totalTransferBytes !== undefined ? { totalTransferBytes } : {}),
        message: `${operationLabel} file ${fileNumber}/${total}...`,
      });
    };

    emitProgress();
    const result = await task.run((loaded, taskTotal) => {
      if (taskTotal > 0) emitProgress(loaded, taskTotal);
    });
    completed++;
    const finalTotal =
      taskTotalBytes.get(index) ??
      (isPositiveFiniteNumber(task.sizeBytes) ? task.sizeBytes : undefined);
    if (result && finalTotal) {
      taskTotalBytes.set(index, finalTotal);
      taskLoadedBytes.set(index, finalTotal);
    }
    const totalTransferBytes = getTotalTransferBytes();
    onProgress?.({
      phase: "files",
      operation,
      currentFile: task.label,
      completedFiles: completed,
      totalFiles: total,
      ...(finalTotal !== undefined ? { currentBytes: finalTotal, totalBytes: finalTotal } : {}),
      ...(taskLoadedBytes.size > 0 ? { totalCurrentBytes: getTotalCurrentBytes() } : {}),
      ...(totalTransferBytes !== undefined ? { totalTransferBytes } : {}),
      message: `${operationLabel} file ${Math.min(completed + 1, total)}/${total}...`,
    });
    return result;
  });

  return parallelLimit(tasksWithProgress, concurrency);
}

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
    const fileExt = book.file_path ? getExt(book.file_path) || "epub" : "";
    const coverExt = book.cover_url ? getExt(book.cover_url) || "jpg" : "";
    const localFilePath = book.file_path
      ? isAbsoluteOrProtocolPath(book.file_path)
        ? book.file_path
        : adapter.joinPath(appDataDir, book.file_path)
      : "";
    const localCoverPath = book.cover_url
      ? isAbsoluteOrProtocolPath(book.cover_url)
        ? book.cover_url
        : adapter.joinPath(appDataDir, book.cover_url)
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
  const localSizeResults = await Promise.all(
    allLocalPaths.map((p) =>
      localExistsMap.get(p) ? adapter.getFileSize(p) : Promise.resolve(null),
    ),
  );
  const localSizeMap = new Map<string, number | null>();
  allLocalPaths.forEach((p, i) => localSizeMap.set(p, localSizeResults[i]));

  // --- List remote directories (tolerant of failures) ---
  const listings = await loadRemoteListings(backend, bookInfos, localExistsMap, {
    forceDownloadAll,
    downloadRemoteBooks,
  });

  // --- Phase 1: migrate per-book remote state (folder rename + legacy → new) ---
  console.log(
    `[Sync] Pre-migration: ${listings.bookDirByBookId.size} book dirs on remote, ` +
      `${listings.legacyFileNames.size} legacy files, ${listings.legacyCoverNames.size} legacy covers`,
  );

  const migrationResults = new Map<string, MigrationResult>();
  const remoteFileAtNew = new Map<string, boolean>();
  const remoteCoverAtNew = new Map<string, boolean>();
  const remoteFileSizeAtNew = new Map<string, number>();
  const remoteCoverSizeAtNew = new Map<string, number>();
  const migrationTasks = bookInfos.map((info) => async () => {
    const result = await migrateBookRemoteState(backend, info, listings);
    migrationResults.set(info.book.id, result);
    remoteFileAtNew.set(info.book.id, result.fileAtNew);
    remoteCoverAtNew.set(info.book.id, result.coverAtNew);
    if (isPositiveFiniteNumber(result.fileSize)) {
      remoteFileSizeAtNew.set(info.book.id, result.fileSize);
    }
    if (isPositiveFiniteNumber(result.coverSize)) {
      remoteCoverSizeAtNew.set(info.book.id, result.coverSize);
    }
  });
  if (migrationTasks.length > 0) {
    await parallelLimit(migrationTasks, MIGRATION_CONCURRENCY);
  }

  // --- Phase 2: build upload/download task lists based on post-migration state ---
  const uploadTasks: FileTask[] = [];
  const downloadTasks: FileTask[] = [];

  for (const info of bookInfos) {
    const { book } = info;
    const migration = migrationResults.get(book.id) ?? { fileAtNew: false, coverAtNew: false };

    // --- Book file ---
    if (info.hasFile && info.fileExt) {
      const localExists = localExistsMap.get(info.localFilePath) ?? false;
      const remoteExists = migration.fileAtNew;

      if (!disableUploads && localExists && (forceUploadAll || !remoteExists)) {
        const task = buildUploadFileTask(backend, info);
        const sizeBytes = localSizeMap.get(info.localFilePath) ?? null;
        uploadTasks.push({
          label: task.label,
          sizeBytes,
          run: async (onProgress) => {
            const ok = await task.run(onProgress);
            if (ok) remoteFileAtNew.set(book.id, true);
            if (ok && isPositiveFiniteNumber(sizeBytes))
              remoteFileSizeAtNew.set(book.id, sizeBytes);
            return ok;
          },
        });
      }

      if (remoteExists && (forceDownloadAll || (downloadRemoteBooks && !localExists))) {
        downloadTasks.push({
          ...buildDownloadFileTask(backend, info, setBookSyncStatus),
          sizeBytes: migration.fileSize,
        });
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
      const localSize = localSizeMap.get(info.localCoverPath) ?? null;
      const remoteExists = migration.coverAtNew;
      const remoteSize = migration.coverSize;
      const coverFileName = info.book.cover_url.split(/[\\/]/).pop() ?? "";
      const isCustomCover = coverFileName.startsWith(`${book.id}-custom-`);
      const coverChanged =
        remoteExists &&
        localExists &&
        ((isPositiveFiniteNumber(localSize) &&
          isPositiveFiniteNumber(remoteSize) &&
          localSize !== remoteSize) ||
          (isCustomCover &&
            (!isPositiveFiniteNumber(localSize) || !isPositiveFiniteNumber(remoteSize))));

      if (!disableUploads && localExists && (forceUploadAll || !remoteExists || coverChanged)) {
        const task = buildUploadCoverTask(backend, info);
        const sizeBytes = localSize;
        uploadTasks.push({
          label: task.label,
          sizeBytes,
          run: async (onProgress) => {
            const ok = await task.run(onProgress);
            if (ok) remoteCoverAtNew.set(book.id, true);
            if (ok && isPositiveFiniteNumber(sizeBytes)) {
              remoteCoverSizeAtNew.set(book.id, sizeBytes);
            }
            return ok;
          },
        });
      }

      if (remoteExists && (forceDownloadAll || !localExists || (disableUploads && coverChanged))) {
        downloadTasks.push({
          ...buildDownloadCoverTask(backend, info),
          sizeBytes: migration.coverSize,
        });
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
    const uploadResults = await runFileTasks(uploadTasks, "upload", UPLOAD_CONCURRENCY, onProgress);
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
    const downloadResults = await runFileTasks(
      downloadTasks,
      "download",
      DOWNLOAD_CONCURRENCY,
      onProgress,
    );
    filesDownloaded = downloadResults.filter((r) => r).length;
    filesDownloadFailed = downloadResults.length - filesDownloaded;
    console.log(
      `[Sync] ✅ Download completed: ${filesDownloaded} succeeded, ${filesDownloadFailed} failed in ${Date.now() - downloadStart}ms`,
    );
  }

  // --- Phase 3: orphan cleanup ---
  if (!disableRemoteDeletes) {
    await cleanupRemoteOrphans(backend, listings, currentBookIds);
  }
  await cleanupLocalOrphans(adapter, appDataDir, currentBookIds, books);

  await saveRemoteFileManifest(
    backend,
    bookInfos,
    remoteFileAtNew,
    remoteCoverAtNew,
    remoteFileSizeAtNew,
    remoteCoverSizeAtNew,
    listings.manifest,
  );

  console.log(`[Sync] ✅ File sync completed in ${Date.now() - syncFilesStart}ms`);
  return { filesUploaded, filesDownloaded, filesUploadFailed, filesDownloadFailed };
}

/* ─────────────────────────  helpers  ───────────────────────── */

async function loadRemoteListings(
  backend: ISyncBackend,
  bookInfos: BookInfo[],
  localExistsMap: Map<string, boolean>,
  options: Pick<SyncFilesOptions, "forceDownloadAll" | "downloadRemoteBooks">,
): Promise<RemoteListings> {
  const currentBookIds = new Set(bookInfos.map((i) => i.book.id));
  const manifest = await loadRemoteFileManifest(backend);
  if (manifest && canUseRemoteFileManifest(manifest, bookInfos, localExistsMap, options)) {
    console.log(
      `[Sync] Using remote file manifest with ${Object.keys(manifest.books).length} entries`,
    );
    return buildListingsFromManifest(manifest, currentBookIds);
  }

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
  const fileSizeByBookId = new Map<string, number>();
  const coverSizeByBookId = new Map<string, number>();

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
    source: "scan",
    manifest,
    bookDirByBookId,
    filePathByBookId: new Map(),
    coverPathByBookId: new Map(),
    fileSizeByBookId,
    coverSizeByBookId,
    legacyFileNames: new Set(legacyFiles.filter((f) => !f.isDirectory).map((f) => f.name)),
    legacyCoverNames: new Set(legacyCovers.filter((f) => !f.isDirectory).map((f) => f.name)),
    legacyFileSizeByName: new Map(
      legacyFiles
        .filter((f) => !f.isDirectory && isPositiveFiniteNumber(f.size))
        .map((f) => [f.name, f.size]),
    ),
    legacyCoverSizeByName: new Map(
      legacyCovers
        .filter((f) => !f.isDirectory && isPositiveFiniteNumber(f.size))
        .map((f) => [f.name, f.size]),
    ),
    orphanBookDirs,
    unknownBookDirs,
  };
}

async function loadRemoteFileManifest(backend: ISyncBackend): Promise<RemoteFileManifest | null> {
  try {
    const manifest = await backend.getJSON<RemoteFileManifest>(REMOTE_FILE_MANIFEST);
    if (
      !manifest ||
      manifest.version !== 1 ||
      !manifest.books ||
      typeof manifest.books !== "object"
    ) {
      return null;
    }
    return manifest;
  } catch (e) {
    console.warn("[Sync] Failed to load remote file manifest; falling back to directory scan:", e);
    return null;
  }
}

function canUseRemoteFileManifest(
  manifest: RemoteFileManifest,
  bookInfos: BookInfo[],
  localExistsMap: Map<string, boolean>,
  options: Pick<SyncFilesOptions, "forceDownloadAll" | "downloadRemoteBooks">,
): boolean {
  for (const info of bookInfos) {
    const entry = manifest.books[info.book.id];
    const localFileExists = localExistsMap.get(info.localFilePath) ?? false;
    const localCoverExists = localExistsMap.get(info.localCoverPath) ?? false;
    const needsRemoteBook =
      info.hasFile &&
      (options.forceDownloadAll || (options.downloadRemoteBooks && !localFileExists));
    const needsRemoteCover = info.hasCover && (options.forceDownloadAll || !localCoverExists);

    if (!entry && (needsRemoteBook || needsRemoteCover)) return false;
    if (entry && needsRemoteBook && !entry.filePath) return false;
    if (entry && needsRemoteCover && !entry.coverPath) return false;
  }
  return true;
}

function buildListingsFromManifest(
  manifest: RemoteFileManifest,
  currentBookIds: Set<string>,
): RemoteListings {
  const bookDirByBookId = new Map<string, string>();
  const filePathByBookId = new Map<string, string>();
  const coverPathByBookId = new Map<string, string>();
  const fileSizeByBookId = new Map<string, number>();
  const coverSizeByBookId = new Map<string, number>();

  for (const [bookId, entry] of Object.entries(manifest.books)) {
    if (!currentBookIds.has(bookId)) continue;
    bookDirByBookId.set(bookId, entry.folderName);
    if (entry.filePath) filePathByBookId.set(bookId, entry.filePath);
    if (entry.coverPath) coverPathByBookId.set(bookId, entry.coverPath);
    if (isPositiveFiniteNumber(entry.fileSize)) fileSizeByBookId.set(bookId, entry.fileSize);
    if (isPositiveFiniteNumber(entry.coverSize)) coverSizeByBookId.set(bookId, entry.coverSize);
  }

  return {
    source: "manifest",
    manifest,
    bookDirByBookId,
    filePathByBookId,
    coverPathByBookId,
    fileSizeByBookId,
    coverSizeByBookId,
    legacyFileNames: new Set(),
    legacyCoverNames: new Set(),
    legacyFileSizeByName: new Map(),
    legacyCoverSizeByName: new Map(),
    orphanBookDirs: [],
    unknownBookDirs: [],
  };
}

async function saveRemoteFileManifest(
  backend: ISyncBackend,
  bookInfos: BookInfo[],
  remoteFileAtNew: Map<string, boolean>,
  remoteCoverAtNew: Map<string, boolean>,
  remoteFileSizeAtNew: Map<string, number>,
  remoteCoverSizeAtNew: Map<string, number>,
  previousManifest: RemoteFileManifest | null,
): Promise<void> {
  const books: RemoteFileManifest["books"] = {};
  for (const info of bookInfos) {
    const hasRemoteFile = remoteFileAtNew.get(info.book.id) ?? false;
    const hasRemoteCover = remoteCoverAtNew.get(info.book.id) ?? false;
    if (!hasRemoteFile && !hasRemoteCover) continue;
    books[info.book.id] = {
      folderName: info.expectedFolderName,
      ...(hasRemoteFile ? { filePath: info.remoteFilePath } : {}),
      ...(hasRemoteCover ? { coverPath: info.remoteCoverPath } : {}),
      ...(hasRemoteFile && remoteFileSizeAtNew.has(info.book.id)
        ? { fileSize: remoteFileSizeAtNew.get(info.book.id) }
        : {}),
      ...(hasRemoteCover && remoteCoverSizeAtNew.has(info.book.id)
        ? { coverSize: remoteCoverSizeAtNew.get(info.book.id) }
        : {}),
      updatedAt: Date.now(),
    };
  }

  if (manifestBooksEqual(previousManifest?.books ?? {}, books)) {
    return;
  }

  if (!previousManifest && Object.keys(books).length === 0) {
    return;
  }

  try {
    await backend.putJSON<RemoteFileManifest>(REMOTE_FILE_MANIFEST, {
      version: 1,
      generatedAt: Date.now(),
      books,
    });
  } catch (e) {
    console.warn("[Sync] Failed to save remote file manifest:", e);
  }
}

function manifestBooksEqual(
  previous: RemoteFileManifest["books"],
  next: RemoteFileManifest["books"],
): boolean {
  const previousIds = Object.keys(previous).sort();
  const nextIds = Object.keys(next).sort();
  if (previousIds.length !== nextIds.length) return false;

  for (let i = 0; i < previousIds.length; i++) {
    const id = previousIds[i];
    if (id !== nextIds[i]) return false;

    const previousEntry = previous[id];
    const nextEntry = next[id];
    if (
      previousEntry.folderName !== nextEntry.folderName ||
      previousEntry.filePath !== nextEntry.filePath ||
      previousEntry.coverPath !== nextEntry.coverPath ||
      previousEntry.fileSize !== nextEntry.fileSize ||
      previousEntry.coverSize !== nextEntry.coverSize
    ) {
      return false;
    }
  }

  return true;
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
  let fileSize = listings.fileSizeByBookId.get(book.id);
  let coverSize = listings.coverSizeByBookId.get(book.id);

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
        const target = cover ? buildBookRemoteCover(book, ext) : buildBookRemoteFile(book, ext);
        try {
          await backend.move(`${oldDir}/${f.name}`, target);
          if (cover) {
            coverAtNew = true;
            if (isPositiveFiniteNumber(f.size)) coverSize = f.size;
          } else {
            fileAtNew = true;
            if (isPositiveFiniteNumber(f.size)) fileSize = f.size;
          }
        } catch (e) {
          console.warn(`[Sync] Folder-rename MOVE failed for ${book.id} (${f.name}):`, e);
          if (await backend.exists(target)) {
            try {
              await backend.delete(`${oldDir}/${f.name}`);
            } catch {}
            if (cover) {
              coverAtNew = true;
              if (isPositiveFiniteNumber(f.size)) coverSize = f.size;
            } else {
              fileAtNew = true;
              if (isPositiveFiniteNumber(f.size)) fileSize = f.size;
            }
          }
        }
      }
      try {
        await backend.delete(oldDir);
      } catch {}
      // Update in-memory map so orphan cleanup downstream doesn't see this as unknown.
      listings.bookDirByBookId.delete(book.id);
      listings.bookDirByBookId.set(book.id, info.expectedFolderName);
    } else {
      if (listings.source === "manifest") {
        fileAtNew = listings.filePathByBookId.get(book.id) === info.remoteFilePath;
        coverAtNew = listings.coverPathByBookId.get(book.id) === info.remoteCoverPath;
        return { fileAtNew, coverAtNew, fileSize, coverSize };
      }

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
        if (expectedFileName && f.name === expectedFileName) {
          fileAtNew = true;
          if (isPositiveFiniteNumber(f.size)) fileSize = f.size;
        }
        if (expectedCoverName && f.name === expectedCoverName) {
          coverAtNew = true;
          if (isPositiveFiniteNumber(f.size)) coverSize = f.size;
        }
      }
    }
  }

  // Migrate legacy file → new path if needed.
  if (!fileAtNew && info.fileExt && listings.legacyFileNames.has(info.legacyRemoteFileName)) {
    const legacy = `${REMOTE_FILES}/${info.legacyRemoteFileName}`;
    try {
      await backend.move(legacy, info.remoteFilePath);
      fileAtNew = true;
      fileSize = listings.legacyFileSizeByName.get(info.legacyRemoteFileName) ?? fileSize;
      console.log(`[Sync] 🔁 Migrated legacy file → ${info.remoteFilePath}`);
    } catch (e) {
      console.warn(`[Sync] Legacy file MOVE failed for ${book.id}:`, e);
      if (await backend.exists(info.remoteFilePath)) {
        try {
          await backend.delete(legacy);
          fileAtNew = true;
          fileSize = listings.legacyFileSizeByName.get(info.legacyRemoteFileName) ?? fileSize;
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
      coverSize = listings.legacyCoverSizeByName.get(info.legacyRemoteCoverName) ?? coverSize;
      console.log(`[Sync] 🔁 Migrated legacy cover → ${info.remoteCoverPath}`);
    } catch (e) {
      console.warn(`[Sync] Legacy cover MOVE failed for ${book.id}:`, e);
      if (await backend.exists(info.remoteCoverPath)) {
        try {
          await backend.delete(legacy);
          coverAtNew = true;
          coverSize = listings.legacyCoverSizeByName.get(info.legacyRemoteCoverName) ?? coverSize;
          console.log(`[Sync] 🧹 Deleted redundant legacy cover ${info.legacyRemoteCoverName}`);
        } catch {}
      }
    }
  }

  return { fileAtNew, coverAtNew, fileSize, coverSize };
}

function buildUploadFileTask(backend: ISyncBackend, info: BookInfo): FileTask {
  const bookTitle = info.book.title || "未知书籍";
  return {
    label: bookTitle,
    run: async (onProgress) => {
      const taskStart = Date.now();
      try {
        console.log(`[Sync] 📤 Uploading book: ${bookTitle} → ${info.remoteFilePath}`);
        const bytes = await uploadFileToRemote(
          backend,
          info.remoteFilePath,
          info.localFilePath,
          onProgress,
        );
        const size = bytes === null ? "" : ` (${(bytes / 1024 / 1024).toFixed(2)} MB)`;
        console.log(`[Sync] ✓ Uploaded "${bookTitle}"${size} in ${Date.now() - taskStart}ms`);
        return true;
      } catch (e) {
        console.log(`[Sync] ✗ Failed to upload "${bookTitle}": ${e}`);
        return false;
      }
    },
  };
}

function buildDownloadFileTask(
  backend: ISyncBackend,
  info: BookInfo,
  setBookSyncStatus: (id: string, status: "local" | "remote") => Promise<void>,
): FileTask {
  const bookTitle = info.book.title || "未知书籍";
  return {
    label: bookTitle,
    run: async (onProgress) => {
      const taskStart = Date.now();
      try {
        console.log(`[Sync] 📥 Downloading book: ${bookTitle} ← ${info.remoteFilePath}`);
        const bytes = await downloadRemoteFileToPath(
          backend,
          info.remoteFilePath,
          info.localFilePath,
          onProgress,
        );
        await setBookSyncStatus(info.book.id, "local");
        const size = bytes === null ? "" : ` (${(bytes / 1024 / 1024).toFixed(2)} MB)`;
        console.log(`[Sync] ✓ Downloaded "${bookTitle}"${size} in ${Date.now() - taskStart}ms`);
        return true;
      } catch (e) {
        console.log(`[Sync] ✗ Failed to download "${bookTitle}": ${e}`);
        return false;
      }
    },
  };
}

function buildUploadCoverTask(backend: ISyncBackend, info: BookInfo): FileTask {
  const bookTitle = info.book.title || "未知书籍";
  return {
    label: `${bookTitle} cover`,
    run: async (onProgress) => {
      const taskStart = Date.now();
      try {
        console.log(`[Sync] 📤 Uploading cover: ${bookTitle} → ${info.remoteCoverPath}`);
        const bytes = await uploadFileToRemote(
          backend,
          info.remoteCoverPath,
          info.localCoverPath,
          onProgress,
        );
        const size = bytes === null ? "" : ` (${(bytes / 1024).toFixed(2)} KB)`;
        console.log(`[Sync] ✓ Uploaded cover "${bookTitle}"${size} in ${Date.now() - taskStart}ms`);
        return true;
      } catch (e) {
        console.log(`[Sync] ✗ Failed to upload cover "${bookTitle}": ${e}`);
        return false;
      }
    },
  };
}

function buildDownloadCoverTask(backend: ISyncBackend, info: BookInfo): FileTask {
  const bookTitle = info.book.title || "未知书籍";
  return {
    label: `${bookTitle} cover`,
    run: async (onProgress) => {
      const taskStart = Date.now();
      try {
        console.log(`[Sync] 📥 Downloading cover: ${bookTitle} ← ${info.remoteCoverPath}`);
        const bytes = await downloadRemoteFileToPath(
          backend,
          info.remoteCoverPath,
          info.localCoverPath,
          onProgress,
        );
        const size = bytes === null ? "" : ` (${(bytes / 1024).toFixed(2)} KB)`;
        console.log(
          `[Sync] ✓ Downloaded cover "${bookTitle}"${size} in ${Date.now() - taskStart}ms`,
        );
        return true;
      } catch (e) {
        console.log(`[Sync] ✗ Failed to download cover "${bookTitle}": ${e}`);
        return false;
      }
    },
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
        try {
          children = await backend.listDir(dir);
        } catch {}
        for (const c of children) {
          if (c.isDirectory) continue;
          try {
            await backend.delete(`${dir}/${c.name}`);
          } catch {}
        }
        try {
          await backend.delete(dir);
        } catch {}
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
  books: BookRow[],
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
  const currentCoverFileNames = new Set(
    books
      .map((book) => book.cover_url)
      .filter((coverUrl): coverUrl is string => Boolean(coverUrl))
      .filter((coverUrl) => !isAbsoluteOrProtocolPath(coverUrl))
      .map((coverUrl) => coverUrl.split(/[\\/]/).pop())
      .filter((fileName): fileName is string => Boolean(fileName)),
  );

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
    if (currentCoverFileNames.has(fileName)) continue;
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

    // Track whether *every* failure we saw was a 404. If so, the remote
    // genuinely doesn't have the file. If at least one attempt failed with
    // some other error, it's an "error" outcome — the caller can retry.
    let sawNon404Error = false;
    const noteFailure = (e: unknown) => {
      const msg = (e as { message?: string })?.message ?? "";
      if (!/404|not found/i.test(msg)) sawNon404Error = true;
    };

    const appDataDir = await adapter.getAppDataDir();
    const localPath = isAbsoluteOrProtocolPath(filePath)
      ? filePath
      : adapter.joinPath(appDataDir, filePath);
    const reportDownloadProgress = (loaded: number, total: number) => {
      if (total > 0) onProgress?.({ downloaded: loaded, total });
    };
    let downloaded = false;
    if (newPath) {
      try {
        await downloadRemoteFileToPath(backend, newPath, localPath, reportDownloadProgress);
        downloaded = true;
        console.log(`[Sync] Downloaded ${newPath} (new layout)`);
      } catch (e) {
        noteFailure(e);
        const msg = (e as { message?: string })?.message ?? "";
        if (!/404|not found/i.test(msg)) {
          console.warn(`[Sync] New-layout fetch failed (${msg}); trying legacy path`);
        }
      }
    }
    if (!downloaded) {
      try {
        await downloadRemoteFileToPath(backend, legacyPath, localPath, reportDownloadProgress);
        downloaded = true;
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
    if (!downloaded && book?.title) {
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
            await downloadRemoteFileToPath(backend, guess, localPath, reportDownloadProgress);
            downloaded = true;
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
                await downloadRemoteFileToPath(backend, hitPath, localPath, reportDownloadProgress);
                downloaded = true;
                console.log(`[Sync] Downloaded via folder scan: ${hitPath}`);
                break;
              }
            } catch {}
          }
        }
      } catch (e) {
        noteFailure(e);
        console.warn("[Sync] Title-based fallback failed:", e);
      }
    }
    if (!downloaded) {
      console.log(
        `[Sync] Book file not found on remote (new=${newPath}, legacy=${legacyPath}, title=${book?.title ?? "?"})`,
      );
      await setBookSyncStatus(bookId, "remote");
      return sawNon404Error ? "error" : "not-found";
    }

    const localSize = await adapter.getFileSize(localPath);
    if (localSize === 0) {
      console.warn(`[Sync] Downloaded empty book file for ${bookId}; keeping it remote`);
      await setBookSyncStatus(bookId, "remote");
      return "error";
    }

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
