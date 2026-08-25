import { describe, expect, it, vi } from "vitest";
import type { IPlatformService } from "../services/platform";
import { createOpdsRuntime } from "./opds-runtime";

function platform() {
  return {
    kvGetItem: vi.fn(async () => null),
    kvSetItem: vi.fn(async () => undefined),
  } as unknown as IPlatformService;
}

describe("shared OPDS runtime", () => {
  it("keeps one loaded store and client for a platform while coalescing concurrent loads", async () => {
    const active = platform();
    const runtime = createOpdsRuntime(() => active);

    expect(runtime.getCatalogStore()).toBe(runtime.getCatalogStore());
    expect(runtime.getClient()).toBe(runtime.getClient());

    await Promise.all([runtime.ensureCatalogsLoaded(), runtime.ensureCatalogsLoaded()]);

    expect(active.kvGetItem).toHaveBeenCalledTimes(1);
  });

  it("replaces platform-bound owners when the platform changes", async () => {
    let active = platform();
    const runtime = createOpdsRuntime(() => active);
    const firstStore = runtime.getCatalogStore();
    const firstClient = runtime.getClient();

    active = platform();

    expect(runtime.getCatalogStore()).not.toBe(firstStore);
    expect(runtime.getClient()).not.toBe(firstClient);
    await runtime.ensureCatalogsLoaded();
    expect(active.kvGetItem).toHaveBeenCalledTimes(1);
  });

  it("allows a failed load to be retried", async () => {
    const active = platform();
    vi.mocked(active.kvGetItem)
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValueOnce(null);
    const runtime = createOpdsRuntime(() => active);

    await expect(runtime.ensureCatalogsLoaded()).rejects.toThrow("storage unavailable");
    await expect(runtime.ensureCatalogsLoaded()).resolves.toBeUndefined();
    expect(active.kvGetItem).toHaveBeenCalledTimes(2);
  });
});
