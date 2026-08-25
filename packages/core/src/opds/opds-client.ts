import { DOMParser } from "@xmldom/xmldom";
import { getSearch } from "foliate-js/opds.js";
import type { FetchOptions, IPlatformService, PlatformFetchResponse } from "../services/platform";
import { parseOpdsDocument } from "./opds-parser";
import { classifyOpdsUrl } from "./opds-security";
import type { OpdsCredentials, OpdsErrorCode, OpdsFeed, OpdsSearchDescriptor } from "./opds-types";

const CATALOG_ACCEPT =
  "application/opds+json, application/atom+xml;profile=opds-catalog, application/xml;q=0.8";
const OPENSEARCH_ACCEPT = "application/opensearchdescription+xml, application/xml;q=0.8";
const CATALOG_MEDIA_TYPES = new Set([
  "application/opds+json",
  "application/json",
  "application/atom+xml",
  "application/xml",
  "text/xml",
]);
const OPENSEARCH_MEDIA_TYPES = new Set([
  "application/opensearchdescription+xml",
  "application/xml",
  "text/xml",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const disposedTransports = new WeakSet<PlatformFetchResponse>();

const ERROR_MESSAGES: Record<OpdsErrorCode, string> = {
  unauthorized: "Catalog authentication failed.",
  "unsupported-auth": "The catalog requires an unsupported authentication method.",
  "insecure-url": "The catalog URL is not allowed.",
  unreachable: "The catalog could not be reached.",
  "invalid-catalog": "The response is not a valid OPDS catalog.",
  cancelled: "The catalog request was cancelled.",
  "too-large": "The catalog response is too large.",
  "unsupported-acquisition": "The selected book format is not supported.",
  "download-failed": "The book could not be downloaded.",
  "asset-too-large": "The book is too large to download safely.",
  "download-in-progress": "Another catalog download is already in progress.",
  "import-failed": "The downloaded book could not be imported.",
};

interface SearchDocument {
  search(values: Map<string | null, Map<string, string>>): string;
  params: Array<{ name: string; ns?: string | null }>;
}

interface RequestResult {
  response: PlatformFetchResponse;
  finalUrl: string;
}

interface RequestOptions {
  accept: string;
  responseType: "text" | "arraybuffer";
  credentials?: OpdsCredentials;
  catalogOrigin?: string;
}

type OpdsFetchPlatform = Pick<IPlatformService, "fetch">;

export type { OpdsCredentials, OpdsErrorCode } from "./opds-types";

export interface OpdsAssetResponse {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly bodyUsed: boolean;
  readonly headers: Headers;
  readonly ok: boolean;
  readonly redirected: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly type: ResponseType;
  readonly url: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  json(): Promise<unknown>;
  text(): Promise<string>;
  cancel(reason?: unknown): Promise<void>;
}

export class OpdsError extends Error {
  readonly code: OpdsErrorCode;

  constructor(code: OpdsErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "OpdsError";
    this.code = code;
  }
}

class RequestLifecycle {
  private readonly controller = new AbortController();
  private readonly userSignal?: AbortSignal;
  private readonly onUserAbort = () => this.abort("cancelled");
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private abortCode: "cancelled" | "unreachable" | undefined;
  private disposed = false;

  constructor(userSignal?: AbortSignal) {
    this.userSignal = userSignal;
    if (userSignal?.aborted) {
      this.abort("cancelled");
      return;
    }
    userSignal?.addEventListener("abort", this.onUserAbort, { once: true });
    this.timeout = setTimeout(() => this.abort("unreachable"), REQUEST_TIMEOUT_MS);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  throwIfAborted(): void {
    if (this.abortCode) throw new OpdsError(this.abortCode);
  }

  mapError(error: unknown): OpdsError {
    if (error instanceof OpdsError) return error;
    return new OpdsError(this.abortCode ?? "unreachable");
  }

  async race<T>(operation: Promise<T>): Promise<T> {
    this.throwIfAborted();
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new OpdsError(this.abortCode ?? "cancelled"));
      this.controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([operation, aborted]);
    } catch (error) {
      throw this.mapError(error);
    } finally {
      if (onAbort) this.controller.signal.removeEventListener("abort", onAbort);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.userSignal?.removeEventListener("abort", this.onUserAbort);
  }

  private abort(code: "cancelled" | "unreachable"): void {
    if (this.abortCode) return;
    this.abortCode = code;
    this.controller.abort();
    this.dispose();
  }
}

function normalizeAllowedOrigin(value: string): string {
  const classification = classifyOpdsUrl(value);
  if (!classification.allowed) throw new OpdsError("insecure-url");
  try {
    return new URL(value).origin;
  } catch {
    throw new OpdsError("insecure-url");
  }
}

function encodeBase64(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = new TextEncoder().encode(value);
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const bits = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += alphabet[(bits >> 18) & 63];
    encoded += alphabet[(bits >> 12) & 63];
    encoded += second === undefined ? "=" : alphabet[(bits >> 6) & 63];
    encoded += third === undefined ? "=" : alphabet[bits & 63];
  }
  return encoded;
}

function getAuthOrigin(credentials?: OpdsCredentials): string | undefined {
  if (!credentials) return undefined;
  return normalizeAllowedOrigin(credentials.catalogOrigin);
}

function getHeaders(
  current: URL,
  accept: string,
  credentials?: OpdsCredentials,
  authOrigin?: string,
): Headers {
  const headers = new Headers({ Accept: accept });
  if (credentials && authOrigin === current.origin) {
    headers.set(
      "Authorization",
      `Basic ${encodeBase64(`${credentials.username}:${credentials.password}`)}`,
    );
  }
  return headers;
}

function authError(response: Response): OpdsError | undefined {
  if (response.status !== 401) return undefined;
  const challenge = response.headers.get("WWW-Authenticate");
  if (!challenge || /(?:^|,)\s*basic(?:\s|$)/i.test(challenge)) {
    return new OpdsError("unauthorized");
  }
  return new OpdsError("unsupported-auth");
}

function getConfirmedInsecureOrigin(catalogOrigin?: string): string | undefined {
  if (!catalogOrigin) return undefined;
  const classification = classifyOpdsUrl(catalogOrigin);
  if (!classification.allowed) throw new OpdsError("insecure-url");
  try {
    const url = new URL(catalogOrigin);
    return classification.requiresInsecureConfirmation ? url.origin : undefined;
  } catch {
    throw new OpdsError("insecure-url");
  }
}

function checkUrl(value: string, confirmedInsecureOrigin?: string): URL {
  const classification = classifyOpdsUrl(value);
  if (!classification.allowed) throw new OpdsError("insecure-url");
  try {
    const url = new URL(value);
    if (classification.requiresInsecureConfirmation && url.origin !== confirmedInsecureOrigin) {
      throw new OpdsError("insecure-url");
    }
    return url;
  } catch {
    throw new OpdsError("insecure-url");
  }
}

function canonicalizeAdvertisedSearchUrl(value: string, sourceUrl?: string): string {
  if (!sourceUrl) return value;
  let source: URL;
  try {
    source = new URL(sourceUrl);
  } catch {
    return value;
  }
  const classification = classifyOpdsUrl(value);
  if (source.protocol !== "https:" || classification.reason !== "public-http") return value;
  try {
    const upgraded = new URL(value);
    upgraded.protocol = "https:";
    return upgraded.href;
  } catch {
    return value;
  }
}

function runPlatformFetch(
  platform: OpdsFetchPlatform,
  url: string,
  options: FetchOptions,
  lifecycle: RequestLifecycle,
): Promise<PlatformFetchResponse> {
  try {
    return lifecycle.race(
      Promise.resolve(platform.fetch(url, { ...options, signal: lifecycle.signal })),
    );
  } catch (error) {
    return Promise.reject(lifecycle.mapError(error));
  }
}

function cancelResponseBody(response: Response): void {
  if (response.body && !response.body.locked) {
    void response.body.cancel().catch(() => {});
  }
}

function abortResponseTransport(response: PlatformFetchResponse): void {
  if (disposedTransports.has(response)) return;
  disposedTransports.add(response);
  response.cancelTransport?.();
  response.onDispose?.();
}

function discardResponse(response: PlatformFetchResponse): void {
  cancelResponseBody(response);
  abortResponseTransport(response);
}

function disposeResponse(response: PlatformFetchResponse): void {
  if (disposedTransports.has(response)) return;
  disposedTransports.add(response);
  response.onDispose?.();
}

async function readLimitedText(
  response: PlatformFetchResponse,
  lifecycle: RequestLifecycle,
): Promise<string> {
  const contentLength = response.headers.get("Content-Length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_CATALOG_BYTES) {
      discardResponse(response);
      throw new OpdsError("too-large");
    }
  }

  const reader = response.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await lifecycle.race(reader.read());
        if (done) break;
        received += value.byteLength;
        if (received > MAX_CATALOG_BYTES) {
          throw new OpdsError("too-large");
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      disposeResponse(response);
      return chunks.join("");
    } catch (error) {
      void reader.cancel().catch(() => {});
      abortResponseTransport(response);
      throw lifecycle.mapError(error);
    }
  }

  let body: string;
  try {
    body = await lifecycle.race(response.text());
  } catch (error) {
    discardResponse(response);
    throw lifecycle.mapError(error);
  }
  if (new TextEncoder().encode(body).byteLength > MAX_CATALOG_BYTES) {
    discardResponse(response);
    throw new OpdsError("too-large");
  }
  disposeResponse(response);
  return body;
}

