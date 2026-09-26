import { describe, expect, it, vi } from "vitest";
import { AsyncLRUCache } from "./synthesis-cache";

describe("AsyncLRUCache", () => {
  it("deduplicates concurrent synthesis and returns independent values", async () => {
    const load = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const cache = new AsyncLRUCache(2, (value: Uint8Array) => value.slice());

    const [first, second] = await Promise.all([
      cache.getOrCreate("same", load),
      cache.getOrCreate("same", load),
    ]);

    expect(load).toHaveBeenCalledOnce();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("evicts the least recently used value", async () => {
    const cache = new AsyncLRUCache(2, (value: string) => value);
    await cache.getOrCreate("first", async () => "one");
    await cache.getOrCreate("second", async () => "two");
    await cache.getExisting("first");
    await cache.getOrCreate("third", async () => "three");

    expect(cache.getExisting("first")).not.toBeNull();
    expect(cache.getExisting("second")).toBeNull();
  });
});
