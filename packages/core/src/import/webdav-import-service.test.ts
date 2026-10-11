import { describe, expect, it } from "vitest";

import { type FetchOptions, type IPlatformService, setPlatformService } from "../services/platform";
import {
  WebDavImportService,
  getWebDavImportRootPrefix,
  resolveWebDavImportServerPath,
  toWebDavImportRelativePath,
} from "./webdav-import-service";
import type { WebDavImportSource } from "./webdav-import-types";

function createSource(overrides: Partial<WebDavImportSource> = {}): WebDavImportSource {
  return {
    kind: "saved",
    url: "https://dav.example.com",
    username: "demo",
    password: "secret",
    remoteRoot: "readany",
    ...overrides,
  };
}

describe("webdav import path helpers", () => {
  it("builds root prefix when url does not include remote root", () => {
    const source = createSource({
      url: "https://dav.example.com/library",
      remoteRoot: "readany",
    });

    expect(getWebDavImportRootPrefix(source)).toBe("/library/readany");
    expect(resolveWebDavImportServerPath(source, "/books")).toBe("/library/readany/books");
  });

  it("dedupes root prefix when url already includes remote root", () => {
    const source = createSource({
      url: "https://dav.example.com/library/readany",
      remoteRoot: "readany",
    });

    expect(getWebDavImportRootPrefix(source)).toBe("/library/readany");
    expect(resolveWebDavImportServerPath(source, "/")).toBe("/library/readany");
  });

  it("maps server hrefs back to browser relative paths", () => {
    const source = createSource({
      url: "https://dav.example.com/library/readany",
      remoteRoot: "readany",
    });

    expect(toWebDavImportRelativePath(source, "/library/readany")).toBe("/");
    expect(toWebDavImportRelativePath(source, "/library/readany/fiction/book.epub")).toBe(
      "/fiction/book.epub",
    );
    expect(
      toWebDavImportRelativePath(
        source,
        "https://dav.example.com/library/readany/non-fiction/essay.pdf",
      ),
    ).toBe("/non-fiction/essay.pdf");
    expect(
      toWebDavImportRelativePath(
        source,
        "https://dav.example.com/library/readany/books/%E7%BE%8E%E5%9B%BD%E5%9B%9B%E7%99%BE%E5%B9%B4.epub",
      ),
    ).toBe("/books/美国四百年.epub");
  });

  it("uses the URL pathname as root when remote root is blank", () => {
    const source = createSource({
      url: "https://dav.example.com/library",
      remoteRoot: "",
    });

    expect(getWebDavImportRootPrefix(source)).toBe("/library");
    expect(resolveWebDavImportServerPath(source, "/fiction/book.epub")).toBe(
      "/library/fiction/book.epub",
    );
  });
});

const PROPFIND_BOOKS_XML = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/home/Books/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/home/Books/novel.epub</D:href>
    <D:propstat><D:prop><D:resourcetype/><D:getcontentlength>123</D:getcontentlength></D:prop></D:propstat>
  </D:response>
</D:multistatus>`;

/**
 * Minimal platform stub: the import paths only use platform.fetch, so we record
 * the requested URL and answer with a canned response (cast — other methods unused).
 */
function installFetchCapture(): { requests: Array<{ method: string; url: string }> } {
  const requests: Array<{ method: string; url: string }> = [];
  setPlatformService({
    async fetch(url: string, options?: FetchOptions) {
      const method = options?.method ?? "GET";
      requests.push({ method, url });
      if (method === "PROPFIND") {
        return new Response(PROPFIND_BOOKS_XML, { status: 207 });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    },
  } as unknown as IPlatformService);
  return { requests };
}

describe("WebDavImportService request paths (issue #174)", () => {
  it("lists a path-bearing WebDAV URL without duplicating the pathname", async () => {
    const { requests } = installFetchCapture();
    const service = new WebDavImportService(
      createSource({ url: "http://host:5005/home/Books", remoteRoot: "" }),
    );

    const listing = await service.list("/");

    expect(requests.map((r) => r.url)).toContain("http://host:5005/home/Books");
    expect(requests.some((r) => r.url.includes("/home/Books/home/Books"))).toBe(false);

    expect(listing.entries.map((e) => e.relativePath)).toEqual(["/novel.epub"]);
    expect(listing.importableCount).toBe(1);
  });

  it("downloads a file using the origin-based base url", async () => {
    const { requests } = installFetchCapture();
    const service = new WebDavImportService(
      createSource({ url: "http://host:5005/home/Books", remoteRoot: "" }),
    );

    await service.downloadFile("/novel.epub");

    expect(
      requests.some(
        (r) =>
          r.method === "GET" &&
          // GETs carry a cache-busting nonce (see cacheBustedUrl)
          r.url.replace(/[?&]_=[^&]*/, "") === "http://host:5005/home/Books/novel.epub",
      ),
    ).toBe(true);
  });

  it("tests the connection against the resolved root prefix, not the bare origin root", async () => {
    const { requests } = installFetchCapture();
    const service = new WebDavImportService(
      createSource({ url: "http://host:5005/home/Books", remoteRoot: "" }),
    );

    await service.testConnection();

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.url === "http://host:5005/home/Books")).toBe(true);
  });
});
