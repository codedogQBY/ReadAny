import type { OpdsAssetResponse } from "./opds-client";

export interface OpdsCoverValue {
  readonly uri: string;
  readonly byteLength: number;
}

export interface OpdsCoverLease {
  readonly uri: string;
  release(): void;
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(value >> 18) & 63];
    output += alphabet[(value >> 12) & 63];
    output += second === undefined ? "=" : alphabet[(value >> 6) & 63];
    output += third === undefined ? "=" : alphabet[value & 63];
  }
  return output;
}

export async function readOpdsCover(
  response: OpdsAssetResponse,
  signal: AbortSignal,
  maxBytes: number,
): Promise<OpdsCoverValue> {
  let cancelled = false;
  const cancelTransport = async (reason: string) => {
    if (cancelled) return;
    cancelled = true;
    await response.cancel(reason);
  };
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim();
  const advertisedLength = Number(response.headers.get("Content-Length"));
  if (!contentType?.startsWith("image/")) {
    await cancelTransport("not-an-image");
    throw new Error("not-an-image");
  }
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
    await cancelTransport("cover-too-large");
    throw new Error("cover-too-large");
  }
  if (signal.aborted) {
    await cancelTransport("cancelled");
    throw new Error("cancelled");
  }
  if (!response.body) {
    await cancelTransport("missing-stream");
    throw new Error("missing-stream");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const onAbort = () => void cancelTransport("cancelled");
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) {
        await cancelTransport("cancelled");
        throw new Error("cancelled");
      }
      const next = await reader.read();
      if (signal.aborted) {
        await cancelTransport("cancelled");
        throw new Error("cancelled");
      }
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > maxBytes) {
        await cancelTransport("cover-too-large");
        throw new Error("cover-too-large");
      }
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { uri: `data:${contentType};base64,${bytesToBase64(bytes)}`, byteLength };
}

interface CacheEntry extends OpdsCoverValue {
  references: number;
  lastUsed: number;
}

interface PendingEntry {
  readonly url: string;
  readonly generation: number;
  controller: AbortController;
  promise: Promise<CacheEntry>;
  resolve(entry: CacheEntry): void;
  reject(error: Error): void;
  waiters: number;
  state: "queued" | "loading" | "resolved" | "rejected" | "cancelled";
  releaseReservation(): void;
  releaseActiveLoad(): void;
}

