import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock database ---
const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect };

vi.mock("../../db/database", () => ({
  getDB: vi.fn(async () => mockDb),
}));

// Import the module under test — will fail until sync-meta.ts exists
const { getSyncMeta, batchSetSyncMeta, acquireSyncLock } = await import("../sync-meta");

describe("sync-meta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getSyncMeta", () => {
    it("returns value when key exists", async () => {
      mockSelect.mockResolvedValue([{ value: "abc123" }]);

      const result = await getSyncMeta("last_sync_db_hash");
      expect(result).toBe("abc123");
      expect(mockSelect).toHaveBeenCalledWith("SELECT value FROM sync_metadata WHERE key = ?", [
        "last_sync_db_hash",
      ]);
    });

    it("returns null when key does not exist", async () => {
      mockSelect.mockResolvedValue([]);

      const result = await getSyncMeta("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("batchSetSyncMeta", () => {
    it("inserts or replaces multiple entries sequentially", async () => {
      mockExecute.mockResolvedValue(undefined);

      await batchSetSyncMeta([
        ["key1", "val1"],
        ["key2", "val2"],
        ["key3", "val3"],
      ]);

      expect(mockExecute).toHaveBeenCalledTimes(3);
      expect(mockExecute).toHaveBeenNthCalledWith(
        1,
        "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)",
        ["key1", "val1"],
      );
      expect(mockExecute).toHaveBeenNthCalledWith(
        2,
        "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)",
        ["key2", "val2"],
      );
      expect(mockExecute).toHaveBeenNthCalledWith(
        3,
        "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)",
        ["key3", "val3"],
      );
    });

    it("handles empty entries array", async () => {
      await batchSetSyncMeta([]);
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  describe("acquireSyncLock", () => {
    it("returns a release function", async () => {
      const release = await acquireSyncLock();
      expect(typeof release).toBe("function");
      release(); // clean up
    });

    it("serializes concurrent sync operations", async () => {
      const order: string[] = [];

      // Acquire first lock
      const release1 = await acquireSyncLock();
      order.push("lock1-acquired");

      // Second acquire should wait
      const lock2Promise = acquireSyncLock().then((release) => {
        order.push("lock2-acquired");
        return release;
      });

      // Ensure lock2 hasn't acquired yet
      await new Promise((r) => setTimeout(r, 10));
      expect(order).toEqual(["lock1-acquired"]);

      // Release first lock
      release1();
      order.push("lock1-released");

      // Now lock2 should acquire
      const release2 = await lock2Promise;
      expect(order).toContain("lock2-acquired");

      release2(); // clean up
    });
  });
});
