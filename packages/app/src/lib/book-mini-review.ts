/**
 * Book Mini Review Service — 书籍微评生成服务
 *
 * 持久化策略：
 * - SQLite (mini_reviews 表) 作为主存储，支持 WebDAV 同步
 * - Settings store 作为快速读取缓存
 * - 页面刷新后从 SQLite 恢复
 */

import { getAllMiniReviews, insertMiniReview as dbInsertMiniReview, getMiniReview as dbGetMiniReview } from "@readany/core/db";
import { useSettingsStore } from "@/stores/settings-store";
import type { Book } from "@readany/core/types";
import { generateId } from "@readany/core/utils/generate-id";

export interface BookMiniReview {
  bookId: string;
  content: string;
  generatedAt: number;
  rating?: number;
  source?: "douban" | "openlibrary" | "ai";
}

export interface MiniReviewOptions {
  timeout?: number;
  useCache?: boolean;
}

const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000;

class BookMiniReviewService {
  private cache: Map<string, BookMiniReview> = new Map();
  private initialized = false;

  constructor() {
    this.loadFromSettings();
  }

  /** Load initial cache from settings store (synchronous, fast) */
  private loadFromSettings() {
    try {
      const settingsStore = useSettingsStore.getState();
      const bookReviews = settingsStore.bookMiniReviews || {};
      Object.entries(bookReviews).forEach(([key, value]) => {
        this.cache.set(key, value as BookMiniReview);
      });
    } catch {
      this.cache = new Map();
    }
  }

  /** Load reviews from SQLite (async, called once on startup) */
  async initializeFromDB() {
    if (this.initialized) return;
    try {
      const rows = await getAllMiniReviews();
      for (const row of rows) {
        this.cache.set(row.book_id, {
          bookId: row.book_id,
          content: row.content,
          generatedAt: row.generated_at,
          rating: row.rating ?? undefined,
          source: (row.source as BookMiniReview["source"]) ?? undefined,
        });
      }
      this.syncCacheToSettings();
      this.initialized = true;
    } catch (err) {
      console.error("[BookMiniReviewService] Failed to load from DB:", err);
    }
  }

  private syncCacheToSettings() {
    try {
      const bookReviews: Record<string, BookMiniReview> = {};
      this.cache.forEach((value, key) => {
        bookReviews[key] = value;
      });
      useSettingsStore.getState().setBookMiniReviews(bookReviews);
    } catch {
      console.error("[BookMiniReviewService] Failed to sync cache to settings");
    }
  }

  private isCacheValid(review: BookMiniReview | undefined): boolean {
    if (!review) return false;
    return Date.now() - review.generatedAt < CACHE_DURATION;
  }

  async generateReview(
    book: Book,
    options: MiniReviewOptions = {},
  ): Promise<BookMiniReview | null> {
    const { timeout = 10000, useCache = true } = options;
    const cacheKey = book.id;

    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (this.isCacheValid(cached)) {
        return cached || null;
      }
    }

    try {
      const review = await this.generateAIReview(book, timeout);
      if (review) {
        this.cache.set(cacheKey, review);
        this.syncCacheToSettings();
        // Persist to SQLite for sync
        try {
          await dbInsertMiniReview({
            id: `${book.id}:${review.generatedAt}`,
            bookId: book.id,
            content: review.content,
            generatedAt: review.generatedAt,
            rating: review.rating,
            source: review.source,
          });
        } catch (err) {
          console.error("[BookMiniReviewService] Failed to persist to DB:", err);
        }
      }
      return review;
    } catch (error) {
      console.error("[BookMiniReviewService] Failed to generate review:", error);
      return null;
    }
  }

  private async generateAIReview(book: Book, timeout: number): Promise<BookMiniReview | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(null);
      }, timeout);

      const aiConfig = useSettingsStore.getState().aiConfig;
      const endpoint = aiConfig.endpoints.find((ep) => ep.id === aiConfig.activeEndpointId);

      if (!endpoint || !aiConfig.activeModel) {
        clearTimeout(timer);
        resolve(null);
        return;
      }

      const systemPrompt = `你是一位资深书评人。请根据给定的书籍信息，生成一段简洁的书评（100-200字），包括：
1. 对这本书的简短评价
2. 适合什么样的读者
3. 一句推荐语

请用第一人称书写，语言简洁有感染力。`;

      const userPrompt = `书籍信息：
书名：《${book.meta.title}》
作者：${book.meta.author || "未知"}
语言：${book.meta.language || "未知"}

请生成一段简短的书评。`;

      const requestBody = {
        model: aiConfig.activeModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      };

      const requestUrl = endpoint.baseUrl.endsWith("/")
        ? `${endpoint.baseUrl}chat/completions`
        : `${endpoint.baseUrl}/chat/completions`;

      fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
        },
        body: JSON.stringify(requestBody),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((data) => {
          clearTimeout(timer);
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            resolve({
              bookId: book.id,
              content: content.trim(),
              generatedAt: Date.now(),
              source: "ai",
            });
          } else {
            resolve(null);
          }
        })
        .catch((error) => {
          clearTimeout(timer);
          console.error("[BookMiniReviewService] AI request failed:", error);
          resolve(null);
        });
    });
  }

  async refreshReview(book: Book, options: MiniReviewOptions = {}): Promise<BookMiniReview | null> {
    this.cache.delete(book.id);
    return this.generateReview(book, { ...options, useCache: false });
  }

  getReview(bookId: string): BookMiniReview | null {
    const review = this.cache.get(bookId);
    if (this.isCacheValid(review)) {
      return review || null;
    }
    return null;
  }

  clearCache() {
    this.cache.clear();
    this.syncCacheToSettings();
  }

  clearCacheForBook(bookId: string) {
    this.cache.delete(bookId);
    this.syncCacheToSettings();
  }

  getCacheStats() {
    return {
      totalReviews: this.cache.size,
      validReviews: Array.from(this.cache.values()).filter((r) => this.isCacheValid(r)).length,
    };
  }
}

export const bookMiniReviewService = new BookMiniReviewService();