class ManagedAssetResponse implements OpdsAssetResponse {
  readonly headers: Headers;
  readonly ok: boolean;
  readonly redirected: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly type: ResponseType;
  readonly url: string;
  readonly body: ReadableStream<Uint8Array> | null;

  private readonly reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private readonly cancellation = new AbortController();
  private state: "open" | "cancelled" | "completed" | "failed" = "open";
  private cancellationCleanup: Promise<void> | undefined;
  private used = false;

  constructor(
    private readonly response: PlatformFetchResponse,
    private readonly lifecycle: RequestLifecycle,
  ) {
    this.headers = response.headers;
    this.ok = response.ok;
    this.redirected = response.redirected;
    this.status = response.status;
    this.statusText = response.statusText;
    this.type = response.type;
    this.url = response.url;

    if (!response.body) {
      this.body = null;
      disposeResponse(response);
      lifecycle.dispose();
      return;
    }

    const reader = response.body.getReader();
    this.reader = reader;
    this.body = new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          this.used = true;
          try {
            const result = await this.readNext(reader);
            this.throwIfCancelled();
            const { done, value } = result;
            if (done) {
              controller.close();
              this.finishNormally();
              return;
            }
            controller.enqueue(value);
          } catch (error) {
            const mapped =
              this.state === "cancelled" ? new OpdsError("cancelled") : lifecycle.mapError(error);
            if (this.state !== "cancelled") void this.fail(error);
            controller.error(mapped);
          }
        },
        cancel: async (reason) => {
          await this.transitionToCancelled(reason);
        },
      },
      { highWaterMark: 0 },
    );
  }

  get bodyUsed(): boolean {
    return this.used || Boolean(this.body?.locked);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return (await this.consumeBytes()).buffer as ArrayBuffer;
  }

  async blob(): Promise<Blob> {
    if (typeof globalThis.Blob !== "function") {
      throw new TypeError("Blob is not available on this platform.");
    }
    const bytes = await this.consumeBytes();
    return new Blob([bytes.buffer as ArrayBuffer], {
      type: this.headers.get("Content-Type") ?? "",
    });
  }

  async json(): Promise<unknown> {
    return JSON.parse(await this.text());
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.consumeBytes());
  }

  async cancel(reason?: unknown): Promise<void> {
    await this.transitionToCancelled(reason);
  }

  private async consumeBytes(): Promise<Uint8Array> {
    this.throwIfCancelled();
    if (this.used || this.body?.locked) {
      throw new TypeError("The response body has already been consumed.");
    }
    this.used = true;
    if (!this.body) return new Uint8Array();

    const reader = this.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const result = await reader.read();
        this.throwIfCancelled();
        const { done, value } = result;
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  private finishNormally(): void {
    if (this.state !== "open") return;
    this.state = "completed";
    disposeResponse(this.response);
    this.lifecycle.dispose();
  }

  private async readNext(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    this.throwIfCancelled();
    let onCancel: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onCancel = () => reject(new OpdsError("cancelled"));
      this.cancellation.signal.addEventListener("abort", onCancel, { once: true });
    });
    try {
      const result = await Promise.race([this.lifecycle.race(reader.read()), cancelled]);
      this.throwIfCancelled();
      return result;
    } catch (error) {
      if (this.state === "cancelled") throw new OpdsError("cancelled");
      throw error;
    } finally {
      if (onCancel) this.cancellation.signal.removeEventListener("abort", onCancel);
    }
  }

  private throwIfCancelled(): void {
    if (this.state === "cancelled") throw new OpdsError("cancelled");
  }

  private transitionToCancelled(reason?: unknown): Promise<void> {
    if (this.state === "cancelled") {
      return this.cancellationCleanup ?? Promise.resolve();
    }
    if (this.state !== "open" || disposedTransports.has(this.response)) {
      return Promise.resolve();
    }

    this.state = "cancelled";
    this.used = true;
    this.cancellation.abort();
    this.cancellationCleanup = this.abortReader(reason);
    return this.cancellationCleanup;
  }

  private fail(reason?: unknown): Promise<void> {
    if (this.state !== "open") return Promise.resolve();
    this.state = "failed";
    return this.abortReader(reason);
  }

  private async abortReader(reason?: unknown): Promise<void> {
    abortResponseTransport(this.response);
    this.lifecycle.dispose();
    try {
      await this.reader?.cancel(reason);
    } catch {
      // The native transport is already aborted; stream cancellation is best effort.
    }
  }
}

