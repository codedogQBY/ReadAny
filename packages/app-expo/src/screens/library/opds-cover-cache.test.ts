import type { OpdsAssetResponse } from "@readany/core";
import { describe, expect, it, vi } from "vitest";
import { createOpdsCoverCache, readOpdsCover } from "./opds-cover-cache";

function response(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const cancel = vi.fn(async () => undefined);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel,
  });
  return {
    body,
    bodyUsed: false,
    headers: new Headers({ "Content-Type": "image/jpeg", ...headers }),
    ok: true,
    redirected: false,
    status: 200,
    statusText: "OK",
    type: "default",
    url: "https://catalog.test/cover.jpg",
    arrayBuffer: vi.fn(),
    blob: vi.fn(),
    json: vi.fn(),
    text: vi.fn(),
    cancel,
  } as unknown as OpdsAssetResponse & { cancel: ReturnType<typeof vi.fn> };
}

describe("OPDS cover streaming and cache", () => {
  it("cancels a chunked response as soon as the real byte ceiling is crossed", async () => {
    const asset = response([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]);

    await expect(readOpdsCover(asset, new AbortController().signal, 5)).rejects.toThrow(
      "cover-too-large",
    );
    expect(asset.cancel).toHaveBeenCalledOnce();
    expect(asset.arrayBuffer).not.toHaveBeenCalled();
  });

  it("does not trust a dishonest short Content-Length", async () => {
    const asset = response([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])], {
      "Content-Length": "2",
    });

    await expect(readOpdsCover(asset, new AbortController().signal, 5)).rejects.toThrow(
      "cover-too-large",
    );
    expect(asset.cancel).toHaveBeenCalledOnce();
  });

  it("aborts the exact cover transport", async () => {
    const asset = response([new Uint8Array([1])]);
    const controller = new AbortController();
    controller.abort();

    await expect(readOpdsCover(asset, controller.signal, 5)).rejects.toThrow("cancelled");
    expect(asset.cancel).toHaveBeenCalledOnce();
  });

  it("deduplicates duplicate cover URLs into one shared fetch", async () => {
    const load = vi.fn(async () => ({ uri: "data:image/jpeg;base64,AQ==", byteLength: 1 }));
    const cache = createOpdsCoverCache({ load, maxEntries: 4, maxBytes: 100 });

    const [first, second] = await Promise.all([
      cache.acquire("https://catalog.test/cover.jpg"),
      cache.acquire("https://catalog.test/cover.jpg"),
    ]);

    expect(load).toHaveBeenCalledOnce();
    expect(first.uri).toBe(second.uri);
    first.release();
    second.release();
  });

  it("evicts the least-recently-used released entry within entry and byte bounds", async () => {
    const load = vi.fn(async (url: string) => ({
      uri: `data:image/jpeg;base64,${url}`,
      byteLength: 6,
    }));
    const cache = createOpdsCoverCache({ load, maxEntries: 1, maxBytes: 8 });

    (await cache.acquire("one")).release();
    (await cache.acquire("two")).release();
    expect(cache.snapshot()).toMatchObject({ entries: 1, sourceBytes: 6, urls: ["two"] });
    (await cache.acquire("one")).release();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("uses reference-counted cancellation for a shared in-flight fetch", async () => {
    let loaderSignal: AbortSignal | undefined;
    const load = vi.fn(
      async (_url: string, signal: AbortSignal) =>
        new Promise<{ uri: string; byteLength: number }>((_resolve, reject) => {
          loaderSignal = signal;
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        }),
    );
    const cache = createOpdsCoverCache({ load, maxEntries: 4, maxBytes: 100 });
    const first = new AbortController();
    const second = new AbortController();
    const firstLease = cache.acquire("shared", first.signal);
    const secondLease = cache.acquire("shared", second.signal);

    first.abort();
    expect(loaderSignal?.aborted).toBe(false);
    second.abort();
    await expect(Promise.allSettled([firstLease, secondLease])).resolves.toHaveLength(2);
    expect(loaderSignal?.aborted).toBe(true);
  });

  it("clears cached and in-flight resources on feed change or unmount", async () => {
    let loaderSignal: AbortSignal | undefined;
    const cache = createOpdsCoverCache({
      load: async (_url, signal) => {
        loaderSignal = signal;
        return new Promise(() => {});
      },
      maxEntries: 4,
      maxBytes: 100,
    });
    const pending = cache.acquire("pending");

    cache.clear();

    await expect(pending).rejects.toThrow("cancelled");
    expect(loaderSignal?.aborted).toBe(true);
    expect(cache.snapshot()).toMatchObject({ entries: 0, sourceBytes: 0, urls: [] });
  });

  it("does not repopulate a cleared feed when a stale loader resolves late", async () => {
    let resolveLoad!: (value: { uri: string; byteLength: number }) => void;
    const cache = createOpdsCoverCache({
      load: async () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      maxEntries: 4,
      maxBytes: 100,
    });
    const stale = cache.acquire("stale");

    cache.clear();
    resolveLoad({ uri: "data:image/jpeg;base64,AQ==", byteLength: 1 });

    await expect(stale).rejects.toThrow("cancelled");
    expect(cache.snapshot()).toMatchObject({ entries: 0, sourceBytes: 0, urls: [] });
  });
});
