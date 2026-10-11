import { afterEach, describe, expect, it, vi } from "vitest";

import { type FetchOptions, type IPlatformService, setPlatformService } from "../services/platform";
import { WebDavClient, cacheBustedUrl, sanitizeWebDavRemoteRoot, transferBudgetMs } from "./webdav-client";

/** Drop the cache-busting nonce so URL assertions stay exact. */
const stripCacheBust = (url: string): string => url.replace(/[?&]_=[^&]*/, "");

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

describe("WebDavClient PROPFIND parsing", () => {
  afterEach(() => {
    setPlatformService(null as unknown as IPlatformService);
  });

  it("keeps only direct children under the requested WebDAV path", async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/dav/readany/sync/</d:href>
          <d:propstat><d:prop><d:resourcetype><d:collection /></d:resourcetype></d:prop></d:propstat>
        </d:response>
        <d:response>
          <d:href>/dav/readany/sync/device-a.json</d:href>
          <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>12</d:getcontentlength></d:prop></d:propstat>
        </d:response>
        <d:response>
          <d:href>/dav/readany/sync/archive/</d:href>
          <d:propstat><d:prop><d:resourcetype><d:collection /></d:resourcetype></d:prop></d:propstat>
        </d:response>
        <d:response>
          <d:href>/dav/readany/sync/archive/device-old.json</d:href>
          <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>99</d:getcontentlength></d:prop></d:propstat>
        </d:response>
        <d:response>
          <d:href>/dav/other/sync/device-foreign.json</d:href>
          <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>99</d:getcontentlength></d:prop></d:propstat>
        </d:response>
      </d:multistatus>`;

    installFetchStub(() => new Response(xml, { status: 207 }));

    const client = new WebDavClient("https://dav.example.com/dav/readany", "alice", "secret");
    const resources = await client.propfind("/sync");

    expect(resources).toEqual([
      {
        href: "/dav/readany/sync/device-a.json",
        name: "device-a.json",
        isCollection: false,
        contentLength: 12,
        lastModified: undefined,
        etag: undefined,
      },
      {
        href: "/dav/readany/sync/archive",
        name: "archive",
        isCollection: true,
        contentLength: undefined,
        lastModified: undefined,
        etag: undefined,
      },
    ]);
  });

  it("skips MKCOL when ensureDirectory sees the directory already exists", async () => {
    const calls: { method: string; url: string }[] = [];
    installFetchStub((url, options) => {
      calls.push({ method: String(options?.method ?? "GET"), url });
      return new Response("", { status: 207 });
    });

    const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
    await client.ensureDirectory("/readany");

    expect(calls.map((call) => call.method)).toEqual(["PROPFIND"]);
    expect(calls.map((call) => call.url)).toEqual(["https://dav.example.com/dav/readany/"]);
  });

  it("treats MKCOL network failure as success when the directory exists afterward", async () => {
    const calls: { method: string; url: string }[] = [];
    installFetchStub((url, options) => {
      const method = String(options?.method ?? "GET");
      calls.push({ method, url });
      if (method === "MKCOL") {
        throw new Error("XHR request failed with status 0");
      }
      return new Response("", { status: calls.length === 1 ? 404 : 207 });
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The fast network failure is retried (stale-keep-alive protection), so run the
    // backoff on fake timers to keep this test instant.
    vi.useFakeTimers();
    try {
      const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
      const pending = client.ensureDirectory("/readany");
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
    }

    // Shape, not exact counts: MKCOL may be attempted several times, and the
    // directory is re-checked afterwards so the caller can treat the mkdir as done.
    const methods = calls.map((call) => call.method);
    expect(methods[0]).toBe("PROPFIND");
    expect(methods.filter((method) => method === "MKCOL").length).toBeGreaterThan(0);
    expect(methods[methods.length - 1]).toBe("PROPFIND");
    expect(new Set(calls.map((call) => call.url))).toEqual(
      new Set(["https://dav.example.com/dav/readany/"]),
    );
  });

  it("retries a fast network failure once the backoff elapses", async () => {
    let attempts = 0;
    installFetchStub(() => {
      attempts++;
      if (attempts === 1) {
        // Stale pooled connection: the request dies in milliseconds.
        throw new Error("XHR request failed with status 0");
      }
      return new Response("{}", { status: 200 });
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.useFakeTimers();
    try {
      const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
      const pending = client.get("/readany/sync/index.json");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toBeInstanceOf(Uint8Array);
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(attempts).toBe(2);
  });

  it("does not retry a slow network failure", async () => {
    // Only FAST failures look like a dead keep-alive socket; a transfer that burned
    // real time is reported as-is (a retry would cost another full attempt).
    let attempts = 0;
    installFetchStub(async () => {
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      throw new Error("Software caused connection abort");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.useFakeTimers();
    try {
      const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
      const settled = client.get("/readany/sync/index.json").catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await settled).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(attempts).toBe(1);
  });

  it("treats MKCOL auth failure as success when the parent listing shows the directory", async () => {
    const calls: { method: string; url: string }[] = [];
    installFetchStub((url, options) => {
      const method = String(options?.method ?? "GET");
      calls.push({ method, url });

      if (method === "PROPFIND" && url.endsWith("/readany/")) {
        return new Response("", { status: 404 });
      }
      if (method === "MKCOL") {
        return new Response("", { status: 401 });
      }
      return new Response(
        `<?xml version="1.0" encoding="utf-8"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/dav/</d:href>
            <d:propstat><d:prop><d:resourcetype><d:collection /></d:resourcetype></d:prop></d:propstat>
          </d:response>
          <d:response>
            <d:href>/dav/readany/</d:href>
            <d:propstat><d:prop><d:resourcetype><d:collection /></d:resourcetype></d:prop></d:propstat>
          </d:response>
        </d:multistatus>`,
        { status: 207 },
      );
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
      await client.ensureDirectory("/readany");
    } finally {
      warnSpy.mockRestore();
    }

    expect(calls.map((call) => call.method)).toEqual(["PROPFIND", "MKCOL", "PROPFIND", "PROPFIND"]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://dav.example.com/dav/readany/",
      "https://dav.example.com/dav/readany/",
      "https://dav.example.com/dav/readany/",
      "https://dav.example.com/dav/",
    ]);
  });

  it("uses a collection path when safely reading a directory", async () => {
    const calls: { method: string; url: string }[] = [];
    installFetchStub((url, options) => {
      calls.push({ method: String(options?.method ?? "GET"), url });
      return new Response('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" />', {
        status: 207,
      });
    });

    const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
    await client.safeReadDir("/readany/sync");

    expect(calls.map((call) => call.method)).toEqual(["PROPFIND"]);
    expect(calls.map((call) => call.url)).toEqual(["https://dav.example.com/dav/readany/sync/"]);
  });

  it("preserves remote root path casing while normalizing slashes", () => {
    expect(sanitizeWebDavRemoteRoot(" /Apps//ReadAny-Sync/ ")).toBe("Apps/ReadAny-Sync");
  });

  it("percent-encodes non-ASCII WebDAV request paths without adding path headers", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    installFetchStub((url, options) => {
      calls.push({
        url,
        headers: (options?.headers ?? {}) as Record<string, string>,
      });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });

    const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
    const path =
      "/ReadAnySync/data/books/这里是，终末停滞委员会。 [第一卷]/姉の彼女にキスをした.epub";
    await client.get(path);

    const expectedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    // GETs carry a cache-busting nonce (see cacheBustedUrl) — strip it so the
    // path/encoding assertion stays exact.
    expect(stripCacheBust(calls[0]?.url ?? "")).toBe(`https://dav.example.com/dav${expectedPath}`);
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual(["Authorization", "Cache-Control", "Pragma"]);
    expect(
      Object.values(calls[0]?.headers ?? {}).every((value) =>
        Array.from(value).every((char) => char.charCodeAt(0) <= 0x7f),
      ),
    ).toBe(true);
  });

  it("marks reads uncacheable so no HTTP layer can serve a stale sync payload", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    installFetchStub((url, options) => {
      calls.push({ url, headers: (options?.headers ?? {}) as Record<string, string> });
      return new Response("{}", { status: 200 });
    });

    const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
    await client.get("/readany/sync/books/book-1.json");

    expect(calls[0]?.headers["Cache-Control"]).toBe("no-store");
    expect(calls[0]?.headers.Pragma).toBe("no-cache");
    expect(calls[0]?.url).toMatch(/\?_=[a-z0-9]+$/);
  });
});

