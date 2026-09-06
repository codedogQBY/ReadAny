import type { DictionaryLanguage } from "@readany/core/dictionary";
import { describe, expect, it } from "vitest";
import type { DictionaryDatabaseAdapter } from "./dictionary-database";
import type { DictionaryPackMetadata, DictionaryPackPlatform } from "./dictionary-pack-manager";
import { createDictionaryRuntime } from "./dictionary-runtime";

const metadata: DictionaryPackMetadata = {
  language: "en",
  version: "1.0.0",
  schemaVersion: 1,
  sourceEdition: "wordnet-3.1",
  sourceDumpDate: "2011-05-26",
  sourceArchiveUrl: "https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz",
  url: "https://example.test/en.sqlite",
  attributionUrl: "https://wordnet.princeton.edu/",
  license: "WordNet 3.1 License",
  licenseNotice: "Complete WordNet license notice.",
  creatorAttribution: "Princeton University.",
};

describe("createDictionaryRuntime", () => {
  it("inspects an active pack once per lifecycle and re-inspects after mutation", async () => {
    const directory = "/docs/dictionaries";
    const activePath = `${directory}/readany-dictionary-en.sqlite`;
    const files = new Set([activePath]);
    let metadataReads = 0;
    let hashReads = 0;
    const platform: DictionaryPackPlatform = {
      ensureDirectory: async () => {},
      download: async () => {
        throw new Error("not used");
      },
      exists: async (path) => files.has(path),
      size: async () => 123,
      sha256: async () => {
        hashReads += 1;
        return "a".repeat(64);
      },
      readMetadata: async () => {
        metadataReads += 1;
        return metadata;
      },
      move: async () => {
        throw new Error("not used");
      },
      remove: async (path) => {
        files.delete(path);
      },
    };
    let openCount = 0;
    const database: DictionaryDatabaseAdapter = {
      open: async () => {
        openCount += 1;
        return { getAllAsync: async () => [], closeAsync: async () => {} };
      },
    };
    const runtime = createDictionaryRuntime({ database, directory, platform });

    await runtime.lookup.lookup("desire");
    await runtime.lookup.lookup("desires");
    expect({ metadataReads, hashReads, openCount }).toEqual({
      metadataReads: 1,
      hashReads: 1,
      openCount: 1,
    });

    await runtime.manager.remove("en");
    files.add(activePath);
    await runtime.lookup.lookup("desire");
    expect({ metadataReads, hashReads, openCount }).toEqual({
      metadataReads: 2,
      hashReads: 2,
      openCount: 2,
    });
  });

  it("invalidates the inspected path and cached connection after a SQLite query error", async () => {
    const directory = "/docs/dictionaries";
    const activePath = `${directory}/readany-dictionary-en.sqlite`;
    let metadataReads = 0;
    let openCount = 0;
    let closeCount = 0;
    const platform: DictionaryPackPlatform = {
      ensureDirectory: async () => {},
      download: async () => {
        throw new Error("not used");
      },
      exists: async (path) => path === activePath,
      size: async () => 123,
      sha256: async () => "a".repeat(64),
      readMetadata: async () => {
        metadataReads += 1;
        return metadata;
      },
      move: async () => {
        throw new Error("not used");
      },
      remove: async () => {},
    };
    const database: DictionaryDatabaseAdapter = {
      open: async () => {
        openCount += 1;
        const thisOpen = openCount;
        return {
          getAllAsync: async () => {
            if (thisOpen === 1) throw new Error("SQLITE_CORRUPT");
            return [];
          },
          closeAsync: async () => {
            closeCount += 1;
          },
        };
      },
    };
    const runtime = createDictionaryRuntime({ database, directory, platform });

    await expect(runtime.lookup.lookup("desire")).rejects.toThrow("SQLITE_CORRUPT");
    await expect(runtime.lookup.lookup("desire")).resolves.toEqual([]);

    expect({ metadataReads, openCount, closeCount }).toEqual({
      metadataReads: 2,
      openCount: 2,
      closeCount: 1,
    });
  });

  it("shares one real lookup between installed-path resolution and manager close", async () => {
    const directory = "/docs/dictionaries";
    const activePath = `${directory}/readany-dictionary-en.sqlite`;
    const files = new Set([activePath]);
    const events: string[] = [];
    const platform: DictionaryPackPlatform = {
      ensureDirectory: async () => {},
      download: async () => {
        throw new Error("not used");
      },
      exists: async (path) => files.has(path),
      size: async () => 123,
      sha256: async () => "a".repeat(64),
      readMetadata: async () => metadata,
      move: async () => {
        throw new Error("not used");
      },
      remove: async (path) => {
        events.push(`remove:${path}`);
        files.delete(path);
      },
    };
    const openedPaths: string[] = [];
    const database: DictionaryDatabaseAdapter = {
      open: async (_language: DictionaryLanguage, path: string) => {
        openedPaths.push(path);
        return {
          getAllAsync: async () => [],
          closeAsync: async () => {
            events.push("close:en");
          },
        };
      },
    };

    const runtime = createDictionaryRuntime({ database, directory, platform });
    await expect(runtime.lookup.lookup("desire")).resolves.toEqual([]);
    expect(openedPaths).toEqual([activePath]);

    await runtime.manager.remove("en");

    expect(events).toEqual(["close:en", `remove:${activePath}`]);
  });
});
