import { afterEach, describe, expect, it, vi } from "vitest";

import { type FetchOptions, type IPlatformService, setPlatformService } from "../services/platform";
import { DEFAULT_WEBDAV_REMOTE_ROOT, type WebDavConfig } from "./sync-backend";
import { WebDavBackend } from "./webdav-backend";

function installFetchStub(
  handler: (url: string, options?: FetchOptions) => Response | Promise<Response>,
): void {
  setPlatformService({
    platformType: "web",
    isMobile: false,
    isDesktop: false,
    fetch: handler,
  } as unknown as IPlatformService);
}

function webDavConfig(): WebDavConfig {
  return {
    type: "webdav",
    url: "https://dav.example.com/dav",
    username: "alice",
    remoteRoot: DEFAULT_WEBDAV_REMOTE_ROOT,
    allowInsecure: false,
    autoSync: false,
    syncIntervalMins: 30,
    wifiOnly: false,
    notifyOnComplete: false,
  };
}

describe("WebDavBackend directory healing", () => {
  afterEach(() => {
    setPlatformService(null as unknown as IPlatformService);
  });

  it("putJSON creates the missing /readany/sync collection and retries instead of surfacing the 404", async () => {
    const calls: { method: string; url: string }[] = [];
    installFetchStub((url, options) => {
      const method = String(options?.method ?? "GET");
      calls.push({ method, url });
      if (method === "PUT") {
        const putCount = calls.filter((call) => call.method === "PUT").length;
        return new Response("", { status: putCount === 1 ? 404 : 200 });
      }
      if (method === "PROPFIND") {
        return new Response("", { status: url.endsWith("/readany/") ? 207 : 404 });
      }
      if (method === "MKCOL") {
        return new Response("", { status: 201 });
      }
      return new Response("", { status: 404 });
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const backend = new WebDavBackend(webDavConfig(), "secret");
      await backend.putJSON("/readany/sync/device-abc.json", { deviceId: "abc" });
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }

    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(2);
    expect(
      calls.some((call) => call.method === "MKCOL" && call.url.endsWith("/readany/sync/")),
    ).toBe(true);
  });

  it("ensureDirectories creates the legacy file/cover collections through ensureDirectory", async () => {
    const calls: { method: string; url: string }[] = [];
    installFetchStub((url, options) => {
      const method = String(options?.method ?? "GET");
      calls.push({ method, url });
      if (method === "PROPFIND") {
        return new Response("", { status: 404 });
      }
      if (method === "MKCOL") {
        return new Response("", { status: 201 });
      }
      return new Response("", { status: 404 });
    });

    const backend = new WebDavBackend(webDavConfig(), "secret");
    await backend.ensureDirectories();

    const mkcolUrls = calls.filter((call) => call.method === "MKCOL").map((call) => call.url);
    expect(mkcolUrls).toEqual([
      "https://dav.example.com/dav/readany/",
      "https://dav.example.com/dav/readany/sync/",
      "https://dav.example.com/dav/readany/data/",
      "https://dav.example.com/dav/readany/data/books/",
      "https://dav.example.com/dav/readany/data/file/",
      "https://dav.example.com/dav/readany/data/cover/",
    ]);
  });
});
