/**
 * IPlatformService — Platform abstraction layer
 *
 * Each platform (desktop, mobile, web) provides its own implementation.
 * Core business logic depends only on this interface, never on Tauri APIs directly.
 */

export interface FilePickerOptions {
  multiple?: boolean;
  filters?: Array<{
    name: string;
    extensions: string[];
  }>;
}

export interface PickedFile {
  path: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

export interface WebSocketOptions {
  headers?: Record<string, string>;
}

/** Extended fetch options with insecure certificate support */
export interface FetchOptions extends RequestInit {
  /** When true, skip TLS certificate verification (for self-signed certs) */
  allowInsecure?: boolean;
  /** Optional request timeout in milliseconds */
  timeoutMs?: number;
  /** Preferred response type for platforms that support native request tuning */
  responseType?: "text" | "arraybuffer";
  /** Download progress callback — receives loaded bytes and total (0 if unknown) */
  onDownloadProgress?: (loaded: number, total: number) => void;
}

export interface FileTransferOptions {
  headers?: Record<string, string>;
  allowInsecure?: boolean;
  onProgress?: (loaded: number, total: number) => void;
}

export interface UpdateInfo {
  version: string;
  notes?: string;
  date?: string;
  downloadUrl?: string;
}

export interface IDatabase {
  execute(sql: string, params?: unknown[]): Promise<void>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface IWebSocket {
  send(data: string | ArrayBuffer): void;
  close(): void;
  onMessage(handler: (data: string | ArrayBuffer) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (error: unknown) => void): void;
}

export interface IPlatformService {
  // ---- Platform info ----
  readonly platformType: "desktop" | "mobile" | "web";
  readonly isMobile: boolean;
  readonly isDesktop: boolean;

  // ---- Language / Locale ----
  // Returns the system locale, e.g. "en-US", "zh-CN", "ja-JP"
  getLocale?(): Promise<string>;

  // ---- File system ----
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  deleteFile(path: string): Promise<void>;
  /** System app data dir — used only for bootstrap config (e.g. locating desktop-data-root.json). NOT for user data. */
  getAppDataDir(): Promise<string>;
  /** User data root — the directory where user-facing data (fonts, store JSON, etc.) should be stored.
   *  On desktop: honours the user-configured library root (falls back to getAppDataDir()).
   *  On mobile/web: same as getAppDataDir(). */
  getDataDir(): Promise<string>;
  joinPath(...parts: string[]): Promise<string>;
  convertFileSrc(path: string): string;

  // ---- File picker ----
  pickFile(options?: FilePickerOptions): Promise<string | string[] | null>;
  /** Rich file picker result for UI surfaces that need stable display names. */
  pickFiles?(options?: FilePickerOptions): Promise<PickedFile[] | null>;

  // ---- Database ----
  loadDatabase(path: string): Promise<IDatabase>;

  // ---- Network (for scenarios requiring custom headers) ----
  fetch(url: string, options?: FetchOptions): Promise<Response>;
  downloadFile?(url: string, filePath: string, options?: FileTransferOptions): Promise<void>;
  uploadFile?(url: string, filePath: string, options?: FileTransferOptions): Promise<void>;
  createWebSocket(url: string, options?: WebSocketOptions): Promise<IWebSocket>;

  // ---- App info ----
  getAppVersion(): Promise<string>;

  // ---- Update (desktop only, mobile returns noop) ----
  checkUpdate?(): Promise<UpdateInfo | null>;
  installUpdate?(): Promise<void>;

  // ---- KV Storage (cross-platform key-value persistence) ----
  // Web: localStorage, RN: AsyncStorage / expo-secure-store
  kvGetItem(key: string): Promise<string | null>;
  kvSetItem(key: string, value: string): Promise<void>;
  kvRemoveItem(key: string): Promise<void>;
  kvGetAllKeys(): Promise<string[]>;

  // ---- Clipboard ----
  // Web: navigator.clipboard, RN: expo-clipboard
  copyToClipboard(content: string): Promise<void>;

  // ---- File sharing / download ----
  // Desktop: system save dialog, RN: expo-file-system + expo-sharing
  // Returns saved path if successful, null if cancelled.
  shareOrDownloadFile(content: string, filename: string, mimeType: string): Promise<string | null>;
  /** Open an external URL or custom protocol URI, such as https:// or obsidian://. */
  openExternalUrl?(url: string): Promise<void>;

  // ---- LAN Sync ----
  // Check if device is on WiFi (returns true on desktop)
  isOnWifi?(): Promise<boolean>;
  // Get local IP address for LAN sync
  getLocalIP?(): Promise<string>;
  // Start a local HTTP server for LAN sync
  startLANServer?(
    port: number,
    handler: (
      method: string,
      path: string,
      headers: Record<string, string>,
    ) => Promise<{ status: number; body?: Uint8Array; headers?: Record<string, string> }>,
  ): Promise<{ port: number; server: unknown }>;
  // Stop the local HTTP server
  stopLANServer?(server: unknown): Promise<void>;
}

/**
 * Global platform service holder.
 * Must be initialized once at app startup via `setPlatformService()`.
 */
let _platformService: IPlatformService | null = null;
let _resolveReady: ((service: IPlatformService) => void) | null = null;
const _readyPromise = new Promise<IPlatformService>((resolve) => {
  _resolveReady = resolve;
});

export function setPlatformService(service: IPlatformService): void {
  _platformService = service;
  _resolveReady?.(service);
}

export function getPlatformService(): IPlatformService {
  if (!_platformService) {
    throw new Error("PlatformService not initialized. Call setPlatformService() at app startup.");
  }
  return _platformService;
}

/**
 * Wait for platform service to be registered.
 * Useful for code that runs during module initialization (before setPlatformService).
 */
export function waitForPlatformService(): Promise<IPlatformService> {
  if (_platformService) return Promise.resolve(_platformService);
  return _readyPromise;
}
