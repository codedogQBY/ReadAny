import { describe, expect, it, vi } from "vitest";
import {
  cleanupOrphanedSyncRows,
  deserializeEmbedding,
  parseJSON,
  serializeEmbedding,
} from "../db-core";

describe("parseJSON", () => {
  it("parses valid JSON string", () => {
    expect(parseJSON('["a","b"]', [])).toEqual(["a", "b"]);
  });

  it("returns fallback for null input", () => {
    expect(parseJSON(null, [])).toEqual([]);
  });

  it("returns fallback for undefined input", () => {
    expect(parseJSON(undefined, "default")).toBe("default");
  });

  it("returns fallback for empty string", () => {
    expect(parseJSON("", { key: "val" })).toEqual({ key: "val" });
  });

  it("returns fallback for invalid JSON", () => {
    expect(parseJSON("{broken", 42)).toBe(42);
  });

  it("parses nested objects", () => {
    const input = '{"a":{"b":1},"c":[2,3]}';
    expect(parseJSON(input, null)).toEqual({ a: { b: 1 }, c: [2, 3] });
  });
});

describe("serializeEmbedding / deserializeEmbedding", () => {
  it("round-trips a float32 array", () => {
    const original = [0.1, 0.2, 0.3, -0.5, 1.0];
    const serialized = serializeEmbedding(original);
    expect(serialized).toBeInstanceOf(Uint8Array);
    expect(serialized!.byteLength).toBe(original.length * 4);

    const deserialized = deserializeEmbedding(serialized);
    expect(deserialized).toBeDefined();
    expect(deserialized!.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(deserialized![i]).toBeCloseTo(original[i], 5);
    }
  });

  it("returns null for undefined embedding", () => {
    expect(serializeEmbedding(undefined)).toBeNull();
  });

  it("returns null for empty embedding", () => {
    expect(serializeEmbedding([])).toBeNull();
  });

  it("returns undefined for null data", () => {
    expect(deserializeEmbedding(null)).toBeUndefined();
  });

  it("returns undefined for undefined data", () => {
    expect(deserializeEmbedding(undefined)).toBeUndefined();
  });

  it("returns undefined for empty Uint8Array", () => {
    expect(deserializeEmbedding(new Uint8Array(0))).toBeUndefined();
  });

  it("handles single-element embedding", () => {
    const original = [3.14];
    const serialized = serializeEmbedding(original);
    const deserialized = deserializeEmbedding(serialized);
    expect(deserialized!.length).toBe(1);
    expect(deserialized![0]).toBeCloseTo(3.14, 5);
  });

  it("handles large embedding", () => {
    const original = Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.01));
    const serialized = serializeEmbedding(original);
    const deserialized = deserializeEmbedding(serialized);
    expect(deserialized!.length).toBe(384);
    for (let i = 0; i < 10; i++) {
      expect(deserialized![i]).toBeCloseTo(original[i], 5);
    }
  });
});

describe("cleanupOrphanedSyncRows", () => {
  it("cleans stale knowledge graph rows without flattening folder orphans", async () => {
    const execute = vi.fn(async (_sql: string, _params?: unknown[]) => undefined);

    await cleanupOrphanedSyncRows({
      execute,
      select: vi.fn(async () => []),
      close: vi.fn(async () => undefined),
    });

    const sql = execute.mock.calls.map(([statement]) =>
      String(statement).replace(/\s+/g, " ").trim(),
    );

    expect(sql).toEqual(
      expect.arrayContaining([
        expect.stringContaining("DELETE FROM knowledge_documents WHERE book_id IS NOT NULL"),
        expect.stringContaining(
          "DELETE FROM knowledge_links WHERE from_document_id NOT IN (SELECT id FROM knowledge_documents)",
        ),
        expect.stringContaining(
          "DELETE FROM knowledge_links WHERE to_kind = 'document' AND to_id NOT IN",
        ),
        expect.stringContaining("UPDATE knowledge_attachments SET document_id = NULL"),
      ]),
    );
    expect(sql.some((statement) => statement.includes("parent_id NOT IN"))).toBe(false);
  });
});
