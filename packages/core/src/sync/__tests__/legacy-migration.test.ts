import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ISyncBackend } from "../sync-backend";

const syncMocks = vi.hoisted(() => ({
  applyChanges: vi.fn(async () => ({ applied: 2, skipped: 1 })),
  listRemoteDeviceFiles: vi.fn(),
}));

vi.mock("../simple-sync", () => ({
  applyChanges: syncMocks.applyChanges,
  listRemoteDeviceFiles: syncMocks.listRemoteDeviceFiles,
}));

vi.mock("../../db/database", () => ({
  cleanupOrphanedSyncRows: vi.fn(),
  ensureNoTransaction: vi.fn(),
  getDB: vi.fn(),
  getDeviceId: vi.fn(),
}));

vi.mock("../../services/platform", () => ({
  getPlatformService: vi.fn(),
}));

const { importLegacySnapshots } = await import("../per-book-sync");

class FakeBackend implements ISyncBackend {
  readonly type = "webdav" as const;
  constructor(private readonly files: Record<string, unknown>) {}

  async getJSON<T>(path: string): Promise<T | null> {
    return (this.files[path] as T) ?? null;
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
  async ensureDirectories(): Promise<void> {}
  async put(): Promise<void> {}
  async get(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async putJSON(): Promise<void> {}
  async listDir(): Promise<never[]> {
    return [];
  }
  async delete(): Promise<void> {}
  async exists(): Promise<boolean> {
    return false;
  }
  async move(): Promise<void> {}
  async getDisplayName(): Promise<string> {
    return "fake";
  }
}

describe("legacy per-device snapshot migration", () => {
  beforeEach(() => {
    syncMocks.applyChanges.mockClear();
    syncMocks.listRemoteDeviceFiles.mockReset();
  });

  it("imports every valid device snapshot and skips malformed files", async () => {
    syncMocks.listRemoteDeviceFiles.mockResolvedValueOnce([
      { deviceId: "device-a", path: "/readany/sync/device-a.json" },
      { deviceId: "device-b", path: "/readany/sync/device-b.json" },
      { deviceId: "device-bad", path: "/readany/sync/device-bad.json" },
    ]);

    const progress = vi.fn();
    const result = await importLegacySnapshots(
      new FakeBackend({
        "/readany/sync/device-a.json": {
          deviceId: "device-a",
          timestamp: 10,
          since: 0,
          tables: { books: { records: [], deletedIds: [] } },
        },
        "/readany/sync/device-b.json": {
          deviceId: "device-b",
          timestamp: 20,
          since: 0,
          tables: { books: { records: [], deletedIds: [] } },
        },
        "/readany/sync/device-bad.json": { nope: true },
      }),
      progress,
      false,
    );

    expect(result).toEqual({ imported: true, applied: 4 });
    expect(syncMocks.applyChanges).toHaveBeenCalledTimes(2);
    expect(syncMocks.applyChanges).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ deviceId: "device-a" }),
      { forceApply: false },
    );
    expect(syncMocks.applyChanges).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ deviceId: "device-b" }),
      { forceApply: false },
    );
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it("returns no migration when the remote has no legacy snapshots", async () => {
    syncMocks.listRemoteDeviceFiles.mockResolvedValueOnce([]);

    const result = await importLegacySnapshots(new FakeBackend({}), vi.fn(), true);

    expect(result).toEqual({ imported: false, applied: 0 });
    expect(syncMocks.applyChanges).not.toHaveBeenCalled();
  });
});