describe("cacheBustedUrl", () => {
  it("appends a unique nonce and preserves an existing query", () => {
    const first = cacheBustedUrl("https://host/p.json");
    const second = cacheBustedUrl("https://host/p.json");
    expect(first).toMatch(/^https:\/\/host\/p\.json\?_=/);
    expect(second).not.toBe(first);
    expect(cacheBustedUrl("https://host/p.json?x=1")).toMatch(/^https:\/\/host\/p\.json\?x=1&_=/);
  });
});

describe("WebDavClient PUT/mkcol self-healing", () => {
  afterEach(() => {
    setPlatformService(null as unknown as IPlatformService);
  });

  it("heals a PUT 404 by force-creating the parent collection chain and retrying once", async () => {
    const calls: { method: string; url: string }[] = [];
    installFetchStub((url, options) => {
      const method = String(options?.method ?? "GET");
      calls.push({ method, url });
      if (method === "PUT") {
        const putCount = calls.filter((call) => call.method === "PUT").length;
        return new Response("", { status: putCount === 1 ? 404 : 200 });
      }
      if (method === "MKCOL") {
        return new Response("", { status: 201 });
      }
      return new Response("", { status: 404 });
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
      await client.putJSON("/readany/sync/device-abc.json", { ok: true });
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }

    expect(calls.map((call) => call.method)).toEqual(["PUT", "MKCOL", "MKCOL", "PUT"]);
    expect(calls[1]?.url).toBe("https://dav.example.com/dav/readany/");
    expect(calls[2]?.url).toBe("https://dav.example.com/dav/readany/sync/");
    expect(calls[0]?.url).toBe("https://dav.example.com/dav/readany/sync/device-abc.json");
    expect(calls[3]?.url).toBe(calls[0]?.url);
  });

  it("heals an MKCOL 409 by force-creating the whole collection chain", async () => {
    const calls: { method: string; url: string }[] = [];
    installFetchStub((url, options) => {
      const method = String(options?.method ?? "GET");
      calls.push({ method, url });
      if (method === "PROPFIND") {
        return new Response("", { status: 207 });
      }
      if (method === "MKCOL") {
        const isBooksCall = url.endsWith("/readany/data/books/");
        const booksAttempts = calls.filter(
          (call) => call.method === "MKCOL" && call.url.endsWith("/readany/data/books/"),
        ).length;
        return new Response("", { status: isBooksCall && booksAttempts === 1 ? 409 : 201 });
      }
      return new Response("", { status: 404 });
    });

    const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
    await client.mkcol("/readany/data/books");

    expect(calls.map((call) => call.method)).toEqual(["MKCOL", "MKCOL", "MKCOL", "MKCOL"]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://dav.example.com/dav/readany/data/books/",
      "https://dav.example.com/dav/readany/",
      "https://dav.example.com/dav/readany/data/",
      "https://dav.example.com/dav/readany/data/books/",
    ]);
  });

  it("retries MKCOL without the trailing slash on servers that 409 collection URIs", async () => {
    const calls: { method: string; url: string }[] = [];
    installFetchStub((url, options) => {
      const method = String(options?.method ?? "GET");
      calls.push({ method, url });
      if (method === "MKCOL") {
        return new Response("", { status: url.endsWith("/") ? 409 : 201 });
      }
      return new Response("", { status: 404 });
    });

    const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
    await client.mkcol("/readany/sync");

    expect(calls.map((call) => call.method)).toEqual(["MKCOL", "MKCOL", "MKCOL", "MKCOL", "MKCOL"]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://dav.example.com/dav/readany/sync/",
      "https://dav.example.com/dav/readany/",
      "https://dav.example.com/dav/readany",
      "https://dav.example.com/dav/readany/sync/",
      "https://dav.example.com/dav/readany/sync",
    ]);
  });

  it("getJSON returns null for 404 by status and rethrows other failures", async () => {
    installFetchStub(() => new Response("", { status: 404 }));
    const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
    await expect(client.getJSON("/readany/sync/missing.json")).resolves.toBeNull();

    installFetchStub(() => new Response("", { status: 401 }));
    await expect(client.getJSON("/readany/sync/missing.json")).rejects.toThrow();
  });

  it("skips re-probing collections confirmed earlier in the same client", async () => {
    const calls: { method: string; url: string }[] = [];
    installFetchStub((url, options) => {
      calls.push({ method: String(options?.method ?? "GET"), url });
      return new Response("", { status: 207 });
    });

    const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
    await client.ensureDirectory("/readany");
    await client.ensureDirectory("/readany");

    expect(calls).toHaveLength(1);
  });
});

