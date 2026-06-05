import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect, close: vi.fn() };

const coreMocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getDeviceId: vi.fn(),
  nextSyncVersion: vi.fn(),
  nextUpdatedAt: vi.fn(),
  parseJSON: vi.fn((value: string, fallback: unknown) => {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }),
}));

vi.mock("../db-core", () => coreMocks);

const {
  buildChapterTranslationId,
  computeChapterSourceHash,
  getChapterTranslation,
  updateChapterTranslationVisibility,
  upsertChapterTranslation,
} = await import("../chapter-translation-queries");

describe("chapter-translation-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(5000);
    coreMocks.getDB.mockResolvedValue(mockDb);
    coreMocks.getDeviceId.mockResolvedValue("device-1");
    coreMocks.nextSyncVersion.mockResolvedValue(7);
    coreMocks.nextUpdatedAt.mockResolvedValue(6000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds stable ids and source hashes for the same chapter text", () => {
    expect(buildChapterTranslationId("book-1", 3, "AUTO", "zh-CN")).toBe(
      "book-1:3:AUTO:zh-CN",
    );
    expect(
      computeChapterSourceHash([
        { paragraphId: "p1", originalText: "Hello", translatedText: "Hello zh" },
        { paragraphId: "p2", originalText: "World", translatedText: "World zh" },
      ]),
    ).toBe(
      computeChapterSourceHash([
        { paragraphId: "p1", originalText: "Hello", translatedText: "Hello zh" },
        { paragraphId: "p2", originalText: "World", translatedText: "World zh" },
      ]),
    );
  });

  it("upserts a full chapter translation with sync tracking", async () => {
    mockExecute.mockResolvedValue(undefined);

    await upsertChapterTranslation({
      bookId: "book-1",
      sectionIndex: 3,
      sourceLang: "AUTO",
      targetLang: "zh-CN",
      provider: "ai",
      model: "deepseek-v4-pro[1m]",
      sourceHash: "hash-1",
      paragraphs: [
        { paragraphId: "p1", originalText: "Hello", translatedText: "Hello zh" },
        { paragraphId: "p2", originalText: "World", translatedText: "World zh" },
      ],
      originalVisible: true,
      translationVisible: true,
    });

    expect(coreMocks.nextSyncVersion).toHaveBeenCalledWith(mockDb, "chapter_translations");
    expect(coreMocks.getDeviceId).toHaveBeenCalled();
    const [sql, params] = mockExecute.mock.calls.at(-1)!;
    expect(sql).toContain("INSERT INTO chapter_translations");
    expect(params[0]).toBe("book-1:3:AUTO:zh-CN");
    expect(params[1]).toBe("book-1");
    expect(params[2]).toBe(3);
    expect(params[5]).toBe("ai");
    expect(params[6]).toBe("deepseek-v4-pro[1m]");
    expect(params[7]).toBe("hash-1");
    expect(JSON.parse(params[8] as string)).toHaveLength(2);
    expect(params).toContain(7);
    expect(params).toContain("device-1");
  });

  it("returns null when the persisted source hash does not match current text", async () => {
    mockSelect.mockResolvedValue([
      {
        id: "book-1:3:AUTO:zh-CN",
        book_id: "book-1",
        section_index: 3,
        source_lang: "AUTO",
        target_lang: "zh-CN",
        provider: "ai",
        model: null,
        source_hash: "old-hash",
        paragraphs: "[]",
        original_visible: 1,
        translation_visible: 1,
        created_at: 1000,
        updated_at: 1000,
      },
    ]);

    await expect(
      getChapterTranslation("book-1", 3, "AUTO", "zh-CN", "new-hash"),
    ).resolves.toBeNull();
  });

  it("maps a matching chapter translation row", async () => {
    mockSelect.mockResolvedValue([
      {
        id: "book-1:3:AUTO:zh-CN",
        book_id: "book-1",
        section_index: 3,
        source_lang: "AUTO",
        target_lang: "zh-CN",
        provider: "ai",
        model: "deepseek-v4-pro[1m]",
        source_hash: "hash-1",
        paragraphs: JSON.stringify([
          { paragraphId: "p1", originalText: "Hello", translatedText: "Hello zh" },
        ]),
        original_visible: 0,
        translation_visible: 1,
        created_at: 1000,
        updated_at: 2000,
      },
    ]);

    const result = await getChapterTranslation("book-1", 3, "AUTO", "zh-CN", "hash-1");

    expect(result).toEqual(
      expect.objectContaining({
        id: "book-1:3:AUTO:zh-CN",
        bookId: "book-1",
        sectionIndex: 3,
        originalVisible: false,
        translationVisible: true,
        updatedAt: 2000,
      }),
    );
    expect(result?.paragraphs[0].translatedText).toBe("Hello zh");
  });

  it("updates visibility with sync tracking", async () => {
    mockExecute.mockResolvedValue(undefined);

    await updateChapterTranslationVisibility("book-1", 3, "AUTO", "zh-CN", {
      originalVisible: false,
      translationVisible: true,
    });

    expect(coreMocks.nextUpdatedAt).toHaveBeenCalledWith(
      mockDb,
      "chapter_translations",
      "book-1:3:AUTO:zh-CN",
    );
    const [sql, params] = mockExecute.mock.calls.at(-1)!;
    expect(sql).toContain("UPDATE chapter_translations SET");
    expect(sql).toContain("original_visible = ?");
    expect(sql).toContain("translation_visible = ?");
    expect(params).toEqual([0, 1, 6000, 7, "device-1", "book-1:3:AUTO:zh-CN"]);
  });
});
