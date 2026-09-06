import type { DictionaryPackMetadata } from "./dictionary-pack-manager";
interface SqliteObjectRow {
  name: string;
  type: string;
  tbl_name: string;
}

interface SqliteColumnRow {
  name: string;
}

interface SqliteIndexColumnRow {
  name: string;
  seqno: number;
}

interface DictionaryMetadataRow {
  key: string;
  value: string;
}

export interface DictionaryValidationDatabase {
  getFirstAsync<T>(sql: string): Promise<T | null>;
  getAllAsync<T>(sql: string): Promise<T[]>;
}

const requiredObjects = new Map<string, string>([
  ["metadata", "table"],
  ["entries", "table"],
  ["senses", "table"],
  ["lookup", "table"],
  ["lookup_key_rank_idx", "index"],
]);

const requiredColumns = {
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
} as const;

const requiredMetadataKeys = [
  "schema_version",
  "language",
  "version",
  "source_edition",
  "source_dump_date",
  "source_archive_url",
  "asset_url",
  "attribution_url",
  "license",
  "license_notice",
  "creator_attribution",
] as const;

export async function validateDictionaryDatabase(
  database: DictionaryValidationDatabase,
): Promise<DictionaryPackMetadata> {
  const integrity = await database.getFirstAsync<{ integrity_check: string }>(
    "PRAGMA integrity_check",
  );
  if (integrity?.integrity_check !== "ok")
    throw new Error("Dictionary SQLite integrity check failed");

  const objects = await database.getAllAsync<SqliteObjectRow>(
    "SELECT name, type, tbl_name FROM sqlite_master WHERE name IN ('metadata', 'entries', 'senses', 'lookup', 'lookup_key_rank_idx')",
  );
  const objectsByName = new Map(objects.map((object) => [object.name, object]));
  for (const [name, type] of requiredObjects) {
    if (objectsByName.get(name)?.type !== type)
      throw new Error(`Dictionary SQLite schema requires ${name} ${type}`);
  }
  if (objectsByName.get("lookup_key_rank_idx")?.tbl_name !== "lookup")
    throw new Error("Dictionary SQLite lookup_key_rank_idx must belong to lookup");

  for (const [table, expectedColumns] of Object.entries(requiredColumns)) {
    const columns = await database.getAllAsync<SqliteColumnRow>(`PRAGMA table_info('${table}')`);
    const actualColumns = columns.map((column) => column.name);
    if (!sameArray(actualColumns, expectedColumns))
      throw new Error(`Dictionary SQLite ${table} columns did not match the required schema`);
  }

  const indexColumns = await database.getAllAsync<SqliteIndexColumnRow>(
    "PRAGMA index_info('lookup_key_rank_idx')",
  );
  const orderedIndexColumns = [...indexColumns]
    .sort((left, right) => left.seqno - right.seqno)
    .map((column) => column.name);
  if (!sameArray(orderedIndexColumns, ["lookup_key", "rank", "entry_id"]))
    throw new Error("Dictionary SQLite lookup index columns were not in the required order");

  const metadataRows = await database.getAllAsync<DictionaryMetadataRow>(
    `SELECT key, value FROM metadata WHERE key IN (${requiredMetadataKeys
      .map((key) => `'${key}'`)
      .join(", ")})`,
  );
  const metadata = new Map(metadataRows.map((row) => [row.key, row.value]));
  const value = (key: (typeof requiredMetadataKeys)[number]): string => {
    const found = metadata.get(key);
    if (!found?.trim()) throw new Error(`Dictionary metadata ${key} is missing`);
    return found;
  };

  const schemaVersion = value("schema_version");
  if (schemaVersion !== "1") throw new Error("Dictionary metadata schema_version is unsupported");
  const language = value("language");
  if (language !== "en" && language !== "zh")
    throw new Error("Dictionary metadata language is unsupported");
  const sourceEdition = value("source_edition");
  const license = value("license");
  const common = {
    version: value("version"),
    sourceDumpDate: value("source_dump_date"),
    sourceArchiveUrl: value("source_archive_url"),
    url: value("asset_url"),
    attributionUrl: value("attribution_url"),
    licenseNotice: value("license_notice"),
    creatorAttribution: value("creator_attribution"),
  };
  if (language === "en" && sourceEdition === "wordnet-3.1" && license === "WordNet 3.1 License") {
    return { ...common, schemaVersion: 1, language, sourceEdition, license };
  }
  if (language === "en" && sourceEdition === "enwiktionary" && license === "CC BY-SA 4.0") {
    return { ...common, schemaVersion: 1, language, sourceEdition, license };
  }
  if (language === "zh" && sourceEdition === "zhwiktionary" && license === "CC BY-SA 4.0") {
    return { ...common, schemaVersion: 1, language, sourceEdition, license };
  }
  throw new Error("Dictionary metadata source/license combination is unsupported");
}

function sameArray(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}
