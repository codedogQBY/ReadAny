import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ISyncBackend, RemoteFile } from "../sync-backend";
import { REMOTE_FILES } from "../sync-types";

// --- Mock sync-adapter ---
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

// --- Mock db/database ---
const mockSelect = vi.fn();
const mockSetBookSyncStatus = vi.fn();
vi.mock("../../db/database", () => ({
  getDB: vi.fn(async () => ({ select: mockSelect })),
  setBookSyncStatus: mockSetBookSyncStatus,
}));

// Import module under test — will fail until sync-files.ts exists
const { syncFiles, downloadBookFile } = await import("../sync-files");

// Helper to create mock backend
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
    exists: vi.fn(),
    getDisplayName: vi.fn(),
    ...overrides,
  } as ISyncBackend;
}

describe("sync-files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockResolvedValue([]);
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
      expect(result).toEqual({ filesUploaded: 0, filesDownloaded: 0 });
    });

    it("uploads local book files not on remote", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test Book",
        },
      ]);

      // Local file exists
      mockAdapter.fileExists.mockResolvedValue(true);

      // Remote has no files
      const backend = createMockBackend({
        listDir: vi.fn().mockResolvedValue([]),
      });

      const result = await syncFiles(backend);
      expect(result.filesUploaded).toBe(1);
      expect(backend.put).toHaveBeenCalledWith(
        `${REMOTE_FILES}/book-1.epub`,
        expect.any(Uint8Array),
      );
    });

    it("downloads remote files when forceDownloadAll is set", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "book-1",
          file_path: "books/book-1.epub",
          file_hash: "h1",
          cover_url: null,
          title: "Test Book",
        },
      ]);

      // Local file doesn't exist
      mockAdapter.fileExists.mockResolvedValue(false);

      // Remote has the file
      const remoteFiles: RemoteFile[] = [
        {
          name: "book-1.epub",
          path: "/readany/data/file/book-1.epub",
          size: 100,
          lastModified: 1000,
          isDirectory: false,
        },
      ];
      const backend = createMockBackend({
        listDir: vi.fn().mockImplementation(async (path: string) => {
          if (path === REMOTE_FILES) return remoteFiles;
          return [];
        }),
      });

      const result = await syncFiles(backend, undefined, {
        forceDownloadAll: true,
      });
      expect(result.filesDownloaded).toBe(1);
    });

    it("marks books as remote when local file missing and remote exists", async () => {
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

      const remoteFiles: RemoteFile[] = [
        {
          name: "book-1.epub",
          path: "/readany/data/file/book-1.epub",
          size: 100,
          lastModified: 1000,
          isDirectory: false,
        },
      ];
      const backend = createMockBackend({
        listDir: vi.fn().mockImplementation(async (path: string) => {
          if (path === REMOTE_FILES) return remoteFiles;
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
  });

  describe("downloadBookFile", () => {
    it("downloads and saves book file when exists on remote", async () => {
      const backend = createMockBackend({
        exists: vi.fn().mockResolvedValue(true),
        get: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5])),
      });

      const result = await downloadBookFile(backend, "book-1", "books/book-1.epub");

      expect(result).toBe(true);
      expect(backend.get).toHaveBeenCalledWith(`${REMOTE_FILES}/book-1.epub`);
      expect(mockAdapter.writeFileBytes).toHaveBeenCalled();
      expect(mockSetBookSyncStatus).toHaveBeenCalledWith("book-1", "local");
    });

    it("returns false when file not on remote", async () => {
      const backend = createMockBackend({
        exists: vi.fn().mockResolvedValue(false),
      });

      const result = await downloadBookFile(backend, "book-1", "books/book-1.epub");

      expect(result).toBe(false);
      expect(mockSetBookSyncStatus).toHaveBeenCalledWith("book-1", "remote");
    });

    it("reports progress", async () => {
      const backend = createMockBackend({
        exists: vi.fn().mockResolvedValue(true),
        get: vi.fn().mockResolvedValue(new Uint8Array([1])),
      });
      const onProgress = vi.fn();

      await downloadBookFile(backend, "book-1", "books/book-1.epub", onProgress);

      expect(onProgress).toHaveBeenCalledWith({ downloaded: 0, total: 100 });
      expect(onProgress).toHaveBeenCalledWith({ downloaded: 100, total: 100 });
    });

    it("handles download error gracefully", async () => {
      const backend = createMockBackend({
        exists: vi.fn().mockResolvedValue(true),
        get: vi.fn().mockRejectedValue(new Error("network error")),
      });

      const result = await downloadBookFile(backend, "book-1", "books/book-1.epub");

      expect(result).toBe(false);
      expect(mockSetBookSyncStatus).toHaveBeenCalledWith("book-1", "remote");
    });
  });
});
