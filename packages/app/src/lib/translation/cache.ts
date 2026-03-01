/**
 * Translation Cache
 * Simple in-memory cache for translation results
 */

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
export function getFromCache(
  text: string,
  sourceLang: string,
  targetLang: string,
  provider: TranslatorName,
): string | null {
  try {
    const key = getCacheKey(text, sourceLang, targetLang, provider);
    const cached = localStorage.getItem(key);
    if (cached) {
      const { translation, timestamp } = JSON.parse(cached);
      // Cache expires after 7 days
      if (Date.now() - timestamp < 7 * 24 * 60 * 60 * 1000) {
        return translation;
      }
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

/** Store translation in cache */
export function storeInCache(
  text: string,
  translation: string,
  sourceLang: string,
  targetLang: string,
  provider: TranslatorName,
): void {
  try {
    const key = getCacheKey(text, sourceLang, targetLang, provider);
    localStorage.setItem(
      key,
      JSON.stringify({
        translation,
        timestamp: Date.now(),
      }),
    );
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

/** Clear all translation cache */
export function clearTranslationCache(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Ignore storage errors
  }
}