export function createOpdsCoverCache({
  load,
  maxEntries,
  maxBytes,
  maxLoadBytes = maxBytes,
  maxConcurrentLoads = 4,
  maxQueuedLoads = Math.max(1, maxEntries * 4),
}: {
  load(url: string, signal: AbortSignal): Promise<OpdsCoverValue>;
  maxEntries: number;
  maxBytes: number;
  /** Maximum bytes one loader can return; reserved before the transport starts. */
  maxLoadBytes?: number;
  maxConcurrentLoads?: number;
  /** Maximum number of distinct queued/loading covers. Duplicate URLs share one slot. */
  maxQueuedLoads?: number;
}) {
  const entries = new Map<string, CacheEntry>();
  const retiredEntries = new Set<CacheEntry>();
  const pendingByUrl = new Map<string, PendingEntry>();
  const pendingQueue: PendingEntry[] = [];
  let sourceBytes = 0;
  let retiredBytes = 0;
  let clock = 0;
  let generation = 0;
  let activeLoads = 0;
  let reservedBytes = 0;

  const evictOldestReleased = () => {
    const candidate = [...entries.entries()]
      .filter(([url, entry]) => {
        const pending = pendingByUrl.get(url);
        return entry.references === 0 && !(pending?.state === "resolved" && pending.waiters > 0);
      })
      .sort(([, left], [, right]) => left.lastUsed - right.lastUsed)[0];
    if (!candidate) return false;
    entries.delete(candidate[0]);
    sourceBytes -= candidate[1].byteLength;
    return true;
  };

  const reserveCapacity = (pending: PendingEntry, bytes: number) => {
    while (
      entries.size + retiredEntries.size + activeLoads >= maxEntries ||
      sourceBytes + retiredBytes + reservedBytes + bytes > maxBytes
    ) {
      if (!evictOldestReleased()) return false;
    }
    reservedBytes += bytes;
    let reservationActive = true;
    pending.releaseReservation = () => {
      if (!reservationActive) return;
      reservationActive = false;
      reservedBytes = Math.max(0, reservedBytes - bytes);
    };
    return true;
  };

  const removePending = (pending: PendingEntry) => {
    if (pendingByUrl.get(pending.url) === pending) pendingByUrl.delete(pending.url);
  };

  let drainQueue = () => {};

  const cancelPending = (pending: PendingEntry, shouldDrain = true) => {
    if (
      pending.state === "resolved" ||
      pending.state === "rejected" ||
      pending.state === "cancelled"
    ) {
      removePending(pending);
      return;
    }
    pending.state = "cancelled";
    pending.controller.abort();
    pending.releaseReservation();
    pending.releaseActiveLoad();
    pending.reject(new Error("cancelled"));
    removePending(pending);
    if (shouldDrain) drainQueue();
  };

  const finishPending = (pending: PendingEntry) => {
    pending.releaseReservation();
    pending.releaseActiveLoad();
    if (pending.waiters === 0) {
      removePending(pending);
      drainQueue();
    } else if (pending.state !== "resolved") {
      drainQueue();
    }
  };

  const startLoad = (pending: PendingEntry, reservation: number) => {
    pending.state = "loading";
    activeLoads += 1;
    let active = true;
    pending.releaseActiveLoad = () => {
      if (!active) return;
      active = false;
      activeLoads = Math.max(0, activeLoads - 1);
    };
    let loaded: Promise<OpdsCoverValue>;
    try {
      loaded = load(pending.url, pending.controller.signal);
    } catch (error) {
      loaded = Promise.reject(error);
    }
    void loaded
      .then((value) => {
        if (pending.state === "cancelled" || pending.generation !== generation) return;
        if (value.byteLength > reservation) throw new Error("cover-too-large");
        const entry = { ...value, references: 0, lastUsed: ++clock };
        entries.set(pending.url, entry);
        sourceBytes += value.byteLength;
        pending.state = "resolved";
        pending.resolve(entry);
      })
      .catch((error: unknown) => {
        if (pending.state === "cancelled") return;
        pending.state = "rejected";
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => finishPending(pending));
  };

  drainQueue = () => {
    const concurrencyLimit = Math.max(1, maxConcurrentLoads);
    const reservation = Math.min(maxLoadBytes, maxBytes);
    while (activeLoads < concurrencyLimit) {
      while (pendingQueue[0] && pendingQueue[0].state !== "queued") pendingQueue.shift();
      const pending = pendingQueue[0];
      if (!pending) return;
      if (!reserveCapacity(pending, reservation)) return;
      pendingQueue.shift();
      startLoad(pending, reservation);
    }
  };

  const lease = (entry: CacheEntry): OpdsCoverLease => {
    entry.references += 1;
    entry.lastUsed = ++clock;
    let released = false;
    return {
      uri: entry.uri,
      release() {
        if (released) return;
        released = true;
        entry.references = Math.max(0, entry.references - 1);
        entry.lastUsed = ++clock;
        if (entry.references === 0 && retiredEntries.delete(entry)) {
          retiredBytes = Math.max(0, retiredBytes - entry.byteLength);
        }
        drainQueue();
      },
    };
  };

  return {
    async acquire(url: string, signal?: AbortSignal): Promise<OpdsCoverLease> {
      const acquisitionGeneration = generation;
      if (signal?.aborted) throw new Error("cancelled");
      const cached = entries.get(url);
      if (cached) return lease(cached);

      let pending = pendingByUrl.get(url);
      if (!pending) {
        if (maxEntries <= 0 || maxLoadBytes <= 0 || maxLoadBytes > maxBytes) {
          throw new Error("cover-cache-full");
        }
        if (pendingByUrl.size >= Math.max(1, maxQueuedLoads)) throw new Error("cover-cache-full");
        const controller = new AbortController();
        let resolvePending!: (entry: CacheEntry) => void;
        let rejectPending!: (error: Error) => void;
        const promise = new Promise<CacheEntry>((resolve, reject) => {
          resolvePending = resolve;
          rejectPending = reject;
        });
        void promise.catch(() => {});
        pending = {
          url,
          generation,
          controller,
          promise,
          resolve: resolvePending,
          reject: rejectPending,
          waiters: 0,
          state: "queued",
          releaseReservation: () => {},
          releaseActiveLoad: () => {},
        };
        pendingByUrl.set(url, pending);
        pendingQueue.push(pending);
        drainQueue();
      }
      pending.waiters += 1;
      let leased = false;
      let rejectCancelled: ((error: Error) => void) | undefined;
      const cancelled = new Promise<never>((_resolve, reject) => {
        rejectCancelled = reject;
      });
      const onAbort = () => rejectCancelled?.(new Error("cancelled"));
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const entry = await Promise.race([pending.promise, cancelled]);
        if (acquisitionGeneration !== generation) throw new Error("cancelled");
        const result = lease(entry);
        leased = true;
        return result;
      } finally {
        signal?.removeEventListener("abort", onAbort);
        pending.waiters = Math.max(0, pending.waiters - 1);
        if (pending.waiters === 0) {
          if (!leased && (pending.state === "queued" || pending.state === "loading")) {
            cancelPending(pending);
          } else {
            removePending(pending);
            drainQueue();
          }
        }
      }
    },
    clear(): void {
      generation += 1;
      for (const pending of pendingByUrl.values()) cancelPending(pending, false);
      pendingByUrl.clear();
      pendingQueue.length = 0;
      for (const entry of entries.values()) {
        if (entry.references > 0 && !retiredEntries.has(entry)) {
          retiredEntries.add(entry);
          retiredBytes += entry.byteLength;
        }
      }
      entries.clear();
      sourceBytes = 0;
      reservedBytes = 0;
    },
    snapshot() {
      return {
        entries: entries.size,
        sourceBytes,
        urls: [...entries.keys()],
        liveEntries: entries.size + retiredEntries.size + activeLoads,
        liveBytes: sourceBytes + retiredBytes + reservedBytes,
        reservedBytes,
        queued: pendingQueue.filter((pending) => pending.state === "queued").length,
      };
    },
  };
}
