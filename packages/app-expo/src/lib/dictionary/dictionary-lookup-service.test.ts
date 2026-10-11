import type { DictionaryEntry, DictionaryLanguage } from "@readany/core/dictionary";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DictionaryDatabaseAdapter,
  type DictionaryDatabaseConnection,
  ExpoDictionaryDatabaseAdapter,
} from "./dictionary-database";
import { DictionaryLookupService } from "./dictionary-lookup-service";

const expoSqlite = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn(),
}));

vi.mock("expo-sqlite", () => expoSqlite);

interface FixtureEntry extends DictionaryEntry {
  lookupKeys: string[];
}

function createFixtureAdapter(
  fixtures: Partial<Record<DictionaryLanguage, FixtureEntry[]>>,
): DictionaryDatabaseAdapter & {
  openCount: number;
  closeCount: number;
  openedPaths: unknown[];
  queries: Array<{ sql: string; params: unknown[] }>;
} {
  let openCount = 0;
  let closeCount = 0;
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const openedPaths: unknown[] = [];

  return {
    get openCount() {
      return openCount;
    },
    get closeCount() {
      return closeCount;
    },
    openedPaths,
    queries,
    async open(language, absolutePath): Promise<DictionaryDatabaseConnection> {
      openCount += 1;
      openedPaths.push(absolutePath);
      return {
        async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
          queries.push({ sql, params });
          const [lookupKey, selectedLanguage] = params as [string, DictionaryLanguage];
          return (fixtures[language] ?? [])
            .filter(
              (entry) => selectedLanguage === language && entry.lookupKeys.includes(lookupKey),
            )
            .flatMap((entry) => {
              const rank = entry.lookupKeys.indexOf(lookupKey);
              return entry.senses.map((sense) => ({
                entry_id: entry.id,
                language: entry.language,
                headword: entry.headword,
                simplified: entry.simplified ?? null,
                traditional: entry.traditional ?? null,
                pronunciation: entry.pronunciation ?? null,
                part_of_speech: entry.partOfSpeech,
                rank,
                sense_order: sense.order,
                definition: sense.definition,
              }));
            })
            .sort(
              (left, right) =>
                left.rank - right.rank ||
                left.entry_id - right.entry_id ||
                left.sense_order - right.sense_order,
            ) as T[];
        },
        async closeAsync(): Promise<void> {
          closeCount += 1;
        },
      };
    },
  };
}

function createChineseFixtureAdapter() {
  return createFixtureAdapter({
    zh: [
      {
        id: 1,
        language: "zh",
        headword: "閱讀",
        simplified: "阅读",
        traditional: "閱讀",
        partOfSpeech: "verb",
        senses: [{ order: 0, definition: "看书。" }],
        lookupKeys: ["閱讀", "阅读"],
      },
    ],
  });
}

