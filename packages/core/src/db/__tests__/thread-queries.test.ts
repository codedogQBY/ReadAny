import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "../../types";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect, close: vi.fn() };

const coreMocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getDeviceId: vi.fn(),
  nextSyncVersion: vi.fn(),
  nextUpdatedAt: vi.fn(),
  insertTombstone: vi.fn(),
}));

vi.mock("../db-core", () => coreMocks);

// Also mock message-queries since thread-queries depends on getMessages
const mockGetMessages = vi.fn();
vi.mock("../message-queries", () => ({
  getMessages: mockGetMessages,
}));

const {
  getThreads,
  getThread,
  insertThread,
  updateThreadTitle,
  deleteThread,
  deleteThreadsByBookId,
} = await import("../thread-queries");

describe("thread-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getDB.mockResolvedValue(mockDb);
    coreMocks.getDeviceId.mockResolvedValue("device-1");
    coreMocks.nextSyncVersion.mockResolvedValue(1);
    coreMocks.nextUpdatedAt.mockResolvedValue(3000);
    coreMocks.insertTombstone.mockResolvedValue(undefined);
    mockGetMessages.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getThreads", () => {
    it("returns threads for a specific book with messages", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "thread-1",
          book_id: "book-1",
          title: "Discussion",
          created_at: 1000,
          updated_at: 2000,
        },
      ]);
      mockGetMessages.mockResolvedValue([{ id: "msg-1", role: "user", content: "Hello" }]);

      const threads = await getThreads("book-1");
      expect(threads).toHaveLength(1);
      expect(threads[0].id).toBe("thread-1");
      expect(threads[0].bookId).toBe("book-1");
      expect(threads[0].title).toBe("Discussion");
      expect(threads[0].messages).toHaveLength(1);
      expect(mockGetMessages).toHaveBeenCalledWith("thread-1");
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM threads WHERE book_id = ? ORDER BY updated_at DESC",
        ["book-1"],
      );
    });

    it("returns all threads when no bookId provided", async () => {
      mockSelect.mockResolvedValue([]);

      await getThreads();
      expect(mockSelect).toHaveBeenCalledWith("SELECT * FROM threads ORDER BY updated_at DESC");
    });

    it("handles null book_id", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "thread-2",
          book_id: null,
          title: "General Chat",
          created_at: 1000,
          updated_at: 1000,
        },
      ]);

      const threads = await getThreads();
      expect(threads[0].bookId).toBeUndefined();
    });
  });

  describe("getThread", () => {
    it("returns a single thread with messages", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "thread-1",
          book_id: "book-1",
          title: "Discussion",
          created_at: 1000,
          updated_at: 2000,
        },
      ]);
      mockGetMessages.mockResolvedValue([{ id: "msg-1", role: "user", content: "Hello" }]);

      const thread = await getThread("thread-1");
      expect(thread).not.toBeNull();
      expect(thread!.id).toBe("thread-1");
      expect(thread!.messages).toHaveLength(1);
      expect(mockSelect).toHaveBeenCalledWith("SELECT * FROM threads WHERE id = ?", ["thread-1"]);
    });

    it("returns null when thread not found", async () => {
      mockSelect.mockResolvedValue([]);

      const thread = await getThread("nonexistent");
      expect(thread).toBeNull();
    });
  });

  describe("insertThread", () => {
    it("inserts thread with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      const thread: Thread = {
        id: "thread-1",
        bookId: "book-1",
        title: "New Discussion",
        messages: [],
        createdAt: 1000,
        updatedAt: 1000,
      };

      await insertThread(thread);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(coreMocks.getDeviceId).toHaveBeenCalled();
      expect(coreMocks.nextSyncVersion).toHaveBeenCalledWith(mockDb, "threads");

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO threads");
      expect(params[0]).toBe("thread-1");
      expect(params[1]).toBe("book-1");
      expect(params[2]).toBe("New Discussion");
    });

    it("handles thread without bookId", async () => {
      mockExecute.mockResolvedValue(undefined);

      const thread: Thread = {
        id: "thread-2",
        title: "General Chat",
        messages: [],
        createdAt: 1000,
        updatedAt: 1000,
      };

      await insertThread(thread);
      const [, params] = mockExecute.mock.calls[0];
      expect(params[1]).toBeNull(); // bookId should be null
    });
  });

  describe("updateThreadTitle", () => {
    it("updates title with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateThreadTitle("thread-1", "Updated Title");
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(coreMocks.nextUpdatedAt).toHaveBeenCalledWith(mockDb, "threads", "thread-1");

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE threads SET title = ?");
      expect(params[0]).toBe("Updated Title");
      expect(params[4]).toBe("thread-1"); // WHERE id = ?
    });
  });

  describe("deleteThread", () => {
    it("deletes thread, its messages, and creates tombstones", async () => {
      mockSelect.mockResolvedValue([{ id: "msg-1" }, { id: "msg-2" }]);
      mockExecute.mockResolvedValue(undefined);

      await deleteThread("thread-1");

      // Should create tombstones for each message
      expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "msg-1", "messages");
      expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "msg-2", "messages");
      // Should create tombstone for thread
      expect(coreMocks.insertTombstone).toHaveBeenCalledWith(mockDb, "thread-1", "threads");
      // Should delete messages then thread
      expect(mockExecute).toHaveBeenCalledWith("DELETE FROM messages WHERE thread_id = ?", [
        "thread-1",
      ]);
      expect(mockExecute).toHaveBeenCalledWith("DELETE FROM threads WHERE id = ?", ["thread-1"]);
    });
  });

  describe("deleteThreadsByBookId", () => {
    it("deletes all threads for a book", async () => {
      // First call: select thread IDs for the book
      // Then for each thread's deleteThread: select message IDs
      mockSelect
        .mockResolvedValueOnce([{ id: "thread-1" }, { id: "thread-2" }]) // threads for book
        .mockResolvedValueOnce([{ id: "msg-1" }]) // messages for thread-1
        .mockResolvedValueOnce([{ id: "msg-2" }]); // messages for thread-2
      mockExecute.mockResolvedValue(undefined);

      await deleteThreadsByBookId("book-1");

      expect(mockSelect).toHaveBeenCalledWith("SELECT id FROM threads WHERE book_id = ?", [
        "book-1",
      ]);
      // Should have created tombstones for all messages and threads
      expect(coreMocks.insertTombstone).toHaveBeenCalledTimes(4); // 2 messages + 2 threads
    });
  });
});
