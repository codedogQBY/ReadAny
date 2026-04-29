/**
 * Web Search Service — 联网预热搜索服务
 *
 * 功能：
 * - 支持多个搜索数据源（Google、Tavily、Open Library）
 * - 3秒超时自动切换到 fallback
 * - 本地缓存搜索结果
 * - 可配置的搜索优先级
 */

import { useSettingsStore } from "@/stores/settings-store";
import type { WebSearchSource } from "@readany/core/types/chat";

export interface BookSearchResult {
  title: string;
  author?: string;
  rating?: number;
  reviews: string[];
  description?: string;
  coverUrl?: string;
  source: WebSearchSource;
}

export interface SearchOptions {
  timeout?: number;
  useCache?: boolean;
  sources?: WebSearchSource[];
}

const DEFAULT_TIMEOUT = 3000;
const CACHE_DURATION = 24 * 60 * 60 * 1000;

interface CacheEntry {
  lastSearchAt: number;
  [key: string]: unknown;
}

export class WebSearchService {
  private cache: Map<string, CacheEntry> = new Map();

  constructor() {
    this.loadCacheFromSettings();
  }

  private loadCacheFromSettings() {
    try {
      const aiConfig = useSettingsStore.getState().aiConfig;
      const cacheData = aiConfig.webSearchCache || {};
      this.cache = new Map(Object.entries(cacheData).map(([k, v]) => [k, v as CacheEntry]));
    } catch {
      this.cache = new Map();
    }
  }

  private saveCacheToSettings() {
    try {
      const cacheObj = Object.fromEntries(this.cache);
      useSettingsStore.getState().updateAIConfig({
        webSearchCache: cacheObj,
      } as any);
    } catch {
      console.error("[WebSearchService] Failed to save cache to settings");
    }
  }

  private getCacheKey(bookTitle: string, author?: string): string {
    return `${bookTitle}:${author || "unknown"}`;
  }

  private isCacheValid(cache: CacheEntry | undefined): boolean {
    if (!cache || !cache.lastSearchAt) return false;
    return Date.now() - cache.lastSearchAt < CACHE_DURATION;
  }

  async searchBookInfo(
    bookTitle: string,
    author?: string,
    options: SearchOptions = {},
  ): Promise<BookSearchResult | null> {
    const {
      timeout = DEFAULT_TIMEOUT,
      useCache = true,
      sources = ["google", "douban", "openlibrary"],
    } = options;

    const cacheKey = this.getCacheKey(bookTitle, author);

    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (this.isCacheValid(cached)) {
        console.log("[WebSearchService] Using cached result for:", bookTitle);
        return cached ? this.cachedToResult(cached, bookTitle, author) : null;
      }
    }

    const sourceConfigs = this.getSourceConfigs(sources);

    for (const sourceConfig of sourceConfigs) {
      try {
        console.log(`[WebSearchService] Trying source: ${sourceConfig.source}`);

        const result = await this.searchWithTimeout(sourceConfig, bookTitle, timeout, author);

        if (result) {
          this.cache.set(cacheKey, {
            ...result,
            lastSearchAt: Date.now(),
          });
          this.saveCacheToSettings();
          return result;
        }
      } catch (error) {
        console.warn(`[WebSearchService] Source ${sourceConfig.source} failed:`, error);
        continue;
      }
    }

