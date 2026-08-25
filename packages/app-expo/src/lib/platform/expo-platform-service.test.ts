import { OpdsClient, type OpdsCredentials } from "@readany/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { expoFetch, secureDelete, secureGet, secureSet } = vi.hoisted(() => ({
  expoFetch: vi.fn(),
  secureDelete: vi.fn(),
  secureGet: vi.fn(),
  secureSet: vi.fn(),
}));

vi.mock("expo/fetch", () => ({ fetch: expoFetch }));
vi.mock("@readany/core/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("expo-clipboard", () => ({}));
vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({
  Directory: class {},
  File: class {},
  Paths: { document: { uri: "file:///test" } },
}));
vi.mock("expo-file-system/legacy", () => ({}));
vi.mock("expo-network", () => ({}));
vi.mock("expo-secure-store", () => ({
  deleteItemAsync: secureDelete,
  getItemAsync: secureGet,
  setItemAsync: secureSet,
}));
vi.mock("expo-sharing", () => ({}));

import { ExpoPlatformService } from "./expo-platform-service";

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

function signalForCall(index = 0): AbortSignal {
  const signal = (expoFetch.mock.calls[index]?.[1] as RequestInit | undefined)?.signal;
  if (!signal) throw new Error(`Missing signal for Expo fetch call ${index}`);
  return signal;
}

