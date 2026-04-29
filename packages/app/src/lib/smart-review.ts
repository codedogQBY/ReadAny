/**
 * Smart Review System — 智能复习系统
 *
 * 持久化策略：
 * - SQLite (review_items 表) 作为主存储，支持 WebDAV 同步
 * - Settings store 作为快速读取缓存
 * - 页面刷新后从 SQLite 恢复
 */

import {
  getDueReviewItems as dbGetDueReviewItems,
  getUpcomingReviewItems as dbGetUpcomingReviewItems,
  getReviewItemStats as dbGetReviewItemStats,
  insertReviewItem as dbInsertReviewItem,
  updateReviewItem as dbUpdateReviewItem,
  deleteReviewItem as dbDeleteReviewItem,
} from "@readany/core/db";
import { useSettingsStore } from "@/stores/settings-store";

export type ReviewQuality = "excellent" | "good" | "fair" | "poor";
export type ReviewStatus = "pending" | "due" | "completed" | "skipped";

export interface ReviewItem {
  id: string;
  bookId: string;
  chapterId: string;
  chapterTitle: string;
  scheduledDate: number;
  completedDate?: number;
  quality?: ReviewQuality;
  status: ReviewStatus;
  reviewCount: number;
  nextReviewDate?: number;
  notes?: string;
}

export interface ReviewSettings {
  enabled: boolean;
  algorithm: "ebbinghaus" | "ai_guided" | "hybrid";
  intervals: number[];
  autoAdjust: boolean;
  showBadges: boolean;
}

export interface AIGuidedAdjustment {
  chapterImportance: "high" | "medium" | "low";
  estimatedRetentionRate: number;
  suggestedInterval: number;
  reason: string;
}

const DEFAULT_EBBINGHAUS_INTERVALS = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  2 * 24 * 60 * 60 * 1000,
  4 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  15 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
  90 * 24 * 60 * 60 * 1000,
];

const QUALITY_INTERVALS: Record<ReviewQuality, number> = {
  excellent: 30 * 24 * 60 * 60 * 1000,
  good: 7 * 24 * 60 * 60 * 1000,
  fair: 3 * 24 * 60 * 60 * 1000,
  poor: 1 * 24 * 60 * 60 * 1000,
};

class SmartReviewSystem {
  private reviewItems: Map<string, ReviewItem> = new Map();
  private listeners: Set<() => void> = new Set();
  private initialized = false;

  constructor() {
    this.loadFromSettings();
  }

  private loadFromSettings() {
    try {
      const reviewSettings = useSettingsStore.getState().reviewSettings;
      if (reviewSettings?.items) {
        Object.entries(reviewSettings.items).forEach(([key, value]) => {
          this.reviewItems.set(key, value as ReviewItem);
        });
      }
    } catch {
      this.reviewItems = new Map();
    }
  }

  /** Load review items from SQLite (async, called once on startup) */
  async initializeFromDB() {
    if (this.initialized) return;
    try {
      const stats = await dbGetReviewItemStats();
      if (stats.total > 0) {
        // Load due and upcoming items into memory
        const dueItems = await dbGetDueReviewItems();
        const upcomingItems = await dbGetUpcomingReviewItems(50);

        for (const row of [...dueItems, ...upcomingItems]) {
          this.reviewItems.set(row.id, {
            id: row.id,
            bookId: row.book_id,
            chapterId: row.chapter_id,
            chapterTitle: row.chapter_title,
            scheduledDate: row.scheduled_date,
            completedDate: row.completed_date ?? undefined,
            quality: (row.quality as ReviewQuality) ?? undefined,
            status: row.status as ReviewStatus,
            reviewCount: row.review_count,
            nextReviewDate: row.next_review_date ?? undefined,
            notes: row.notes ?? undefined,
          });
        }
        this.syncToSettings();
      }
      this.initialized = true;
    } catch (err) {
      console.error("[SmartReviewSystem] Failed to load from DB:", err);
    }
  }

