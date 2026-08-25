/**
 * TauriPlatformService — IPlatformService implementation for Tauri v2 desktop.
 *
 * Wraps @tauri-apps/plugin-fs, @tauri-apps/plugin-sql, @tauri-apps/plugin-dialog,
 * @tauri-apps/api, and @tauri-apps/plugin-updater behind the core platform interface.
 *
 * All Tauri imports are dynamic so the module graph stays clean in SSR/test contexts.
 */
import type {
  FetchOptions,
  FilePickerOptions,
  IDatabase,
  IPlatformService,
  IWebSocket,
  UpdateInfo,
  WebSocketOptions,
} from "@readany/core/services";
import type { ClientOptions } from "@tauri-apps/plugin-http";

const TAURI_LAN_RUNTIME_ERROR =
  "Tauri desktop runtime is required to use the LAN sender. Open the desktop app instead of the browser dev server.";

function isTauriRuntimeAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function ensureTauriRuntimeForLAN(): void {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(TAURI_LAN_RUNTIME_ERROR);
  }
}

/** Adapter: wraps Tauri SQL plugin instance as IDatabase */
function isClosedPoolError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("closed pool") || message.includes("attempted to acquire a connection");
}

/** Adapter: wraps Tauri SQL plugin instance as IDatabase */
function wrapTauriDatabase(tauriDb: any, normalizedPath: string): IDatabase {
  let currentDb = tauriDb;
  let reopenPromise: Promise<void> | null = null;

  const reopenIfNeeded = async (): Promise<void> => {
    if (!reopenPromise) {
      reopenPromise = (async () => {
        const Database = (await import("@tauri-apps/plugin-sql")).default;
        currentDb = await Database.load(normalizedPath);
      })().finally(() => {
        reopenPromise = null;
      });
    }

    await reopenPromise;
  };

  const withRecovery = async <T>(operation: (db: any) => Promise<T>): Promise<T> => {
    try {
      return await operation(currentDb);
    } catch (error) {
      if (!isClosedPoolError(error)) {
        throw error;
      }

      console.warn(`[TauriPlatformService] Reopening closed SQL pool for ${normalizedPath}`);
      await reopenIfNeeded();
      return operation(currentDb);
    }
  };

  return {
    execute: (sql: string, params?: unknown[]) =>
      withRecovery((db) => db.execute(sql, params ?? [])),
    select: <T>(sql: string, params?: unknown[]): Promise<T[]> =>
      withRecovery((db) => db.select(sql, params ?? [])),
    close: () => currentDb.close(),
  };
}

export class TauriPlatformService implements IPlatformService {
  readonly platformType = "desktop" as const;
  readonly isMobile = false;
  readonly isDesktop = true;

  // ---- File system ----

