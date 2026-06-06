import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ISyncBackend, RemoteFile } from "../sync-backend";
import { REMOTE_BOOKS_ROOT, REMOTE_COVERS, REMOTE_FILES } from "../sync-types";

const mockAdapter = {
  getAppDataDir: vi.fn().mockResolvedValue("/appdata"),
  joinPath: vi.fn((...segs: string[]) => segs.join("/")),
  fileExists: vi.fn(),
  readFileBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  writeFileBytes: vi.fn(),
  deleteFile: vi.fn(),
  ensureDir: vi.fn(),
  listFiles: vi.fn().mockResolvedValue([]),
};
vi.mock("../sync-adapter", () => ({
  getSyncAdapter: vi.fn(() => mockAdapter),
}));

const mockSelect = vi.fn();
const mockExecute = vi.fn();
const mockSetBookSyncStatus = vi.fn();
const mockImportChapterTranslationRecord = vi.fn();
vi.mock("../../db/database", () => ({
  getDB: vi.fn(async () => ({ select: mockSelect, execute: mockExecute })),
  importChapterTranslationRecord: mockImportChapterTranslationRecord,
  setBookSyncStatus: mockSetBookSyncStatus,
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
    mockExecute.mockResolvedValue(undefined);
    mockImportChapterTranslationRecord.mockResolvedValue(undefined);
    mockAdapter.listFiles.mockResolvedValue([]);
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

    it("uploads persisted chapter translations as visible JSON files", async () => {
      mockSelect.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM books WHERE deleted_at IS NULL")) {
          return [
            {
              id: "book-1",
              file_path: null,
              file_hash: "h1",
              cover_url: null,
              title: "Test Book",
            },
          ];
        }
        if (sql.includes("FROM chapter_translations")) {
          return [
            {
              id: "book-1:0:AUTO:zh-CN",
              book_id: "book-1",
              book_title: "Test Book",
              section_index: 0,
              source_lang: "AUTO",
              target_lang: "zh-CN",
              provider: "ai",
              model: "deepseek-v4-pro[1m]",
              source_hash: "hash-1",
              paragraphs: JSON.stringify([
                { paragraphId: "p1", originalText: "Hello", translatedText: "Hello zh" },
              ]),
              original_visible: 1,
              translation_visible: 1,
              created_at: 1000,
              updated_at: 1000,
            },
          ];
        }
        return [];
      });

      const backend = createMockBackend({
        listDir: vi.fn().mockResolvedValue([]),
      });

      const result = await syncFiles(backend);

      expect(result.filesUploaded).toBe(1);
      expect(backend.put).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Test Book-book-1/translations/00000-AUTO-zh-CN-hash-1.json`,
        expect.any(Uint8Array),
      );
    });

    it("downloads remote chapter translation JSON into the local database", async () => {
      mockSelect.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM books WHERE deleted_at IS NULL")) {
          return [
            {
              id: "book-1",
              file_path: null,
              file_hash: "h1",
              cover_url: null,
              title: "Test Book",
            },
          ];
        }
        if (sql.includes("FROM chapter_translations")) {
          return [
            {
              id: "book-1:0:AUTO:zh-CN",
              book_id: "book-1",
              book_title: "Test Book",
              section_index: 0,
              source_lang: "AUTO",
              target_lang: "zh-CN",
              provider: "ai",
              model: "deepseek-v4-pro[1m]",
              source_hash: "hash-1",
              paragraphs: "[]",
              original_visible: 1,
              translation_visible: 1,
              created_at: 1000,
              updated_at: 1000,
            },
          ];
        }
        return [];
      });

      const remotePath = `${REMOTE_BOOKS_ROOT}/Test Book-book-1/translations/00000-AUTO-zh-CN-hash-1.json`;
      const backend = createMockBackend({
        listDir: vi.fn().mockImplementation(async (path: string) => {
          if (path === `${REMOTE_BOOKS_ROOT}/Test Book-book-1/translations`) {
            return [
              {
                name: "00000-AUTO-zh-CN-hash-1.json",
                path: remotePath,
                size: 100,
                lastModified: 2000,
                isDirectory: false,
              },
            ];
          }
          return [];
        }),
        get: vi.fn().mockResolvedValue(
          new TextEncoder().encode(
            JSON.stringify({
              schemaVersion: 1,
              id: "book-1:0:AUTO:zh-CN",
              bookId: "book-1",
              sectionIndex: 0,
              sourceLang: "AUTO",
              targetLang: "zh-CN",
              provider: "ai",
              model: "deepseek-v4-pro[1m]",
              sourceHash: "hash-1",
              paragraphs: [
                { paragraphId: "p1", originalText: "Hello", translatedText: "Hello zh" },
              ],
              originalVisible: true,
              translationVisible: true,
              createdAt: 1000,
              updatedAt: 1000,
            }),
          ),
        ),
      });

      const result = await syncFiles(backend);

      expect(result.filesDownloaded).toBe(1);
      expect(backend.get).toHaveBeenCalledWith(remotePath);
      expect(mockImportChapterTranslationRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "book-1:0:AUTO:zh-CN",
          bookId: "book-1",
          paragraphs: [
            { paragraphId: "p1", originalText: "Hello", translatedText: "Hello zh" },
          ],
        }),
      );
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
  });

  describe("downloadBookFile", () => {
    it("downloads via the new layout when the book is in DB", async () => {
      mockSelect.mockResolvedValue([{ id: "book-1", title: "Test Book" }]);

      const backend = createMockBackend({
        get: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5])),
      });

      const result = await downloadBookFile(
        backend,
        "book-1",
        "books/book-1.epub",
      );

      expect(result).toBe("ok");
      expect(backend.get).toHaveBeenCalledWith(
        `${REMOTE_BOOKS_ROOT}/Test Book-book-1/Test Book.epub`,
      );
      expect(mockAdapter.writeFileBytes).toHaveBeenCalled();
      expect(mockSetBookSyncStatus).toHaveBeenCalledWith("book-1", "local");
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
          throw new Error("unexpected path " + path);
        });
      const backend = createMockBackend({ get: getMock });

      const result = await downloadBookFile(
        backend,
        "book-1",
        "books/book-1.epub",
      );

      expect(result).toBe("ok");
      expect(getMock).toHaveBeenCalledWith(`${REMOTE_FILES}/book-1.epub`);
      expect(mockSetBookSyncStatus).toHaveBeenCalledWith("book-1", "local");
    });

    it("returns 'not-found' and marks book as remote when neither path has the file", async () => {
      mockSelect.mockResolvedValue([{ id: "book-1", title: "Test Book" }]);

      const backend = createMockBackend({
        get: vi.fn().mockRejectedValue(new Error("404 Not Found")),
      });

      const result = await downloadBookFile(
        backend,
        "book-1",
        "books/book-1.epub",
      );

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

      const result = await downloadBookFile(
        backend,
        "book-1",
        "books/book-1.epub",
      );

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
