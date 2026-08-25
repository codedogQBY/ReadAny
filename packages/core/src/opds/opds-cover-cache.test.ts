import { describe, expect, it, vi } from "vitest";
import type { OpdsAssetResponse } from "./opds-client";
import { createOpdsCoverCache, readOpdsCover } from "./opds-cover-cache";

function imageResponse(bytes: number[], headers: Record<string, string> = {}) {
  const response = new Response(Uint8Array.from(bytes), {
    headers: { "Content-Type": "image/png", ...headers },
  });
  return Object.assign(response, { cancel: vi.fn(async () => undefined) }) as OpdsAssetResponse;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("shared OPDS cover cache", () => {
  it("deduplicates in-flight authenticated image reads", async () => {
    const load = vi.fn(async () => ({ uri: "data:image/png;base64,AQ==", byteLength: 1 }));
    const cache = createOpdsCoverCache({ load, maxEntries: 2, maxBytes: 10 });

    const [first, second] = await Promise.all([cache.acquire("cover"), cache.acquire("cover")]);

    expect(load).toHaveBeenCalledTimes(1);
    first.release();
    second.release();
  });

  it("evicts the least recently used released cover within entry and byte bounds", async () => {
    const cache = createOpdsCoverCache({
      load: async (url) => ({ uri: url, byteLength: 4 }),
      maxEntries: 1,
      maxBytes: 4,
    });
    (await cache.acquire("first")).release();
    (await cache.acquire("second")).release();

    expect(cache.snapshot()).toMatchObject({ entries: 1, sourceBytes: 4, urls: ["second"] });
  });

  it("loads a dense FIFO window as earlier leases release capacity", async () => {
    const loaded: string[] = [];
    const cache = createOpdsCoverCache({
      load: async (url) => {
        loaded.push(url);
        return { uri: url, byteLength: 2 };
      },
      maxEntries: 2,
      maxBytes: 4,
      maxLoadBytes: 2,
    });
    const pending = Array.from({ length: 8 }, (_, index) => cache.acquire(`cover-${index}`));
    const held = await Promise.all(pending.slice(0, 2));
    expect(loaded).toEqual(["cover-0", "cover-1"]);

    for (let index = 2; index < pending.length; index += 1) {
      held.shift()?.release();
      const next = await pending[index];
      held.push(next);
      expect(cache.snapshot().liveBytes).toBeLessThanOrEqual(4);
    }

    for (const lease of held) lease.release();
    expect(loaded).toEqual(Array.from({ length: 8 }, (_, index) => `cover-${index}`));
  });

  it("reserves the hard live-byte budget before starting distinct loads", async () => {
    const gate = deferred();
    const load = vi.fn(async (url: string) => {
      await gate.promise;
      return { uri: url, byteLength: 4 };
    });
    const cache = createOpdsCoverCache({
      load,
      maxEntries: 2,
      maxBytes: 8,
      maxLoadBytes: 4,
      maxConcurrentLoads: 4,
    });

    const first = cache.acquire("first");
    const second = cache.acquire("second");
    const third = cache.acquire("third");
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.snapshot()).toMatchObject({
      entries: 0,
      sourceBytes: 0,
      liveEntries: 2,
      liveBytes: 8,
      reservedBytes: 8,
    });
    gate.resolve();
    const leases = await Promise.all([first, second]);
    expect(cache.snapshot()).toMatchObject({ liveEntries: 2, liveBytes: 8, reservedBytes: 0 });
    for (const lease of leases) lease.release();
    const thirdLease = await third;
    thirdLease.release();
  });

  it("deduplicates a queued URL and gives both waiters leases when capacity frees", async () => {
    const load = vi.fn(async (url: string) => ({ uri: url, byteLength: 2 }));
    const cache = createOpdsCoverCache({ load, maxEntries: 1, maxBytes: 2, maxLoadBytes: 2 });
    const first = await cache.acquire("first");
    const secondA = cache.acquire("second");
    const secondB = cache.acquire("second");
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);

    first.release();
    const [leaseA, leaseB] = await Promise.all([secondA, secondB]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(leaseA.uri).toBe(leaseB.uri);
    leaseA.release();
    leaseB.release();
  });

  it("releases queue capacity after a load failure", async () => {
    const load = vi.fn(async (url: string) => {
      if (url === "bad") throw new Error("bad-cover");
      return { uri: url, byteLength: 1 };
    });
    const cache = createOpdsCoverCache({ load, maxEntries: 1, maxBytes: 1, maxLoadBytes: 1 });
    const bad = cache.acquire("bad");
    const good = cache.acquire("good");

    await expect(bad).rejects.toThrow("bad-cover");
    const lease = await good;
    expect(load.mock.calls.map(([url]) => url)).toEqual(["bad", "good"]);
    lease.release();
  });

  it("cancels queued and in-flight covers on clear without late repopulation", async () => {
    let resolveFirst!: (value: { uri: string; byteLength: number }) => void;
    const load = vi.fn(async (url: string) =>
      url === "first"
        ? new Promise<{ uri: string; byteLength: number }>((resolve) => {
            resolveFirst = resolve;
          })
        : { uri: url, byteLength: 1 },
    );
    const cache = createOpdsCoverCache({ load, maxEntries: 1, maxBytes: 1, maxLoadBytes: 1 });
    const first = cache.acquire("first");
    const queued = cache.acquire("queued");
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);

    cache.clear();
    resolveFirst({ uri: "late", byteLength: 1 });
    await expect(Promise.allSettled([first, queued])).resolves.toEqual([
      expect.objectContaining({ status: "rejected" }),
      expect.objectContaining({ status: "rejected" }),
    ]);
    expect(cache.snapshot()).toMatchObject({ entries: 0, liveBytes: 0, queued: 0 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps a cleared generation's leased bytes live until the lease releases", async () => {
    const load = vi.fn(async (url: string) => ({ uri: url, byteLength: 1 }));
    const cache = createOpdsCoverCache({ load, maxEntries: 1, maxBytes: 1, maxLoadBytes: 1 });
    const oldLease = await cache.acquire("old");

    cache.clear();
    const nextLease = cache.acquire("next");
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.snapshot()).toMatchObject({ entries: 0, liveEntries: 1, liveBytes: 1 });

    oldLease.release();
    const next = await nextLease;
    expect(load).toHaveBeenCalledTimes(2);
    next.release();
  });

  it("caps concurrent distinct loads", async () => {
    const gate = deferred();
    let active = 0;
    let maximumActive = 0;
    const cache = createOpdsCoverCache({
      load: async (url) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await gate.promise;
        active -= 1;
        return { uri: url, byteLength: 1 };
      },
      maxEntries: 20,
      maxBytes: 20,
      maxLoadBytes: 1,
      maxConcurrentLoads: 3,
    });

    const pending = Array.from({ length: 20 }, (_, index) => cache.acquire(`cover-${index}`));
    await Promise.resolve();
    expect(maximumActive).toBe(3);
    gate.resolve();
    const leases = await Promise.all(pending);
    expect(maximumActive).toBe(3);
    for (const lease of leases) lease.release();
  });

  it("rejects a streamed non-image or oversized cover and cancels transport", async () => {
    const wrongType = imageResponse([1], { "Content-Type": "text/html" });
    await expect(readOpdsCover(wrongType, new AbortController().signal, 4)).rejects.toThrow(
      "not-an-image",
    );
    expect(wrongType.cancel).toHaveBeenCalledWith("not-an-image");

    const tooLarge = imageResponse([1, 2, 3, 4, 5]);
    await expect(readOpdsCover(tooLarge, new AbortController().signal, 4)).rejects.toThrow(
      "cover-too-large",
    );
    expect(tooLarge.cancel).toHaveBeenCalledWith("cover-too-large");
  });
});