describe("ExpoPlatformService standards fetch contract", () => {
  beforeEach(() => {
    expoFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses expo/fetch for manual requests and preserves request and response web APIs", async () => {
    const controller = new AbortController();
    const redirect = new Response(null, {
      status: 302,
      headers: {
        Location: "https://other.test/feed.xml",
        "Content-Type": "application/atom+xml",
        "WWW-Authenticate": 'Basic realm="Books"',
      },
    });
    expoFetch.mockResolvedValue(redirect);
    const requestHeaders = new Headers({
      Accept: "application/atom+xml",
      Authorization: "Basic test-token",
    });

    const result = await new ExpoPlatformService().fetch("https://catalog.test/feed.xml", {
      headers: requestHeaders,
      redirect: "manual",
      signal: controller.signal,
      responseType: "text",
      timeoutMs: 15_000,
    });

    expect(expoFetch).toHaveBeenCalledTimes(1);
    const [url, init] = expoFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://catalog.test/feed.xml");
    expect(init.redirect).toBe("manual");
    expect(init.signal).not.toBe(controller.signal);
    expect(init.signal?.aborted).toBe(false);
    expect(header(init, "Accept")).toBe("application/atom+xml");
    expect(header(init, "Authorization")).toBe("Basic test-token");
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("https://other.test/feed.xml");
    expect(result.headers.get("Content-Type")).toBe("application/atom+xml");
    expect(result.headers.get("WWW-Authenticate")).toBe('Basic realm="Books"');
  });

  it("lets core inspect each Expo redirect and strips auth across origins", async () => {
    expoFetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === "https://catalog.test/feed.xml") {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://cdn.test/feed.xml" },
        });
      }
      expect(signalForCall(0).aborted).toBe(true);
      expect(init.signal).not.toBe(signalForCall(0));
      expect(init.signal?.aborted).toBe(false);
      return new Response(ATOM, {
        headers: { "Content-Type": "application/atom+xml" },
      });
    });

    await new OpdsClient(new ExpoPlatformService()).open(
      "https://catalog.test/feed.xml",
      credentials,
    );

    expect(expoFetch).toHaveBeenCalledTimes(2);
    expect(header(expoFetch.mock.calls[0]?.[1], "Authorization")).not.toBeNull();
    expect(header(expoFetch.mock.calls[1]?.[1], "Authorization")).toBeNull();
    expect(expoFetch.mock.calls.every(([, init]) => init.redirect === "manual")).toBe(true);
    expect(signalForCall(0).aborted).toBe(true);
    expect(signalForCall(1).aborted).toBe(false);
  });

  it("aborts the Expo transport when Content-Length rejects a catalog before reading", async () => {
    expoFetch.mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>(), {
        headers: {
          "Content-Type": "application/atom+xml",
          "Content-Length": "5242881",
        },
      }),
    );

    await expect(
      new OpdsClient(new ExpoPlatformService()).open("https://catalog.test/feed.xml"),
    ).rejects.toMatchObject({ code: "too-large" });

    expect(signalForCall().aborted).toBe(true);
  });

  it("lets core reject HTTPS downgrades and public HTTP targets before Expo follows", async () => {
    expoFetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "http://catalog.example/feed.xml" },
      }),
    );

    await expect(
      new OpdsClient(new ExpoPlatformService()).open("https://catalog.test/feed.xml", credentials),
    ).rejects.toMatchObject({ code: "insecure-url" });
    expect(expoFetch).toHaveBeenCalledTimes(1);
  });

  it("exposes authentication challenges to core", async () => {
    expoFetch.mockResolvedValue(
      new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": 'Digest realm="Books"' },
      }),
    );

    await expect(
      new OpdsClient(new ExpoPlatformService()).open("https://catalog.test/feed.xml"),
    ).rejects.toMatchObject({ code: "unsupported-auth" });
    expect(signalForCall().aborted).toBe(true);
  });

  it("forwards AbortSignal to expo/fetch", async () => {
    expoFetch.mockImplementation(
      async (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init.signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const controller = new AbortController();
    const request = new ExpoPlatformService().fetch("https://catalog.test/feed.xml", {
      redirect: "manual",
      signal: controller.signal,
      responseType: "text",
    });

    controller.abort();

    await expect(request).rejects.toThrow("aborted");
  });

  it("preserves streaming so core cancels an oversized Expo response before full buffering", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(3 * 1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    expoFetch.mockResolvedValue(
      new Response(body, { headers: { "Content-Type": "application/atom+xml" } }),
    );

    await expect(
      new OpdsClient(new ExpoPlatformService()).open("https://catalog.test/feed.xml"),
    ).rejects.toMatchObject({ code: "too-large" });
    expect(pulls).toBeLessThanOrEqual(3);
    expect(cancelled).toBe(true);
    expect(signalForCall().aborted).toBe(true);
  });

  it("aborts the Expo transport when streaming the response body fails", async () => {
    expoFetch.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(new Error("native stream failed"));
          },
        }),
        { headers: { "Content-Type": "application/atom+xml" } },
      ),
    );

    await expect(
      new OpdsClient(new ExpoPlatformService()).open("https://catalog.test/feed.xml"),
    ).rejects.toMatchObject({ code: "unreachable" });

    expect(signalForCall().aborted).toBe(true);
  });

  it("aborts the Expo transport when a returned asset body is cancelled", async () => {
    expoFetch.mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>(), {
        headers: { "Content-Type": "application/epub+zip" },
      }),
    );
    const asset = await new OpdsClient(new ExpoPlatformService()).fetchAsset(
      "https://catalog.test/book.epub",
      "https://catalog.test",
    );

    await asset.body?.cancel();

    expect(signalForCall().aborted).toBe(true);
  });

  it("keeps explicit asset cancellation stable for future consumers", async () => {
    expoFetch.mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>(), {
        headers: { "Content-Type": "application/epub+zip" },
      }),
    );
    const asset = await new OpdsClient(new ExpoPlatformService()).fetchAsset(
      "https://catalog.test/book.epub",
      "https://catalog.test",
    );

    await Promise.all([asset.cancel(), asset.cancel()]);

    expect(signalForCall().aborted).toBe(true);
    await expect(asset.arrayBuffer()).rejects.toMatchObject({ code: "cancelled" });
  });

  it("reads exact asset bytes when React Native Response cannot wrap a stream", async () => {
    const bytes = Uint8Array.of(1, 0, 255, 127, 64);
    const source = new Response(bytes, {
      headers: { "Content-Type": "application/octet-stream" },
    });
    Object.defineProperties(source, {
      url: { value: "https://catalog.test/final-book.epub" },
      redirected: { value: true },
    });
    expoFetch.mockResolvedValue(source);
    vi.stubGlobal(
      "Response",
      class NonStreamingWhatwgResponse {
        constructor() {
          throw new Error("React Native whatwg Response does not accept ReadableStream");
        }
      },
    );

    const asset = await new OpdsClient(new ExpoPlatformService()).fetchAsset(
      "https://catalog.test/book.epub",
      "https://catalog.test",
    );

    expect(Array.from(new Uint8Array(await asset.arrayBuffer()))).toEqual(Array.from(bytes));
    expect(asset.url).toBe("https://catalog.test/final-book.epub");
    expect(asset.redirected).toBe(true);
    expect(signalForCall().aborted).toBe(false);
  });
});

describe("ExpoPlatformService secret contract", () => {
  beforeEach(() => {
    secureDelete.mockReset();
    secureGet.mockReset();
    secureSet.mockReset();
  });

  it("delegates secrets directly to SecureStore without the general KV index", async () => {
    secureGet.mockResolvedValue("stored-password");
    const service = new ExpoPlatformService();

    await expect(service.secretGetItem("opds.catalog.one.password")).resolves.toBe(
      "stored-password",
    );
    await service.secretSetItem("opds.catalog.one.password", "new-password");
    await service.secretRemoveItem("opds.catalog.one.password");

    expect(secureGet).toHaveBeenCalledWith("opds.catalog.one.password");
    expect(secureSet).toHaveBeenCalledWith("opds.catalog.one.password", "new-password");
    expect(secureDelete).toHaveBeenCalledWith("opds.catalog.one.password");
    expect(secureSet).not.toHaveBeenCalledWith("__readany_kv_keys__", expect.anything());
  });
});
