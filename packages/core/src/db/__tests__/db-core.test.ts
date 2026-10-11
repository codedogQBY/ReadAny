import { describe, expect, it, vi } from "vitest";

const platformMocks = vi.hoisted(() => ({
  kvGetItem: vi.fn(async () => "device-test"),
  kvSetItem: vi.fn(async () => undefined),
}));

vi.mock("../../services/platform", () => ({
  getPlatformService: () => platformMocks,
}));

const {
  parseJSON,
  serializeEmbedding,
  deserializeEmbedding,
  purgeOrphanPageNoteRows,
} = await import("../db-core");

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

function makeFakeDb(
  options: {
    pendingRows?: Array<{ id: string; book_id: string | null }>;
    purgeAlreadyDone?: boolean;
    tombstoneWritable?: boolean;
  } = {},
) {
  const { pendingRows = [], purgeAlreadyDone = false, tombstoneWritable = true } = options;
  const executed: Array<{ sql: string; params?: unknown[] }> = [];
  const selected: string[] = [];

  const db = {
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      executed.push({ sql, params });
    }),
    select: vi.fn(async (sql: string, params?: unknown[]) => {
      selected.push(sql);
      if (sql.includes("orphan_page_note_purge_done")) {
        return purgeAlreadyDone ? [{ value: "1" }] : [];
      }
      if (sql.includes("FROM sync_tombstones")) {
        return tombstoneWritable ? [{ id: params?.[0] as string }] : [];
      }
      if (sql.includes("FROM highlights")) return pendingRows;
      return [];
    }),
    close: vi.fn(),
  };

  return { db, executed, selected };
}

describe("purgeOrphanPageNoteRows", () => {
  it("deletes empty page-note rows and writes a tombstone so the deletion syncs", async () => {
    const { db, executed } = makeFakeDb({
      pendingRows: [{ id: "hl-orphan", book_id: "book-1" }],
    });

    const removed = await purgeOrphanPageNoteRows(db as never);

    expect(removed).toBe(1);
    expect(executed.map((entry) => entry.sql)).toEqual([
      "INSERT OR REPLACE INTO sync_tombstones (id, table_name, deleted_at, device_id, book_id) VALUES (?, ?, ?, ?, ?)",
      "DELETE FROM highlights WHERE id = ?",
      "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('orphan_page_note_purge_done', '1')",
    ]);
    expect(executed[0]?.params?.slice(0, 2)).toEqual(["hl-orphan", "highlights"]);
    expect(executed[1]?.params).toEqual(["hl-orphan"]);
  });

  it("keeps the row when no tombstone could be written", async () => {
    // Without a tombstone the next sync pull would restore the row, so the purge
    // must leave it alone rather than delete something that comes straight back.
    const { db, executed } = makeFakeDb({
      pendingRows: [{ id: "hl-orphan", book_id: "book-1" }],
      tombstoneWritable: false,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(await purgeOrphanPageNoteRows(db as never)).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }

    expect(executed.some((entry) => entry.sql.startsWith("DELETE FROM highlights"))).toBe(false);
  });

  it("is a no-op once it has run", async () => {
    const { db, executed } = makeFakeDb({ purgeAlreadyDone: true });
    expect(await purgeOrphanPageNoteRows(db as never)).toBe(0);
    expect(executed).toEqual([]);
  });

  it("only selects rows with no note, no selected text, and a point anchor", async () => {
    const { db, selected } = makeFakeDb();
    await purgeOrphanPageNoteRows(db as never);

    const query = selected.find((sql) => sql.includes("FROM highlights")) ?? "";
    expect(query).toContain("TRIM(note) = ''");
    expect(query).toContain("TRIM(text) = ''");
    // A foliate range CFI carries a comma; text-less frame highlights in scanned
    // PDFs keep theirs and must survive.
    expect(query).toContain("cfi NOT LIKE '%,%'");
  });
});
