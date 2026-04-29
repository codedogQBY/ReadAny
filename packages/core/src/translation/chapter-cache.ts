/**
 * Chapter-level Cache Metadata
 *
 * Tracks whether a full chapter has already been translated so we can
 * skip the per-paragraph cache lookup on subsequent visits.
 * Also stores user's visibility preferences (original/translation visibility).
 */

import { getPlatformService } from "../services/platform";

const CHAPTER_CACHE_PREFIX = "readany_chapter_translated_";

interface ChapterTranslationSettings {
  cached: boolean;
  originalVisible: boolean;
  translationVisible: boolean;
  targetLang: string;
}

function getChapterKey(bookId: string, sectionIndex: number, targetLang: string): string {
  return `${CHAPTER_CACHE_PREFIX}${bookId}_${sectionIndex}_${targetLang}`;
}

function getChapterSettingsKey(bookId: string, sectionIndex: number): string {
  return `${CHAPTER_CACHE_PREFIX}${bookId}_${sectionIndex}_settings`;
}

/** Check if every paragraph in a chapter is already cached */
export async function isChapterFullyCached(
  bookId: string,
  sectionIndex: number,
  targetLang: string,
): Promise<boolean> {
  try {
    const platform = getPlatformService();
    const key = getChapterKey(bookId, sectionIndex, targetLang);
    const value = await platform.kvGetItem(key);
    return value === "1";
  } catch {
    return false;
  }
}

/** Get chapter translation settings (visibility preferences) */
export async function getChapterTranslationSettings(
  bookId: string,
  sectionIndex: number,
): Promise<ChapterTranslationSettings | null> {
  try {
    const platform = getPlatformService();
    const key = getChapterSettingsKey(bookId, sectionIndex);
    const value = await platform.kvGetItem(key);
    if (value) {
      return JSON.parse(value) as ChapterTranslationSettings;
    }
    return null;
  } catch {
    return null;
  }
}

/** Mark a chapter as fully cached (call after all paragraphs translated) */
export async function markChapterFullyCached(
  bookId: string,
  sectionIndex: number,
  targetLang: string,
): Promise<void> {
  try {
    const platform = getPlatformService();
    const key = getChapterKey(bookId, sectionIndex, targetLang);
    await platform.kvSetItem(key, "1");

    const settingsKey = getChapterSettingsKey(bookId, sectionIndex);
    const settings: ChapterTranslationSettings = {
      cached: true,
      originalVisible: true,
      translationVisible: true,
      targetLang,
    };
    await platform.kvSetItem(settingsKey, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

/** Update chapter translation visibility settings */
export async function updateChapterTranslationSettings(
  bookId: string,
  sectionIndex: number,
  settings: Partial<ChapterTranslationSettings>,
): Promise<void> {
  try {
    const platform = getPlatformService();
    const key = getChapterSettingsKey(bookId, sectionIndex);
    const existing = await getChapterTranslationSettings(bookId, sectionIndex);
    const updated: ChapterTranslationSettings = {
      cached: settings.cached ?? existing?.cached ?? true,
      originalVisible: settings.originalVisible ?? existing?.originalVisible ?? true,
      translationVisible: settings.translationVisible ?? existing?.translationVisible ?? true,
      targetLang: settings.targetLang ?? existing?.targetLang ?? "",
    };
    await platform.kvSetItem(key, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

/** Clear chapter cache for a specific chapter */
export async function clearChapterCache(bookId: string, sectionIndex: number): Promise<void> {
  try {
    const platform = getPlatformService();
    const prefix = `${CHAPTER_CACHE_PREFIX}${bookId}_${sectionIndex}_`;
    const allKeys = await platform.kvGetAllKeys();
    const keysToRemove = allKeys.filter((k) => k.startsWith(prefix));
    for (const key of keysToRemove) {
      await platform.kvRemoveItem(key);
    }
  } catch {
    // Ignore storage errors
  }
}
