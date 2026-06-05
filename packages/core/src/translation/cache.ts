/**
 * Translation Cache
 * Cross-platform cache for translation results using IPlatformService KV storage.
 *
 * All methods are async to support both Web (localStorage) and RN (AsyncStorage).
 */

import { getPlatformService } from "../services/platform";
import type { TranslatorName } from "./types";

const CACHE_PREFIX = "readany_translation_cache_";

/** Generate cache key */
function getCacheKey(
  text: string,
  sourceLang: string,
  targetLang: string,
  provider: TranslatorName,
): string {
  const hash = simpleHash(text);
  return `${CACHE_PREFIX}${provider}_${sourceLang}_${targetLang}_${hash}`;
}

/** Simple hash function for cache key */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/** Get translation from cache */
export async function getFromCache(
  text: string,
  sourceLang: string,
  targetLang: string,
  provider: TranslatorName,
): Promise<string | null> {
  try {
    const platform = getPlatformService();
    const key = getCacheKey(text, sourceLang, targetLang, provider);
    const cached = await platform.kvGetItem(key);
    if (cached) {
      const { translation, timestamp } = JSON.parse(cached);
      if (typeof timestamp === "number") {
        return translation;
      }
    }
  } catch (err) {
    console.warn("[Translation] Cache read error:", err);
  }
  return null;
}

/** Store translation in cache */
export async function storeInCache(
  text: string,
  translation: string,
  sourceLang: string,
  targetLang: string,
  provider: TranslatorName,
): Promise<void> {
  try {
    const platform = getPlatformService();
    const key = getCacheKey(text, sourceLang, targetLang, provider);
    await platform.kvSetItem(
      key,
      JSON.stringify({
        translation,
        timestamp: Date.now(),
      }),
    );
  } catch (err) {
    console.warn("[Translation] Cache write error:", err);
  }
}

/** Clear all translation cache */
export async function clearTranslationCache(): Promise<void> {
  try {
    const platform = getPlatformService();
    const allKeys = await platform.kvGetAllKeys();
    const keysToRemove = allKeys.filter((key) => key.startsWith(CACHE_PREFIX));
    await Promise.all(keysToRemove.map((key) => platform.kvRemoveItem(key)));
  } catch (err) {
    console.warn("[Translation] Failed to clear translation cache:", err);
  }
}