describe("sanitizeWebDavRemoteRoot", () => {
  it("preserves case because WebDAV paths can be case-sensitive", () => {
    expect(sanitizeWebDavRemoteRoot("ReadAny/DeviceSync")).toBe("ReadAny/DeviceSync");
  });

  it("trims unsafe path noise without lowercasing user folders", () => {
    expect(sanitizeWebDavRemoteRoot(" /\u0000ReadAny//Sync/ ")).toBe("ReadAny/Sync");
  });
});

/**
 * Regression for the 2026-09-26 incident: a flat 5-minute transfer budget cut
 * large book uploads off mid-body. The server (pfm) received a truncated PUT,
 * answered 500 (`write staging: unexpected EOF`), and sync retried the same
 * books forever — 3 books, 16 attempts, every one cut at ~5 minutes while
 * smaller books finished in seconds.
 */
describe("WebDAV transfer budgets", () => {
  afterEach(() => {
    setPlatformService(null as unknown as IPlatformService);
  });

  function captureFetchCalls(): Array<{ url: string; options?: FetchOptions }> {
    const calls: Array<{ url: string; options?: FetchOptions }> = [];
    installFetchStub((url, options) => {
      calls.push({ url, options });
      // 204 is a null-body status: the Response constructor rejects a body here.
      return new Response(null, { status: 204 });
    });
    return calls;
  }

  it("keeps the 5-minute floor for small payloads", async () => {
    const calls = captureFetchCalls();
    const client = new WebDavClient("https://dav.example.com/dav/readany", "alice", "secret");

    await client.putJSON("/sync/index.json", { ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].options?.timeoutMs).toBe(300_000);
  });

  it("scales the PUT budget with the payload size", async () => {
    const calls = captureFetchCalls();
    const client = new WebDavClient("https://dav.example.com/dav/readany", "alice", "secret");

    // 8 MiB at the worst-case rate (32 KiB/s) needs 256s on top of the floor.
    await client.put("/data/books/big.epub", new Uint8Array(8 * 1024 * 1024));

    expect(calls).toHaveLength(1);
    expect(calls[0].options?.timeoutMs).toBe(300_000 + 256_000);
  });

  it("asks platforms to abort a stalled transfer via the idle guard", async () => {
    const calls = captureFetchCalls();
    const client = new WebDavClient("https://dav.example.com/dav/readany", "alice", "secret");

    await client.put("/sync/index.json", "{}", "application/json");

    expect(calls[0].options?.idleTimeoutMs).toBe(120_000);
  });

  it("clamps the budget: floor for unknown sizes, ceiling for absurd ones", () => {
    expect(transferBudgetMs(undefined)).toBe(300_000);
    expect(transferBudgetMs(0)).toBe(300_000);
    // The mobile buffered-transfer cap (16 MiB) is the largest GET payload.
    expect(transferBudgetMs(16 * 1024 * 1024)).toBe(300_000 + 512_000);
    expect(transferBudgetMs(Number.MAX_SAFE_INTEGER)).toBe(3 * 60 * 60 * 1000);
  });
});