  private syncToSettings() {
    try {
      const items: Record<string, ReviewItem> = {};
      this.reviewItems.forEach((value, key) => {
        items[key] = value;
      });
      useSettingsStore.getState().updateReviewSettings({ items });
    } catch {
      console.error("[SmartReviewSystem] Failed to sync to settings");
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  async createReviewItem(
    bookId: string,
    chapterId: string,
    chapterTitle: string,
    baseDate?: number,
  ): Promise<ReviewItem> {
    const id = `${bookId}:${chapterId}`;
    const now = baseDate || Date.now();

    const item: ReviewItem = {
      id,
      bookId,
      chapterId,
      chapterTitle,
      scheduledDate: now,
      status: "pending",
      reviewCount: 0,
    };

    this.reviewItems.set(id, item);
    this.syncToSettings();
    this.notify();

    // Persist to SQLite for sync
    try {
      await dbInsertReviewItem({
        id,
        bookId,
        chapterId,
        chapterTitle,
        scheduledDate: now,
        status: "pending",
        reviewCount: 0,
      });
    } catch (err) {
      console.error("[SmartReviewSystem] Failed to persist to DB:", err);
    }

    return item;
  }

  getReviewItem(id: string): ReviewItem | null {
    return this.reviewItems.get(id) || null;
  }

  getReviewItemsForBook(bookId: string): ReviewItem[] {
    return Array.from(this.reviewItems.values()).filter((item) => item.bookId === bookId);
  }

  getDueReviews(): ReviewItem[] {
    const now = Date.now();
    return Array.from(this.reviewItems.values())
      .filter((item) => item.status === "pending" && item.scheduledDate <= now)
      .sort((a, b) => a.scheduledDate - b.scheduledDate);
  }

  getUpcomingReviews(limit = 10): ReviewItem[] {
    const now = Date.now();
    return Array.from(this.reviewItems.values())
      .filter((item) => item.status === "pending" && item.scheduledDate > now)
      .sort((a, b) => a.scheduledDate - b.scheduledDate)
      .slice(0, limit);
  }

  async completeReview(id: string, quality: ReviewQuality, settings: ReviewSettings): Promise<ReviewItem | null> {
    const item = this.reviewItems.get(id);
    if (!item) return null;

    const now = Date.now();
    let nextInterval: number;

    switch (settings.algorithm) {
      case "ebbinghaus":
        nextInterval = this.calculateEbbinghausInterval(item.reviewCount);
        break;
      case "ai_guided":
        nextInterval = QUALITY_INTERVALS[quality];
        break;
      case "hybrid":
      default: {
        const baseInterval = this.calculateEbbinghausInterval(item.reviewCount);
        const qualityMultiplier = this.getQualityMultiplier(quality);
        nextInterval = Math.round(baseInterval * qualityMultiplier);
        break;
      }
    }

    // Update existing item to completed
    item.completedDate = now;
    item.quality = quality;
    item.status = "completed";
    item.reviewCount += 1;
    item.nextReviewDate = now + nextInterval;

    // Update in DB
    try {
      await dbUpdateReviewItem(id, {
        completedDate: now,
        quality,
        status: "completed",
        reviewCount: item.reviewCount,
        nextReviewDate: item.nextReviewDate,
      });
    } catch (err) {
      console.error("[SmartReviewSystem] Failed to update DB:", err);
    }

    // Create next review item
    const newItem: ReviewItem = {
      ...item,
      id: `${item.bookId}:${item.chapterId}:${item.reviewCount}`,
      scheduledDate: item.nextReviewDate,
      status: "pending",
      completedDate: undefined,
      quality: undefined,
    };

    this.reviewItems.set(newItem.id, newItem);
    this.reviewItems.delete(id);

    // Insert next review in DB
    try {
      await dbInsertReviewItem({
        id: newItem.id,
        bookId: newItem.bookId,
        chapterId: newItem.chapterId,
        chapterTitle: newItem.chapterTitle,
        scheduledDate: newItem.scheduledDate,
        status: "pending",
        reviewCount: newItem.reviewCount,
      });
    } catch (err) {
      console.error("[SmartReviewSystem] Failed to insert next review in DB:", err);
    }

    this.syncToSettings();
    this.notify();
    return newItem;
  }

  async skipReview(id: string): Promise<ReviewItem | null> {
    const item = this.reviewItems.get(id);
    if (!item) return null;

    item.status = "skipped";

    try {
      await dbUpdateReviewItem(id, { status: "skipped" });
    } catch (err) {
      console.error("[SmartReviewSystem] Failed to update DB:", err);
    }

    this.syncToSettings();
    this.notify();
    return item;
  }

  adjustReviewDate(id: string, newDate: number): ReviewItem | null {
    const item = this.reviewItems.get(id);
    if (!item) return null;

    item.scheduledDate = newDate;

    // Fire and forget DB update
    dbUpdateReviewItem(id, { scheduledDate: newDate }).catch((err) =>
      console.error("[SmartReviewSystem] Failed to update DB:", err),
    );

    this.syncToSettings();
    this.notify();
    return item;
  }

  private calculateEbbinghausInterval(reviewCount: number): number {
    if (reviewCount >= DEFAULT_EBBINGHAUS_INTERVALS.length) {
      return DEFAULT_EBBINGHAUS_INTERVALS[DEFAULT_EBBINGHAUS_INTERVALS.length - 1];
    }
    return DEFAULT_EBBINGHAUS_INTERVALS[reviewCount];
  }

  private getQualityMultiplier(quality: ReviewQuality): number {
    switch (quality) {
      case "excellent": return 2.5;
      case "good": return 1.5;
      case "fair": return 1.0;
      case "poor": return 0.5;
      default: return 1.0;
    }
  }

  async getAIGuidedAdjustment(
    chapterContent: string,
    previousQuality?: ReviewQuality,
  ): Promise<AIGuidedAdjustment> {
    try {
      const aiConfig = useSettingsStore.getState().aiConfig;
      const endpoint = aiConfig.endpoints.find((ep) => ep.id === aiConfig.activeEndpointId);
      if (!endpoint || !aiConfig.activeModel) {
        return this.getDefaultAIGuidedAdjustment();
      }

      const systemPrompt = `你是一位学习科学专家。请分析以下章节内容，评估：
1. 内容的重要程度（高/中/低）
2. 预估的留存率（0-100%）
3. 建议的下次复习间隔（天数）

请用JSON格式回复，字段：importance, estimatedRetentionRate, suggestedInterval, reason`;

      const userPrompt = `章节内容摘要：${chapterContent.slice(0, 500)}
${previousQuality ? `上次复习质量：${previousQuality}` : ""}`;

      const requestUrl = endpoint.baseUrl.endsWith("/")
        ? `${endpoint.baseUrl}chat/completions`
        : `${endpoint.baseUrl}/chat/completions`;

      const response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: aiConfig.activeModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 200,
        }),
      });

