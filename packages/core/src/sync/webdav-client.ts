/**
 * WebDAV client using IPlatformService.fetch() — works on both Tauri and Expo.
 * WebDAV is HTTP with custom methods (PROPFIND, MKCOL, PUT, GET, DELETE).
 */

import { Buffer } from "buffer";
import i18n from "../i18n";
import { getPlatformService } from "../services/platform";
import type { DavResource } from "./sync-types";

export function sanitizeWebDavUrl(url: string): string {
  return url
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .replace(/\/+$/, "");
}

export function sanitizeWebDavRemoteRoot(remoteRoot: string): string {
  const normalized = remoteRoot
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
  return normalized;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const TRANSFER_TIMEOUT_MS = 300_000;

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

function summarizeStatus(status: number, statusText: string): string {
  return [status, statusText.trim()].filter(Boolean).join(" ");
}

function createHttpWebDavError(
  status: number,
  statusText: string,
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
  const connectionMessage = i18n.t(
    "settings.syncWebdavNetworkError",
    {
      defaultValue: "无法连接到 WebDAV 服务器，请检查网络、地址、端口或证书配置。",
    },
  );

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

  constructor(url: string, username: string, password: string, allowInsecure?: boolean) {
    // Normalize: remove control chars/whitespace and trailing slash
    this.baseUrl = sanitizeWebDavUrl(url);
    // Basic auth header
    const credentials = `${username}:${password}`;
    // Use UTF-8 safe base64 encoding; btoa is unreliable in React Native/Android.
    const encoded = Buffer.from(credentials, "utf8").toString("base64");
    this.authHeader = `Basic ${encoded}`;
    console.log("[WebDAV] auth debug", {
      username,
      passwordLength: password.length,
      encodedPreview:
        encoded.length > 24 ? `${encoded.slice(0, 12)}...${encoded.slice(-8)}` : encoded,
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
    const platform = getPlatformService();
    const url = this.buildUrl(path);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      ...options.headers,
    };
    if (options.contentType) {
      headers["Content-Type"] = options.contentType;
    }

    console.log(`[WebDAV] ${method} ${url}`);
    const startTime = Date.now();

    try {
      const effectiveTimeoutMs = this.getTimeout(method, options.timeoutMs);
      const response = await platform.fetch(url, {
        method,
        headers,
        body: options.body as BodyInit | undefined,
        allowInsecure: this.allowInsecure,
        timeoutMs: effectiveTimeoutMs,
        responseType: options.responseType,
      });
      const elapsed = Date.now() - startTime;
      console.log(
        `[WebDAV] ${method} ${url} completed in ${elapsed}ms (status: ${response.status})`,
      );
      return response;
    } catch (error: unknown) {
      const elapsed = Date.now() - startTime;
      const webDavError = createRequestWebDavError(
        error,
        method,
        url,
        this.getTimeout(method, options.timeoutMs),
      );
      console.error(
        `[WebDAV] ${method} ${url} failed (${webDavError.kind}) after ${elapsed}ms:`,
        error,
      );
      throw webDavError;
    }
  }

  /** Test if the server is reachable and credentials are valid */
  async ping(): Promise<void> {
    const resp = await this.request("PROPFIND", "/", {
      headers: { Depth: "0" },
      body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',
      contentType: "application/xml",
      timeoutMs: 10_000,
    });
    if (resp.ok || resp.status === 207) {
      return;
    }
    throw createHttpWebDavError(resp.status, resp.statusText, "PROPFIND", this.buildUrl("/"));
  }

  /** Test connection, returns true if successful */
  async testConnection(): Promise<boolean> {
    await this.ping();
    return true;
  }

  /** Create a directory (MKCOL) */
  async mkcol(path: string): Promise<void> {
    const resp = await this.request("MKCOL", path);
    const status = resp.status;
    if (resp.ok || status === 201) {
      return;
    }
    if (status === 405 || status === 409) {
      return;
    }
    throw new Error(`WebDAV MKCOL failed for ${path}: ${status} ${resp.statusText}`);
  }

  /** Ensure a full directory path exists (creates each segment) */
  async ensureDirectory(path: string): Promise<void> {
    const segments = path.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current += `/${segment}`;
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
      throw new Error(`WebDAV PUT failed for ${path}: ${resp.status} ${resp.statusText}`);
    }
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
      throw new Error(`WebDAV GET failed for ${path}: ${resp.status} ${resp.statusText}`);
    }
    const buffer = await resp.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /** Download text content from a path (GET) */
  async getText(path: string): Promise<string> {
    const resp = await this.request("GET", path, {
      responseType: "text",
    });
    if (!resp.ok) {
      throw new Error(`WebDAV GET failed for ${path}: ${resp.status} ${resp.statusText}`);
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
      throw new Error(`WebDAV DELETE failed for ${path}: ${resp.status} ${resp.statusText}`);
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
  private async propfindExists(path: string): Promise<boolean> {
    try {
      const resp = await this.request("PROPFIND", path, {
        headers: { Depth: "0" },
        body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',
        contentType: "application/xml",
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
      throw new Error(`WebDAV PROPFIND failed for ${path}: ${resp.status} ${resp.statusText}`);
    }
    const xml = await resp.text();
    return parsePropfindResponse(xml, path);
  }

  /** Safely list directory, create if not exists */
  async safeReadDir(path: string): Promise<DavResource[]> {
    try {
      return await this.propfind(path);
    } catch (e: unknown) {
      const err = e as { message?: string };
      if (err.message?.includes("404")) {
        await this.ensureDirectory(path);
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
function parsePropfindResponse(xml: string, basePath: string): DavResource[] {
  const resources: DavResource[] = [];

  // Split by <D:response> or <d:response> boundaries (case-insensitive)
  const responseRegex = /<(?:D|d):response[^>]*>([\s\S]*?)<\/(?:D|d):response>/gi;
  let match: RegExpExecArray | null;
  while ((match = responseRegex.exec(xml)) !== null) {
    const block = match[1];

    const href = extractTagContent(block, "href") || "";
    const isCollection =
      block.includes("<D:collection") ||
      block.includes("<d:collection") ||
      block.includes("<D:collection/") ||
      block.includes("<d:collection/");
    const contentLengthStr = extractTagContent(block, "getcontentlength");
    const lastModified = extractTagContent(block, "getlastmodified");
    const etag = extractTagContent(block, "getetag")?.replace(/"/g, "");

    resources.push({
      href: decodeURIComponent(href),
      name: filenameFromHref(href),
      isCollection,
      contentLength: contentLengthStr ? Number.parseInt(contentLengthStr, 10) : undefined,
      lastModified: lastModified || undefined,
      etag: etag || undefined,
    });
  }

  // Filter out the parent directory itself (first result is usually the queried path)
  const baseNormalized = basePath.replace(/\/+$/, "").replace(/^\/+/, "");
  return resources.filter((r) => {
    const hrefNormalized = r.href.replace(/\/+$/, "").replace(/^\/+/, "");
    return hrefNormalized !== baseNormalized;
  });
}

/** Extract text content of an XML tag (case-insensitive, supports D: and d: namespace prefix) */
function extractTagContent(xml: string, localName: string): string | null {
  const regex = new RegExp(`<(?:D|d):${localName}[^>]*>([^<]*)<\\/(?:D|d):${localName}>`, "i");
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

/** Extract filename from a WebDAV href */
function filenameFromHref(href: string): string {
  const decoded = decodeURIComponent(href);
  return decoded.replace(/\/+$/, "").split("/").pop() || "";
}
