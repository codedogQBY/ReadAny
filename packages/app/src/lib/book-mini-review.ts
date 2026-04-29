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

// 微评类型定义
export type MiniReviewType = "hook" | "question" | "resonance" | "anecdote";

export interface BookMiniReview {
  bookId: string;
  content: string;
  generatedAt: number;
  rating?: number;
  source?: "douban" | "openlibrary" | "ai";
  type?: MiniReviewType;        // 微评类型
  isPinned?: boolean;           // 是否固定
}

export interface MiniReviewOptions {
  timeout?: number;
  useCache?: boolean;  // 是否使用缓存，默认true
  type?: MiniReviewType;  // 指定微评类型
  forceRefresh?: boolean;  // 强制刷新，忽略缓存
}

const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000;

// 全局请求队列，限制并发
let currentGeneratingCount = 0;
const MAX_CONCURRENT_GENERATIONS = 2; // 最多同时生成2个
const generationQueue: Array<() => void> = [];

// 处理队列中的下一个请求
function processQueue() {
  if (currentGeneratingCount >= MAX_CONCURRENT_GENERATIONS || generationQueue.length === 0) {
    return;
  }
  
  const next = generationQueue.shift();
  if (next) {
    currentGeneratingCount++;
    console.log(`[BookMiniReviewService] Starting generation (${currentGeneratingCount}/${MAX_CONCURRENT_GENERATIONS})`);
    next();
  }
}

class BookMiniReviewService {
  private cache: Map<string, BookMiniReview> = new Map();
  private initialized = false;
  private defaultType: MiniReviewType = "hook";

  constructor() {
    this.loadFromSettings();
  }

  /** 生成缓存键: ${bookId}:${type} */
  private getCacheKey(bookId: string, type: MiniReviewType = "hook"): string {
    return `${bookId}:${type}`;
  }

  /** Load initial cache from settings store (synchronous, fast) */
  private loadFromSettings() {
    try {
      const settingsStore = useSettingsStore.getState();
      const bookReviews = settingsStore.bookMiniReviews || {};
      console.log('[BookMiniReviewService] Loading from settings, count:', Object.keys(bookReviews).length);
      Object.entries(bookReviews).forEach(([key, value]) => {
        this.cache.set(key, value as BookMiniReview);
      });
      
      // 加载默认类型设置
      if (!this.defaultType) {
        this.defaultType = settingsStore.miniReviewDefaultType || "hook";
        console.log('[BookMiniReviewService] Default type:', this.defaultType);
      }
    } catch (err) {
      console.error('[BookMiniReviewService] Failed to load from settings:', err);
      this.cache = new Map();
    }
  }