function getMediaType(response: Response): string {
  return response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function removeDoctypeAndEntityReferences(body: string): string {
  const withoutDoctype = body.replace(/<!DOCTYPE(?:[^<>\[]|\[[\s\S]*?\])*>/gi, "");
  return withoutDoctype.replace(/&(?!(?:amp|lt|gt|quot|apos);)[A-Za-z_][\w.:-]*;/g, "");
}

async function parseOpenSearch(body: string): Promise<SearchDocument> {
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: (message) => errors.push(message),
      error: (message) => errors.push(message),
      fatalError: (message) => errors.push(message),
    },
  }).parseFromString(removeDoctypeAndEntityReferences(body), "application/xml");
  const root = document.documentElement;
  if (
    errors.length > 0 ||
    root.localName !== "OpenSearchDescription" ||
    root.namespaceURI !== "http://a9.com/-/spec/opensearch/1.1/"
  ) {
    throw new OpdsError("invalid-catalog");
  }
  const children = Array.from(root.childNodes).filter(
    (node): node is Element => node.nodeType === 1,
  );
  const title = children
    .find(
      (element) => element.localName === "ShortName" && element.namespaceURI === root.namespaceURI,
    )
    ?.textContent?.trim();
  const candidates = children
    .filter((element) => element.localName === "Url" && element.namespaceURI === root.namespaceURI)
    .flatMap((element, index) => {
      const method = (element.getAttribute("method") ?? "").trim().toUpperCase() || "GET";
      const template = element.getAttribute("template")?.trim();
      const rawType = element.getAttribute("type") ?? "";
      const [rawMediaType = "", ...rawParameters] = rawType.split(";");
      const mediaType = rawMediaType.trim().toLowerCase();
      const parameters = new Map<string, string>();
      for (const rawParameter of rawParameters) {
        const separator = rawParameter.indexOf("=");
        if (separator < 0) continue;
        const name = rawParameter.slice(0, separator).trim().toLowerCase();
        const rawValue = rawParameter.slice(separator + 1).trim();
        const value =
          (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
          (rawValue.startsWith("'") && rawValue.endsWith("'"))
            ? rawValue.slice(1, -1)
            : rawValue;
        parameters.set(name, value.trim().toLowerCase());
      }
      const rank =
        mediaType === "application/opds+json"
          ? 4
          : mediaType === "application/atom+xml" && parameters.get("profile") === "opds-catalog"
            ? 3
            : mediaType === "application/atom+xml"
              ? 2
              : mediaType === "application/xml" || mediaType === "text/xml"
                ? 1
                : 0;
      return method === "GET" && template && rank > 0
        ? [{ index, rank, template, type: rawType }]
        : [];
    })
    .sort((left, right) => right.rank - left.rank || left.index - right.index);

  for (const candidate of candidates) {
    try {
      const result = (await getSearch({
        href: candidate.template,
        title,
        type: candidate.type,
      })) as Partial<SearchDocument>;
      if (
        typeof result.search === "function" &&
        Array.isArray(result.params) &&
        result.params.some((param) => param.name === "searchTerms" && !param.ns)
      ) {
        return result as SearchDocument;
      }
    } catch {
      // Try the next advertised catalog representation.
    }
  }
  throw new OpdsError("invalid-catalog");
}

