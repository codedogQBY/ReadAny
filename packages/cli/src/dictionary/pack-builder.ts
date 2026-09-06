import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import readline from "node:readline";
import {
  type DictionaryLanguage,
  type DictionaryPackDescriptor,
  type DictionarySource,
  prepareDictionarySelection,
} from "@readany/core/dictionary";
import Database from "better-sqlite3";
import { DICTIONARY_SCHEMA_SQL, DICTIONARY_SCHEMA_VERSION } from "./schema.js";

const ACCEPTED_FORM_TAGS: Record<DictionaryLanguage, ReadonlySet<string>> = {
  en: new Set(["plural", "past", "present", "participle", "wordnet-exception"]),
  zh: new Set(["Simplified-Chinese", "Traditional-Chinese"]),
};

const TRANSFORMED_BY = "ReadAny offline dictionary pack builder";

interface WiktionarySound {
  ipa?: unknown;
  "zh-pron"?: unknown;
}

interface WiktionaryForm {
  form?: unknown;
  tags?: unknown;
}

interface WiktionarySense {
  glosses?: unknown;
}

interface WiktionaryRecord {
  title?: unknown;
  redirect?: unknown;
  redirects?: unknown;
  word?: unknown;
  lang_code?: unknown;
  pos?: unknown;
  sounds?: unknown;
  forms?: unknown;
  senses?: unknown;
}

type RedirectGraph = Map<string, Set<string>>;

interface PendingEntry {
  headword: string;
  simplified?: string;
  traditional?: string;
  pronunciation?: string;
  partOfSpeech: string;
  definitions: string[];
  lookupRanks: Map<string, number>;
}

interface DictionaryPackBuildOptionsBase {
  inputPath: string;
  outputPath: string;
  version: string;
  sourceDumpDate: string;
  sourceArchiveUrl: string;
  attributionUrl: string;
  licenseNotice: string;
  creatorAttribution: string;
  assetUrl: string;
}

export type DictionaryPackBuildOptions = DictionaryPackBuildOptionsBase & DictionarySource;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = nonEmptyString(item);
    return text ? [text] : [];
  });
}

function firstSound(sounds: unknown, property: keyof WiktionarySound): string | undefined {
  if (!Array.isArray(sounds)) return undefined;
  for (const sound of sounds as WiktionarySound[]) {
    const value = nonEmptyString(sound?.[property]);
    if (value) return value;
  }
  return undefined;
}

function normalizeLookupKey(value: string, language: DictionaryLanguage): string | undefined {
  const selection = prepareDictionarySelection(value);
  return selection.ok && selection.language === language ? selection.key : undefined;
}

function normalizeAlias(value: string): string {
  return value.normalize("NFKC").trim();
}

function collectChineseRedirect(record: WiktionaryRecord, graph: RedirectGraph): void {
  const isHardRedirect = record.pos === "hard-redirect";
  const isSoftRedirect = record.pos === "soft-redirect" && record.lang_code === "zh";
  if (!isHardRedirect && !isSoftRedirect) return;

  const alias = normalizeLookupKey(
    nonEmptyString(isHardRedirect ? record.title : record.word) ?? "",
    "zh",
  );
  const targets = isHardRedirect
    ? [nonEmptyString(record.redirect)].filter((target): target is string => Boolean(target))
    : stringArray(record.redirects);
  if (!alias) return;

  for (const target of targets) {
    const normalizedTarget = normalizeLookupKey(target, "zh");
    if (!normalizedTarget || normalizedTarget === alias) continue;
    const existingTargets = graph.get(alias) ?? new Set<string>();
    existingTargets.add(normalizedTarget);
    graph.set(alias, existingTargets);
  }
}

