import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ISyncBackend, RemoteFile } from "../sync-backend";
import {
  REMOTE_BOOKS_ROOT,
  REMOTE_COVERS,
  REMOTE_FILES,
  REMOTE_FILE_MANIFEST,
} from "../sync-types";

const mockAdapter = {
  getAppDataDir: vi.fn().mockResolvedValue("/appdata"),
  getTempDir: vi.fn().mockResolvedValue("/tmp"),
  joinPath: vi.fn((...segs: string[]) => segs.join("/")),
  fileExists: vi.fn(),
  hashFile: vi.fn().mockResolvedValue("local-hash"),
  readFileBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  getFileSize: vi.fn().mockResolvedValue(null),
  maxBufferedTransferBytes: undefined as number | undefined,
  writeFileBytes: vi.fn(),
  copyFile: vi.fn(),
  deleteFile: vi.fn(),
  ensureDir: vi.fn(),
  listFiles: vi.fn().mockResolvedValue([]),
};
vi.mock("../sync-adapter", () => ({
  getSyncAdapter: vi.fn(() => mockAdapter),
}));

const mockSelect = vi.fn();
const mockSetBookSyncStatus = vi.fn();
const mockUpdateBook = vi.fn();
vi.mock("../../db/database", () => ({
  getDB: vi.fn(async () => ({ select: mockSelect })),
  setBookSyncStatus: mockSetBookSyncStatus,
  updateBook: mockUpdateBook,
}));

const { syncFiles, downloadBookFile } = await import("../sync-files");

function createMockBackend(overrides: Partial<ISyncBackend> = {}): ISyncBackend {
  return {
    type: "webdav",
    testConnection: vi.fn(),
    ensureDirectories: vi.fn(),
    put: vi.fn(),
    get: vi.fn().mockResolvedValue(new Uint8Array([10, 20, 30])),
    getJSON: vi.fn(),
    putJSON: vi.fn(),
    listDir: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    exists: vi.fn().mockResolvedValue(false),
    move: vi.fn(),
    getDisplayName: vi.fn(),
    ...overrides,
  } as ISyncBackend;
}

