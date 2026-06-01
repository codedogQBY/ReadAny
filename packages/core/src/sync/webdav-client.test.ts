import { afterEach, describe, expect, it, vi } from "vitest";

import { type FetchOptions, type IPlatformService, setPlatformService } from "../services/platform";
import { WebDavClient } from "./webdav-client";

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
    try {
      const client = new WebDavClient("https://dav.example.com/dav", "alice", "secret");
      await client.ensureDirectory("/readany");
    } finally {
      warnSpy.mockRestore();
    }

    expect(calls.map((call) => call.method)).toEqual(["PROPFIND", "MKCOL", "PROPFIND"]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://dav.example.com/dav/readany/",
      "https://dav.example.com/dav/readany/",
      "https://dav.example.com/dav/readany/",
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
});