async function expandTemplate(
  descriptor: Extract<OpdsSearchDescriptor, { kind: "template" }>,
  query: string,
) {
  try {
    const search = (await getSearch({
      href: descriptor.urlTemplate,
      title: descriptor.title,
      type: descriptor.type,
    })) as Partial<SearchDocument>;
    if (typeof search.search !== "function" || !Array.isArray(search.params)) {
      throw new OpdsError("invalid-catalog");
    }
    const names = new Set(search.params.map((param) => param.name));
    if (!names.has("query") && !names.has("searchTerms")) {
      throw new OpdsError("invalid-catalog");
    }
    const values = new Map<string, string>([
      ["query", query],
      ["searchTerms", query],
    ]);
    return search.search(new Map([[null, values]]));
  } catch (error) {
    if (error instanceof OpdsError) throw error;
    throw new OpdsError("invalid-catalog");
  }
}

export class OpdsClient {
  constructor(private readonly platform: OpdsFetchPlatform) {}

  private async request(
    url: string,
    options: RequestOptions,
    lifecycle: RequestLifecycle,
  ): Promise<RequestResult> {
    const authOrigin = getAuthOrigin(options.credentials);
    const confirmedInsecureOrigin = getConfirmedInsecureOrigin(options.catalogOrigin);
    let current = checkUrl(url, confirmedInsecureOrigin);

    for (let redirects = 0; ; redirects += 1) {
      lifecycle.throwIfAborted();
      const headers = getHeaders(current, options.accept, options.credentials, authOrigin);
      let response: Response;
      try {
        response = await runPlatformFetch(
          this.platform,
          current.href,
          {
            headers,
            redirect: "manual",
            timeoutMs: REQUEST_TIMEOUT_MS,
            responseType: options.responseType,
          },
          lifecycle,
        );
      } catch (error) {
        throw lifecycle.mapError(error);
      }

      const authenticationError = authError(response);
      if (authenticationError) {
        discardResponse(response);
        throw authenticationError;
      }
      if (!REDIRECT_STATUSES.has(response.status)) {
        if (!response.ok) {
          discardResponse(response);
          throw new OpdsError("unreachable");
        }
        return { response, finalUrl: current.href };
      }
      discardResponse(response);
      if (redirects >= MAX_REDIRECTS) throw new OpdsError("invalid-catalog");

      const location = response.headers.get("Location");
      if (!location) throw new OpdsError("invalid-catalog");
      let next: URL;
      try {
        next = checkUrl(new URL(location, current).href, confirmedInsecureOrigin);
      } catch (error) {
        if (error instanceof OpdsError) throw error;
        throw new OpdsError("insecure-url");
      }
      if (current.protocol === "https:" && next.protocol === "http:") {
        throw new OpdsError("insecure-url");
      }
      current = next;
    }
  }

