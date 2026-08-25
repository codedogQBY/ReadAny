import { OpdsClient, type OpdsCredentials } from "@readany/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { tauriFetch, tauriInvoke } = vi.hoisted(() => ({
  tauriFetch: vi.fn(),
  tauriInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: tauriFetch }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriInvoke }));

import { TauriPlatformService } from "./tauri-platform-service";

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <title>Catalog</title>
  <entry><title>Book</title><link rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" /></entry>
</feed>`;

const credentials: OpdsCredentials = {
  username: "reader",
  password: "secret-password",
  catalogOrigin: "https://catalog.test",
};

function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

describe("TauriPlatformService manual redirect contract", () => {
  beforeEach(() => {
    tauriFetch.mockReset();
  });

  it("translates redirect manual into the Tauri native maxRedirections option", async () => {
    tauriFetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://other.test/feed.xml" },
      }),
    );

    const response = await new TauriPlatformService().fetch("https://catalog.test/feed.xml", {
      redirect: "manual",
      headers: new Headers({ Accept: "application/atom+xml" }),
      signal: new AbortController().signal,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://other.test/feed.xml");
    const [, init] = tauriFetch.mock.calls[0] as [
      string,
      RequestInit & { maxRedirections?: number },
    ];
    expect(init.maxRedirections).toBe(0);
    expect(init).not.toHaveProperty("redirect");
    expect(header(init, "Accept")).toBe("application/atom+xml");
  });

  it("lets core enforce its five-hop redirect cap without native auto-follow", async () => {
    tauriFetch.mockImplementation(
      async (_url: string, _init: RequestInit) =>
        new Response(null, {
          status: 302,
          headers: { Location: `/redirect-${tauriFetch.mock.calls.length}` },
        }),
    );

    await expect(
      new OpdsClient(new TauriPlatformService()).open("https://catalog.test/feed.xml"),
    ).rejects.toMatchObject({ code: "invalid-catalog" });
    expect(tauriFetch).toHaveBeenCalledTimes(6);
    expect(
      tauriFetch.mock.calls.every(
        ([, init]) => init.maxRedirections === 0 && !("redirect" in init),
      ),
    ).toBe(true);
  });

  it("lets core inspect per-hop origins and remove cross-origin auth", async () => {
    tauriFetch.mockImplementation(async (url: string) =>
      url === "https://catalog.test/feed.xml"
        ? new Response(null, {
            status: 302,
            headers: { Location: "https://cdn.test/feed.xml" },
          })
        : new Response(ATOM, {
            headers: { "Content-Type": "application/atom+xml" },
          }),
    );

    await new OpdsClient(new TauriPlatformService()).open(
      "https://catalog.test/feed.xml",
      credentials,
    );

    expect(header(tauriFetch.mock.calls[0]?.[1], "Authorization")).not.toBeNull();
    expect(header(tauriFetch.mock.calls[1]?.[1], "Authorization")).toBeNull();
  });

  it("lets core reject HTTPS downgrade before Tauri issues the next hop", async () => {
    tauriFetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/feed.xml" },
      }),
    );

    await expect(
      new OpdsClient(new TauriPlatformService()).open("https://catalog.test/feed.xml", credentials),
    ).rejects.toMatchObject({ code: "insecure-url" });
    expect(tauriFetch).toHaveBeenCalledTimes(1);
  });
});

describe("TauriPlatformService secret contract", () => {
  const secretKey = "opds.catalog.11111111-1111-4111-8111-111111111111.password";

  beforeEach(() => {
    tauriInvoke.mockReset();
  });

  it("invokes the three OS credential commands without routing through localStorage", async () => {
    tauriInvoke.mockResolvedValueOnce("stored-password").mockResolvedValue(undefined);
    const localStorageSet = vi.fn();
    vi.stubGlobal("localStorage", { setItem: localStorageSet });
    const service = new TauriPlatformService();

    await expect(service.secretGetItem(secretKey)).resolves.toBe("stored-password");
    await service.secretSetItem(secretKey, "new-password");
    await service.secretRemoveItem(secretKey);

    expect(tauriInvoke.mock.calls).toEqual([
      ["secret_get", { key: secretKey }],
      ["secret_set", { key: secretKey, value: "new-password" }],
      ["secret_remove", { key: secretKey }],
    ]);
    expect(localStorageSet).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
