import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../types";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect, close: vi.fn() };

const coreMocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getDeviceId: vi.fn(),
  nextSyncVersion: vi.fn(),
  parseJSON: vi.fn((str: string | null | undefined, fallback: unknown) => {
    if (!str) return fallback;
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }),
}));

vi.mock("../db-core", () => coreMocks);

const { getMessages, insertMessage } = await import("../message-queries");

describe("message-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getDB.mockResolvedValue(mockDb);
    coreMocks.getDeviceId.mockResolvedValue("device-1");
    coreMocks.nextSyncVersion.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getMessages", () => {
    it("returns mapped messages for a thread", async () => {
      mockSelect.mockResolvedValue([
        {
          id: "msg-1",
          thread_id: "thread-1",
          role: "user",
          content: "Hello",
          citations: null,
          tool_calls: null,
          reasoning: null,
          parts_order: null,
          created_at: 1000,
        },
        {
          id: "msg-2",
          thread_id: "thread-1",
          role: "assistant",
          content: "Hi there",
          citations: '[{"source":"book-1"}]',
          tool_calls: null,
          reasoning: '{"steps":["think"]}',
          parts_order: null,
          created_at: 2000,
        },
      ]);

      const messages = await getMessages("thread-1");
      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe("msg-1");
      expect(messages[0].threadId).toBe("thread-1");
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Hello");
      expect(messages[0].citations).toBeUndefined();
      expect(messages[1].citations).toEqual([{ source: "book-1" }]);
      expect(messages[1].reasoning).toEqual({ steps: ["think"] });
      expect(mockSelect).toHaveBeenCalledWith(
        "SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC",
        ["thread-1"],
      );
    });

    it("returns empty array when no messages", async () => {
      mockSelect.mockResolvedValue([]);
      const messages = await getMessages("thread-1");
      expect(messages).toEqual([]);
    });
  });

  describe("insertMessage", () => {
    it("inserts message with sync tracking", async () => {
      mockExecute.mockResolvedValue(undefined);

      const message: Message = {
        id: "msg-1",
        threadId: "thread-1",
        role: "user",
        content: "Hello world",
        createdAt: 1000,
      };

      await insertMessage(message);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(coreMocks.getDeviceId).toHaveBeenCalled();
      expect(coreMocks.nextSyncVersion).toHaveBeenCalledWith(mockDb, "messages");

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO messages");
      expect(params[0]).toBe("msg-1");
      expect(params[1]).toBe("thread-1");
      expect(params[2]).toBe("user");
      expect(params[3]).toBe("Hello world");
    });

    it("serializes citations and toolCalls as JSON", async () => {
      mockExecute.mockResolvedValue(undefined);

      const message: Message = {
        id: "msg-2",
        threadId: "thread-1",
        role: "assistant",
        content: "Here is the answer",
        citations: [{ source: "book-1" }] as any,
        toolCalls: [{ name: "search", args: {} }] as any,
        createdAt: 2000,
      };

      await insertMessage(message);
      const [, params] = mockExecute.mock.calls[0];
      // citations should be serialized as JSON
      expect(params[4]).toBe('[{"source":"book-1"}]');
      // toolCalls should be serialized as JSON
      expect(params[5]).toBe('[{"name":"search","args":{}}]');
    });
  });
});
