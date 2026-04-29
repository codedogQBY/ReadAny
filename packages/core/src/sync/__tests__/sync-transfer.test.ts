import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ISyncBackend } from "../sync-backend";
import { REMOTE_DB_FILE, REMOTE_MANIFEST } from "../sync-types";

// --- Mock sync-meta ---
const metaMocks = vi.hoisted(() => ({
  batchSetSyncMeta: vi.fn(),
}));
vi.mock("../sync-meta", () => metaMocks);

// --- Mock sync-adapter ---
const mockAdapter = {
  getTempDir: vi.fn().mockResolvedValue("/tmp"),
  joinPath: vi.fn((...segs: string[]) => segs.join("/")),
  vacuumInto: vi.fn(),
  readFileBytes: vi.fn(),
  writeFileBytes: vi.fn(),
  getDatabasePath: vi.fn().mockResolvedValue("/data/readany.db"),
  hashFile: vi.fn().mockResolvedValue("hash-new"),
  fileExists: vi.fn().mockResolvedValue(true),
  deleteFile: vi.fn(),
  copyFile: vi.fn(),
  integrityCheck: vi.fn().mockResolvedValue(true),
  closeDatabase: vi.fn(),
  reopenDatabase: vi.fn(),
  getDeviceName: vi.fn().mockResolvedValue("Test Device"),
  getAppVersion: vi.fn().mockResolvedValue("1.0.0"),
};

vi.mock("../sync-adapter", () => ({
  getSyncAdapter: vi.fn(() => mockAdapter),
}));

// --- Mock db/database ---
const mockSnapshotDb = { execute: vi.fn(), close: vi.fn() };
vi.mock("../../db/database", () => ({
  getDB: vi.fn(async () => ({ select: vi.fn().mockResolvedValue([{ c: 5 }]) })),
  getDeviceId: vi.fn(async () => "device-1"),
  clearVectorizationFlagsWithoutLocalChunks: vi.fn(),
}));

// --- Mock platform service ---
vi.mock("../../services/platform", () => ({
  getPlatformService: vi.fn(() => ({
    loadDatabase: vi.fn().mockResolvedValue(mockSnapshotDb),
  })),
}));

// --- Mock incremental-sync (dynamic import in executeUpload) ---
vi.mock("../incremental-sync", () => ({
  collectLocalChanges: vi.fn().mockResolvedValue({ changes: [] }),
  getDeviceId: vi.fn().mockResolvedValue("device-1"),
}));

// Import module under test — will fail until sync-transfer.ts exists
const { parallelLimit, executeUpload, executeDownload } = await import("../sync-transfer");

// Helper to create a mock backend
function createMockBackend(overrides: Partial<ISyncBackend> = {}): ISyncBackend {
  return {
    type: "webdav",
    testConnection: vi.fn(),
    ensureDirectories: vi.fn(),
    put: vi.fn(),
    get: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    getJSON: vi.fn(),
    putJSON: vi.fn(),
    listDir: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
    getDisplayName: vi.fn(),
    ...overrides,
  } as ISyncBackend;
}

describe("sync-transfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.readFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    mockSnapshotDb.execute.mockResolvedValue(undefined);
    mockSnapshotDb.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("parallelLimit", () => {
    it("executes all tasks and returns results", async () => {
      const tasks = [() => Promise.resolve(1), () => Promise.resolve(2), () => Promise.resolve(3)];

      const results = await parallelLimit(tasks, 2);
      expect(results).toHaveLength(3);
      expect(results).toContain(1);
      expect(results).toContain(2);
      expect(results).toContain(3);
    });

    it("respects concurrency limit", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const makeTask = (val: number) => async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        return val;
      };

      const tasks = [makeTask(1), makeTask(2), makeTask(3), makeTask(4), makeTask(5)];
      const results = await parallelLimit(tasks, 2);

      expect(results).toHaveLength(5);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("handles empty task array", async () => {
      const results = await parallelLimit([], 3);
      expect(results).toEqual([]);
    });
  });

  describe("executeUpload", () => {
    it("creates snapshot, uploads DB and manifest", async () => {
      const backend = createMockBackend();

      await executeUpload(backend);

      // Should vacuum into snapshot
      expect(mockAdapter.vacuumInto).toHaveBeenCalled();
      // Should upload DB file
      expect(backend.put).toHaveBeenCalledWith(REMOTE_DB_FILE, expect.any(Uint8Array));
      // Should upload manifest
      expect(backend.putJSON).toHaveBeenCalledWith(
        REMOTE_MANIFEST,
        expect.objectContaining({
          lastModifiedAt: expect.any(Number),
          uploadedBy: "Test Device",
          appVersion: "1.0.0",
        }),
      );
      // Should update local sync metadata
      expect(metaMocks.batchSetSyncMeta).toHaveBeenCalled();
    });

    it("reports progress via callback", async () => {
      const backend = createMockBackend();
      const onProgress = vi.fn();

      await executeUpload(backend, onProgress);

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "database",
          operation: "upload",
        }),
      );
    });

    it("cleans up snapshot file on success", async () => {
      const backend = createMockBackend();
      mockAdapter.fileExists.mockResolvedValue(true);

      await executeUpload(backend);

      expect(mockAdapter.deleteFile).toHaveBeenCalled();
    });
  });

  describe("executeDownload", () => {
    it("downloads, validates, and replaces DB", async () => {
      const backend = createMockBackend();
      const manifest = {
        lastModifiedAt: 1000,
        uploadedBy: "device-2",
        appVersion: "1.0.0",
        schemaVersion: 1,
      };

      await executeDownload(backend, manifest);

      // Should download remote DB
      expect(backend.get).toHaveBeenCalledWith(REMOTE_DB_FILE);
      // Should validate integrity
      expect(mockAdapter.integrityCheck).toHaveBeenCalled();
      // Should backup, close, copy, reopen
      expect(mockAdapter.copyFile).toHaveBeenCalledTimes(2); // backup + replace
      expect(mockAdapter.closeDatabase).toHaveBeenCalled();
      expect(mockAdapter.reopenDatabase).toHaveBeenCalled();
      // Should update sync metadata
      expect(metaMocks.batchSetSyncMeta).toHaveBeenCalled();
    });

    it("aborts when integrity check fails", async () => {
      const backend = createMockBackend();
      mockAdapter.integrityCheck.mockResolvedValue(false);

      await expect(executeDownload(backend, null)).rejects.toThrow("integrity check");
    });

    it("restores backup on error after DB close", async () => {
      const backend = createMockBackend();
      mockAdapter.integrityCheck.mockResolvedValue(true);
      // Fail during copyFile (replace step)
      let callCount = 0;
      mockAdapter.copyFile.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) throw new Error("disk full");
      });
      mockAdapter.fileExists.mockResolvedValue(true);

      await expect(executeDownload(backend, null)).rejects.toThrow("disk full");

      // Should have tried to restore from backup
      expect(mockAdapter.reopenDatabase).toHaveBeenCalled();
    });

    it("reports progress via callback", async () => {
      const backend = createMockBackend();
      const onProgress = vi.fn();

      await executeDownload(backend, null, onProgress);

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "database",
          operation: "download",
        }),
      );
    });
  });
});
