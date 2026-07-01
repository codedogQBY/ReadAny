/**
 * BrowserPreviewPlatformService — lightweight desktop-shell preview runtime.
 *
 * The production desktop app runs inside Tauri. When the Vite dev server is
 * opened directly in a normal browser there is no Tauri IPC bridge, so Tauri
 * plugins reject with `invoke` errors before UI smoke checks can even start.
 * This service keeps that preview mode quiet and intentionally non-persistent.
 */
import type {
  FetchOptions,
  FilePickerOptions,
  IDatabase,
  IPlatformService,
  IWebSocket,
  PickedFile,
  UpdateInfo,
  WebSocketOptions,
} from "@readany/core/services";

const PREVIEW_ROOT = "/readany-browser-preview";
const FILE_PREFIX = "readany-preview-file:";

class BrowserPreviewDatabase implements IDatabase {
  async execute(_sql: string, _params?: unknown[]): Promise<void> {}

  async select<T>(sql: string, _params?: unknown[]): Promise<T[]> {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.includes("max(version) as max_version")) {
      return [{ max_version: 0 }] as T[];
    }
    if (normalized.includes("max(sync_version) as max_v")) {
      return [{ max_v: 0 }] as T[];
    }
    if (normalized.includes("select value from sync_metadata")) {
      const value = localStorage.getItem("sync_device_id");
      return value ? ([{ value }] as T[]) : [];
    }

    return [];
  }

  async close(): Promise<void> {}
}

class BrowserPreviewWebSocket implements IWebSocket {
  private readonly socket: WebSocket;

  constructor(url: string, _options?: WebSocketOptions) {
    this.socket = new WebSocket(url);
  }

  send(data: string | ArrayBuffer): void {
    this.socket.send(data);
  }

  close(): void {
    this.socket.close();
  }

  onMessage(handler: (data: string | ArrayBuffer) => void): void {
    this.socket.addEventListener("message", (event) => handler(event.data));
  }

  onClose(handler: () => void): void {
    this.socket.addEventListener("close", () => handler());
  }

  onError(handler: (error: unknown) => void): void {
    this.socket.addEventListener("error", (event) => handler(event));
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function joinPreviewPath(...parts: string[]): string {
  const joined = parts
    .filter(Boolean)
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function getStoredFile(path: string): string | null {
  return localStorage.getItem(`${FILE_PREFIX}${normalizePath(path)}`);
}

function setStoredFile(path: string, content: string): void {
  localStorage.setItem(`${FILE_PREFIX}${normalizePath(path)}`, content);
}

function removeStoredFile(path: string): void {
  localStorage.removeItem(`${FILE_PREFIX}${normalizePath(path)}`);
}

export class BrowserPreviewPlatformService implements IPlatformService {
  readonly platformType = "desktop" as const;
  readonly isMobile = false;
  readonly isDesktop = true;

  async getLocale(): Promise<string> {
    return navigator.language || "en-US";
  }

  async readFile(path: string): Promise<Uint8Array> {
    const content = getStoredFile(path);
    if (content == null) {
      throw new Error(`Preview file not found: ${path}`);
    }
    return new TextEncoder().encode(content);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    setStoredFile(path, new TextDecoder().decode(data));
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    setStoredFile(path, content);
  }

  async readTextFile(path: string): Promise<string> {
    const content = getStoredFile(path);
    if (content == null) {
      throw new Error(`Preview file not found: ${path}`);
    }
    return content;
  }

  async mkdir(_path: string): Promise<void> {}

  async exists(path: string): Promise<boolean> {
    return getStoredFile(path) != null;
  }

  async deleteFile(path: string): Promise<void> {
    removeStoredFile(path);
  }

  async getAppDataDir(): Promise<string> {
    return PREVIEW_ROOT;
  }

  async getDataDir(): Promise<string> {
    return PREVIEW_ROOT;
  }

  async joinPath(...parts: string[]): Promise<string> {
    return joinPreviewPath(...parts);
  }

  convertFileSrc(path: string): string {
    return path;
  }

  async pickFile(_options?: FilePickerOptions): Promise<string | string[] | null> {
    return null;
  }

  async pickFiles(_options?: FilePickerOptions): Promise<PickedFile[] | null> {
    return null;
  }

  async loadDatabase(_path: string): Promise<IDatabase> {
    return new BrowserPreviewDatabase();
  }

  async fetch(url: string, options?: FetchOptions): Promise<Response> {
    const { allowInsecure: _allowInsecure, timeoutMs, responseType: _responseType, ...init } =
      options ?? {};
    if (!timeoutMs) {
      return globalThis.fetch(url, init);
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await globalThis.fetch(url, { ...init, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async createWebSocket(url: string, options?: WebSocketOptions): Promise<IWebSocket> {
    return new BrowserPreviewWebSocket(url, options);
  }

  async getAppVersion(): Promise<string> {
    return "dev-preview";
  }

  async checkUpdate(): Promise<UpdateInfo | null> {
    return null;
  }

  async installUpdate(): Promise<void> {}

  async kvGetItem(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }

  async kvSetItem(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  async kvRemoveItem(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  async kvGetAllKeys(): Promise<string[]> {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }
    return keys;
  }

  async copyToClipboard(content: string): Promise<void> {
    await navigator.clipboard.writeText(content);
  }

  async shareOrDownloadFile(
    content: string,
    filename: string,
    mimeType: string,
  ): Promise<string | null> {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      return filename;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async openExternalUrl(url: string): Promise<void> {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async isOnWifi(): Promise<boolean> {
    return true;
  }

  async getLocalIP(): Promise<string> {
    return "";
  }

  async startLANServer(): Promise<{ port: number; server: unknown }> {
    throw new Error("LAN sync server is only available in the Tauri desktop app.");
  }

  async stopLANServer(_server: unknown): Promise<void> {}
}
