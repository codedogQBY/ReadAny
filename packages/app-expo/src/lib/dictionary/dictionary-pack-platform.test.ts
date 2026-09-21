import type { DictionaryPackDescriptor } from "@readany/core/dictionary";
import { describe, expect, it, vi } from "vitest";
import {
  type DictionaryValidationDatabase,
  validateDictionaryDatabase,
} from "./dictionary-pack-platform";

vi.mock("@dr.pogodin/react-native-fs", () => ({ hash: vi.fn() }));
vi.mock("expo-file-system", () => ({
  Directory: class {},
  File: class {},
  Paths: { document: { uri: "file:///documents" } },
}));
vi.mock("expo-file-system/legacy", () => ({ createDownloadResumable: vi.fn() }));

const descriptor: DictionaryPackDescriptor = {
  language: "en",
  version: "2026.09",
  schemaVersion: 1,
  sourceEdition: "wordnet-3.1",
  sourceDumpDate: "2011-05-26",
  sizeBytes: 123,
  sha256: "a".repeat(64),
  url: "https://example.test/en.sqlite",
  sourceArchiveUrl: "https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz",
  attributionUrl: "https://wordnet.princeton.edu/",
  license: "WordNet 3.1 License",
};

const expectedColumns = {
  metadata: ["key", "value"],
  entries: [
    "id",
    "language",
    "headword",
    "simplified",
    "traditional",
    "pronunciation",
    "part_of_speech",
  ],
  senses: ["entry_id", "sense_order", "definition"],
  lookup: ["lookup_key", "entry_id", "rank"],
};

class SchemaDatabase implements DictionaryValidationDatabase {
  integrity = "ok";
  objects = [
    { name: "metadata", type: "table", tbl_name: "metadata" },
    { name: "entries", type: "table", tbl_name: "entries" },
    { name: "senses", type: "table", tbl_name: "senses" },
    { name: "lookup", type: "table", tbl_name: "lookup" },
    { name: "lookup_key_rank_idx", type: "index", tbl_name: "lookup" },
  ];
  columns = structuredClone(expectedColumns);
  indexColumns = ["lookup_key", "rank", "entry_id"];
  metadata = new Map<string, string>([
    ["schema_version", "1"],
    ["language", "en"],
    ["version", descriptor.version],
    ["source_edition", descriptor.sourceEdition],
    ["source_dump_date", descriptor.sourceDumpDate],
    ["source_archive_url", descriptor.sourceArchiveUrl],
    ["asset_url", descriptor.url],
    ["attribution_url", descriptor.attributionUrl],
    ["license", descriptor.license],
    ["license_notice", "Complete WordNet license notice."],
    ["creator_attribution", "Princeton University."],
  ]);

  async getFirstAsync<T>(): Promise<T | null> {
    return { integrity_check: this.integrity } as T;
  }

  async getAllAsync<T>(sql: string): Promise<T[]> {
    if (sql.includes("sqlite_master")) return structuredClone(this.objects) as T[];
    const table = /table_info\('([^']+)'\)/.exec(sql)?.[1] as keyof typeof this.columns | undefined;
    if (table) return this.columns[table].map((name) => ({ name })) as T[];
    if (sql.includes("index_info"))
      return this.indexColumns.map((name, seqno) => ({ name, seqno })) as T[];
    if (sql.includes("FROM metadata"))
      return [...this.metadata].map(([key, value]) => ({ key, value })) as T[];
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

describe("dictionary SQLite validation", () => {
  it("returns intrinsic pack metadata after validating the complete schema", async () => {
    await expect(validateDictionaryDatabase(new SchemaDatabase())).resolves.toEqual({
      language: descriptor.language,
      version: descriptor.version,
      schemaVersion: descriptor.schemaVersion,
      sourceEdition: descriptor.sourceEdition,
      sourceDumpDate: descriptor.sourceDumpDate,
      sourceArchiveUrl: descriptor.sourceArchiveUrl,
      url: descriptor.url,
      attributionUrl: descriptor.attributionUrl,
      license: descriptor.license,
      licenseNotice: "Complete WordNet license notice.",
      creatorAttribution: "Princeton University.",
    });
  });

  it("rejects an expected object with the wrong SQLite type", async () => {
    const database = new SchemaDatabase();
    const index = database.objects.find((object) => object.name === "lookup_key_rank_idx");
    if (index) index.type = "table";

    await expect(validateDictionaryDatabase(database)).rejects.toThrow("lookup_key_rank_idx index");
  });

  it("rejects the lookup index when it belongs to another table", async () => {
    const database = new SchemaDatabase();
    const index = database.objects.find((object) => object.name === "lookup_key_rank_idx");
    if (index) index.tbl_name = "entries";

    await expect(validateDictionaryDatabase(database)).rejects.toThrow(
      "lookup_key_rank_idx must belong to lookup",
    );
  });

  it("rejects a table missing a required column", async () => {
    const database = new SchemaDatabase();
    database.columns.entries = database.columns.entries.filter((name) => name !== "headword");

    await expect(validateDictionaryDatabase(database)).rejects.toThrow("entries columns");
  });

  it("rejects a lookup index with the wrong column order", async () => {
    const database = new SchemaDatabase();
    database.indexColumns = ["rank", "lookup_key", "entry_id"];

    await expect(validateDictionaryDatabase(database)).rejects.toThrow("lookup index columns");
  });

  it("rejects metadata whose source and license do not form a supported pair", async () => {
    const database = new SchemaDatabase();
    database.metadata.set("license", "CC BY-SA 4.0");

    await expect(validateDictionaryDatabase(database)).rejects.toThrow("source/license");
  });

  it.each(["license_notice", "creator_attribution"])(
    "rejects blank required metadata %s",
    async (key) => {
      const database = new SchemaDatabase();
      database.metadata.set(key, "   ");

      await expect(validateDictionaryDatabase(database)).rejects.toThrow(key);
    },
  );
});
