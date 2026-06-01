/**
 * WebDAV client using IPlatformService.fetch() — works on both Tauri and Expo.
 * WebDAV is HTTP with custom methods (PROPFIND, MKCOL, PUT, GET, DELETE).
 */

// React Native/Metro cannot resolve the Node `node:buffer` protocol import.
// biome-ignore lint/style/useNodejsImportProtocol: Expo needs the buffer polyfill package name.
import { Buffer } from "buffer";
import i18n from "../i18n";
import { getPlatformService } from "../services/platform";
import type { DavResource } from "./sync-types";

function stripControlChars(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return (code >= 0x20 && code !== 0x7f) || code > 0x7f;
    })
    .join("");
}

export function sanitizeWebDavUrl(url: string): string {
  return stripControlChars(url).trim().replace(/\/+$/, "");
}

export function sanitizeWebDavRemoteRoot(remoteRoot: string): string {
  const normalized = stripControlChars(remoteRoot)
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
  return normalized;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const TRANSFER_TIMEOUT_MS = 300_000;
const DIRECTORY_PROBE_TIMEOUT_MS = 5_000;

/**
 * Retry policy for transient HTTP failures (401-after-auth, 429, 5xx).
 * Backoff: 500ms → 1s → 2s. Network/timeout errors are NOT retried — they may
 * have consumed the full timeout already, so retrying would amplify latency.
 * Issue #195 motivated this: Chinese WebDAV providers (Jianguoyun, NAS) reject
 * with 401 under burst load even though credentials are valid.
 */
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

type WebDavErrorKind =
  | "auth"
  | "forbidden"
  | "not-found"
  | "method-not-allowed"
  | "timeout"
  | "network"
  | "tls"
  | "server"
  | "http";

export class WebDavError extends Error {
  readonly kind: WebDavErrorKind;
  readonly status?: number;
  readonly method?: string;
  readonly url?: string;
  readonly cause?: unknown;

  constructor(
    kind: WebDavErrorKind,
    message: string,
    options?: {
      status?: number;
      method?: string;
      url?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "WebDavError";
    this.kind = kind;
    this.status = options?.status;
    this.method = options?.method;
    this.url = options?.url;
    this.cause = options?.cause;
  }
}

function summarizeStatus(status: number, statusText?: string): string {
  return [status, statusText?.trim()].filter(Boolean).join(" ");
}

function toCollectionPath(path: string): string {
  if (path === "/") return "/";
  return path.endsWith("/") ? path : `${path}/`;
}

function createHttpWebDavError(
  status: number,
  statusText: string | undefined,
  method: string,
  url: string,
): WebDavError {
  const statusSummary = summarizeStatus(status, statusText);
  switch (status) {
    case 401:
      return new WebDavError(
        "auth",
        i18n.t("settings.syncWebdavAuthFailed", {
          defaultValue: "WebDAV 认证失败，请检查用户名和应用密码是否正确。",
        }),
        { status, method, url },
      );
    case 403:
      return new WebDavError(
        "forbidden",
        i18n.t("settings.syncWebdavForbidden", {
          defaultValue: "WebDAV 访问被拒绝，请检查当前账号是否有这个路径的权限。",
        }),
        { status, method, url },
      );
    case 404:
      return new WebDavError(
        "not-found",
        i18n.t("settings.syncWebdavNotFound", {
          defaultValue: "WebDAV 地址或路径不存在，请检查服务器地址和根路径。",
        }),
        { status, method, url },
      );
    case 405:
      return new WebDavError(
        "method-not-allowed",
        i18n.t("settings.syncWebdavMethodNotAllowed", {
          defaultValue: "服务器没有正确响应 WebDAV 请求，请确认 WebDAV 服务已经开启。",
        }),
        { status, method, url },
      );
    default:
      if (status >= 500) {
        return new WebDavError(
          "server",
          i18n.t("settings.syncWebdavServerError", {
            defaultValue: "WebDAV 服务器异常（{{status}}）。",
            status: statusSummary,
          }),
          { status, method, url },
        );
      }
      return new WebDavError(
        "http",
        i18n.t("settings.syncWebdavHttpError", {
          defaultValue: "WebDAV 请求失败（{{status}}）。",
          status: statusSummary,
        }),
        { status, method, url },
      );
  }
}

function createRequestWebDavError(
  error: unknown,
  method: string,
  url: string,
  timeoutMs: number,
): WebDavError {
  const err = error as { name?: string; message?: string; cause?: { code?: string } };
  const lowerMessage = err.message?.toLowerCase() ?? "";
  const connectionMessage = i18n.t("settings.syncWebdavNetworkError", {
    defaultValue: "无法连接到 WebDAV 服务器，请检查网络、地址、端口或证书配置。",
  });

  if (
    err.name === "AbortError" ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("aborted")
  ) {
    return new WebDavError(
      "timeout",
      i18n.t("settings.syncWebdavTimeout", {
        defaultValue: "WebDAV 连接超时（{{seconds}} 秒），请检查服务器地址、端口和网络。",
        seconds: Math.max(1, Math.round(timeoutMs / 1000)),
      }),
      { method, url, cause: error },
    );
  }

  if (
    lowerMessage.includes("certificate") ||
    lowerMessage.includes("ssl") ||
    lowerMessage.includes("tls")
  ) {
    return new WebDavError(
      "tls",
      i18n.t("settings.syncWebdavTlsError", {
        defaultValue: "WebDAV TLS 证书校验失败，请检查证书，或开启允许不安全连接后再试。",
      }),
      { method, url, cause: error },
    );
  }

  if (
    err.cause?.code === "ECONNREFUSED" ||
    err.cause?.code === "EHOSTUNREACH" ||
    err.cause?.code === "ENOTFOUND" ||
    lowerMessage.includes("configured scope") ||
    lowerMessage.includes("url not allowed") ||
    lowerMessage.includes("status 0") ||
    lowerMessage.includes("xhr request failed") ||
    lowerMessage.includes("network request failed") ||
    lowerMessage.includes("failed to fetch") ||
    lowerMessage.includes("connect")
  ) {
    const message =
      lowerMessage.includes("configured scope") || lowerMessage.includes("url not allowed")
        ? i18n.t("settings.syncWebdavDesktopScopeError", {
            defaultValue:
              "桌面端当前没有放行这个 WebDAV 地址，请更新到最新版本后重试，或重新启动应用。",
          })
        : connectionMessage;
    return new WebDavError("network", message, {
      method,
      url,
      cause: error,
    });
  }

  return new WebDavError(
    "network",
    i18n.t("settings.syncWebdavUnknownError", {
      defaultValue: "WebDAV 请求失败：{{message}}",
      message: err.message || connectionMessage,
    }),
    { method, url, cause: error },
  );
}

export class WebDavClient {
  private baseUrl: string;
  private authHeader: string;
  private allowInsecure: boolean;
  /**
   * Flips to true after the first 2xx/207 response. Once true, a 401 is
   * treated as a server-side throttle (retry-worthy) rather than a credential
   * failure. Reset per WebDavClient instance.
   */
  private hadAuthSuccess = false;

  constructor(url: string, username: string, password: string, allowInsecure?: boolean) {
    // Normalize: remove control chars/whitespace and trailing slash
    this.baseUrl = sanitizeWebDavUrl(url);
    // Basic auth header
    const credentials = `${username}:${password}`;
    // Use UTF-8 safe base64 encoding; btoa is unreliable in React Native/Android.
    const encoded = Buffer.from(credentials, "utf8").toString("base64");
    this.authHeader = `Basic ${encoded}`;
    console.log("[WebDAV] auth configured", {
      username: username.length > 2 ? `${username[0]}***${username[username.length - 1]}` : "***",
      passwordLength: password.length,
    });
    this.allowInsecure = allowInsecure ?? false;
  }

  private getTimeout(method: string, explicitTimeoutMs?: number): number {
    if (explicitTimeoutMs !== undefined) return explicitTimeoutMs;
    const isTransferOperation = method === "PUT" || method === "GET";
    return isTransferOperation ? TRANSFER_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  }

  private buildUrl(path: string): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    // Encode path segments but preserve /
    const encoded = normalizedPath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${this.baseUrl}${encoded}`;
  }

  private getAuthHeaders(): Record<string, string> {
    return { Authorization: this.authHeader };
  }

  /** True if the status code indicates a transient, retry-worthy failure. */
  private isTransientStatus(status: number): boolean {
    // 401 BEFORE any successful auth = real credential failure, do not retry.
    // 401 AFTER a successful response = server is throttling / temporarily
    // rejecting valid credentials under burst load (Jianguoyun, some NAS).
    if (status === 401 && this.hadAuthSuccess) return true;
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }

  private async doFetch(
    method: string,
    path: string,
    options: {
      body?: string | Uint8Array | ArrayBuffer;
      headers?: Record<string, string>;
      contentType?: string;
      timeoutMs?: number;
      responseType?: "text" | "arraybuffer";
    },
  ): Promise<Response> {
    const platform = getPlatformService();
    const url = this.buildUrl(path);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      ...options.headers,
    };
    if (options.contentType) {
      headers["Content-Type"] = options.contentType;
    }
    const effectiveTimeoutMs = this.getTimeout(method, options.timeoutMs);
    return await platform.fetch(url, {
      method,
      headers,
      body: options.body as BodyInit | undefined,
      allowInsecure: this.allowInsecure,
      timeoutMs: effectiveTimeoutMs,
      responseType: options.responseType,
    });
  }

  private async request(
    method: string,
    path: string,
    options: {
      body?: string | Uint8Array | ArrayBuffer;
      headers?: Record<string, string>;
      contentType?: string;
      timeoutMs?: number;
      responseType?: "text" | "arraybuffer";
    } = {},
  ): Promise<Response> {
    const logPath = path.startsWith("/") ? path : `/${path}`;
    console.log(`[WebDAV] ${method} ${logPath}`);

    for (let attempt = 0; ; attempt++) {
      const startTime = Date.now();
      try {
        const response = await this.doFetch(method, path, options);
        const elapsed = Date.now() - startTime;
        console.log(
          `[WebDAV] ${method} ${logPath} completed in ${elapsed}ms (status: ${response.status})`,
        );

        if (response.ok || response.status === 207) {
          this.hadAuthSuccess = true;
          return response;
        }

        if (attempt < RETRY_MAX_ATTEMPTS && this.isTransientStatus(response.status)) {
          const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
          console.warn(
            `[WebDAV] ${method} ${logPath} got ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        return response;
      } catch (error: unknown) {
        const elapsed = Date.now() - startTime;
        const webDavError = createRequestWebDavError(
          error,
          method,
          this.buildUrl(path),
          this.getTimeout(method, options.timeoutMs),
        );
        console.error(
          `[WebDAV] ${method} ${logPath} failed (${webDavError.kind}) after ${elapsed}ms:`,
          error,
        );
        throw webDavError;
      }
    }
  }

  /**
   * Test if the server is reachable and credentials are valid. Pass `path` when
   * baseUrl is the bare origin; the default "/" probes the root, which
   * subpath-only servers (e.g. Jianguoyun /dav/) reject.
   */
  async ping(path = "/"): Promise<void> {
    const resp = await this.request("PROPFIND", path, {
      headers: { Depth: "0" },
      body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',
      contentType: "application/xml",
      timeoutMs: 10_000,
    });
    if (resp.ok || resp.status === 207) {
      return;
    }
    throw createHttpWebDavError(resp.status, resp.statusText, "PROPFIND", this.buildUrl(path));
  }

  /** Test connection, returns true if successful */
  async testConnection(): Promise<boolean> {
    await this.ping();
    return true;
  }

  /** Create a directory (MKCOL) */
  async mkcol(path: string): Promise<void> {
    const collectionPath = toCollectionPath(path);
    let resp: Response;
    try {
      resp = await this.request("MKCOL", collectionPath);
    } catch (e) {
      if (await this.propfindExists(collectionPath, { timeoutMs: DIRECTORY_PROBE_TIMEOUT_MS })) {
        console.warn(`[WebDAV] MKCOL ${path} failed but directory exists; continuing`);
        return;
      }
      throw e;
    }
    const status = resp.status;
    if (resp.ok || status === 201) {
      return;
    }
    if (status === 405 || status === 409) {
      return;
    }
    throw new Error(`WebDAV MKCOL failed for ${path}: ${status} ${resp.statusText || ""}`);
  }

  /** Ensure a full directory path exists (creates each segment) */
  async ensureDirectory(path: string): Promise<void> {
    const segments = path.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current += `/${segment}`;
      if (
        await this.propfindExists(toCollectionPath(current), {
          timeoutMs: DIRECTORY_PROBE_TIMEOUT_MS,
        })
      ) {
        continue;
      }
      try {
        await this.mkcol(current);
      } catch (e: unknown) {
        const err = e as { message?: string };
        if (err.message?.includes("405") || err.message?.includes("409")) {
          continue;
        }
        throw e;
      }
    }
  }

  /** Upload data to a path (PUT) */
  async put(
    path: string,
    data: string | Uint8Array | ArrayBuffer,
    contentType = "application/octet-stream",
  ): Promise<void> {
    const resp = await this.request("PUT", path, {
      body: data,
      contentType,
    });
    if (!resp.ok) {
      throw new Error(`WebDAV PUT failed for ${path}: ${resp.status} ${resp.statusText || ""}`);
    }
  }

  async putFile(
    path: string,
    localFilePath: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const platform = getPlatformService();
    if (!platform.uploadFile) {
      throw new Error("Platform does not support direct file upload");
    }

    const url = this.buildUrl(path);
    const logPath = path.startsWith("/") ? path : `/${path}`;
    console.log(`[WebDAV] PUT ${logPath} (file upload)`);
    const startTime = Date.now();
    await platform.uploadFile(url, localFilePath, {
      headers: {
        ...this.getAuthHeaders(),
        "Content-Type": "application/octet-stream",
      },
      allowInsecure: this.allowInsecure,
      onProgress,
    });
    this.hadAuthSuccess = true;
    console.log(`[WebDAV] PUT ${logPath} completed in ${Date.now() - startTime}ms`);
  }

  /** Upload a JSON object */
  async putJSON(path: string, data: unknown): Promise<void> {
    await this.put(path, JSON.stringify(data), "application/json");
  }

  /** Download data from a path (GET) — returns Uint8Array */
  async get(path: string): Promise<Uint8Array> {
    const resp = await this.request("GET", path, {
      responseType: "arraybuffer",
    });
    if (!resp.ok) {
      throw new Error(`WebDAV GET failed for ${path}: ${resp.status} ${resp.statusText || ""}`);
    }
    const buffer = await resp.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /** Download data with progress reporting */
  async getWithProgress(
    path: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Uint8Array> {
    const platform = getPlatformService();
    const url = this.buildUrl(path);
    const logPath = path.startsWith("/") ? path : `/${path}`;
    console.log(`[WebDAV] GET ${logPath} (with progress)`);
    const startTime = Date.now();

    try {
      const resp = await platform.fetch(url, {
        method: "GET",
        headers: { Authorization: this.authHeader },
        allowInsecure: this.allowInsecure,
        timeoutMs: TRANSFER_TIMEOUT_MS,
        responseType: "arraybuffer",
        onDownloadProgress: onProgress,
      });

      const elapsed = Date.now() - startTime;
      if (!resp.ok) {
        console.error(`[WebDAV] GET ${logPath} failed after ${elapsed}ms: ${resp.status}`);
        throw new Error(`WebDAV GET failed for ${path}: ${resp.status} ${resp.statusText || ""}`);
      }
      console.log(`[WebDAV] GET ${logPath} completed in ${elapsed}ms (status: ${resp.status})`);
      const buffer = await resp.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error: unknown) {
      const msg = (error as { message?: string })?.message ?? "";
      // Tauri/Chromium rejects response headers containing non-ISO-8859-1
      // characters (e.g. Chinese filenames in Content-Disposition). When this
      // happens, fall back to the regular `get()` which goes through
      // `request()` and has retry protection. Progress reporting is lost but
      // the download still succeeds.
      if (
        msg.includes("ISO-8859-1") ||
        msg.includes("non ISO") ||
        msg.includes("Failed to construct 'Headers'")
      ) {
        console.warn(
          `[WebDAV] GET ${logPath} failed due to non-ASCII response headers; falling back to get() without progress`,
        );
        return this.get(path);
      }
      throw error;
    }
  }

  async getFileToPath(
    path: string,
    localFilePath: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const platform = getPlatformService();
    if (!platform.downloadFile) {
      throw new Error("Platform does not support direct file download");
    }

    const url = this.buildUrl(path);
    const logPath = path.startsWith("/") ? path : `/${path}`;
    console.log(`[WebDAV] GET ${logPath} (file download)`);
    const startTime = Date.now();
    await platform.downloadFile(url, localFilePath, {
      headers: this.getAuthHeaders(),
      allowInsecure: this.allowInsecure,
      onProgress,
    });
    this.hadAuthSuccess = true;
    console.log(`[WebDAV] GET ${logPath} completed in ${Date.now() - startTime}ms`);
  }

  /** Download text content from a path (GET) */
  async getText(path: string): Promise<string> {
    const resp = await this.request("GET", path, {
      responseType: "text",
    });
    if (!resp.ok) {
      throw new Error(`WebDAV GET failed for ${path}: ${resp.status} ${resp.statusText || ""}`);
    }
    return resp.text();
  }

  /** Download and parse JSON from a path */
  async getJSON<T>(path: string): Promise<T | null> {
    try {
      const text = await this.getText(path);
      return JSON.parse(text) as T;
    } catch (e: unknown) {
      const err = e as { message?: string };
      if (err.message?.includes("404") || err.message?.includes("409")) return null;
      throw e;
    }
  }

  /** Delete a resource (DELETE) */
  async delete(path: string): Promise<void> {
    const resp = await this.request("DELETE", path);
    // 204 No Content or 404 Not Found — both OK for delete
    if (!resp.ok && resp.status !== 404) {
      throw new Error(`WebDAV DELETE failed for ${path}: ${resp.status} ${resp.statusText || ""}`);
    }
  }

  /**
   * Move/rename a resource (MOVE).
   * `Overwrite: F` instructs the server to refuse if `toPath` already exists.
   */
  async move(fromPath: string, toPath: string): Promise<void> {
    const destination = this.buildUrl(toPath);
    const resp = await this.request("MOVE", fromPath, {
      headers: {
        Destination: destination,
        Overwrite: "F",
      },
    });
    // 201 Created (target newly created) and 204 No Content (target overwritten) are success.
    // 207 Multi-Status can also be returned for collection moves with partial errors — treat as failure.
    if (!resp.ok && resp.status !== 201 && resp.status !== 204) {
      throw new Error(
        `WebDAV MOVE failed for ${fromPath} -> ${toPath}: ${resp.status} ${resp.statusText || ""}`,
      );
    }
  }

  /** Check if a resource exists (try HEAD first, fallback to PROPFIND Depth 0) */
  async exists(path: string): Promise<boolean> {
    try {
      const resp = await this.request("HEAD", path);
      if (resp.ok) return true;
      if (resp.status === 405) {
        return await this.propfindExists(path);
      }
      return false;
    } catch {
      return false;
    }
  }

  /** PROPFIND Depth 0 to check if a resource exists */
  private async propfindExists(path: string, options?: { timeoutMs?: number }): Promise<boolean> {
    try {
      const resp = await this.request("PROPFIND", path, {
        headers: { Depth: "0" },
        body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',
        contentType: "application/xml",
        timeoutMs: options?.timeoutMs,
      });
      return resp.ok || resp.status === 207;
    } catch {
      return false;
    }
  }

  /** List directory contents (PROPFIND Depth 1) */
  async propfind(path: string): Promise<DavResource[]> {
    const resp = await this.request("PROPFIND", path, {
      headers: { Depth: "1" },
      body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:getcontentlength/><D:getlastmodified/><D:getetag/></D:prop></D:propfind>',
      contentType: "application/xml",
    });
    if (!resp.ok && resp.status !== 207) {
      if (resp.status === 404 || resp.status === 409) return [];
      throw new Error(
        `WebDAV PROPFIND failed for ${path}: ${resp.status} ${resp.statusText || ""}`,
      );
    }
    const xml = await resp.text();
    return parsePropfindResponse(xml, path, this.buildUrl(path));
  }

  /** Safely list directory, create if not exists */
  async safeReadDir(path: string): Promise<DavResource[]> {
    const collectionPath = toCollectionPath(path);
    try {
      return await this.propfind(collectionPath);
    } catch (e: unknown) {
      const err = e as { message?: string };
      if (err.message?.includes("404")) {
        await this.ensureDirectory(collectionPath);
        return [];
      }
      throw e;
    }
  }
}

/**
 * Parse a PROPFIND multistatus XML response.
 * Uses regex-based parsing — no DOM parser needed since the XML structure is predictable.
 */
function parsePropfindResponse(xml: string, basePath: string, requestUrl: string): DavResource[] {
  const blocks: string[] = [];

  // Split by WebDAV response boundaries regardless of namespace prefix.
  const responseRegex = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  let match = responseRegex.exec(xml);
  while (match !== null) {
    blocks.push(match[1]);
    match = responseRegex.exec(xml);
  }

  const strictBasePath = normalizeWebDavPath(new URL(requestUrl).pathname);
  const fallbackBasePath = normalizeWebDavPath(basePath);
  let resources = parsePropfindBlocks(blocks, strictBasePath, requestUrl);

  if (resources.length === 0 && fallbackBasePath !== strictBasePath) {
    resources = parsePropfindBlocks(blocks, fallbackBasePath, requestUrl);
  }

  return resources;
}

function parsePropfindBlocks(
  blocks: string[],
  basePath: string,
  requestUrl: string,
): DavResource[] {
  const resources: DavResource[] = [];

  for (const block of blocks) {
    const href = extractTagContent(block, "href") || "";
    const hrefPath = normalizeWebDavPath(getPathnameFromHref(href, requestUrl));
    if (!isDirectChildPath(basePath, hrefPath)) continue;

    const isCollection = /<(?:(?:\w+):)?collection\b[^>]*\/?>/i.test(block);
    const contentLengthStr = extractTagContent(block, "getcontentlength");
    const lastModified = extractTagContent(block, "getlastmodified");
    const etag = extractTagContent(block, "getetag")?.replace(/"/g, "");

    resources.push({
      href: hrefPath,
      name: filenameFromPath(hrefPath),
      isCollection,
      contentLength: contentLengthStr ? Number.parseInt(contentLengthStr, 10) : undefined,
      lastModified: lastModified || undefined,
      etag: etag || undefined,
    });
  }

  return resources;
}

function safeDecodeWebDavPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function getPathnameFromHref(href: string, requestUrl: string): string {
  try {
    return new URL(href, requestUrl).pathname;
  } catch {
    return href;
  }
}

function normalizeWebDavPath(path: string): string {
  const decoded = safeDecodeWebDavPath(path).replace(/\/{2,}/g, "/");
  const trimmed = decoded.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed || "/" : `/${trimmed}`;
}

function isDirectChildPath(basePath: string, hrefPath: string): boolean {
  if (hrefPath === basePath) return false;
  const prefix = basePath === "/" ? "/" : `${basePath}/`;
  if (!hrefPath.startsWith(prefix)) return false;
  const relative = hrefPath.slice(prefix.length).replace(/\/+$/, "");
  return relative.length > 0 && !relative.includes("/");
}

/** Extract text content of an XML tag (case-insensitive, supports arbitrary namespace prefix) */
function extractTagContent(xml: string, localName: string): string | null {
  const regex = new RegExp(
    `<(?:[\\w-]+:)?${localName}\\b[^>]*>([^<]*)<\\/(?:[\\w-]+:)?${localName}>`,
    "i",
  );
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

/** Extract filename from a normalized WebDAV path */
function filenameFromPath(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || "";
}