    return null;
  }

  private async searchWithTimeout(
    sourceConfig: {
      source: WebSearchSource;
      searchFn: (bookTitle: string, author?: string) => Promise<Partial<BookSearchResult> | null>;
    },
    bookTitle: string,
    timeout: number,
    author?: string,
  ): Promise<BookSearchResult | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn(`[WebSearchService] Timeout for source: ${sourceConfig.source}`);
        resolve(null);
      }, timeout);

      sourceConfig
        .searchFn(bookTitle, author)
        .then((result) => {
          clearTimeout(timer);
          if (result && result.title) {
            resolve({
              ...result,
              title: result.title,
              reviews: result.reviews || [],
              source: sourceConfig.source,
            });
          } else {
            resolve(null);
          }
        })
        .catch((error) => {
          clearTimeout(timer);
          console.error(`[WebSearchService] Error from ${sourceConfig.source}:`, error);
          resolve(null);
        });
    });
  }

  private getSourceConfigs(sources: WebSearchSource[]) {
    return sources
      .map((source) => {
        switch (source) {
          case "google":
            return {
              source: "google" as WebSearchSource,
              searchFn: this.searchGoogle.bind(this),
            };
          case "douban":
            return {
              source: "douban" as WebSearchSource,
              searchFn: this.searchDouban.bind(this),
            };
          case "openlibrary":
            return {
              source: "openlibrary" as WebSearchSource,
              searchFn: this.searchOpenLibrary.bind(this),
            };
          default:
            return null;
        }
      })
      .filter(Boolean) as Array<{
      source: WebSearchSource;
      searchFn: (bookTitle: string, author?: string) => Promise<Partial<BookSearchResult> | null>;
    }>;
  }

  private async searchGoogle(
    bookTitle: string,
    author?: string,
  ): Promise<Partial<BookSearchResult> | null> {
    const query = author ? `${bookTitle} ${author} book review` : `${bookTitle} book review`;

    const searchUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${import.meta.env.VITE_GOOGLE_SEARCH_API_KEY}&cx=${import.meta.env.VITE_GOOGLE_SEARCH_ENGINE_ID}`;

    try {
      const response = await fetch(searchUrl);
      if (!response.ok) return null;

      const data = await response.json();
      if (!data.items || data.items.length === 0) return null;

      const reviews = data.items.slice(0, 5).map((item: any) => item.snippet || item.title);

      return {
        title: bookTitle,
        author,
        reviews,
        source: "google",
      };
    } catch {
      return null;
    }
  }

  private async searchDouban(
    bookTitle: string,
    author?: string,
  ): Promise<Partial<BookSearchResult> | null> {
    const query = author ? `${bookTitle} ${author}` : bookTitle;

    try {
      const searchUrl = `https://api.douban.com/v2/book/search?q=${encodeURIComponent(query)}&count=5`;

      const response = await fetch(searchUrl);
      if (!response.ok) return null;

      const data = await response.json();
      if (!data.books || data.books.length === 0) return null;

      const book = data.books[0];
      return {
        title: book.title || bookTitle,
        author: book.author?.join(", ") || author,
        rating: book.rating?.average,
        reviews: [book.summary].filter(Boolean),
        description: book.summary,
        coverUrl: book.image,
        source: "douban",
      };
    } catch {
      return null;
    }
  }

  private async searchOpenLibrary(
    bookTitle: string,
    author?: string,
  ): Promise<Partial<BookSearchResult> | null> {
    const query = author ? `${bookTitle} ${author}` : bookTitle;

    try {
      const searchUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`;

      const response = await fetch(searchUrl);
      if (!response.ok) return null;

      const data = await response.json();
      if (!data.docs || data.docs.length === 0) return null;

      const book = data.docs[0];
      const reviews = [];

      if (book.first_sentence) {
        reviews.push(
          Array.isArray(book.first_sentence) ? book.first_sentence[0] : book.first_sentence,
        );
      }

      return {
        title: book.title || bookTitle,
        author: book.author_name?.join(", ") || author,
        description: book.first_sentence
          ? Array.isArray(book.first_sentence)
            ? book.first_sentence[0]
            : book.first_sentence
          : undefined,
        source: "openlibrary",
      };
    } catch {
      return null;
    }
  }

  private cachedToResult(
    cache: CacheEntry,
    bookTitle: string,
    author?: string,
  ): BookSearchResult | null {
    const reviews: string[] = [];
    const doubanData = cache.douban as { reviews?: string[]; rating?: number } | undefined;

    if (doubanData?.reviews) {
      reviews.push(...doubanData.reviews);
    }

    return {
      title: bookTitle,
      author,
      rating: doubanData?.rating,
      reviews: reviews.slice(0, 5),
      source: doubanData ? "douban" : "openlibrary",
    };
  }

  clearCache() {
    this.cache.clear();
    this.saveCacheToSettings();
    console.log("[WebSearchService] Cache cleared");
  }

  clearCacheForBook(bookTitle: string, author?: string) {
    const cacheKey = this.getCacheKey(bookTitle, author);
    this.cache.delete(cacheKey);
    this.saveCacheToSettings();
  }

  getCacheStats() {
    return {
      totalEntries: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([key, value]) => ({
        key,
        lastSearchAt: value.lastSearchAt,
        hasDouban: !!value.douban,
        hasZhihu: !!value.zhihu,
      })),
    };
  }
}

export const webSearchService = new WebSearchService();