function resolvedRedirectTargets(
  alias: string,
  graph: RedirectGraph,
  canonicalKeys: ReadonlySet<string>,
  memo: Map<string, ReadonlySet<string>>,
  visiting = new Set<string>(),
): ReadonlySet<string> {
  if (canonicalKeys.has(alias)) return new Set([alias]);
  const cached = memo.get(alias);
  if (cached) return cached;
  if (visiting.has(alias)) return new Set();

  visiting.add(alias);
  const resolved = new Set<string>();
  for (const target of [...(graph.get(alias) ?? [])].sort()) {
    for (const canonicalTarget of resolvedRedirectTargets(
      target,
      graph,
      canonicalKeys,
      memo,
      visiting,
    )) {
      resolved.add(canonicalTarget);
    }
  }
  visiting.delete(alias);
  memo.set(alias, resolved);
  return resolved;
}

function prepareEntry(
  record: WiktionaryRecord,
  language: DictionaryLanguage,
): PendingEntry | undefined {
  if (record.lang_code !== language) return undefined;

  const headword = nonEmptyString(record.word);
  if (!headword) return undefined;
  const definitions = Array.isArray(record.senses)
    ? (record.senses as WiktionarySense[]).flatMap((sense) => stringArray(sense?.glosses))
    : [];
  if (definitions.length === 0) return undefined;

  const lookupRanks = new Map<string, number>();
  const canonicalKey = normalizeLookupKey(headword, language);
  if (!canonicalKey) return undefined;
  lookupRanks.set(canonicalKey, 0);

  let simplified: string | undefined;
  let traditional: string | undefined;
  if (Array.isArray(record.forms)) {
    for (const form of record.forms as WiktionaryForm[]) {
      const alias = nonEmptyString(form?.form);
      if (!alias) continue;
      const tags = new Set(stringArray(form?.tags));
      if (![...tags].some((tag) => ACCEPTED_FORM_TAGS[language].has(tag))) continue;

      const normalizedAlias = normalizeLookupKey(alias, language);
      if (normalizedAlias && !lookupRanks.has(normalizedAlias)) {
        lookupRanks.set(normalizedAlias, 1);
      }
      if (language === "zh" && tags.has("Simplified-Chinese")) {
        simplified ??= normalizeAlias(alias);
      }
      if (language === "zh" && tags.has("Traditional-Chinese")) {
        traditional ??= normalizeAlias(alias);
      }
    }
  }

  return {
    headword: normalizeAlias(headword),
    simplified,
    traditional,
    pronunciation: firstSound(record.sounds, language === "en" ? "ipa" : "zh-pron"),
    partOfSpeech: nonEmptyString(record.pos) ?? "unknown",
    definitions,
    lookupRanks,
  };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function assertSqliteChecks(database: Database.Database): void {
  const foreignKeyViolations = database.pragma("foreign_key_check") as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new Error("Dictionary pack foreign key check failed");
  }
  const integrity = database.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") {
    throw new Error(`Dictionary pack integrity check failed: ${String(integrity)}`);
  }
}

