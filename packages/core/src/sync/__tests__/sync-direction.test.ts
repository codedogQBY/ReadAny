import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ISyncBackend } from "../sync-backend";
import { SYNC_META_KEYS, SYNC_SCHEMA_VERSION } from "../sync-types";

// --- Mock sync-meta ---
const metaMocks = vi.hoisted(() => ({
  getSyncMeta: vi.fn(),
}));
vi.mock("../sync-meta", () => metaMocks);

// --- Mock sync-adapter ---
const mockAdapter = {
  getDatabasePath: vi.fn(),
  hashFile: vi.fn(),
};
vi.mock("../sync-adapter", () => ({
  getSyncAdapter: vi.fn(() => mockAdapter),
}));

// Import module under test — will fail until sync-direction.ts exists
const { determineSyncDirection } = await import("../sync-direction");

// Helper to create a mock backend
function createMockBackend(overrides: Partial<ISyncBackend> = {}): ISyncBackend {
  return {
    type: "webdav",
    testConnection: vi.fn(),
    ensureDirectories: vi.fn(),
    put: vi.fn(),
    get: vi.fn(),
    getJSON: vi.fn(),
    putJSON: vi.fn(),
    listDir: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
    getDisplayName: vi.fn(),
    ...overrides,
  } as ISyncBackend;
}

describe("sync-direction (determineSyncDirection)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.getDatabasePath.mockResolvedValue("/data/readany.db");
    mockAdapter.hashFile.mockResolvedValue("hash-local-current");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'upload' when no remote manifest exists (first sync)", async () => {
    const backend = createMockBackend({
      getJSON: vi.fn().mockResolvedValue(null),
    });

    const result = await determineSyncDirection(backend);
    expect(result.direction).toBe("upload");
    expect(result.remoteManifest).toBeNull();
  });

  it("throws when remote schema version is newer than local", async () => {
    const backend = createMockBackend({
      getJSON: vi.fn().mockResolvedValue({
        lastModifiedAt: 1000,
        schemaVersion: SYNC_SCHEMA_VERSION + 1,
        uploadedBy: "device-2",
        appVersion: "2.0.0",
      }),
    });

    await expect(determineSyncDirection(backend)).rejects.toThrow("newer than local");
  });

  it("returns 'download' when no local sync hash (first sync on this device)", async () => {
    const backend = createMockBackend({
      getJSON: vi.fn().mockResolvedValue({
        lastModifiedAt: 1000,
        schemaVersion: SYNC_SCHEMA_VERSION,
        uploadedBy: "device-2",
        appVersion: "1.0.0",
      }),
    });

    metaMocks.getSyncMeta.mockResolvedValue(null); // no stored hash

    const result = await determineSyncDirection(backend);
    expect(result.direction).toBe("download");
    expect(result.remoteManifest).not.toBeNull();
  });

  it("returns 'none' when nothing changed", async () => {
    const backend = createMockBackend({
      getJSON: vi.fn().mockResolvedValue({
        lastModifiedAt: 1000,
        schemaVersion: SYNC_SCHEMA_VERSION,
        uploadedBy: "device-2",
        appVersion: "1.0.0",
      }),
    });

    // local hash matches stored → no local change
    metaMocks.getSyncMeta.mockImplementation(async (key: string) => {
      if (key === SYNC_META_KEYS.LAST_REMOTE_MODIFIED_AT) return "1000";
      if (key === SYNC_META_KEYS.LAST_SYNC_DB_HASH) return "hash-local-current";
      if (key === SYNC_META_KEYS.LAST_SYNC_AT) return null;
      return null;
    });

    const result = await determineSyncDirection(backend);
    expect(result.direction).toBe("none");
  });

  it("returns 'upload' when only local changed", async () => {
    const backend = createMockBackend({
      getJSON: vi.fn().mockResolvedValue({
        lastModifiedAt: 1000,
        schemaVersion: SYNC_SCHEMA_VERSION,
        uploadedBy: "device-2",
        appVersion: "1.0.0",
      }),
    });

    // remote unchanged (storedRemoteModifiedAt matches manifest)
    // local changed (currentDbHash != storedDbHash)
    metaMocks.getSyncMeta.mockImplementation(async (key: string) => {
      if (key === SYNC_META_KEYS.LAST_REMOTE_MODIFIED_AT) return "1000";
      if (key === SYNC_META_KEYS.LAST_SYNC_DB_HASH) return "hash-old";
      if (key === SYNC_META_KEYS.LAST_SYNC_AT) return null;
      return null;
    });
    mockAdapter.hashFile.mockResolvedValue("hash-local-current"); // different from stored "hash-old"

    const result = await determineSyncDirection(backend);
    expect(result.direction).toBe("upload");
  });

  it("returns 'download' when only remote changed", async () => {
    const backend = createMockBackend({
      getJSON: vi.fn().mockResolvedValue({
        lastModifiedAt: 2000, // different from stored 1000
        schemaVersion: SYNC_SCHEMA_VERSION,
        uploadedBy: "device-2",
        appVersion: "1.0.0",
      }),
    });

    metaMocks.getSyncMeta.mockImplementation(async (key: string) => {
      if (key === SYNC_META_KEYS.LAST_REMOTE_MODIFIED_AT) return "1000";
      if (key === SYNC_META_KEYS.LAST_SYNC_DB_HASH) return "hash-local-current"; // same as current
      if (key === SYNC_META_KEYS.LAST_SYNC_AT) return null;
      return null;
    });

    const result = await determineSyncDirection(backend);
    expect(result.direction).toBe("download");
  });

  it("returns 'conflict' when both local and remote changed", async () => {
    const backend = createMockBackend({
      getJSON: vi.fn().mockResolvedValue({
        lastModifiedAt: 2000, // remote changed
        schemaVersion: SYNC_SCHEMA_VERSION,
        uploadedBy: "device-2",
        appVersion: "1.0.0",
      }),
    });

    metaMocks.getSyncMeta.mockImplementation(async (key: string) => {
      if (key === SYNC_META_KEYS.LAST_REMOTE_MODIFIED_AT) return "1000";
      if (key === SYNC_META_KEYS.LAST_SYNC_DB_HASH) return "hash-old"; // local also changed
      if (key === SYNC_META_KEYS.LAST_SYNC_AT) return null;
      return null;
    });
    mockAdapter.hashFile.mockResolvedValue("hash-local-new");

    const result = await determineSyncDirection(backend);
    expect(result.direction).toBe("conflict");
  });
});