describe("DictionaryLookupService", () => {
  it("returns ordered English senses through a supplied inflection alias", async () => {
    const database = createFixtureAdapter({
      en: [
        {
          id: 2,
          language: "en",
          headword: "desire",
          pronunciation: "/dɪˈzaɪəɹ/",
          partOfSpeech: "noun",
          senses: [
            { order: 1, definition: "A strong wish." },
            { order: 0, definition: "An object of longing." },
          ],
          lookupKeys: ["desire", "desires"],
        },
      ],
    });
    const service = new DictionaryLookupService(database, () => "/dict/en.sqlite");

    await expect(service.lookup("Desires")).resolves.toEqual([
      expect.objectContaining({
        headword: "desire",
        senses: [
          { order: 0, definition: "An object of longing." },
          { order: 1, definition: "A strong wish." },
        ],
      }),
    ]);
    expect(database.queries[0]).toMatchObject({ params: ["desires", "en"] });
    expect(database.queries[0]?.sql).toContain(
      "ORDER BY matched.rank ASC, e.id ASC, s.sense_order ASC",
    );
    expect(database.queries[0]?.sql).toContain("LIMIT 20");
  });

  it("returns one Chinese entry through simplified and traditional aliases", async () => {
    const service = new DictionaryLookupService(
      createChineseFixtureAdapter(),
      () => "/dict/zh.sqlite",
    );

    expect((await service.lookup("阅读"))[0]?.traditional).toBe("閱讀");
    expect((await service.lookup("閱讀"))[0]?.simplified).toBe("阅读");
  });

  it("returns exact-match entries in rank and entry order", async () => {
    const service = new DictionaryLookupService(
      createFixtureAdapter({
        en: [
          {
            id: 4,
            language: "en",
            headword: "read",
            partOfSpeech: "verb",
            senses: [{ order: 0, definition: "To examine writing." }],
            lookupKeys: ["read", "reads"],
          },
          {
            id: 2,
            language: "en",
            headword: "read",
            partOfSpeech: "verb",
            senses: [{ order: 0, definition: "To interpret writing." }],
            lookupKeys: ["read", "reads"],
          },
        ],
      }),
      () => "/dict/en.sqlite",
    );

    await expect(service.lookup("reads")).resolves.toMatchObject([
      { id: 2, headword: "read" },
      { id: 4, headword: "read" },
    ]);
  });

  it("does not open a database for unsupported selection", async () => {
    const adapter = createFixtureAdapter({});

    await expect(
      new DictionaryLookupService(adapter, () => null).lookup("read閱讀"),
    ).rejects.toMatchObject({ code: "unsupported-selection" });
    expect(adapter.openCount).toBe(0);
  });

  it("reports a missing selected pack without opening a database", async () => {
    const adapter = createFixtureAdapter({});

    await expect(
      new DictionaryLookupService(adapter, () => null).lookup("read"),
    ).rejects.toMatchObject({ code: "pack-not-installed" });
    expect(adapter.openCount).toBe(0);
  });

  it("awaits an asynchronous installed-pack path resolver", async () => {
    const adapter = createFixtureAdapter({ en: [] });
    const service = new DictionaryLookupService(adapter, async () => "/dict/en.sqlite");

    await service.lookup("desire");

    expect(adapter.openedPaths).toEqual(["/dict/en.sqlite"]);
  });

  it("caches one connection per language and releases it when closed", async () => {
    const adapter = createFixtureAdapter({ en: [] });
    const service = new DictionaryLookupService(adapter, () => "/dict/en.sqlite");

    await service.lookup("read");
    await service.lookup("reads");
    expect(adapter.openCount).toBe(1);

    await service.close("en");
    expect(adapter.closeCount).toBe(1);
    await service.lookup("read");
    expect(adapter.openCount).toBe(2);

    await service.close();
    expect(adapter.closeCount).toBe(2);
  });
});

describe("ExpoDictionaryDatabaseAdapter", () => {
  const connection = {
    execAsync: vi.fn(),
    getAllAsync: vi.fn(),
    closeAsync: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    expoSqlite.openDatabaseAsync.mockResolvedValue(connection);
    connection.getAllAsync.mockResolvedValue([
      { key: "schema_version", value: "1" },
      { key: "language", value: "en" },
    ]);
  });

  it("opens a verified read-only Expo pack by filename and directory", async () => {
    const adapter = new ExpoDictionaryDatabaseAdapter();

    const opened = await adapter.open("en", "/dict/en.sqlite");

    expect(expoSqlite.openDatabaseAsync).toHaveBeenCalledWith(
      "en.sqlite",
      { useNewConnection: true },
      "/dict",
    );
    expect(connection.execAsync).toHaveBeenCalledWith("PRAGMA query_only = ON");
    expect(opened).toMatchObject({
      getAllAsync: expect.any(Function),
      closeAsync: expect.any(Function),
    });
  });

  it("closes an invalid Expo pack before reporting it", async () => {
    connection.getAllAsync.mockResolvedValue([
      { key: "schema_version", value: "1" },
      { key: "language", value: "zh" },
    ]);

    await expect(
      new ExpoDictionaryDatabaseAdapter().open("en", "/dict/en.sqlite"),
    ).rejects.toMatchObject({ code: "pack-invalid" });
    expect(connection.closeAsync).toHaveBeenCalledTimes(1);
  });
});
