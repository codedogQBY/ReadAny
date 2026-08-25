import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchOptions } from "../services/platform";
import {
  type OpdsAssetResponse,
  OpdsClient,
  type OpdsCredentials,
  type OpdsError,
} from "./opds-client";

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <title>Catalog</title>
  <entry>
    <title>Book</title>
    <link rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" />
  </entry>
</feed>`;

const OPENSEARCH = `<?xml version="1.0"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Catalog search</ShortName>
  <Url type="application/atom+xml;profile=opds-catalog" template="https://catalog.test/search?q={searchTerms}" />
</OpenSearchDescription>`;

const GUTENBERG_OPENSEARCH = `<?xml version="1.0" encoding="UTF-8"?>

<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
   <LongName>Project Gutenberg</LongName>
   <ShortName>Gutenberg</ShortName>
   <Description>Search the Project Gutenberg ebook catalog.</Description>
   <Tags>free ebooks books public domain</Tags>
   <Developer>Marcello Perathoner</Developer>
   <Contact>webmaster@gutenberg.org</Contact>

   <Url type="text/html"
        template="http://www.gutenberg.org/ebooks/search/?query={searchTerms}"/>

   <Url type="application/atom+xml"
        template="http://m.gutenberg.org/ebooks/search.opds/?query={searchTerms}"/>

   <Url type="application/x-suggestions+json"
	rel="suggestions"
        template="http://www.gutenberg.org/ebooks/suggest/?query={searchTerms}"/>

   <Query role="example" searchTerms="shakespeare hamlet" />
   <Query role="example" searchTerms="doyle detective" />
   <Query role="example" searchTerms="love stories" />

   <Attribution>Search Data Copyright 1971-2012, Project Gutenberg, All Rights Reserved.</Attribution>
   <SyndicationRight>open</SyndicationRight>
   <Language>en-us</Language>
   <OutputEncoding>UTF-8</OutputEncoding>
   <InputEncoding>UTF-8</InputEncoding>
