import type { Book } from "../types";

export interface FallbackTextSegment {
  text: string;
  cfi?: string;
}

export interface FallbackChapter {
  index: number;
  title: string;
  content: string;
  segments?: FallbackTextSegment[];
}

export interface FallbackContentProvider {
  getChapters(book: Book): Promise<FallbackChapter[]>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 8;
const PROVIDER_TIMEOUT_MS = 45_000;

interface CachedChapters {
  chapters: FallbackChapter[];
  cachedAt: number;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Timed out reading original book content"));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

class FallbackContentService {
  private provider: FallbackContentProvider | null = null;
  private cache = new Map<string, CachedChapters>();

  setProvider(provider: FallbackContentProvider | null): void {
    this.provider = provider;
    this.cache.clear();
  }

  clear(bookId?: string): void {
    if (bookId) {
      this.cache.delete(bookId);
      return;
    }
    this.cache.clear();
  }

  async getChapters(book: Book): Promise<FallbackChapter[]> {
    if (!this.provider) {
      throw new Error("Fallback content provider is not registered");
    }

    const cached = this.cache.get(book.id);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.chapters;
    }

    const chapters = await withTimeout(this.provider.getChapters(book), PROVIDER_TIMEOUT_MS);
    this.cache.set(book.id, { chapters, cachedAt: Date.now() });

    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    return chapters;
  }
}

export const fallbackContentService = new FallbackContentService();

export function setFallbackContentProvider(provider: FallbackContentProvider | null): void {
  fallbackContentService.setProvider(provider);
}