  /** Load reviews from SQLite (async, called once on startup) */
  async initializeFromDB() {
    if (this.initialized) {
      console.log('[BookMiniReviewService] Already initialized, skipping');
      return;
    }
    console.log('[BookMiniReviewService] Initializing from DB...');
    try {
      const rows = await getAllMiniReviews();
      console.log('[BookMiniReviewService] Loaded', rows.length, 'reviews from DB');
      
      let validCount = 0;
      let invalidCount = 0;
      
      for (const row of rows) {
        const type = (row.type as MiniReviewType) || "hook";
        const cacheKey = this.getCacheKey(row.book_id, type);
        
        // 检查字数是否符合要求(65字符以下)
        if (row.content.length <= 65) {
          this.cache.set(cacheKey, {
            bookId: row.book_id,
            content: row.content,
            generatedAt: row.generated_at,
            rating: row.rating ?? undefined,
            source: (row.source as BookMiniReview["source"]) ?? undefined,
            type: type,
            isPinned: row.is_pinned === 1,  // 转换为布尔值
          });
          validCount++;
        } else {
          // 超过65字，不加载到缓存，相当于清除
          console.log(`[BookMiniReviewService] Skipping invalid review (${row.content.length} chars > 65): ${row.book_id}`);
          invalidCount++;
        }
      }
      
      console.log(`[BookMiniReviewService] Valid: ${validCount}, Invalid (skipped): ${invalidCount}`);
      console.log('[BookMiniReviewService] Cache size after DB load:', this.cache.size);
      this.syncCacheToSettings();
      this.initialized = true;
      console.log('[BookMiniReviewService] Initialization complete');
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
      console.log('[BookMiniReviewService] Syncing to settings, count:', Object.keys(bookReviews).length);
      useSettingsStore.getState().setBookMiniReviews(bookReviews);
      console.log('[BookMiniReviewService] Sync complete');
    } catch (err) {
      console.error("[BookMiniReviewService] Failed to sync cache to settings:", err);
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
    const { timeout = 10000, type = this.defaultType, forceRefresh = false } = options;
    const cacheKey = this.getCacheKey(book.id, type);

    // 检查缓存（除非强制刷新）
    if (!forceRefresh) {
      const cached = this.cache.get(cacheKey);
      console.log(`[BookMiniReviewService] Checking cache for key: ${cacheKey}`);
      console.log(`[BookMiniReviewService] Cache size: ${this.cache.size}, Found: ${!!cached}`);
      
      if (this.isCacheValid(cached)) {
        console.log('[BookMiniReviewService] Using cached review');
        return cached || null;
      } else if (cached) {
        console.log('[BookMiniReviewService] Cache found but invalid (expired)');
      } else {
        console.log('[BookMiniReviewService] No cache found, will generate new');
      }
    } else {
      console.log('[BookMiniReviewService] Force refresh, skipping cache');
    }

    // 使用队列控制并发
    return new Promise((resolve) => {
      const executeGeneration = async () => {
        try {
          const review = await this.generateAIReview(book, timeout, type);
          
          if (review) {
            // 检查字数是否符合要求(65字符以下)
            const contentLength = review.content.length;
            console.log(`[BookMiniReviewService] Generated review length: ${contentLength} chars`);
            
            if (contentLength <= 65) {
              // 符合要求，缓存并持久化
              console.log(`[BookMiniReviewService] Review length OK (${contentLength} chars), caching...`);
              console.log(`[BookMiniReviewService] Cache key: ${cacheKey}`);
              console.log(`[BookMiniReviewService] Content preview: ${review.content.substring(0, 50)}...`);
              
              this.cache.set(cacheKey, review);
              console.log(`[BookMiniReviewService] Set to memory cache. Cache size: ${this.cache.size}`);
              
              this.syncCacheToSettings();
              console.log(`[BookMiniReviewService] Synced to settings store`);
              
              // 持久化到SQLite
              try {
                await dbInsertMiniReview({
                  id: `${book.id}:${type}:${review.generatedAt}`,
                  bookId: book.id,
                  content: review.content,
                  generatedAt: review.generatedAt,
                  rating: review.rating,
                  source: review.source,
                  type: review.type,
                  isPinned: review.isPinned,
                });
                console.log(`[BookMiniReviewService] Persisted to SQLite`);
              } catch (err) {
                console.error("[BookMiniReviewService] Failed to persist to DB:", err);
              }
            } else {
              // 超过65字，不缓存，返回null强制重新生成
              console.warn(`[BookMiniReviewService] Review too long (${contentLength} chars > 65), not caching`);
              resolve(null);
              return;
            }
          }
          
          resolve(review);
        } catch (error) {
          console.error("[BookMiniReviewService] Failed to generate review:", error);
          resolve(null);
        } finally {
          // 完成一个请求，处理队列中的下一个
          currentGeneratingCount--;
          console.log(`[BookMiniReviewService] Generation complete (${currentGeneratingCount}/${MAX_CONCURRENT_GENERATIONS})`);
          processQueue();
        }
      };
      
      // 如果当前并发数未满，直接执行
      if (currentGeneratingCount < MAX_CONCURRENT_GENERATIONS) {
        currentGeneratingCount++;
        console.log(`[BookMiniReviewService] Starting generation (${currentGeneratingCount}/${MAX_CONCURRENT_GENERATIONS})`);
        executeGeneration();
      } else {
        // 否则加入队列
        console.log('[BookMiniReviewService] Queuing generation request');
        generationQueue.push(executeGeneration);
      }
    });
  }

  private async generateAIReview(
    book: Book,
    timeout: number,
    type: MiniReviewType = "hook",
  ): Promise<BookMiniReview | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn(`[BookMiniReviewService] AI request timeout after ${timeout}ms`);
        resolve(null);
      }, timeout);

      const aiConfig = useSettingsStore.getState().aiConfig;
      const endpoint = aiConfig.endpoints.find((ep) => ep.id === aiConfig.activeEndpointId);

      if (!endpoint || !aiConfig.activeModel) {
        clearTimeout(timer);
        resolve(null);
        return;
      }

      // 根据类型选择不同的系统提示词
      const systemPrompts: Record<MiniReviewType, string> = {
        hook: `你是一位资深书评人。请提炼书中最颠覆认知的一个事实或观点，用一句话抓住读者注意力。**严格要求：输出必须恰好50-60个字符（包括标点符号和空格），不能多也不能少**。请直接输出微评内容，不要有任何解释、前缀、后缀、引号或标记。示例格式：这本书揭示了...（正好50-60字）`,
        question: `你是一位善于提问的读书导师。请提出一个让读者忍不住想翻书寻找答案的尖锐问题，并简要说明为什么这个问题值得思考。**严格要求：输出必须恰好50-60个字符（包括标点符号和空格），不能多也不能少**。请直接输出微评内容，不要有任何解释、前缀、后缀、引号或标记。示例格式：你是否想过...（正好50-60字）`,
        resonance: `你是一位富有同理心的读者。请结合普通读者的经历或困惑，生成一句直击内心的见解，让人产生强烈共鸣。**严格要求：输出必须恰好50-60个字符（包括标点符号和空格），不能多也不能少**。请直接输出微评内容，不要有任何解释、前缀、后缀、引号或标记。示例格式：我们都曾...（正好50-60字）`,
        anecdote: `你是一位文学研究者。请抓取作者在创作该书时的一段有趣背景或故事，或者书中某个鲜为人知的细节。**严格要求：输出必须恰好50-60个字符（包括标点符号和空格），不能多也不能少**。请直接输出微评内容，不要有任何解释、前缀、后缀、引号或标记。示例格式：作者在写...（正好50-60字）`,
      };

      const systemPrompt = systemPrompts[type];

      const userPrompt = `书籍信息：
书名：《${book.meta.title}》
作者：${book.meta.author || "未知"}
语言：${book.meta.language || "未知"}

请生成一段${this.getTypeLabel(type)}风格的微评。`;

      console.log(`[BookMiniReviewService] Sending AI request for book: ${book.meta.title}, type: ${type}`);

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

      console.log(`[BookMiniReviewService] Request URL: ${requestUrl}`);
      console.log(`[BookMiniReviewService] Model: ${aiConfig.activeModel}`);
      console.log(`[BookMiniReviewService] API Key: ${endpoint.apiKey ? '***' + endpoint.apiKey.slice(-4) : 'NOT SET'}`);

      fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
        },
        body: JSON.stringify(requestBody),
      })
        .then((response) => {
          console.log(`[BookMiniReviewService] Response status: ${response.status}`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((data) => {
          clearTimeout(timer);
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            // 清理内容：去除引号、前缀等
            let cleanedContent = content.trim();
            
            // 去除首尾的引号
            if ((cleanedContent.startsWith('"') && cleanedContent.endsWith('"')) ||
                (cleanedContent.startsWith("'") && cleanedContent.endsWith("'"))) {
              cleanedContent = cleanedContent.slice(1, -1).trim();
            }
            
            // 去除可能的前缀（如“微评：”、“评论：”等）
            const prefixes = ['微评：', '评论：', '书评：', '简介：', '摘要：'];
            for (const prefix of prefixes) {
              if (cleanedContent.startsWith(prefix)) {
                cleanedContent = cleanedContent.substring(prefix.length).trim();
                break;
              }
            }
            
            console.log(`[BookMiniReviewService] Raw content length: ${content.length}, Cleaned: ${cleanedContent.length}`);
            console.log(`[BookMiniReviewService] Content preview: ${cleanedContent.substring(0, 100)}`);
            
            resolve({
              bookId: book.id,
              content: cleanedContent,
              generatedAt: Date.now(),
              source: "ai",
              type: type,
              isPinned: false,
            });
          } else {
            resolve(null);
          }
        })
        .catch((error) => {
          clearTimeout(timer);
          console.error("[BookMiniReviewService] AI request failed:", error.message || error);
          resolve(null);
        });
    });
  }

  /** 获取类型的中文标签 */
  private getTypeLabel(type: MiniReviewType): string {
    const labels: Record<MiniReviewType, string> = {
      hook: "钩子式",
      question: "问题式",
      resonance: "共鸣式",
      anecdote: "作者轶事",
    };
    return labels[type];
  }

  async refreshReview(book: Book, options: MiniReviewOptions = {}): Promise<BookMiniReview | null> {
    const type = options.type || this.defaultType;
    const cacheKey = this.getCacheKey(book.id, type);
    
    // 清除缓存
    this.cache.delete(cacheKey);
    console.log('[BookMiniReviewService] Cache cleared for refresh');
    
    // 强制刷新，忽略缓存
    return this.generateReview(book, { ...options, forceRefresh: true });
  }

  /** 切换固定状态 */
  togglePinReview(bookId: string, type: MiniReviewType = "hook"): void {
    const cacheKey = this.getCacheKey(bookId, type);
    const review = this.cache.get(cacheKey);
    if (review) {
      review.isPinned = !review.isPinned;
      this.cache.set(cacheKey, review);
      this.syncCacheToSettings();
    }
  }

  /** 获取指定类型的微评 */
  getReview(bookId: string, type: MiniReviewType = "hook"): BookMiniReview | null {
    const cacheKey = this.getCacheKey(bookId, type);
    const review = this.cache.get(cacheKey);
    if (this.isCacheValid(review)) {
      return review || null;
    }
    return null;
  }

  /** 获取一本书的所有类型微评 */
  getAllReviewsForBook(bookId: string): BookMiniReview[] {
    const types: MiniReviewType[] = ["hook", "question", "resonance", "anecdote"];
    return types
      .map((type) => this.getReview(bookId, type))
      .filter((r): r is BookMiniReview => r !== null);
  }

  /** 设置默认微评类型 */
  setDefaultType(type: MiniReviewType): void {
    this.defaultType = type;
    try {
      useSettingsStore.getState().setMiniReviewDefaultType(type);
    } catch (err) {
      console.error("[BookMiniReviewService] Failed to save default type:", err);
    }
  }

  /** 获取默认微评类型 */
  getDefaultType(): MiniReviewType {
    return this.defaultType;
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