      if (!response.ok) return this.getDefaultAIGuidedAdjustment();

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          return {
            chapterImportance: parsed.importance || "medium",
            estimatedRetentionRate: parsed.estimatedRetentionRate || 50,
            suggestedInterval: (parsed.suggestedInterval || 7) * 24 * 60 * 60 * 1000,
            reason: parsed.reason || "基于内容分析",
          };
        } catch {
          return this.getDefaultAIGuidedAdjustment();
        }
      }
      return this.getDefaultAIGuidedAdjustment();
    } catch {
      return this.getDefaultAIGuidedAdjustment();
    }
  }

  private getDefaultAIGuidedAdjustment(): AIGuidedAdjustment {
    return {
      chapterImportance: "medium",
      estimatedRetentionRate: 50,
      suggestedInterval: 7 * 24 * 60 * 60 * 1000,
      reason: "默认设置",
    };
  }

  async clearAllReviews() {
    this.reviewItems.clear();
    this.syncToSettings();
    this.notify();
  }

  async clearReviewsForBook(bookId: string) {
    const keysToDelete: string[] = [];
    this.reviewItems.forEach((item, key) => {
      if (item.bookId === bookId) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((key) => this.reviewItems.delete(key));
    this.syncToSettings();
    this.notify();

    // Delete from DB
    try {
      const { deleteReviewItemsByBookId } = await import("@readany/core/db");
      await deleteReviewItemsByBookId(bookId);
    } catch (err) {
      console.error("[SmartReviewSystem] Failed to delete from DB:", err);
    }
  }

  getStats() {
    const items = Array.from(this.reviewItems.values());
    return {
      total: items.length,
      pending: items.filter((i) => i.status === "pending").length,
      due: this.getDueReviews().length,
      completed: items.filter((i) => i.status === "completed").length,
      skipped: items.filter((i) => i.status === "skipped").length,
    };
  }
}

export const smartReviewSystem = new SmartReviewSystem();