  async open(
    url: string,
    credentials?: OpdsCredentials,
    signal?: AbortSignal,
    catalogOrigin?: string,
  ): Promise<OpdsFeed> {
    const lifecycle = new RequestLifecycle(signal);
    try {
      const { response, finalUrl } = await this.request(
        url,
        {
          accept: CATALOG_ACCEPT,
          responseType: "text",
          credentials,
          catalogOrigin: catalogOrigin ?? credentials?.catalogOrigin,
        },
        lifecycle,
      );
      const contentType = getMediaType(response);
      if (!CATALOG_MEDIA_TYPES.has(contentType)) {
        discardResponse(response);
        throw new OpdsError("invalid-catalog");
      }
      const body = await readLimitedText(response, lifecycle);
      try {
        return parseOpdsDocument(body, contentType, finalUrl);
      } catch (error) {
        if (error instanceof OpdsError) throw error;
        throw new OpdsError("invalid-catalog");
      }
    } finally {
      lifecycle.dispose();
    }
  }

  async search(
    descriptor: OpdsSearchDescriptor,
    query: string,
    credentials?: OpdsCredentials,
    signal?: AbortSignal,
    catalogOrigin?: string,
  ): Promise<OpdsFeed> {
    const requestCatalogOrigin = catalogOrigin ?? credentials?.catalogOrigin;
    if (descriptor.kind === "template") {
      const searchUrl = canonicalizeAdvertisedSearchUrl(
        await expandTemplate(descriptor, query),
        requestCatalogOrigin,
      );
      return this.open(searchUrl, credentials, signal, requestCatalogOrigin);
    }

    const lifecycle = new RequestLifecycle(signal);
    let searchUrl: string;
    try {
      const { response, finalUrl } = await this.request(
        descriptor.descriptorUrl,
        {
          accept: OPENSEARCH_ACCEPT,
          responseType: "text",
          credentials,
          catalogOrigin: requestCatalogOrigin,
        },
        lifecycle,
      );
      if (!OPENSEARCH_MEDIA_TYPES.has(getMediaType(response))) {
        discardResponse(response);
        throw new OpdsError("invalid-catalog");
      }
      const search = await parseOpenSearch(await readLimitedText(response, lifecycle));
      if (!search.params.some((param) => param.name === "searchTerms" && !param.ns)) {
        throw new OpdsError("invalid-catalog");
      }
      try {
        searchUrl = canonicalizeAdvertisedSearchUrl(
          new URL(search.search(new Map([[null, new Map([["searchTerms", query]])]])), finalUrl)
            .href,
          finalUrl,
        );
      } catch {
        throw new OpdsError("invalid-catalog");
      }
    } finally {
      lifecycle.dispose();
    }
    return this.open(searchUrl, credentials, signal, requestCatalogOrigin);
  }

  async fetchAsset(
    url: string,
    catalogOrigin: string,
    credentials?: OpdsCredentials,
    signal?: AbortSignal,
  ): Promise<OpdsAssetResponse> {
    const normalizedCatalogOrigin = normalizeAllowedOrigin(catalogOrigin);
    if (
      credentials &&
      normalizeAllowedOrigin(credentials.catalogOrigin) !== normalizedCatalogOrigin
    ) {
      throw new OpdsError("insecure-url");
    }
    const lifecycle = new RequestLifecycle(signal);
    try {
      const { response } = await this.request(
        url,
        {
          accept: "*/*",
          responseType: "arraybuffer",
          credentials,
          catalogOrigin: normalizedCatalogOrigin,
        },
        lifecycle,
      );
      return new ManagedAssetResponse(response, lifecycle);
    } catch (error) {
      lifecycle.dispose();
      throw error;
    }
  }
}