export async function buildDictionaryPack(
  options: DictionaryPackBuildOptions,
): Promise<DictionaryPackDescriptor> {
  if (!options.licenseNotice.trim()) throw new Error("Dictionary license notice is required");
  if (!options.creatorAttribution.trim())
    throw new Error("Dictionary creator attribution is required");
  const database = new Database(options.outputPath);
  try {
    database.exec(DICTIONARY_SCHEMA_SQL);
    const insertMetadata = database.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)");
    const insertEntry = database.prepare(`
      INSERT INTO entries (language, headword, simplified, traditional, pronunciation, part_of_speech)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertSense = database.prepare(
      "INSERT INTO senses (entry_id, sense_order, definition) VALUES (?, ?, ?)",
    );
    const insertLookup = database.prepare(
      "INSERT INTO lookup (lookup_key, entry_id, rank) VALUES (?, ?, ?)",
    );
    const insertRedirectLookup = database.prepare(`
      INSERT OR IGNORE INTO lookup (lookup_key, entry_id, rank)
      SELECT ?, entry_id, 1
      FROM lookup
      WHERE lookup_key = ? AND rank = 0
      ORDER BY entry_id
    `);

    const metadata: ReadonlyArray<readonly [string, string]> = [
      ["schema_version", String(DICTIONARY_SCHEMA_VERSION)],
      ["language", options.language],
      ["version", options.version],
      ["source_edition", options.sourceEdition],
      ["source_dump_date", options.sourceDumpDate],
      ["source_archive_url", options.sourceArchiveUrl],
      ["asset_url", options.assetUrl],
      ["license", options.license],
      ["license_notice", options.licenseNotice],
      ["creator_attribution", options.creatorAttribution],
      ["attribution_url", options.attributionUrl],
      ["transformed_by", TRANSFORMED_BY],
    ];
    database.transaction(() => {
      for (const [key, value] of metadata) insertMetadata.run(key, value);
    })();

    const insertBatch = database.transaction((entries: PendingEntry[]) => {
      for (const entry of entries) {
        const entryId = Number(
          insertEntry.run(
            options.language,
            entry.headword,
            entry.simplified ?? null,
            entry.traditional ?? null,
            entry.pronunciation ?? null,
            entry.partOfSpeech,
          ).lastInsertRowid,
        );
        for (const [index, definition] of entry.definitions.entries()) {
          insertSense.run(entryId, index, definition);
        }
        for (const [lookupKey, rank] of entry.lookupRanks) {
          insertLookup.run(lookupKey, entryId, rank);
        }
      }
    });

    const lines = readline.createInterface({
      input: createReadStream(options.inputPath, { encoding: "utf8" }),
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    let lineNumber = 0;
    let batch: PendingEntry[] = [];
    const redirects: RedirectGraph = new Map();
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) continue;
      let parsed: WiktionaryRecord;
      try {
        parsed = JSON.parse(line) as WiktionaryRecord;
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${lineNumber}: ${String(error)}`);
      }
      if (options.language === "zh") collectChineseRedirect(parsed, redirects);
      const entry = prepareEntry(parsed, options.language);
      if (!entry) continue;
      batch.push(entry);
      if (batch.length === 5_000) {
        insertBatch(batch);
        batch = [];
      }
    }
    if (batch.length > 0) insertBatch(batch);

    const canonicalKeys = new Set(
      database
        .prepare("SELECT DISTINCT lookup_key FROM lookup WHERE rank = 0 ORDER BY lookup_key")
        .pluck()
        .all() as string[],
    );
    const resolved = new Map<string, ReadonlySet<string>>();
    database.transaction(() => {
      for (const alias of [...redirects.keys()].sort()) {
        for (const target of [
          ...resolvedRedirectTargets(alias, redirects, canonicalKeys, resolved),
        ].sort()) {
          if (alias !== target) insertRedirectLookup.run(alias, target);
        }
      }
    })();

    assertSqliteChecks(database);
    database.exec("VACUUM");
  } finally {
    database.close();
  }

  const [file, sha256] = await Promise.all([
    stat(options.outputPath),
    sha256File(options.outputPath),
  ]);
  const descriptor = {
    version: options.version,
    schemaVersion: DICTIONARY_SCHEMA_VERSION,
    sourceDumpDate: options.sourceDumpDate,
    sizeBytes: file.size,
    sha256,
    url: options.assetUrl,
    sourceArchiveUrl: options.sourceArchiveUrl,
    attributionUrl: options.attributionUrl,
  };
  if (options.language === "zh") {
    return {
      ...descriptor,
      language: "zh",
      sourceEdition: options.sourceEdition,
      license: options.license,
    };
  }
  if (options.sourceEdition === "wordnet-3.1") {
    return {
      ...descriptor,
      language: "en",
      sourceEdition: options.sourceEdition,
      license: options.license,
    };
  }
  return {
    ...descriptor,
    language: "en",
    sourceEdition: options.sourceEdition,
    license: options.license,
  };
}