  async readFile(path: string): Promise<Uint8Array> {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    return readFile(path);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(path, data);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, content);
  }

  async readTextFile(path: string): Promise<string> {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    return readTextFile(path);
  }

  async mkdir(path: string): Promise<void> {
    const { mkdir } = await import("@tauri-apps/plugin-fs");
    await mkdir(path, { recursive: true });
  }

  async exists(path: string): Promise<boolean> {
    const { exists } = await import("@tauri-apps/plugin-fs");
    return exists(path);
  }

  async deleteFile(path: string): Promise<void> {
    const { remove } = await import("@tauri-apps/plugin-fs");
    await remove(path);
  }

  async getAppDataDir(): Promise<string> {
    const { appDataDir } = await import("@tauri-apps/api/path");
    return appDataDir();
  }

  async getDataDir(): Promise<string> {
    // Desktop: user-configurable library root (defaults to appDataDir if not customised)
    const { getDesktopLibraryRoot } = await import("@/lib/storage/desktop-library-root");
    return getDesktopLibraryRoot();
  }

  async joinPath(...parts: string[]): Promise<string> {
    const { join } = await import("@tauri-apps/api/path");
    return join(...parts);
  }

  convertFileSrc(path: string): string {
    // Dynamic import can't be used for a synchronous method.
    // Use the Tauri core `convertFileSrc` which is lightweight and can be
    // eagerly imported since this file is only loaded in Tauri context.
    // We lazy-cache it on first call.
    if (!this._convertFileSrc) {
      throw new Error("convertFileSrc not ready. Call initSync() first or use the async version.");
    }
    return this._convertFileSrc(path);
  }

  private _convertFileSrc: ((path: string) => string) | null = null;

  /** Must be called once after construction to initialize sync utilities. */
  async initSync(): Promise<void> {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    this._convertFileSrc = convertFileSrc;
  }

  // ---- Language / Locale ----

  async getLocale(): Promise<string> {
    // Use browser's navigator.language API (works in Tauri webview)
    return navigator.language || "en-US";
  }

  // ---- File picker ----

  async pickFile(options?: FilePickerOptions): Promise<string | string[] | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({
      multiple: options?.multiple ?? false,
      filters: options?.filters,
    });
    if (Array.isArray(result)) return result.length > 0 ? result : null;
    return result;
  }

  // ---- Database ----

  async loadDatabase(path: string): Promise<IDatabase> {
    const Database = (await import("@tauri-apps/plugin-sql")).default;
    const normalizedPath = path.startsWith("sqlite:")
      ? path
      : `sqlite:${path.replace(/^file:\/\//, "")}`;
    const tauriDb = await Database.load(normalizedPath);
    return wrapTauriDatabase(tauriDb, normalizedPath);
  }

  // ---- Network ----

  async fetch(url: string, options?: FetchOptions): Promise<Response> {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    const {
      allowInsecure,
      timeoutMs: _timeoutMs,
      responseType: _responseType,
      onDownloadProgress: _onDownloadProgress,
      redirect,
      ...fetchOptions
    } = options ?? {};
    const browserOptions = redirect ? { ...fetchOptions, redirect } : fetchOptions;
    const tauriOptions: RequestInit & ClientOptions = {
      ...fetchOptions,
      ...(redirect === "manual" ? { maxRedirections: 0 } : {}),
      ...(allowInsecure
        ? { danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } }
        : {}),
    };
    try {
      return await tauriFetch(url, tauriOptions);
    } catch (error: unknown) {
      // Tauri's fetch (Chromium-based) rejects when the server sends response
      // headers containing characters outside the ISO-8859-1 range (e.g.
      // Chinese filenames in Content-Disposition from WebDAV servers like dufs).
      // Fall back to the browser's native fetch which is more lenient, aligning
      // behaviour with the mobile (XHR) implementation.
      const msg = (error as { message?: string })?.message ?? "";
      if (
        msg.includes("ISO-8859-1") ||
        msg.includes("non ISO") ||
        msg.includes("Failed to construct 'Headers'")
      ) {
        console.warn(
          "[TauriPlatform] tauriFetch failed due to non-ASCII response headers; falling back to native fetch",
        );
        return globalThis.fetch(url, browserOptions);
      }
      throw error;
    }
  }

  async createWebSocket(url: string, options?: WebSocketOptions): Promise<IWebSocket> {
    const WebSocket = (await import("@tauri-apps/plugin-websocket")).default;
    const ws = await WebSocket.connect(url, {
      headers: options?.headers,
    });

    return {
      send: (data: string | ArrayBuffer) => {
        if (typeof data === "string") {
          ws.send(data);
        } else {
          ws.send(Array.from(new Uint8Array(data)));
        }
      },
      close: () => ws.disconnect(),
      onMessage: (handler) => {
        ws.addListener((msg) => {
          if (typeof msg === "string") handler(msg);
          else if (msg && typeof msg === "object" && "data" in msg) {
            handler((msg as any).data);
          }
        });
      },
      onClose: (handler) => {
        // Tauri WS plugin sends CloseFrame as a message type
        ws.addListener((msg) => {
          if (msg && typeof msg === "object" && "type" in msg && (msg as any).type === "Close") {
            handler();
          }
        });
      },
      onError: (handler) => {
        // Tauri WS errors surface in the promise chain; limited listener support
        ws.addListener((msg) => {
          if (msg && typeof msg === "object" && "type" in msg && (msg as any).type === "Error") {
            handler((msg as any).data);
          }
        });
      },
    };
  }

  // ---- App info ----

  async getAppVersion(): Promise<string> {
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  }

  // ---- Update ----

  async checkUpdate(): Promise<UpdateInfo | null> {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body || undefined,
      date: update.date || undefined,
    };
  }

  async installUpdate(): Promise<void> {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    }
  }

  // ---- Secret Storage (OS credential store via Tauri commands) ----

  async secretGetItem(key: string): Promise<string | null> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("secret_get", { key });
  }

  async secretSetItem(key: string, value: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("secret_set", { key, value });
  }

  async secretRemoveItem(key: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("secret_remove", { key });
  }

  // ---- KV Storage (backed by localStorage on desktop/web) ----

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

  // ---- Clipboard ----

  async copyToClipboard(content: string): Promise<void> {
    await navigator.clipboard.writeText(content);
  }

  // ---- File sharing / download ----

  async shareOrDownloadFile(
    content: string,
    filename: string,
    _mimeType: string,
  ): Promise<string | null> {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const ext = filename.split(".").pop() || "";
    const filePath = await save({
      defaultPath: filename,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    });
    if (!filePath) return null;

    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(filePath, content);
    return filePath;
  }

  // ---- LAN Sync ----

  async isOnWifi(): Promise<boolean> {
    // Desktop is always considered "on WiFi"
    return true;
  }

  async getLocalIP(): Promise<string> {
    ensureTauriRuntimeForLAN();

    // Try Rust-side detection first (most reliable)
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const ip = await invoke<string>("get_local_ip");
      if (ip) return ip;
    } catch (err) {
      console.warn("[Platform] Rust get_local_ip failed, falling back to WebRTC:", err);
    }

    // Try WebRTC approach
    const webrtcIP = await this.getLocalIPViaWebRTC();
    if (webrtcIP) return webrtcIP;

    // Fallback: no IP found
    return "";
  }

  private async getLocalIPViaWebRTC(): Promise<string> {
    return new Promise((resolve) => {
      let resolved = false;
      const pc = new RTCPeerConnection({
        iceServers: [],
      });

      pc.createDataChannel("");

      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => {
          if (!resolved) {
            resolved = true;
            resolve("");
          }
        });

      pc.onicecandidate = (event) => {
        if (!event?.candidate || resolved) return;

        const candidate = event.candidate.candidate;
        const ipMatch = candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (ipMatch) {
          const ip = ipMatch[1];
          // Check for private IP ranges
          if (
            ip.startsWith("192.168.") ||
            ip.startsWith("10.") ||
            ip.startsWith("172.16.") ||
            ip.startsWith("172.17.") ||
            ip.startsWith("172.18.") ||
            ip.startsWith("172.19.") ||
            ip.startsWith("172.20.") ||
            ip.startsWith("172.21.") ||
            ip.startsWith("172.22.") ||
            ip.startsWith("172.23.") ||
            ip.startsWith("172.24.") ||
            ip.startsWith("172.25.") ||
            ip.startsWith("172.26.") ||
            ip.startsWith("172.27.") ||
            ip.startsWith("172.28.") ||
            ip.startsWith("172.29.") ||
            ip.startsWith("172.30.") ||
            ip.startsWith("172.31.")
          ) {
            resolved = true;
            pc.close();
            resolve(ip);
          }
        }
      };

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete" && !resolved) {
          resolved = true;
          pc.close();
          resolve("");
        }
      };

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          pc.close();
          resolve("");
        }
      }, 5000);
    });
  }

  async startLANServer(
    port: number,
    handler: (
      method: string,
      path: string,
      headers: Record<string, string>,
    ) => Promise<{ status: number; body?: Uint8Array; headers?: Record<string, string> }>,
  ): Promise<{ port: number; server: unknown }> {
    ensureTauriRuntimeForLAN();

    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");

    const boundPort = await invoke<number>("start_lan_server", { port });

    // Listen for HTTP requests coming from the Rust Axum server
    const unlisten = await listen<any>("lan-request", async (event) => {
      const { req_id, method, path, headers } = event.payload;
      try {
        const response = await handler(method, path, headers);

        // encode body to base64
        let resBodyBase64: string | null = null;
        if (response.body) {
          resBodyBase64 = this.arrayBufferToBase64(response.body);
        }

        await invoke("lan_server_respond", {
          reqId: req_id,
          payload: {
            status: response.status,
            headers: response.headers || {},
            body_base64: resBodyBase64,
          },
        });
      } catch (e) {
        console.error("LAN Sync Handler Error:", e);
        await invoke("lan_server_respond", {
          reqId: req_id,
          payload: { status: 500, headers: {}, body_base64: null },
        });
      }
    });

    return { port: boundPort, server: unlisten };
  }

  async stopLANServer(server: unknown): Promise<void> {
    ensureTauriRuntimeForLAN();

    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_lan_server");
    if (typeof server === "function") {
      server(); // call unlisten
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