describe("sync-files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockResolvedValue([]);
    mockAdapter.listFiles.mockResolvedValue([]);
    mockAdapter.maxBufferedTransferBytes = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("syncFiles", () => {
    it("returns zero counts when no books exist", async () => {
      mockSelect.mockResolvedValue([]);
      const backend = createMockBackend();

      const result = await syncFiles(backend);
      expect(result).toEqual({
        filesUploaded: 0,
        filesDownloaded: 0,
        filesUploadFailed: 0,
        filesDownloadFailed: 0,
      });
    });

    it("uploads local book files to the new per-book layout when remote is empty", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test Book",
        },
      ]);

      mockAdapter.fileExists.mockResolvedValue(true);

      const backend = createMockBackend({
        listDir: vi.fn().mockResolvedValue([]),
      });

      const result = await syncFiles(backend);
      expect(result.filesUploaded).toBe(1);
      expect(backend.put).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
        expect.any(Uint8Array),
      );
    });

    it("uses direct file upload when the backend supports it", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test Book",
        },
      ]);

      mockAdapter.fileExists.mockResolvedValue(true);

      const backend = createMockBackend({
        listDir: vi.fn().mockResolvedValue([]),
        putFile: vi.fn().mockResolvedValue(undefined),
      });

      const result = await syncFiles(backend);
      expect(result.filesUploaded).toBe(1);
      expect(backend.putFile).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
        "/appdata/books/book-1.epub",
        expect.any(Function),
      );
      expect(mockAdapter.readFileBytes).not.toHaveBeenCalled();
      expect(backend.put).not.toHaveBeenCalled();
    });

    it("does not buffer oversized uploads when the platform sets a transfer limit", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Huge Book",
        },
      ]);

      mockAdapter.fileExists.mockResolvedValue(true);
      mockAdapter.getFileSize.mockResolvedValue(20 * 1024 * 1024);
      mockAdapter.maxBufferedTransferBytes = 16 * 1024 * 1024;

      const backend = createMockBackend({
        listDir: vi.fn().mockResolvedValue([]),
      });

      const result = await syncFiles(backend);
      expect(result.filesUploaded).toBe(0);
      expect(result.filesUploadFailed).toBe(1);
      expect(mockAdapter.readFileBytes).not.toHaveBeenCalled();
      expect(backend.put).not.toHaveBeenCalled();
    });

    it("migrates legacy files to the new layout via MOVE", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test Book",
        },
      ]);

      // Local file is missing → downloadRemoteBooks default off, so this just verifies migration.
      mockAdapter.fileExists.mockResolvedValue(false);

      const legacyFiles: RemoteFile[] = [
        {
          name: "book-1.epub",
          path: `${REMOTE_FILES}/book-1.epub`,
          size: 100,
          lastModified: 1000,
          isDirectory: false,
        },
      ];
      const backend = createMockBackend({
        listDir: vi.fn().mockImplementation(async (path: string) => {
          if (path === REMOTE_FILES) return legacyFiles;
          return [];
        }),
        move: vi.fn().mockResolvedValue(undefined),
      });

      await syncFiles(backend);
      expect(backend.move).toHaveBeenCalledWith(
        `${REMOTE_FILES}/book-1.epub`,
        `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
      );
    });

    it("downloads remote files from the new layout when forceDownloadAll is set", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test Book",
        },
      ]);

      mockAdapter.fileExists.mockResolvedValue(false);

      const remoteBookDirs: RemoteFile[] = [
        {
          name: "Test Book-book-1",
          path: `${REMOTE_BOOKS_ROOT}/Test Book-book-1`,
          size: 0,
          lastModified: 0,
          isDirectory: true,
        },
      ];
      const folderContents: RemoteFile[] = [
        {
          name: "Test Book.epub",
          path: `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
          size: 100,
          lastModified: 1000,
          isDirectory: false,
        },
      ];

      const backend = createMockBackend({
        listDir: vi.fn().mockImplementation(async (path: string) => {
          if (path === REMOTE_BOOKS_ROOT) return remoteBookDirs;
          if (path === `${REMOTE_BOOKS_ROOT}/Test Book-book-1`) return folderContents;
          return [];
        }),
      });

      const result = await syncFiles(backend, undefined, {
        forceDownloadAll: true,
      });
      expect(result.filesDownloaded).toBe(1);
    });

    it("uses the remote file manifest for downloads without scanning remote directories", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test Book",
        },
      ]);

      mockAdapter.fileExists.mockResolvedValue(false);

      const backend = createMockBackend({
        getJSON: vi.fn().mockResolvedValue({
          version: 1,
          generatedAt: 1000,
          books: {
            "book-1": {
              folderName: "Test Book-book-1",
              filePath: `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
            },
          },
        }),
        listDir: vi.fn().mockResolvedValue([]),
      });

      const result = await syncFiles(backend, undefined, {
        forceDownloadAll: true,
      });

      expect(result.filesDownloaded).toBe(1);
      expect(backend.getJSON).toHaveBeenCalledWith(REMOTE_FILE_MANIFEST);
      expect(backend.listDir).not.toHaveBeenCalled();
      expect(backend.get).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
      );
    });

    it("falls back to a remote scan when the manifest is missing needed download data", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test Book",
        },
      ]);

      mockAdapter.fileExists.mockResolvedValue(false);

      const remoteBookDirs: RemoteFile[] = [
        {
          name: "Test Book-book-1",
          path: `${REMOTE_BOOKS_ROOT}/Test Book-book-1`,
          size: 0,
          lastModified: 0,
          isDirectory: true,
        },
      ];
      const folderContents: RemoteFile[] = [
        {
          name: "Test Book.epub",
          path: `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
          size: 100,
          lastModified: 1000,
          isDirectory: false,
        },
      ];

      const backend = createMockBackend({
        getJSON: vi.fn().mockResolvedValue({
          version: 1,
          generatedAt: 1000,
          books: {},
        }),
        listDir: vi.fn().mockImplementation(async (path: string) => {
          if (path === REMOTE_BOOKS_ROOT) return remoteBookDirs;
          if (path === `${REMOTE_BOOKS_ROOT}/Test Book-book-1`) return folderContents;
          return [];
        }),
      });

      const result = await syncFiles(backend, undefined, {
        downloadRemoteBooks: true,
      });

      expect(result.filesDownloaded).toBe(1);
      expect(backend.listDir).toHaveBeenCalledWith(REMOTE_BOOKS_ROOT);
      expect(backend.get).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
      );
    });

    it("uploads a local file and writes it into the manifest without scanning remote directories", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test Book",
        },
      ]);

      mockAdapter.fileExists.mockResolvedValue(true);

      const backend = createMockBackend({
        getJSON: vi.fn().mockResolvedValue({
          version: 1,
          generatedAt: 1000,
          books: {},
        }),
        listDir: vi.fn().mockResolvedValue([]),
      });

      const result = await syncFiles(backend);

      expect(result.filesUploaded).toBe(1);
      expect(backend.listDir).not.toHaveBeenCalled();
      expect(backend.put).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
        expect.any(Uint8Array),
      );
      expect(backend.putJSON).toHaveBeenCalledWith(
        REMOTE_FILE_MANIFEST,
        expect.objectContaining({
          version: 1,
          books: {
            "book-1": expect.objectContaining({
              folderName: "Test Book-book-1",
              filePath: `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
            }),
          },
        }),
      );
    });

    it("uses direct file download when the backend supports it", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test Book",
        },
      ]);

      mockAdapter.fileExists.mockResolvedValue(false);

      const remoteBookDirs: RemoteFile[] = [
        {
          name: "Test Book-book-1",
          path: `${REMOTE_BOOKS_ROOT}/Test Book-book-1`,
          size: 0,
          lastModified: 0,
          isDirectory: true,
        },
      ];
      const folderContents: RemoteFile[] = [
        {
          name: "Test Book.epub",
          path: `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
          size: 100,
          lastModified: 1000,
          isDirectory: false,
        },
      ];

      const backend = createMockBackend({
        getFileToPath: vi.fn().mockResolvedValue(undefined),
        listDir: vi.fn().mockImplementation(async (path: string) => {
          if (path === REMOTE_BOOKS_ROOT) return remoteBookDirs;
          if (path === `${REMOTE_BOOKS_ROOT}/Test Book-book-1`) return folderContents;
          return [];
        }),
      });

      const result = await syncFiles(backend, undefined, {
        forceDownloadAll: true,
      });

      expect(result.filesDownloaded).toBe(1);
      expect(backend.getFileToPath).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
        expect.stringMatching(/^\/tmp\/readany-transfer-.*\.epub$/),
        expect.any(Function),
      );
      expect(mockAdapter.copyFile).toHaveBeenCalledWith(
        expect.stringMatching(/^\/tmp\/readany-transfer-.*\.epub$/),
        "/appdata/books/book-1.epub",
      );
      expect(mockAdapter.writeFileBytes).not.toHaveBeenCalled();
      expect(backend.get).not.toHaveBeenCalled();
    });

    it("marks books as remote when local file missing and remote exists in new layout", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Remote Book",
        },
      ]);

      mockAdapter.fileExists.mockResolvedValue(false);

      const remoteBookDirs: RemoteFile[] = [
        {
          name: "Remote Book-book-1",
          path: `${REMOTE_BOOKS_ROOT}/Remote Book-book-1`,
          size: 0,
          lastModified: 0,
          isDirectory: true,
        },
      ];
      const folderContents: RemoteFile[] = [
        {
          name: "Remote Book.epub",
          path: `${REMOTE_BOOKS_ROOT}/Remote Book-book-1/Remote Book.epub`,
          size: 100,
          lastModified: 1000,
          isDirectory: false,
        },
      ];

      const backend = createMockBackend({
        listDir: vi.fn().mockImplementation(async (path: string) => {
          if (path === REMOTE_BOOKS_ROOT) return remoteBookDirs;
          if (path === `${REMOTE_BOOKS_ROOT}/Remote Book-book-1`) return folderContents;
          return [];
        }),
      });

      await syncFiles(backend);
      expect(mockSetBookSyncStatus).toHaveBeenCalledWith("book-1", "remote");
    });

    it("reports progress via callback", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test",
        },
      ]);
      mockAdapter.fileExists.mockResolvedValue(true);

      const backend = createMockBackend({
        listDir: vi.fn().mockResolvedValue([]),
      });
      const onProgress = vi.fn();

      await syncFiles(backend, onProgress);

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "files",
          operation: "upload",
        }),
      );
    });

    it("reports direct transfer byte progress", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test",
        },
      ]);
      mockAdapter.fileExists.mockResolvedValue(true);

      const backend = createMockBackend({
        listDir: vi.fn().mockResolvedValue([]),
        putFile: vi.fn(async (_remotePath, _localPath, onProgress) => {
          onProgress?.(50, 100);
        }),
      });
      const onProgress = vi.fn();

      await syncFiles(backend, onProgress);

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "files",
          operation: "upload",
          completedFiles: 0,
          totalFiles: 1,
          currentBytes: 50,
          totalBytes: 100,
        }),
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "files",
          operation: "upload",
          completedFiles: 1,
          totalFiles: 1,
        }),
      );
    });

    it("does not rewrite the remote file manifest when it is unchanged", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test Book",
        },
      ]);
      mockAdapter.fileExists.mockResolvedValue(true);

      const manifest = {
        version: 1 as const,
        generatedAt: 1000,
        books: {
          "book-1": {
            folderName: "Test Book-book-1",
            filePath: `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
            updatedAt: 1000,
          },
        },
      };
      const backend = createMockBackend({
        getJSON: vi.fn().mockResolvedValue(manifest),
        listDir: vi.fn().mockResolvedValue([]),
      });

      const result = await syncFiles(backend);

      expect(result.filesUploaded).toBe(0);
      expect(backend.listDir).not.toHaveBeenCalled();
      expect(backend.putJSON).not.toHaveBeenCalledWith(REMOTE_FILE_MANIFEST, expect.anything());
    });

    it("renames the book folder when the title has changed", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: "covers/book-1.jpg",
          title: "New Title",
        },
      ]);

      mockAdapter.fileExists.mockResolvedValue(true);

      const oldDirName = "Old Title-book-1";
      const oldDirPath = `${REMOTE_BOOKS_ROOT}/${oldDirName}`;
      const oldFolderEntry: RemoteFile = {
        name: oldDirName,
        path: oldDirPath,
        size: 0,
        lastModified: 0,
        isDirectory: true,
      };
      const oldFiles: RemoteFile[] = [
        {
          name: "Old Title.epub",
          path: `${oldDirPath}/Old Title.epub`,
          size: 100,
          lastModified: 1000,
          isDirectory: false,
        },
        {
          name: "Old Title.jpg",
          path: `${oldDirPath}/Old Title.jpg`,
          size: 50,
          lastModified: 1000,
          isDirectory: false,
        },
      ];

      const backend = createMockBackend({
        listDir: vi.fn().mockImplementation(async (path: string) => {
          if (path === REMOTE_BOOKS_ROOT) return [oldFolderEntry];
          if (path === oldDirPath) return oldFiles;
          return [];
        }),
        move: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      });

      await syncFiles(backend);

      expect(backend.move).toHaveBeenCalledWith(
        `${oldDirPath}/Old Title.epub`,
        `${REMOTE_BOOKS_ROOT}/New Title-book-1/New Title.epub`,
      );
      expect(backend.move).toHaveBeenCalledWith(
        `${oldDirPath}/Old Title.jpg`,
        `${REMOTE_BOOKS_ROOT}/New Title-book-1/New Title.jpg`,
      );
      // Old dir is best-effort deleted at the end.
      expect(backend.delete).toHaveBeenCalledWith(oldDirPath);
    });

    it("deletes remote orphan folders for books no longer in DB", async () => {
      mockSelect.mockResolvedValue([]);
      const orphanDir = "Old-550e8400-e29b-41d4-a716-446655440000";
      const orphanPath = `${REMOTE_BOOKS_ROOT}/${orphanDir}`;
      const orphanChild: RemoteFile = {
        name: "Old.epub",
        path: `${orphanPath}/Old.epub`,
        size: 1,
        lastModified: 0,
        isDirectory: false,
      };

      const backend = createMockBackend({
        listDir: vi.fn().mockImplementation(async (path: string) => {
          if (path === REMOTE_BOOKS_ROOT) {
            return [
              {
                name: orphanDir,
                path: orphanPath,
                size: 0,
                lastModified: 0,
                isDirectory: true,
              },
            ];
          }
          if (path === orphanPath) return [orphanChild];
          return [];
        }),
        delete: vi.fn().mockResolvedValue(undefined),
      });

      await syncFiles(backend);
      expect(backend.delete).toHaveBeenCalledWith(`${orphanPath}/Old.epub`);
      expect(backend.delete).toHaveBeenCalledWith(orphanPath);
    });

    it("keeps the active custom cover during local orphan cleanup", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.txt",
          file_hash: "h1",
          cover_url: "covers/book-1-custom-123.jpg",
          title: "Text Book",
        },
      ]);
      mockAdapter.fileExists.mockResolvedValue(true);
      mockAdapter.getFileSize.mockResolvedValue(100);
      mockAdapter.listFiles.mockImplementation(async (path: string) => {
        if (path === "/appdata/covers") return ["book-1-custom-123.jpg", "gone-book.jpg"];
        return [];
      });

      const backend = createMockBackend({
        listDir: vi.fn().mockResolvedValue([]),
      });

      await syncFiles(backend);

      expect(mockAdapter.deleteFile).not.toHaveBeenCalledWith(
        "/appdata/covers/book-1-custom-123.jpg",
      );
      expect(mockAdapter.deleteFile).toHaveBeenCalledWith("/appdata/covers/gone-book.jpg");
    });

    it("uploads the active custom cover when the remote manifest has no reliable cover size", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.txt",
          file_hash: "h1",
          cover_url: "covers/book-1-custom-123.jpg",
          title: "Text Book",
        },
      ]);
      mockAdapter.fileExists.mockResolvedValue(true);
      mockAdapter.getFileSize.mockResolvedValue(100);

      const manifest = {
        version: 1 as const,
        generatedAt: 1000,
        books: {
          "book-1": {
            folderName: "Text Book-book-1",
            filePath: `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.txt`,
            coverPath: `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.jpg`,
            updatedAt: 1000,
          },
        },
      };
      const backend = createMockBackend({
        getJSON: vi.fn().mockResolvedValue(manifest),
        listDir: vi.fn().mockResolvedValue([]),
      });

      const result = await syncFiles(backend);

      expect(result.filesUploaded).toBe(1);
      expect(backend.put).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.jpg`,
        expect.any(Uint8Array),
      );
    });

    it("uploads a replaced custom cover when the local cover path changes but size stays the same", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.txt",
          file_hash: "h1",
          cover_url: "covers/book-1-custom-456.jpg",
          title: "Text Book",
        },
      ]);
      mockAdapter.fileExists.mockResolvedValue(true);
      mockAdapter.getFileSize.mockImplementation(async (path: string) => {
        if (path === "/appdata/books/book-1.txt") return 500;
        if (path === "/appdata/covers/book-1-custom-456.jpg") return 100;
        return null;
      });
      mockAdapter.hashFile.mockResolvedValue("new-cover-hash");

      const manifest = {
        version: 1 as const,
        generatedAt: 1000,
        books: {
          "book-1": {
            folderName: "Text Book-book-1",
            filePath: `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.txt`,
            fileSize: 500,
            coverPath: `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.jpg`,
            coverSize: 100,
            coverHash: "old-cover-hash",
            coverSourcePath: "covers/book-1-custom-123.jpg",
            updatedAt: 1000,
          },
        },
      };
      const backend = createMockBackend({
        getJSON: vi.fn().mockResolvedValue(manifest),
        listDir: vi.fn().mockResolvedValue([]),
      });

      const result = await syncFiles(backend);

      expect(result.filesUploaded).toBe(1);
      expect(backend.put).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.jpg`,
        expect.any(Uint8Array),
      );
      expect(backend.putJSON).toHaveBeenCalledWith(
        REMOTE_FILE_MANIFEST,
        expect.objectContaining({
          books: expect.objectContaining({
            "book-1": expect.objectContaining({
              coverHash: "new-cover-hash",
              coverSourcePath: "covers/book-1-custom-456.jpg",
            }),
          }),
        }),
      );
    });

    it("uploads a custom cover when the content hash changes even if the path and size match", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.txt",
          file_hash: "h1",
          cover_url: "covers/book-1-custom-123.jpg",
          title: "Text Book",
        },
      ]);
      mockAdapter.fileExists.mockResolvedValue(true);
      mockAdapter.getFileSize.mockImplementation(async (path: string) => {
        if (path === "/appdata/books/book-1.txt") return 500;
        if (path === "/appdata/covers/book-1-custom-123.jpg") return 100;
        return null;
      });
      mockAdapter.hashFile.mockResolvedValue("new-cover-hash");

      const manifest = {
        version: 1 as const,
        generatedAt: 1000,
        books: {
          "book-1": {
            folderName: "Text Book-book-1",
            filePath: `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.txt`,
            fileSize: 500,
            coverPath: `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.jpg`,
            coverSize: 100,
            coverHash: "old-cover-hash",
            coverSourcePath: "covers/book-1-custom-123.jpg",
            updatedAt: 1000,
          },
        },
      };
      const backend = createMockBackend({
        getJSON: vi.fn().mockResolvedValue(manifest),
        listDir: vi.fn().mockResolvedValue([]),
      });

      const result = await syncFiles(backend);

      expect(result.filesUploaded).toBe(1);
      expect(backend.put).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.jpg`,
        expect.any(Uint8Array),
      );
    });

    it("downloads a newly referenced custom cover when it is missing locally", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.txt",
          file_hash: "h1",
          cover_url: "covers/book-1-custom-123.jpg",
          title: "Text Book",
        },
      ]);
      mockAdapter.fileExists.mockImplementation(async (path: string) => {
        if (path === "/appdata/books/book-1.txt") return true;
        if (path === "/appdata/covers/book-1-custom-123.jpg") return false;
        return false;
      });
      mockAdapter.getFileSize.mockImplementation(async (path: string) => {
        if (path === "/appdata/books/book-1.txt") return 500;
        return null;
      });

      const manifest = {
        version: 1 as const,
        generatedAt: 1000,
        books: {
          "book-1": {
            folderName: "Text Book-book-1",
            filePath: `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.txt`,
            fileSize: 500,
            coverPath: `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.jpg`,
            coverSize: 100,
            updatedAt: 1000,
          },
        },
      };
      const backend = createMockBackend({
        getJSON: vi.fn().mockResolvedValue(manifest),
        listDir: vi.fn().mockResolvedValue([]),
      });

      const result = await syncFiles(backend);

      expect(result.filesDownloaded).toBe(1);
      expect(backend.get).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.jpg`,
      );
      expect(mockAdapter.writeFileBytes).toHaveBeenCalledWith(
        "/appdata/covers/book-1-custom-123.jpg",
        expect.any(Uint8Array),
      );
    });

    it("downloads a changed custom cover in receive-only mode instead of uploading the stale local copy", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.txt",
          file_hash: "h1",
          cover_url: "covers/book-1-custom-123.jpg",
          title: "Text Book",
        },
      ]);
      mockAdapter.fileExists.mockResolvedValue(true);
      mockAdapter.getFileSize.mockImplementation(async (path: string) => {
        if (path === "/appdata/books/book-1.txt") return 500;
        if (path === "/appdata/covers/book-1-custom-123.jpg") return 80;
        return null;
      });

      const manifest = {
        version: 1 as const,
        generatedAt: 1000,
        books: {
          "book-1": {
            folderName: "Text Book-book-1",
            filePath: `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.txt`,
            fileSize: 500,
            coverPath: `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.jpg`,
            coverSize: 120,
            updatedAt: 1000,
          },
        },
      };
      const backend = createMockBackend({
        getJSON: vi.fn().mockResolvedValue(manifest),
        listDir: vi.fn().mockResolvedValue([]),
      });

      const result = await syncFiles(backend, undefined, {
        disableUploads: true,
        disableRemoteDeletes: true,
        downloadRemoteBooks: true,
      });

      expect(result.filesUploaded).toBe(0);
      expect(result.filesDownloaded).toBe(1);
      expect(backend.put).not.toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.jpg`,
        expect.any(Uint8Array),
      );
      expect(backend.get).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Text Book-book-1/Text Book.jpg`,
      );
    });
  });

  describe("downloadBookFile", () => {
    it("downloads via the new layout when the book is in DB", async () => {
      mockSelect.mockResolvedValue([{ id: "book-1", title: "Test Book" }]);

      const backend = createMockBackend({
        get: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5])),
      });

      const result = await downloadBookFile(backend, "book-1", "books/book-1.epub");

      expect(result).toBe("ok");
      expect(backend.get).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
      );
      expect(mockAdapter.writeFileBytes).toHaveBeenCalled();
      expect(mockUpdateBook).toHaveBeenCalledWith("book-1", {
        filePath: "books/book-1.epub",
        syncStatus: "local",
      });
    });

    it("downloads on-demand via direct file transfer when available", async () => {
      mockSelect.mockResolvedValue([{ id: "book-1", title: "Test Book" }]);

      const backend = createMockBackend({
        getFileToPath: vi.fn().mockResolvedValue(undefined),
      });

      const result = await downloadBookFile(backend, "book-1", "books/book-1.epub");

      expect(result).toBe("ok");
      expect(backend.getFileToPath).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
        expect.stringMatching(/^\/tmp\/readany-transfer-.*\.epub$/),
        expect.any(Function),
      );
      expect(mockAdapter.copyFile).toHaveBeenCalledWith(
        expect.stringMatching(/^\/tmp\/readany-transfer-.*\.epub$/),
        "/appdata/books/book-1.epub",
      );
      expect(mockAdapter.writeFileBytes).not.toHaveBeenCalled();
      expect(backend.get).not.toHaveBeenCalled();
      expect(mockUpdateBook).toHaveBeenCalledWith("book-1", {
        filePath: "books/book-1.epub",
        syncStatus: "local",
      });
    });

    it("downloads source-device absolute paths into the local managed book path", async () => {
      mockSelect.mockResolvedValue([{ id: "book-1", title: "Test Book" }]);

      const backend = createMockBackend({
        getFileToPath: vi.fn().mockResolvedValue(undefined),
      });

      const result = await downloadBookFile(
        backend,
        "book-1",
        "file:///data/user/0/com.readany.app/files/books/source-device-copy.epub",
      );

      expect(result).toBe("ok");
      expect(mockAdapter.copyFile).toHaveBeenCalledWith(
        expect.stringMatching(/^\/tmp\/readany-transfer-.*\.epub$/),
        "/appdata/books/book-1.epub",
      );
      expect(mockUpdateBook).toHaveBeenCalledWith("book-1", {
        filePath: "books/book-1.epub",
        syncStatus: "local",
      });
    });

    it("falls back to the legacy path when the new path is missing", async () => {
      mockSelect.mockResolvedValue([{ id: "book-1", title: "Test Book" }]);

      const getMock = vi
        .fn<(p: string) => Promise<Uint8Array>>()
        .mockImplementation(async (path: string) => {
          if (path === `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`) {
            throw new Error("404 Not Found");
          }
          if (path === `${REMOTE_FILES}/book-1.epub`) {
            return new Uint8Array([9, 9, 9]);
          }
          throw new Error(`unexpected path ${path}`);
        });
      const backend = createMockBackend({ get: getMock });

      const result = await downloadBookFile(backend, "book-1", "books/book-1.epub");

      expect(result).toBe("ok");
      expect(getMock).toHaveBeenCalledWith(`${REMOTE_FILES}/book-1.epub`);
      expect(mockUpdateBook).toHaveBeenCalledWith("book-1", {
        filePath: "books/book-1.epub",
        syncStatus: "local",
      });
    });

    it("returns 'not-found' and marks book as remote when neither path has the file", async () => {
      mockSelect.mockResolvedValue([{ id: "book-1", title: "Test Book" }]);

      const backend = createMockBackend({
        get: vi.fn().mockRejectedValue(new Error("404 Not Found")),
      });

      const result = await downloadBookFile(backend, "book-1", "books/book-1.epub");

      expect(result).toBe("not-found");
      expect(mockSetBookSyncStatus).toHaveBeenCalledWith("book-1", "remote");
    });

    it("reports progress", async () => {
      mockSelect.mockResolvedValue([{ id: "book-1", title: "Test Book" }]);
      const backend = createMockBackend({
        get: vi.fn().mockResolvedValue(new Uint8Array([1])),
      });
      const onProgress = vi.fn();

      await downloadBookFile(backend, "book-1", "books/book-1.epub", onProgress);

      expect(onProgress).toHaveBeenCalledWith({ downloaded: 0, total: 100 });
      expect(onProgress).toHaveBeenCalledWith({ downloaded: 100, total: 100 });
    });

    it("returns 'error' on transient network failure", async () => {
      mockSelect.mockResolvedValue([{ id: "book-1", title: "Test Book" }]);
      const backend = createMockBackend({
        get: vi.fn().mockRejectedValue(new Error("network error")),
      });

      const result = await downloadBookFile(backend, "book-1", "books/book-1.epub");

      expect(result).toBe("error");
      expect(mockSetBookSyncStatus).toHaveBeenCalledWith("book-1", "remote");
    });
  });

  describe("legacy cover migration", () => {
    it("migrates a legacy cover via MOVE", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: "covers/book-1.jpg",
          title: "Test Book",
        },
      ]);
      mockAdapter.fileExists.mockResolvedValue(false);

      const backend = createMockBackend({
        listDir: vi.fn().mockImplementation(async (path: string) => {
          if (path === REMOTE_COVERS) {
            return [
              {
                name: "book-1.jpg",
                path: `${REMOTE_COVERS}/book-1.jpg`,
                size: 50,
                lastModified: 1000,
                isDirectory: false,
              },
            ];
          }
          return [];
        }),
        move: vi.fn().mockResolvedValue(undefined),
      });

      await syncFiles(backend);
      expect(backend.move).toHaveBeenCalledWith(
        `${REMOTE_COVERS}/book-1.jpg`,
        `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.jpg`,
      );
    });
  });
});