</OpenSearchDescription>`;

const credentials: OpdsCredentials = {
  username: "reader",
  password: "secret-password",
  catalogOrigin: "https://catalog.test",
};

interface FetchCall {
  url: string;
  options?: FetchOptions;
}

function response(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers ?? { "Content-Type": "application/atom+xml" },
  });
}

function fakePlatform(
  handler: (
    url: string,
    options: FetchOptions | undefined,
    call: number,
  ) => Promise<Response> | Response,
): { fetch: (url: string, options?: FetchOptions) => Promise<Response>; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  return {
    calls,
    async fetch(url, options) {
      calls.push({ url, options });
      return handler(url, options, calls.length);
    },
  };
}

function authorization(call: FetchCall): string | null {
  return new Headers(call.options?.headers).get("Authorization");
}

function transportResponse(response: Response) {
  const cancelTransport = vi.fn();
  const onDispose = vi.fn();
  Object.assign(response, { cancelTransport, onDispose });
  return { response, cancelTransport, onDispose };
}

function scheduleCancelAfterReadNext(asset: OpdsAssetResponse): void {
  const managed = asset as unknown as {
    readNext(
      reader: ReadableStreamDefaultReader<Uint8Array>,
    ): Promise<ReadableStreamReadResult<Uint8Array>>;
  };
  const readNext = managed.readNext.bind(managed);
  managed.readNext = async (reader) => {
    const result = await readNext(reader);
    queueMicrotask(() => {
      void asset.cancel();
    });
    return result;
  };
}

function stalledBodyResponse(contentType = "application/atom+xml") {
  let startReading: (() => void) | undefined;
  let cancelled = false;
  const readingStarted = new Promise<void>((resolve) => {
    startReading = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    pull() {
      startReading?.();
      return new Promise<void>(() => {});
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, { headers: { "Content-Type": contentType } }),
    readingStarted,
    wasCancelled: () => cancelled,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function expectOpdsError(promise: Promise<unknown>, code: OpdsError["code"]): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "OpdsError", code });
}

describe("OpdsClient catalog requests", () => {
  it.each([
    ["navigation", "http://127.0.0.1:8080/feed.xml", "open"],
    ["different loopback port", "http://localhost:8081/feed.xml", "open"],
    ["private address", "http://192.168.1.20/feed.xml", "open"],
    ["local asset", "http://printer.local/cover.jpg", "asset"],
  ] as const)(
    "blocks an HTTPS catalog's feed-provided %s target before requesting it",
    async (_name, target, kind) => {
      const platform = fakePlatform(() => response(ATOM));
      const client = new OpdsClient(platform);
      const request =
        kind === "asset"
          ? client.fetchAsset(target, "https://remote.test")
          : client.open(target, undefined, undefined, "https://remote.test");

      await expectOpdsError(request, "insecure-url");
      expect(platform.calls).toHaveLength(0);
    },
  );

  it("allows confirmed local HTTP only on the catalog's exact origin", async () => {
    const platform = fakePlatform(() => response(ATOM));
    const client = new OpdsClient(platform);

    await client.open(
      "http://localhost:8080/child.xml",
      undefined,
      undefined,
      "http://localhost:8080/root.xml",
    );
    await expectOpdsError(
      client.open(
        "http://localhost:8081/child.xml",
        undefined,
        undefined,
        "http://localhost:8080/root.xml",
      ),
      "insecure-url",
    );
    await expectOpdsError(
      client.open(
        "http://127.0.0.1:8080/child.xml",
        undefined,
        undefined,
        "http://localhost:8080/root.xml",
      ),
      "insecure-url",
    );
    expect(platform.calls.map((call) => call.url)).toEqual(["http://localhost:8080/child.xml"]);
  });

  it("does not let redirects expand a confirmed local HTTP origin", async () => {
    const platform = fakePlatform(() =>
      response("", { status: 302, headers: { Location: "http://127.0.0.1:8080/feed.xml" } }),
    );

    await expectOpdsError(
      new OpdsClient(platform).open(
        "http://localhost:8080/feed.xml",
        undefined,
        undefined,
        "http://localhost:8080",
      ),
      "insecure-url",
    );
    expect(platform.calls).toHaveLength(1);
  });

  it("sends Basic auth only to the configured catalog origin", async () => {
    const platform = fakePlatform(() => response(ATOM));
    const client = new OpdsClient(platform);

    await client.open("https://catalog.test/root/feed.xml", credentials);
    await client.open("https://other.test/feed.xml", credentials);

    expect(authorization(platform.calls[0] as FetchCall)).toBe(
      "Basic cmVhZGVyOnNlY3JldC1wYXNzd29yZA==",
    );
    expect(authorization(platform.calls[1] as FetchCall)).toBeNull();
  });

  it("does not send Authorization for anonymous requests", async () => {
    const platform = fakePlatform(() => response(ATOM));

    await new OpdsClient(platform).open("https://catalog.test/feed.xml");

    expect(authorization(platform.calls[0] as FetchCall)).toBeNull();
  });

  it("uses manual redirects and strips Authorization after a cross-origin redirect", async () => {
    const redirect = transportResponse(
      response("", { status: 302, headers: { Location: "https://cdn.test/feed.xml" } }),
    );
    const destination = transportResponse(response(ATOM));
    const platform = fakePlatform((url) =>
      url === "https://catalog.test/feed.xml" ? redirect.response : destination.response,
    );

    await new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials);

    expect(platform.calls.map((call) => call.url)).toEqual([
      "https://catalog.test/feed.xml",
      "https://cdn.test/feed.xml",
    ]);
    expect(authorization(platform.calls[0] as FetchCall)).not.toBeNull();
    expect(authorization(platform.calls[1] as FetchCall)).toBeNull();
    expect(platform.calls.every((call) => call.options?.redirect === "manual")).toBe(true);
    expect(redirect.cancelTransport).toHaveBeenCalledOnce();
    expect(redirect.onDispose).toHaveBeenCalledOnce();
    expect(destination.cancelTransport).not.toHaveBeenCalled();
    expect(destination.onDispose).toHaveBeenCalledOnce();
  });

  it("rejects HTTPS-to-HTTP redirect downgrades before making the target request", async () => {
    const platform = fakePlatform(() =>
      response("", { status: 302, headers: { Location: "http://127.0.0.1/feed.xml" } }),
    );

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials),
      "insecure-url",
    );
    expect(platform.calls).toHaveLength(1);
  });

  it("reclassifies redirect targets and rejects embedded credentials", async () => {
    const platform = fakePlatform(() =>
      response("", {
        status: 302,
        headers: { Location: "https://reader:secret-password@catalog.test/private" },
      }),
    );

    const request = new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials);

    await expectOpdsError(request, "insecure-url");
    await expect(request).rejects.not.toThrow("secret-password");
    expect(platform.calls).toHaveLength(1);
  });

  it("follows no more than five redirects", async () => {
    const platform = fakePlatform((_url, _options, call) =>
      response("", { status: 302, headers: { Location: `/redirect-${call}` } }),
    );

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "invalid-catalog",
    );
    expect(platform.calls).toHaveLength(6);
  });

  it("maps Basic challenges to unauthorized", async () => {
    const platform = fakePlatform(() =>
      response("", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Books"' } }),
    );

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials),
      "unauthorized",
    );
  });

  it("maps a 401 without a challenge to unauthorized", async () => {
    const platform = fakePlatform(() => response("", { status: 401 }));

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "unauthorized",
    );
  });

  it("maps unsupported authentication challenges separately", async () => {
    const unauthorized = transportResponse(
      response("", { status: 401, headers: { "WWW-Authenticate": 'Digest realm="Books"' } }),
    );
    const platform = fakePlatform(() => unauthorized.response);

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials),
      "unsupported-auth",
    );
    expect(unauthorized.cancelTransport).toHaveBeenCalledOnce();
    expect(unauthorized.onDispose).toHaveBeenCalledOnce();
  });

  it("passes the 15 second timeout through the platform and maps timeout failures", async () => {
    const platform = fakePlatform(() => Promise.reject(new Error("request timed out")));

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "unreachable",
    );
    expect(platform.calls[0]?.options?.timeoutMs).toBe(15_000);
  });

  it("keeps the 15 second timeout active while a catalog body is stalled", async () => {
    vi.useFakeTimers();
    const stalled = stalledBodyResponse();
    const platform = fakePlatform(() => stalled.response);
    let rejection: unknown;
    const request = new OpdsClient(platform)
      .open("https://catalog.test/feed.xml")
      .catch((error: unknown) => {
        rejection = error;
      });
    await stalled.readingStarted;

    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.resolve();

    expect(rejection).toMatchObject({ name: "OpdsError", code: "unreachable" });
    expect(stalled.wasCancelled()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await request;
  });

  it("keeps user cancellation active while a catalog body is stalled", async () => {
    const stalled = stalledBodyResponse();
    const platform = fakePlatform(() => stalled.response);
    const controller = new AbortController();
    const request = new OpdsClient(platform).open(
      "https://catalog.test/feed.xml",
      undefined,
      controller.signal,
    );
    await stalled.readingStarted;

    controller.abort();

    const outcome = await Promise.race([
      request.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      ),
      new Promise<{ kind: "pending" }>((resolve) =>
        setTimeout(() => resolve({ kind: "pending" }), 0),
      ),
    ]);
    expect(outcome).toMatchObject({
      kind: "rejected",
      error: { name: "OpdsError", code: "cancelled" },
    });
    expect(stalled.wasCancelled()).toBe(true);
  });

  it("removes its abort listener and timer after body completion", async () => {
    vi.useFakeTimers();
    const platform = fakePlatform(() => response(ATOM));
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");

    await new OpdsClient(platform).open(
      "https://catalog.test/feed.xml",
      undefined,
      controller.signal,
    );

    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a pre-cancelled request without starting network work", async () => {
    const platform = fakePlatform(() => response(ATOM));
    const controller = new AbortController();
    controller.abort();

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml", undefined, controller.signal),
      "cancelled",
    );
    expect(platform.calls).toHaveLength(0);
  });

  it("maps cancellation during platform fetch without exposing its error", async () => {
    const controller = new AbortController();
    const platform = fakePlatform(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("secret-password")));
        }),
    );
    const request = new OpdsClient(platform).open(
      "https://catalog.test/feed.xml",
      credentials,
      controller.signal,
    );

    controller.abort();

    await expectOpdsError(request, "cancelled");
    await expect(request).rejects.not.toThrow("secret-password");
  });

  it("rejects oversized catalogs from Content-Length without reading the body", async () => {
    let cancelled = false;
    const oversized = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
      {
        headers: { "Content-Type": "application/atom+xml", "Content-Length": "5242881" },
      },
    );
    const transport = transportResponse(oversized);
    const platform = fakePlatform(() => transport.response);

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "too-large",
    );
    expect(cancelled).toBe(true);
    expect(transport.cancelTransport).toHaveBeenCalledOnce();
    expect(transport.onDispose).toHaveBeenCalledOnce();
  });

  it("rejects oversized decoded catalog text", async () => {
    const platform = fakePlatform(() =>
      response("x".repeat(5 * 1024 * 1024 + 1), {
        headers: { "Content-Type": "application/atom+xml" },
      }),
    );

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "too-large",
    );
  });

  it("stops reading a streamed catalog as soon as it exceeds the size limit", async () => {
    let reads = 0;
    let cancelled = false;
    const oversized = response(ATOM);
    Object.defineProperty(oversized, "body", {
      value: {
        getReader: () => ({
          async read() {
            reads += 1;
            if (reads <= 2) return { done: false, value: new Uint8Array(3 * 1024 * 1024) };
            throw new Error("read beyond the limit");
          },
          async cancel() {
            cancelled = true;
          },
        }),
      },
    });
    Object.defineProperty(oversized, "text", {
      value: async () => {
        throw new Error("text fallback used");
      },
    });
    const transport = transportResponse(oversized);
    const platform = fakePlatform(() => transport.response);

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "too-large",
    );
    expect(reads).toBe(2);
    expect(cancelled).toBe(true);
    expect(transport.cancelTransport).toHaveBeenCalledOnce();
    expect(transport.onDispose).toHaveBeenCalledOnce();
  });

  it("rejects unsupported content types even when the body looks like OPDS", async () => {
    const platform = fakePlatform(() =>
      response(ATOM, { headers: { "Content-Type": "text/html" } }),
    );

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "invalid-catalog",
    );
  });

  it("cancels the response stream when the content type is unsupported", async () => {
    let cancelled = false;
    const invalid = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "Content-Type": "text/html" } },
    );
    const transport = transportResponse(invalid);
    const platform = fakePlatform(() => transport.response);

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "invalid-catalog",
    );
    expect(cancelled).toBe(true);
    expect(transport.cancelTransport).toHaveBeenCalledOnce();
    expect(transport.onDispose).toHaveBeenCalledOnce();
  });

  it("maps malformed supported content to invalid-catalog", async () => {
    const platform = fakePlatform(() => response("<not-a-feed />"));

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "invalid-catalog",
    );
  });

  it("does not expose passwords from network failures", async () => {
    const platform = fakePlatform(() => Promise.reject(new Error("secret-password")));
    const request = new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials);

    await expectOpdsError(request, "unreachable");
    await expect(request).rejects.not.toThrow("secret-password");
  });

  it("does not expose passwords from response body failures", async () => {
    const unreadable = response(ATOM);
    Object.defineProperty(unreadable, "body", { value: null });
    Object.defineProperty(unreadable, "text", {
      value: async () => {
        throw new Error("secret-password");
      },
    });
    const platform = fakePlatform(() => unreadable);
    const request = new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials);

    await expectOpdsError(request, "unreachable");
    await expect(request).rejects.not.toThrow("secret-password");
  });
});

describe("OpdsClient assets", () => {
  it.each([
    ["EOF", { done: true as const, value: undefined }],
    ["a chunk", { done: false as const, value: Uint8Array.of(7, 8, 9) }],
  ])(
    "rejects when cancellation lands after readNext fulfills with %s but before pull continues",
    async (_label, outcome) => {
      const nativeReader = {
        read: vi.fn(async () => outcome),
        cancel: vi.fn(async () => {}),
      };
      const source = response("unused", { headers: {} });
      Object.defineProperty(source, "body", {
        value: { getReader: () => nativeReader },
      });
      const transport = transportResponse(source);
      const platform = fakePlatform(() => transport.response);
      const asset = await new OpdsClient(platform).fetchAsset(
        "https://catalog.test/book.epub",
        "https://catalog.test",
      );
      scheduleCancelAfterReadNext(asset);
      const reader = asset.body?.getReader();
      if (!reader) throw new Error("Expected a managed asset body");

      await expectOpdsError(reader.read(), "cancelled");
      await asset.cancel();

      expect(nativeReader.cancel).toHaveBeenCalledOnce();
      expect(transport.cancelTransport).toHaveBeenCalledOnce();
      expect(transport.onDispose).toHaveBeenCalledOnce();
    },
  );

  it("returns exact binary bytes and metadata without constructing an ambient Response", async () => {
    const bytes = Uint8Array.of(0, 255, 16, 128, 42);
    const source = new Response(bytes, { headers: { "Content-Type": "image/jpeg" } });
    Object.defineProperties(source, {
      url: { value: "https://cdn.test/final-cover.jpg" },
      redirected: { value: true },
      type: { value: "cors" },
    });
    const platform = fakePlatform(() => source);
    vi.stubGlobal(
      "Response",
      class NonStreamingWhatwgResponse {
        constructor() {
          throw new Error("This React Native Response cannot wrap streams");
        }
      },
    );

    const asset = await new OpdsClient(platform).fetchAsset(
      "https://cdn.test/final-cover.jpg",
      "https://catalog.test",
    );

    expect(Array.from(new Uint8Array(await asset.arrayBuffer()))).toEqual(Array.from(bytes));
    expect(asset.url).toBe("https://cdn.test/final-cover.jpg");
    expect(asset.redirected).toBe(true);
    expect(asset.type).toBe("cors");
    expect(asset.status).toBe(source.status);
    expect(asset.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("supports text and enforces single body consumption", async () => {
    const platform = fakePlatform(
      () =>
        new Response(new TextEncoder().encode("héllo"), {
          headers: { "Content-Type": "text/plain" },
        }),
    );
    const asset = await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/readme.txt",
      "https://catalog.test",
    );

    expect(asset.bodyUsed).toBe(false);
    expect(await asset.text()).toBe("héllo");
    expect(asset.bodyUsed).toBe(true);
    await expect(asset.arrayBuffer()).rejects.toThrow(TypeError);
  });

  it("supports JSON and preserves JSON parse errors", async () => {
    const validPlatform = fakePlatform(
      () =>
        new Response('{"title":"Catalog","count":2}', {
          headers: { "Content-Type": "application/json" },
        }),
    );
    const valid = await new OpdsClient(validPlatform).fetchAsset(
      "https://catalog.test/data.json",
      "https://catalog.test",
    );

    await expect(valid.json()).resolves.toEqual({ title: "Catalog", count: 2 });
    expect(valid.bodyUsed).toBe(true);

    const invalidPlatform = fakePlatform(
      () => new Response("{bad json", { headers: { "Content-Type": "application/json" } }),
    );
    const invalid = await new OpdsClient(invalidPlatform).fetchAsset(
      "https://catalog.test/bad.json",
      "https://catalog.test",
    );

    await expect(invalid.json()).rejects.toThrow(SyntaxError);
    expect(invalid.bodyUsed).toBe(true);
  });

  it("supports Blob when the platform provides Blob", async () => {
    const bytes = Uint8Array.of(5, 4, 3, 2, 1);
    const platform = fakePlatform(
      () => new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }),
    );
    const asset = await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/book.bin",
      "https://catalog.test",
    );

    const blob = await asset.blob();

    expect(blob.type).toBe("application/octet-stream");
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(Array.from(bytes));
  });

  it("reports unavailable Blob support without consuming the body", async () => {
    const platform = fakePlatform(() => response("asset", { headers: {} }));
    const asset = await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/book.bin",
      "https://catalog.test",
    );
    vi.stubGlobal("Blob", undefined);

    await expect(asset.blob()).rejects.toThrow(TypeError);
    expect(asset.bodyUsed).toBe(false);
    expect(await asset.text()).toBe("asset");
  });

  it("completes a normal asset read without aborting its transport", async () => {
    const transport = transportResponse(response("asset", { headers: {} }));
    const platform = fakePlatform(() => transport.response);
    const asset = await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/book.epub",
      "https://catalog.test",
    );

    expect(await asset.text()).toBe("asset");
    await Promise.all([asset.cancel(), asset.cancel()]);

    expect(transport.cancelTransport).not.toHaveBeenCalled();
    expect(transport.onDispose).toHaveBeenCalledOnce();
  });

  it("rejects an active multi-chunk read when explicit cancellation resolves the native read as done", async () => {
    let reads = 0;
    let resolveSecond: ((result: ReadableStreamReadResult<Uint8Array>) => void) | undefined;
    let markSecondStarted: (() => void) | undefined;
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const nativeReader = {
      read: vi.fn(() => {
        reads += 1;
        if (reads === 1) {
          return Promise.resolve({ done: false as const, value: Uint8Array.of(1, 2, 3) });
        }
        markSecondStarted?.();
        return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
          resolveSecond = resolve;
        });
      }),
      cancel: vi.fn(async () => {
        resolveSecond?.({ done: true, value: undefined });
      }),
    };
    const source = response("unused", { headers: {} });
    Object.defineProperty(source, "body", {
      value: { getReader: () => nativeReader },
    });
    const transport = transportResponse(source);
    const platform = fakePlatform(() => transport.response);
    const asset = await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/book.epub",
      "https://catalog.test",
    );
    const reading = asset.arrayBuffer();
    await secondStarted;

    const cancels = [asset.cancel(), asset.cancel(), asset.cancel()];

    await expectOpdsError(reading, "cancelled");
    await Promise.all(cancels);
    await asset.cancel();
    await expectOpdsError(asset.text(), "cancelled");
    expect(nativeReader.read).toHaveBeenCalledTimes(2);
    expect(nativeReader.cancel).toHaveBeenCalledOnce();
    expect(transport.cancelTransport).toHaveBeenCalledOnce();
    expect(transport.onDispose).toHaveBeenCalledOnce();
  });

  it("maps a native read rejection caused by explicit cancellation to cancelled", async () => {
    let rejectRead: ((error: Error) => void) | undefined;
    let markReading: (() => void) | undefined;
    const readingStarted = new Promise<void>((resolve) => {
      markReading = resolve;
    });
    const nativeReader = {
      read: vi.fn(
        () =>
          new Promise<ReadableStreamReadResult<Uint8Array>>((_resolve, reject) => {
            rejectRead = reject;
            markReading?.();
          }),
      ),
      cancel: vi.fn(async () => {
        rejectRead?.(new Error("native request aborted"));
      }),
    };
    const source = response("unused", { headers: {} });
    Object.defineProperty(source, "body", {
      value: { getReader: () => nativeReader },
    });
    const platform = fakePlatform(() => source);
    const asset = await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/book.epub",
      "https://catalog.test",
    );
    const reading = asset.arrayBuffer();
    await readingStarted;

    await asset.cancel();

    await expectOpdsError(reading, "cancelled");
  });

  it("makes cancellation before consumption stable and idempotent", async () => {
    const nativeReader = {
      read: vi.fn(),
      cancel: vi.fn(async () => {}),
    };
    const source = response("unused", { headers: {} });
    Object.defineProperty(source, "body", {
      value: { getReader: () => nativeReader },
    });
    const transport = transportResponse(source);
    const platform = fakePlatform(() => transport.response);
    const asset = await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/book.epub",
      "https://catalog.test",
    );

    await Promise.all([asset.cancel(), asset.cancel()]);

    await expectOpdsError(asset.arrayBuffer(), "cancelled");
    expect(nativeReader.read).not.toHaveBeenCalled();
    expect(nativeReader.cancel).toHaveBeenCalledOnce();
    expect(transport.cancelTransport).toHaveBeenCalledOnce();
  });

  it.each(["arrayBuffer", "text", "json", "blob"] as const)(
    "makes future %s consumption reject cancelled",
    async (method) => {
      const platform = fakePlatform(() => response("asset", { headers: {} }));
      const asset = await new OpdsClient(platform).fetchAsset(
        "https://catalog.test/book.epub",
        "https://catalog.test",
      );

      await asset.cancel();

      await expectOpdsError(asset[method](), "cancelled");
    },
  );

  it("aborts the asset transport when its returned body is cancelled", async () => {
    const transport = transportResponse(response("asset", { headers: {} }));
    const platform = fakePlatform(() => transport.response);
    const asset = await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/book.epub",
      "https://catalog.test",
    );

    await asset.body?.cancel();

    await expectOpdsError(asset.text(), "cancelled");
    expect(transport.cancelTransport).toHaveBeenCalledOnce();
    expect(transport.onDispose).toHaveBeenCalledOnce();
  });

  it("rejects mismatched credential and catalog origins without sending a request", async () => {
    const platform = fakePlatform(() => response("asset", { headers: {} }));

    await expectOpdsError(
      new OpdsClient(platform).fetchAsset(
        "https://other.test/cover.jpg",
        "https://other.test",
        credentials,
      ),
      "insecure-url",
    );
    expect(platform.calls).toHaveLength(0);
  });

  it("sends credentials to cover and acquisition assets only on the exact catalog origin", async () => {
    const platform = fakePlatform(() => response("asset", { headers: {} }));
    const client = new OpdsClient(platform);

    await client.fetchAsset("https://catalog.test/cover.jpg", "https://catalog.test", credentials);
    await client.fetchAsset("https://cdn.test/book.epub", "https://catalog.test", credentials);

    expect(authorization(platform.calls[0] as FetchCall)).not.toBeNull();
    expect(authorization(platform.calls[1] as FetchCall)).toBeNull();
    expect(platform.calls.every((call) => call.options?.responseType === "arraybuffer")).toBe(true);
  });

  it("strips credentials when an authenticated asset redirects across origins", async () => {
    const platform = fakePlatform((url) =>
      url === "https://catalog.test/cover.jpg"
        ? response("", { status: 302, headers: { Location: "https://cdn.test/cover.jpg" } })
        : response("asset", { headers: {} }),
    );

    await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/cover.jpg",
      "https://catalog.test",
      credentials,
    );

    expect(authorization(platform.calls[0] as FetchCall)).not.toBeNull();
    expect(authorization(platform.calls[1] as FetchCall)).toBeNull();
  });

  it("keeps user cancellation active while an asset body is being consumed", async () => {
    const stalled = stalledBodyResponse("application/epub+zip");
    const platform = fakePlatform(() => stalled.response);
    const controller = new AbortController();
    const asset = await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/book.epub",
      "https://catalog.test",
      undefined,
      controller.signal,
    );
    const reading = asset.arrayBuffer();
    await stalled.readingStarted;

    controller.abort();

    const outcome = await Promise.race([
      reading.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      ),
      new Promise<{ kind: "pending" }>((resolve) =>
        setTimeout(() => resolve({ kind: "pending" }), 0),
      ),
    ]);
    expect(outcome).toMatchObject({
      kind: "rejected",
      error: { name: "OpdsError", code: "cancelled" },
    });
  });

  it("keeps the timeout active while an asset body is being consumed", async () => {
    vi.useFakeTimers();
    const stalled = stalledBodyResponse("application/epub+zip");
    const platform = fakePlatform(() => stalled.response);
    const asset = await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/book.epub",
      "https://catalog.test",
    );
    let rejection: unknown;
    const reading = asset.arrayBuffer().catch((error: unknown) => {
      rejection = error;
    });
    await stalled.readingStarted;

    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.resolve();

    expect(rejection).toMatchObject({ name: "OpdsError", code: "unreachable" });
    expect(vi.getTimerCount()).toBe(0);
    await reading;
  });
});

describe("OpdsClient search", () => {
  it("upgrades Gutenberg-style public HTTP search templates advertised by HTTPS", async () => {
    const platform = fakePlatform((url) => {
      if (url === "https://www.gutenberg.org/catalog/osd-books.xml") {
        return response(GUTENBERG_OPENSEARCH, {
          headers: { "Content-Type": "application/opensearchdescription+xml" },
        });
      }
      if (url === "https://m.gutenberg.org/ebooks/search.opds/?query=alice") return response(ATOM);
      throw new Error(`Unexpected test URL: ${url}`);
    });

    await new OpdsClient(platform).search(
      {
        kind: "openSearch",
        descriptorUrl: "https://www.gutenberg.org/catalog/osd-books.xml",
      },
      "alice",
      undefined,
      undefined,
      "https://www.gutenberg.org",
    );

    expect(platform.calls.map((call) => call.url)).toEqual([
      "https://www.gutenberg.org/catalog/osd-books.xml",
      "https://m.gutenberg.org/ebooks/search.opds/?query=alice",
    ]);
  });

  it("prefers OPDS JSON and Atom search URLs over generic XML", async () => {
    const descriptor = `<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
      <ShortName>Ranked search</ShortName>
      <Url type="application/xml" template="https://catalog.test/generic?q={searchTerms}" />
      <Url type="application/atom+xml" template="https://catalog.test/atom?q={searchTerms}" />
      <Url type="application/opds+json" template="https://catalog.test/json?q={searchTerms}" />
    </OpenSearchDescription>`;
    const opdsJson = JSON.stringify({
      metadata: { title: "JSON results" },
      links: [{ rel: "self", href: "https://catalog.test/json?q=books" }],
      navigation: [{ title: "More", href: "https://catalog.test/more" }],
    });
    const platform = fakePlatform((url) => {
      if (url === "https://catalog.test/open-search.xml") {
        return response(descriptor, {
          headers: { "Content-Type": "application/opensearchdescription+xml" },
        });
      }
      if (url === "https://catalog.test/json?q=books") {
        return response(opdsJson, { headers: { "Content-Type": "application/opds+json" } });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });

    const feed = await new OpdsClient(platform).search(
      { kind: "openSearch", descriptorUrl: "https://catalog.test/open-search.xml" },
      "books",
    );

    expect(feed.title).toBe("JSON results");
    expect(platform.calls.map((call) => call.url)).toEqual([
      "https://catalog.test/open-search.xml",
      "https://catalog.test/json?q=books",
    ]);
  });

  it.each([
    [
      "HTML only",
      `<Url type="text/html" template="https://catalog.test/search?q={searchTerms}" />`,
    ],
    [
      "POST method",
      `<Url type="application/atom+xml" method="POST" template="https://catalog.test/search?q={searchTerms}" />`,
    ],
    [
      "missing search terms",
      `<Url type="application/atom+xml" template="https://catalog.test/search?q={query}" />`,
    ],
  ])("rejects an OpenSearch descriptor with %s", async (_name, urlElement) => {
    const descriptor = `<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><ShortName>Bad search</ShortName>${urlElement}</OpenSearchDescription>`;
    const platform = fakePlatform(() =>
      response(descriptor, {
        headers: { "Content-Type": "application/opensearchdescription+xml" },
      }),
    );

    await expectOpdsError(
      new OpdsClient(platform).search(
        { kind: "openSearch", descriptorUrl: "https://catalog.test/open-search.xml" },
        "books",
      ),
      "invalid-catalog",
    );
    expect(platform.calls).toHaveLength(1);
  });

  it("does not upgrade or request a local HTTP search target advertised by HTTPS", async () => {
    const platform = fakePlatform(() => response(ATOM));

    await expectOpdsError(
      new OpdsClient(platform).search(
        { kind: "template", urlTemplate: "http://127.0.0.1:8080/search{?query}" },
        "books",
        undefined,
        undefined,
        "https://remote.test",
      ),
      "insecure-url",
    );
    expect(platform.calls).toHaveLength(0);
  });

  it("does not upgrade a local HTTP URL selected from an HTTPS OpenSearch descriptor", async () => {
    const descriptor = `<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><ShortName>Unsafe</ShortName><Url type="application/atom+xml" template="http://127.0.0.1:8080/search?q={searchTerms}" /></OpenSearchDescription>`;
    const platform = fakePlatform(() =>
      response(descriptor, {
        headers: { "Content-Type": "application/opensearchdescription+xml" },
      }),
    );

    await expectOpdsError(
      new OpdsClient(platform).search(
        { kind: "openSearch", descriptorUrl: "https://remote.test/open-search.xml" },
        "books",
      ),
      "insecure-url",
    );
    expect(platform.calls.map((call) => call.url)).toEqual(["https://remote.test/open-search.xml"]);
  });
  it("fetches an advertised OPDS 1 OpenSearch descriptor and encodes the query", async () => {
    const platform = fakePlatform((url) => {
      if (url === "https://catalog.test/open-search.xml") {
        return response(OPENSEARCH, {
          headers: { "Content-Type": "application/opensearchdescription+xml" },
        });
      }
      if (url === "https://catalog.test/search?q=cats%20%26%20dogs") return response(ATOM);
      throw new Error(`Unexpected test URL: ${url}`);
    });

    const feed = await new OpdsClient(platform).search(
      {
        kind: "openSearch",
        descriptorUrl: "https://catalog.test/open-search.xml",
      },
      "cats & dogs",
      credentials,
    );

    expect(feed.title).toBe("Catalog");
    expect(platform.calls.map((call) => call.url)).toEqual([
      "https://catalog.test/open-search.xml",
      "https://catalog.test/search?q=cats%20%26%20dogs",
    ]);
    expect(platform.calls.map(authorization)).toEqual([
      "Basic cmVhZGVyOnNlY3JldC1wYXNzd29yZA==",
      "Basic cmVhZGVyOnNlY3JldC1wYXNzd29yZA==",
    ]);
  });

  it("expands an advertised OPDS 2 URI template without allowing query injection", async () => {
    const platform = fakePlatform((url) => {
      if (url === "https://catalog.test/search?query=a%26admin%3Dtrue%23fragment") {
        return response(ATOM);
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });

    await new OpdsClient(platform).search(
      { kind: "template", urlTemplate: "https://catalog.test/search{?query}" },
      "a&admin=true#fragment",
      credentials,
    );

    expect(platform.calls).toHaveLength(1);
  });

  it("does not guess search parameters for a feed without advertised search", async () => {
    const platform = fakePlatform(() => response(ATOM));

    const feed = await new OpdsClient(platform).open("https://catalog.test/feed.xml");

    expect(feed.search).toBeUndefined();
    expect(platform.calls.map((call) => call.url)).toEqual(["https://catalog.test/feed.xml"]);
  });
});
