export class AsyncLRUCache<T> {
  private readonly values = new Map<string, T>();
  private readonly pending = new Map<string, Promise<T>>();

  constructor(
    private readonly capacity: number,
    private readonly clone: (value: T) => T,
  ) {}

  getExisting(key: string): Promise<T> | null {
    const value = this.values.get(key);
    if (value !== undefined) {
      this.touch(key, value);
      return Promise.resolve(this.clone(value));
    }
    const pending = this.pending.get(key);
    return pending ? pending.then(this.clone) : null;
  }

  getOrCreate(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.getExisting(key);
    if (existing) return existing;

    const request = load()
      .then((value) => {
        this.touch(key, this.clone(value));
        return value;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, request);
    return request.then(this.clone);
  }

  private touch(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.capacity) {
      const oldestKey = this.values.keys().next().value;
      if (oldestKey === undefined) break;
      this.values.delete(oldestKey);
    }
  }
}

const SYNTHESIS_CACHE_CAPACITY = 48;
const synthesisAudioCache = new AsyncLRUCache<Uint8Array>(SYNTHESIS_CACHE_CAPACITY, (audio) =>
  audio.slice(),
);

export function buildSynthesisCacheKey(
  provider: string,
  text: string,
  settings: readonly unknown[],
): string {
  return JSON.stringify([provider, ...settings, text]);
}

export function getCachedSynthesisAudio(key: string): Promise<Uint8Array> | null {
  return synthesisAudioCache.getExisting(key);
}

export function getOrCreateSynthesisAudio(
  key: string,
  synthesize: () => Promise<Uint8Array>,
): Promise<Uint8Array> {
  return synthesisAudioCache.getOrCreate(key, synthesize);
}
