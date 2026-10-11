import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as dictionaryConfig from "./dictionary-config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("dictionary configuration", () => {
  it("allows a build-time manifest override", async () => {
    vi.stubEnv("EXPO_PUBLIC_DICTIONARY_MANIFEST_URL", "https://example.com/dictionaries.json");
    vi.resetModules();
    const config = await import("./dictionary-config");
    expect(config.DICTIONARY_REMOTE_MANIFEST_URL).toBe("https://example.com/dictionaries.json");
  });

  it("uses the official URL for an empty build-time override", async () => {
    vi.stubEnv("EXPO_PUBLIC_DICTIONARY_MANIFEST_URL", "  ");
    vi.resetModules();
    const config = await import("./dictionary-config");
    expect(config.DICTIONARY_REMOTE_MANIFEST_URL).toBe(
      "https://raw.githubusercontent.com/codedogQBY/ReadAny/main/dictionary-packs/manifest.json",
    );
  });
  it("uses the official dictionary manifest URL", () => {
    expect(dictionaryConfig.DICTIONARY_REMOTE_MANIFEST_URL).toBe(
      "https://raw.githubusercontent.com/codedogQBY/ReadAny/main/dictionary-packs/manifest.json",
    );
  });

  it("exposes a parsed bundled manifest with the verified mixed sources", () => {
    expect(dictionaryConfig).toHaveProperty("DICTIONARY_BUNDLED_MANIFEST");
    const bundled = Reflect.get(dictionaryConfig, "DICTIONARY_BUNDLED_MANIFEST");
    expect(bundled).toMatchObject({
      manifestVersion: 1,
      packs: {
        en: {
          language: "en",
          schemaVersion: 1,
          sourceEdition: "wordnet-3.1",
          license: "WordNet 3.1 License",
          sourceArchiveUrl: "https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz",
          attributionUrl: "https://wordnet.princeton.edu/license-and-commercial-use",
        },
        zh: {
          language: "zh",
          schemaVersion: 1,
          sourceEdition: "zhwiktionary",
          license: "CC BY-SA 4.0",
          sourceArchiveUrl:
            "https://dumps.wikimedia.org/zhwiktionary/20260901/zhwiktionary-20260901-pages-articles.xml.bz2",
          attributionUrl:
            "https://zh.wiktionary.org/wiki/Wiktionary:%E7%89%88%E6%9D%83%E4%BF%A1%E6%81%AF",
        },
      },
    });

    for (const pack of Object.values(bundled.packs)) {
      expect(pack.attributionUrl).not.toBe(pack.sourceArchiveUrl);
      expect(pack.attributionUrl).not.toMatch(/\.(?:tar\.gz|xml\.bz2)$/u);
    }
  });

  it("bundles bytes identical to the canonical release manifest", async () => {
    const canonicalPath = resolve(
      import.meta.dirname,
      "../../../../dictionary-packs/manifest.json",
    );
    const bundledPath = resolve(
      import.meta.dirname,
      "../../../core/src/dictionary/dictionary-manifest.json",
    );

    await expect(readFile(bundledPath)).resolves.toEqual(await readFile(canonicalPath));
  });
});
