import { describe, expect, it } from "vitest";
import { parseDictionaryManifest } from "./manifest";

const validPack = {
  language: "en",
  version: "2026.9.3",
  schemaVersion: 1,
  sourceEdition: "wordnet-3.1",
  sourceDumpDate: "2011-05-26",
  sizeBytes: 123,
  sha256: "a".repeat(64),
  url: "https://cdn.example.com/dictionaries/en.sqlite3",
  sourceArchiveUrl: "https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz",
  attributionUrl: "https://wordnet.princeton.edu/",
  license: "WordNet 3.1 License",
} as const;

function validManifest() {
  return {
    manifestVersion: 1,
    packs: {
      en: validPack,
      zh: {
        ...validPack,
        language: "zh",
        sourceEdition: "zhwiktionary",
        sourceDumpDate: "2026-09-01",
        url: "https://cdn.example.com/dictionaries/zh.sqlite3",
        sourceArchiveUrl:
          "https://dumps.wikimedia.org/zhwiktionary/20260901/zhwiktionary-20260901-pages-articles.xml.bz2",
        attributionUrl:
          "https://zh.wiktionary.org/wiki/Wiktionary:%E7%89%88%E6%9D%83%E4%BF%A1%E6%81%AF",
        license: "CC BY-SA 4.0",
      },
    },
  };
}

describe("parseDictionaryManifest", () => {
  it("parses valid English and Chinese descriptors", () => {
    expect(parseDictionaryManifest(validManifest())).toEqual(validManifest());
  });

  it("continues to accept an English Wiktionary descriptor", () => {
    const manifest = validManifest();
    manifest.packs.en = {
      ...manifest.packs.en,
      sourceEdition: "enwiktionary",
      sourceDumpDate: "2026-09-01",
      attributionUrl: "https://en.wiktionary.org/wiki/Wiktionary:Copyrights",
      license: "CC BY-SA 4.0",
    } as typeof manifest.packs.en;

    expect(parseDictionaryManifest(manifest)).toEqual(manifest);
  });

  it.each([
    ["WordNet with the Wiktionary license", "wordnet-3.1", "CC BY-SA 4.0"],
    ["English Wiktionary with the WordNet license", "enwiktionary", "WordNet 3.1 License"],
  ])("rejects %s", (_description, sourceEdition, license) => {
    const manifest = validManifest();
    const invalid = {
      ...manifest,
      packs: { ...manifest.packs, en: { ...manifest.packs.en, sourceEdition, license } },
    };

    expect(() => parseDictionaryManifest(invalid)).toThrow();
  });

  it.each(["1", "1.2", "01.2.3", "1.02.3", "1.2.03", "1.2.3-01", "v1.2.3"])(
    "rejects non-SemVer version %s",
    (version) => {
      const manifest = validManifest();
      expect(() =>
        parseDictionaryManifest({
          ...manifest,
          packs: { ...manifest.packs, en: { ...manifest.packs.en, version } },
        }),
      ).toThrow();
    },
  );

  it.each(["2026-02-30", "2026-13-01", "2026-9-01", "not-a-date"])(
    "rejects invalid source date %s",
    (sourceDumpDate) => {
      const manifest = validManifest();
      expect(() =>
        parseDictionaryManifest({
          ...manifest,
          packs: { ...manifest.packs, en: { ...manifest.packs.en, sourceDumpDate } },
        }),
      ).toThrow();
    },
  );

  it("accepts a pack exactly at the 150 MiB limit", () => {
    const manifest = validManifest();
    manifest.packs.en = { ...manifest.packs.en, sizeBytes: 150 * 1024 * 1024 };
    expect(parseDictionaryManifest(manifest)).toEqual(manifest);
  });

  it.each([150 * 1024 * 1024 + 1, 1.5, 0])("rejects invalid pack size %s", (sizeBytes) => {
    const manifest = validManifest();
    expect(() =>
      parseDictionaryManifest({
        ...manifest,
        packs: { ...manifest.packs, en: { ...manifest.packs.en, sizeBytes } },
      }),
    ).toThrow();
  });

  it.each(["http://example.test/file", "file:///tmp/file", "javascript:alert(1)"])(
    "rejects non-HTTPS URL %s in every URL field",
    (url) => {
      for (const field of ["url", "sourceArchiveUrl", "attributionUrl"] as const) {
        const manifest = validManifest();
        expect(() =>
          parseDictionaryManifest({
            ...manifest,
            packs: { ...manifest.packs, en: { ...manifest.packs.en, [field]: url } },
          }),
        ).toThrow();
      }
    },
  );

  it.each([
    [
      "an invalid URL",
      (manifest: ReturnType<typeof validManifest>) => ({
        ...manifest,
        packs: { ...manifest.packs, en: { ...manifest.packs.en, url: "not-a-url" } },
      }),
    ],
    [
      "a non-hex SHA-256",
      (manifest: ReturnType<typeof validManifest>) => ({
        ...manifest,
        packs: { ...manifest.packs, en: { ...manifest.packs.en, sha256: "z".repeat(64) } },
      }),
    ],
    [
      "a non-positive byte size",
      (manifest: ReturnType<typeof validManifest>) => ({
        ...manifest,
        packs: { ...manifest.packs, en: { ...manifest.packs.en, sizeBytes: 0 } },
      }),
    ],
    [
      "a wrong language key",
      (manifest: ReturnType<typeof validManifest>) => ({
        ...manifest,
        packs: { ...manifest.packs, en: { ...manifest.packs.en, language: "zh" } },
      }),
    ],
    [
      "a schema version other than 1",
      (manifest: ReturnType<typeof validManifest>) => ({
        ...manifest,
        packs: { ...manifest.packs, en: { ...manifest.packs.en, schemaVersion: 2 } },
      }),
    ],
    [
      "an unknown descriptor field",
      (manifest: ReturnType<typeof validManifest>) => ({
        ...manifest,
        packs: { ...manifest.packs, en: { ...manifest.packs.en, extra: true } },
      }),
    ],
  ])("rejects %s", (_description, invalidManifest) => {
    expect(() => parseDictionaryManifest(invalidManifest(validManifest()))).toThrow();
  });
});
