import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildDictionaryPack } from "./pack-builder.js";

const fixtureDirectory = resolve(import.meta.dirname, "fixtures");
const temporaryDirectories: string[] = [];
const TEST_LICENSE_NOTICE = "Complete test license notice.";
const TEST_CREATOR_ATTRIBUTION = "Wiktionary contributors.";

async function buildFixture(language: "en" | "zh") {
  const directory = await mkdtemp(join(tmpdir(), "readany-dictionary-pack-"));
  temporaryDirectories.push(directory);
  const outputPath = join(directory, `${language}.sqlite`);

  const descriptor = await buildDictionaryPack({
    language,
    inputPath: join(fixtureDirectory, `${language}.jsonl`),
    outputPath,
    version: "1.2.3",
    sourceEdition: language === "en" ? "enwiktionary" : "zhwiktionary",
    license: "CC BY-SA 4.0",
    sourceDumpDate: "2026-09-03",
    sourceArchiveUrl: `https://example.invalid/${language}-archive`,
    attributionUrl: `https://example.invalid/${language}-attribution`,
    licenseNotice: TEST_LICENSE_NOTICE,
    creatorAttribution: TEST_CREATOR_ATTRIBUTION,
    assetUrl: `https://example.invalid/${language}.sqlite`,
  });

  return { descriptor, outputPath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      const { rm } = await import("node:fs/promises");
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("buildDictionaryPack", () => {
  it("resolves Chinese hard, soft, and chained redirects without cycle or missing-target rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readany-dictionary-redirects-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "zh.sqlite");

    await buildDictionaryPack({
      language: "zh",
      inputPath: join(fixtureDirectory, "zh-redirects.jsonl"),
      outputPath,
      version: "1.2.3",
      sourceEdition: "zhwiktionary",
      license: "CC BY-SA 4.0",
      sourceDumpDate: "2026-09-03",
      sourceArchiveUrl: "https://example.invalid/zh-archive",
      attributionUrl: "https://example.invalid/zh-attribution",
      licenseNotice: TEST_LICENSE_NOTICE,
      creatorAttribution: TEST_CREATOR_ATTRIBUTION,
      assetUrl: "https://example.invalid/zh.sqlite",
    });

    const database = new Database(outputPath, { readonly: true });
    try {
      const redirected = database
        .prepare(`
          SELECT l.lookup_key, l.rank, e.headword
          FROM lookup l
          JOIN entries e ON e.id = l.entry_id
          WHERE l.lookup_key IN ('首页', '锂', '日语')
          ORDER BY l.lookup_key, e.id
        `)
        .all();
      expect(redirected).toEqual([
        { lookup_key: "日语", rank: 1, headword: "日語" },
        { lookup_key: "锂", rank: 1, headword: "鋰" },
        { lookup_key: "首页", rank: 1, headword: "首頁" },
      ]);
      expect(
        database
          .prepare(
            "SELECT COUNT(*) FROM lookup WHERE lookup_key IN ('循环甲', '循环乙', '失踪词', 'unsupported-alias', '錯誤語言')",
          )
          .pluck()
          .get(),
      ).toBe(0);
      expect(database.pragma("foreign_key_check")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("builds deterministic English and Chinese SQLite packs with lookup aliases", async () => {
    const [english, chinese] = await Promise.all([buildFixture("en"), buildFixture("zh")]);
    const englishDatabase = new Database(english.outputPath, { readonly: true });
    const chineseDatabase = new Database(chinese.outputPath, { readonly: true });

    try {
      expect(
        englishDatabase
          .prepare("SELECT value FROM metadata WHERE key = 'schema_version'")
          .pluck()
          .get(),
      ).toBe("1");
      expect(
        chineseDatabase
          .prepare("SELECT value FROM metadata WHERE key = 'schema_version'")
          .pluck()
          .get(),
      ).toBe("1");
      expect(
        englishDatabase
          .prepare("SELECT value FROM metadata WHERE key = 'source_archive_url'")
          .pluck()
          .get(),
      ).toBe("https://example.invalid/en-archive");
      expect(
        englishDatabase
          .prepare("SELECT value FROM metadata WHERE key = 'attribution_url'")
          .pluck()
          .get(),
      ).toBe("https://example.invalid/en-attribution");
      expect(
        englishDatabase
          .prepare("SELECT value FROM metadata WHERE key = 'license_notice'")
          .pluck()
          .get(),
      ).toBe(TEST_LICENSE_NOTICE);
      expect(
        englishDatabase
          .prepare("SELECT value FROM metadata WHERE key = 'creator_attribution'")
          .pluck()
          .get(),
      ).toBe(TEST_CREATOR_ATTRIBUTION);
      expect(
        englishDatabase
          .prepare("SELECT entry_id FROM lookup WHERE lookup_key = ?")
          .pluck()
          .get("desires"),
      ).toBeTypeOf("number");
      expect(
        englishDatabase
          .prepare("SELECT rank FROM lookup WHERE lookup_key = ?")
          .pluck()
          .get("desire"),
      ).toBe(0);
      expect(
        englishDatabase
          .prepare("SELECT rank FROM lookup WHERE lookup_key = ?")
          .pluck()
          .get("desires"),
      ).toBe(1);
      expect(
        chineseDatabase
          .prepare("SELECT entry_id FROM lookup WHERE lookup_key = ?")
          .pluck()
          .get("阅读"),
      ).toBeTypeOf("number");
      expect(
        englishDatabase.prepare("SELECT definition FROM senses ORDER BY sense_order").pluck().all(),
      ).toContain("A strong wish.");

      expect(englishDatabase.prepare("SELECT pronunciation FROM entries").pluck().get()).toBe(
        "/dɪˈzaɪəɹ/",
      );
      expect(chineseDatabase.prepare("SELECT pronunciation FROM entries").pluck().get()).toBe(
        "yuèdú",
      );
      expect(chineseDatabase.prepare("SELECT simplified FROM entries").pluck().get()).toBe("阅读");
      expect(chineseDatabase.prepare("SELECT traditional FROM entries").pluck().get()).toBe("閱讀");
    } finally {
      englishDatabase.close();
      chineseDatabase.close();
    }

    const databaseText = await Promise.all([
      readFile(english.outputPath),
      readFile(chinese.outputPath),
    ]).then((files) => Buffer.concat(files).toString("utf8"));
    for (const forbiddenText of [
      "Her desire was strong.",
      "閱讀是一種樂趣。",
      "EN_TRANSLATION_SHOULD_NOT_APPEAR",
      "ZH_TRANSLATION_SHOULD_NOT_APPEAR",
      "https://example.invalid/desire.png",
      "https://example.invalid/read.ogg",
    ]) {
      expect(databaseText).not.toContain(forbiddenText);
    }

    expect(english.descriptor).toMatchObject({
      language: "en",
      schemaVersion: 1,
      sourceEdition: "enwiktionary",
      url: "https://example.invalid/en.sqlite",
      sourceArchiveUrl: "https://example.invalid/en-archive",
      attributionUrl: "https://example.invalid/en-attribution",
      license: "CC BY-SA 4.0",
    });
    expect(chinese.descriptor).toMatchObject({ language: "zh", schemaVersion: 1 });
  });

  it("skips a record whose canonical headword cannot become an English lookup key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readany-dictionary-unnormalizable-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "en.sqlite");

    await buildDictionaryPack({
      language: "en",
      inputPath: join(fixtureDirectory, "en-unnormalizable-canonical.jsonl"),
      outputPath,
      version: "1.2.3",
      sourceEdition: "enwiktionary",
      license: "CC BY-SA 4.0",
      sourceDumpDate: "2026-09-03",
      sourceArchiveUrl: "https://example.invalid/en-archive",
      attributionUrl: "https://example.invalid/en-attribution",
      licenseNotice: TEST_LICENSE_NOTICE,
      creatorAttribution: TEST_CREATOR_ATTRIBUTION,
      assetUrl: "https://example.invalid/en.sqlite",
    });

    const database = new Database(outputPath, { readonly: true });
    try {
      expect(database.prepare("SELECT COUNT(*) FROM entries").pluck().get()).toBe(0);
      expect(database.prepare("SELECT COUNT(*) FROM lookup").pluck().get()).toBe(0);
    } finally {
      database.close();
    }
  });

  it.each([
    ["license notice", { licenseNotice: "" }],
    ["creator attribution", { creatorAttribution: "   " }],
  ])("rejects an empty %s before creating a pack", async (_name, override) => {
    const directory = await mkdtemp(join(tmpdir(), "readany-dictionary-empty-notice-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "en.sqlite");

    await expect(
      buildDictionaryPack({
        language: "en",
        inputPath: join(fixtureDirectory, "en.jsonl"),
        outputPath,
        version: "1.2.3",
        sourceEdition: "enwiktionary",
        license: "CC BY-SA 4.0",
        sourceDumpDate: "2026-09-03",
        sourceArchiveUrl: "https://example.invalid/en-archive",
        attributionUrl: "https://example.invalid/en-attribution",
        licenseNotice: TEST_LICENSE_NOTICE,
        creatorAttribution: TEST_CREATOR_ATTRIBUTION,
        assetUrl: "https://example.invalid/en.sqlite",
        ...override,
      }),
    ).rejects.toThrow(/license notice|creator attribution/i);
    expect(existsSync(outputPath)).toBe(false);
  });

  it("builds WordNet metadata and keeps deterministic exception aliases", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readany-dictionary-wordnet-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "en.sqlite");

    const descriptor = await buildDictionaryPack({
      language: "en",
      inputPath: join(fixtureDirectory, "en-wordnet.jsonl"),
      outputPath,
      version: "1.0.0",
      sourceEdition: "wordnet-3.1",
      sourceDumpDate: "2011-05-26",
      sourceArchiveUrl: "https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz",
      attributionUrl: "https://wordnet.princeton.edu/license-and-commercial-use",
      licenseNotice: "Complete WordNet license notice.",
      creatorAttribution: "Princeton University.",
      assetUrl: "https://example.invalid/en.sqlite",
      license: "WordNet 3.1 License",
    });

    const database = new Database(outputPath, { readonly: true });
    try {
      expect(
        database.prepare("SELECT value FROM metadata WHERE key = 'source_edition'").pluck().get(),
      ).toBe("wordnet-3.1");
      expect(
        database.prepare("SELECT value FROM metadata WHERE key = 'license'").pluck().get(),
      ).toBe("WordNet 3.1 License");
      expect(
        database.prepare("SELECT rank FROM lookup WHERE lookup_key = 'children'").pluck().get(),
      ).toBe(1);
    } finally {
      database.close();
    }
    expect(descriptor).toMatchObject({
      language: "en",
      sourceEdition: "wordnet-3.1",
      license: "WordNet 3.1 License",
    });
  });

  it("builds a validated, pretty-printed descriptor from the required command arguments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readany-dictionary-command-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "en.sqlite");
    const descriptorPath = join(directory, "en.json");
    const scriptPath = resolve(import.meta.dirname, "../../scripts/build-dictionary-pack.ts");
    const tsxPath = resolve(import.meta.dirname, "../../../../node_modules/tsx/dist/cli.mjs");
    const result = spawnSync(
      process.execPath,
      [
        tsxPath,
        scriptPath,
        "--language",
        "en",
        "--input",
        join(fixtureDirectory, "en.jsonl"),
        "--output",
        outputPath,
        "--version",
        "1.2.3",
        "--source-edition",
        "enwiktionary",
        "--license",
        "CC BY-SA 4.0",
        "--source-date",
        "2026-09-03",
        "--source-archive-url",
        "https://example.invalid/en-archive",
        "--attribution-url",
        "https://example.invalid/en-attribution",
        "--license-file",
        join(fixtureDirectory, "test-license.txt"),
        "--creator-attribution",
        TEST_CREATOR_ATTRIBUTION,
        "--asset-url",
        "https://example.invalid/en.sqlite",
        "--descriptor",
        descriptorPath,
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(descriptorPath, "utf8")).toBe(
      `${JSON.stringify(JSON.parse(await readFile(descriptorPath, "utf8")), null, 2)}\n`,
    );
  });

  it.each(["01.2.3", "1.2.3-01"])(
    "rejects non-SemVer version %s before creating output files",
    async (version) => {
      const directory = await mkdtemp(join(tmpdir(), "readany-dictionary-invalid-semver-"));
      temporaryDirectories.push(directory);
      const outputPath = join(directory, "en.sqlite");
      const descriptorPath = join(directory, "en.json");
      const scriptPath = resolve(import.meta.dirname, "../../scripts/build-dictionary-pack.ts");
      const tsxPath = resolve(import.meta.dirname, "../../../../node_modules/tsx/dist/cli.mjs");
      const result = spawnSync(
        process.execPath,
        [
          tsxPath,
          scriptPath,
          "--language",
          "en",
          "--input",
          join(fixtureDirectory, "en.jsonl"),
          "--output",
          outputPath,
          "--version",
          version,
          "--source-edition",
          "enwiktionary",
          "--license",
          "CC BY-SA 4.0",
          "--source-date",
          "2026-09-03",
          "--source-archive-url",
          "https://example.invalid/en-archive",
          "--attribution-url",
          "https://example.invalid/en-attribution",
          "--license-file",
          join(fixtureDirectory, "test-license.txt"),
          "--creator-attribution",
          TEST_CREATOR_ATTRIBUTION,
          "--asset-url",
          "https://example.invalid/en.sqlite",
          "--descriptor",
          descriptorPath,
        ],
        { encoding: "utf8" },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--version must be a semver value");
      expect(existsSync(outputPath)).toBe(false);
      expect(existsSync(descriptorPath)).toBe(false);
    },
  );
});
