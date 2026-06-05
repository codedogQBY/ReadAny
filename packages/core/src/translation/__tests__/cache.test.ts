import { beforeEach, describe, expect, it, vi } from "vitest";

const platformMocks = vi.hoisted(() => ({
  kv: new Map<string, string>(),
}));

vi.mock("../../services/platform", () => ({
  getPlatformService: vi.fn(() => ({
    kvGetItem: async (key: string) => platformMocks.kv.get(key) ?? null,
    kvSetItem: async (key: string, value: string) => {
      platformMocks.kv.set(key, value);
    },
    kvRemoveItem: async (key: string) => {
      platformMocks.kv.delete(key);
    },
    kvGetAllKeys: async () => [...platformMocks.kv.keys()],
  })),
}));

const { clearTranslationCache, getFromCache, storeInCache } = await import("../cache");

describe("translation cache", () => {
  beforeEach(() => {
    platformMocks.kv = new Map();
    vi.restoreAllMocks();
  });

  it("keeps cached translations after the old 7-day expiry window", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10 * 24 * 60 * 60 * 1000);

    await storeInCache("hello", "你好", "en", "zh", "deepl");

    vi.spyOn(Date, "now").mockReturnValue(30 * 24 * 60 * 60 * 1000);

    await expect(getFromCache("hello", "en", "zh", "deepl")).resolves.toBe("你好");
  });

  it("clears translation cache entries", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    await storeInCache("hello", "你好", "en", "zh", "deepl");

    const translationKey = [...platformMocks.kv.keys()].find((key) =>
      key.startsWith("readany_translation_cache_"),
    );
    expect(translationKey).toBeTruthy();

    await clearTranslationCache();

    expect(platformMocks.kv.has(translationKey as string)).toBe(false);
  });
});
