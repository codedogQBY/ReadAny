import type { IPlatformService } from "@readany/core/services";
import { describe, expect, it, vi } from "vitest";
import { createOpdsMobileRuntime } from "./opds-mobile-runtime";

describe("mobile OPDS runtime", () => {
  it("shares one catalog store so session-only credentials survive screen navigation", async () => {
    let persisted: string | null = null;
    const platform = {
      kvGetItem: vi.fn(async () => persisted),
      kvSetItem: vi.fn(async (_key: string, value: string) => {
        persisted = value;
      }),
    } as unknown as IPlatformService;
    const runtime = createOpdsMobileRuntime(() => platform);
    await runtime.ensureCatalogsLoaded();
    const firstScreenStore = runtime.getCatalogStore();

    const catalog = await firstScreenStore.addCatalog({
      name: "Private catalog",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "session-secret",
    });

    await runtime.ensureCatalogsLoaded();
    const browserStore = runtime.getCatalogStore();
    expect(browserStore).toBe(firstScreenStore);
    expect(await browserStore.getCredentials(catalog.id)).toMatchObject({
      username: "reader",
      password: "session-secret",
      catalogOrigin: "https://catalog.test",
    });
    expect(platform.kvGetItem).toHaveBeenCalledOnce();
    expect(runtime.getClient()).toBe(runtime.getClient());
  });
});
