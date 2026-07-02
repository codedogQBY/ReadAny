import i18n from "@readany/core/i18n";
/**
 * ExpoPlatformService — IPlatformService implementation for Expo / React Native.
 *
 * Uses Expo SDK 55+ modules:
 * - expo-file-system (new File/Directory/Paths API) for FS operations
 * - expo-sqlite for database
 * - expo-secure-store for KV storage
 * - expo-clipboard for clipboard
 * - expo-sharing + expo-file-system for file sharing
 * - expo-constants for app version
 */
import type {
  FetchOptions,
  FilePickerOptions,
  FileTransferOptions,
  IDatabase,
  IPlatformService,
  IWebSocket,
  WebSocketOptions,
} from "@readany/core/services";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as LegacyFS from "expo-file-system/legacy";
import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";
import * as Sharing from "expo-sharing";

/** Simple KV storage keys tracking (SecureStore doesn't have getAllKeys) */
const KV_KEYS_INDEX = "__readany_kv_keys__";
const SQLITE_OPERATION_QUEUES = new Map<string, Promise<void>>();

export class ExpoPlatformService implements IPlatformService {
  readonly platformType = "mobile" as const;
  readonly isMobile = true;
  readonly isDesktop = false;

  // ---- File system (expo-file-system v55 — File/Directory/Paths API) ----

  async readFile(path: string): Promise<Uint8Array> {
    try {
      const file = new File(path);
      return await file.bytes();
    } catch (err) {
      if (!path.startsWith("content://")) throw err;
      const base64 = await LegacyFS.readAsStringAsync(path, {
        encoding: LegacyFS.EncodingType.Base64,
      });
      return base64ToBytes(base64);
    }
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const file = new File(path);
    file.write(data);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const file = new File(path);
    file.write(content);
  }

  async readTextFile(path: string): Promise<string> {
    const file = new File(path);
    return file.text();
  }

  async mkdir(path: string): Promise<void> {
    const dir = new Directory(path);
    if (!dir.exists) {
      dir.create({ intermediates: true });
    }
  }

  async exists(path: string): Promise<boolean> {
    const info = Paths.info(path);
    return info.exists;
  }

  async deleteFile(path: string): Promise<void> {
    const file = new File(path);
    if (file.exists) {
      file.delete();
    }
  }

  async getAppDataDir(): Promise<string> {
    return Paths.document.uri;
  }

  async getDataDir(): Promise<string> {
    return Paths.document.uri;
  }

  async joinPath(...parts: string[]): Promise<string> {
    const joined = parts.join("/");
    // Preserve file:// protocol prefix while collapsing duplicate slashes in path
    const match = joined.match(/^(file:\/\/)(\/.*)/);
    if (match) {
      return match[1] + match[2].replace(/\/+/g, "/");
    }
    return joined.replace(/\/+/g, "/");
  }

  convertFileSrc(path: string): string {
    // In RN, file:// URIs can be used directly by Image/WebView
    if (path.startsWith("file://")) return path;
    return `file://${path}`;
  }

  // ---- Language / Locale ----

  async getLocale(): Promise<string> {
    // Use React Native's I18nManager to get device locale
    const { I18nManager } = require("react-native");
    return I18nManager.localeIdentifier || "en_US";
  }

  // ---- File picker (expo-document-picker) ----

  async pickFile(options?: FilePickerOptions): Promise<string | string[] | null> {
    try {
      // Convert extension-based filters to MIME types for expo-document-picker
      const mimeTypes: string[] = [];
      if (options?.filters) {
        for (const filter of options.filters) {
          for (const ext of filter.extensions) {
            const mime = extensionToMime(ext);
            if (mime && !mimeTypes.includes(mime)) {
              mimeTypes.push(mime);
            }
          }
        }
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: mimeTypes.length > 0 ? mimeTypes : ["*/*"],
        multiple: options?.multiple ?? false,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return null;
      }

      if (options?.multiple) {
        return result.assets.map((a) => a.uri);
      }
      return result.assets[0].uri;
    } catch {
      return null;
    }
  }

  // ---- Database (expo-sqlite) ----

  async loadDatabase(path: string): Promise<IDatabase> {
    const SQLite = await import("expo-sqlite");
    const createQueuedAdapter = (
      queueKey: string,
      db: Awaited<ReturnType<typeof SQLite.openDatabaseAsync>>,
      closeImpl: () => Promise<void>,
    ): IDatabase => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const isRetryableSqliteError = (error: unknown): boolean => {
        const message = error instanceof Error ? error.message : String(error);
        return message.includes("database is locked") || message.includes("another row available");
      };
      const withSqliteRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
        const maxAttempts = 4;
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            return await operation();
          } catch (error) {
            lastError = error;
            if (!isRetryableSqliteError(error) || attempt === maxAttempts) {
              throw error;
            }
            await sleep(50 * attempt);
          }
        }

        throw lastError;
      };

      const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
        const currentQueue = SQLITE_OPERATION_QUEUES.get(queueKey) ?? Promise.resolve();
        const run = currentQueue.then(operation, operation);
        const settledRun = run.then(
          () => undefined,
          () => undefined,
        );
        SQLITE_OPERATION_QUEUES.set(queueKey, settledRun);
        return run.finally(() => {
          if (SQLITE_OPERATION_QUEUES.get(queueKey) === settledRun) {
            SQLITE_OPERATION_QUEUES.delete(queueKey);
          }
        });
      };

      return {
        async execute(sql: string, params?: unknown[]): Promise<void> {
          await enqueue(async () => {
            await withSqliteRetry(async () => {
              await db.runAsync(sql, ...((params as (string | number | null)[]) ?? []));
            });
          });
        },
        async select<T>(sql: string, params?: unknown[]): Promise<T[]> {
          return enqueue(async () => {
            const rows = await withSqliteRetry(async () =>
              db.getAllAsync(sql, ...((params as (string | number | null)[]) ?? [])),
            );
            return rows as T[];
          });
        },
        async close(): Promise<void> {
          await enqueue(closeImpl);
        },
      };
    };
    const normalizedPath = path.replace("sqlite:", "");
    const queueKey = `sqlite:${normalizedPath}`;
    const isExternalPath =
      normalizedPath.includes("/") ||
      normalizedPath.includes("\\") ||
      normalizedPath.startsWith("file:");

    if (!isExternalPath) {
      const db = await SQLite.openDatabaseAsync(normalizedPath);
      return createQueuedAdapter(queueKey, db, async () => {
        await db.closeAsync();
      });
    }

    const sqliteDirPath = `${Paths.document.uri.replace(/\/$/, "")}/SQLite`;
    const sqliteDir = new Directory(sqliteDirPath);
    if (!sqliteDir.exists) {
      sqliteDir.create({ intermediates: true });
    }

    const tempDbName = `_external_${Date.now()}_${Math.random().toString(36).slice(2)}.db`;
    const tempDbPath = `${sqliteDirPath}/${tempDbName}`;
    const sourceFile = new File(path);
    const tempFile = new File(tempDbPath);

    if (tempFile.exists) {
      tempFile.delete();
    }
    sourceFile.copy(tempFile);

    let db: Awaited<ReturnType<typeof SQLite.openDatabaseAsync>>;
    try {
      db = await SQLite.openDatabaseAsync(tempDbName);
    } catch (error) {
      if (tempFile.exists) {
        tempFile.delete();
      }
      throw error;
    }

    return createQueuedAdapter(queueKey, db, async () => {
      try {
        await db.closeAsync();
      } finally {
        const destinationFile = new File(path);
        if (destinationFile.exists) {
          destinationFile.delete();
        }
        tempFile.copy(destinationFile);
        if (tempFile.exists) {
          tempFile.delete();
        }
      }
    });
  }

  // ---- Network ----

  async fetch(url: string, options?: FetchOptions): Promise<Response> {
    const { allowInsecure, timeoutMs, responseType, onDownloadProgress, ...fetchOptions } =
      options ?? {};
    const effectiveUrl = allowInsecure ? url.replace(/^https:\/\//i, "http://") : url;
    const method = fetchOptions?.method?.toUpperCase() || "GET";

    // Always use XHR for WebDAV to handle large binary files properly
    // React Native's fetch has issues with large arrayBuffer responses
    const resolvedResponseType = responseType ?? (method === "GET" ? "arraybuffer" : "text");
    const effectiveTimeoutMs = timeoutMs ?? (method === "GET" ? 120000 : 15000);
    return this._fetchWithXHR(
      effectiveUrl,
      fetchOptions,
      resolvedResponseType,
      effectiveTimeoutMs,
      onDownloadProgress,
    );
  }

  async downloadFile(url: string, filePath: string, options?: FileTransferOptions): Promise<void> {
    const effectiveUrl = options?.allowInsecure ? url.replace(/^https:\/\//i, "http://") : url;
    const task = LegacyFS.createDownloadResumable(
      effectiveUrl,
      filePath,
      {
        headers: options?.headers,
        sessionType: LegacyFS.FileSystemSessionType.FOREGROUND,
      },
      (progress) => {
        options?.onProgress?.(
          progress.totalBytesWritten,
          progress.totalBytesExpectedToWrite > 0 ? progress.totalBytesExpectedToWrite : 0,
        );
      },
    );

    const result = await task.downloadAsync();
    if (!result) {
      throw new Error(`File download cancelled: ${effectiveUrl}`);
    }
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`File download failed: ${result.status}`);
    }
  }

  async uploadFile(url: string, filePath: string, options?: FileTransferOptions): Promise<void> {
    const effectiveUrl = options?.allowInsecure ? url.replace(/^https:\/\//i, "http://") : url;
    const task = LegacyFS.createUploadTask(
      effectiveUrl,
      filePath,
      {
        headers: options?.headers,
        httpMethod: "PUT",
        uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
        sessionType: LegacyFS.FileSystemSessionType.FOREGROUND,
      },
      (progress) => {
        options?.onProgress?.(progress.totalBytesSent, progress.totalBytesExpectedToSend);
      },
    );

    const result = await task.uploadAsync();
    if (!result) {
      throw new Error(`File upload cancelled: ${effectiveUrl}`);
    }
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`File upload failed: ${result.status}`);
    }
  }

  private _fetchWithXHR(
    url: string,
    options?: RequestInit,
    responseType: XMLHttpRequestResponseType = "arraybuffer",
    timeoutMs = 120000,
    onDownloadProgress?: (loaded: number, total: number) => void,
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const method = options?.method || "GET";
      let settled = false;
      let didTimeout = false;
      let didNetworkError = false;

      xhr.open(method, url, true);
      xhr.responseType = responseType;
      xhr.timeout = timeoutMs;

      // Download progress tracking
      if (onDownloadProgress) {
        xhr.onprogress = (event) => {
          onDownloadProgress(event.loaded, event.lengthComputable ? event.total : 0);
        };
      }

      // Set headers
      if (options?.headers) {
        const headers = options.headers as Record<string, string>;
        for (const [key, value] of Object.entries(headers)) {
          xhr.setRequestHeader(key, value);
        }
      }

      const finalizeResponse = () => {
        if (settled || xhr.readyState !== XMLHttpRequest.DONE) return;

        if (xhr.status === 0) {
          settled = true;
          if (didTimeout) {
            reject(new Error(`XHR request timeout (${timeoutMs}ms): ${method} ${url}`));
            return;
          }
          const suffix = didNetworkError ? " (network error)" : "";
          reject(new Error(`XHR request failed with status 0: ${method} ${url}${suffix}`));
          return;
        }

        settled = true;
        try {
          let textResponse = "";
          if (typeof xhr.response === "string") {
            textResponse = xhr.response;
          } else if (responseType !== "arraybuffer") {
            textResponse = typeof xhr.responseText === "string" ? xhr.responseText : "";
          }

          // Create a Response-like object
          const response = {
            status: xhr.status,
            statusText: xhr.statusText,
            ok: xhr.status >= 200 && xhr.status < 300,
            headers: new Headers(),
            text: async () => {
              if (responseType !== "arraybuffer") {
                return textResponse;
              }
              const buffer = xhr.response as ArrayBuffer;
              // Use chunked decoding for large buffers to avoid string length limits
              const CHUNK_SIZE = 65536; // 64KB chunks
              if (buffer.byteLength <= CHUNK_SIZE) {
                return new TextDecoder().decode(buffer);
              }
              const chunks: string[] = [];
              const decoder = new TextDecoder();
              let offset = 0;
              while (offset < buffer.byteLength) {
                const end = Math.min(offset + CHUNK_SIZE, buffer.byteLength);
                chunks.push(
                  decoder.decode(buffer.slice(offset, end), { stream: end < buffer.byteLength }),
                );
                offset = end;
              }
              return chunks.join("");
            },
            json: async () => {
              const text = await response.text();
              return JSON.parse(text);
            },
            arrayBuffer: async () => {
              if (responseType === "arraybuffer") {
                if (xhr.response instanceof ArrayBuffer) {
                  return xhr.response;
                }
                if (xhr.response instanceof Blob) {
                  return xhr.response.arrayBuffer();
                }
                throw new Error(
                  `Expected arraybuffer response for ${method} ${url}, got ${Object.prototype.toString.call(xhr.response)}`,
                );
              }
              return new TextEncoder().encode(textResponse).buffer;
            },
          } as Response;

          resolve(response);
        } catch (error) {
          reject(new Error(`Failed to process XHR response for ${method} ${url}: ${error}`));
        }
      };

      xhr.onreadystatechange = finalizeResponse;
      xhr.onload = finalizeResponse;
      xhr.onloadend = finalizeResponse;

      xhr.onerror = () => {
        if (settled) return;
        didNetworkError = true;
        settled = true;
        reject(new Error(`XHR request failed: ${method} ${url}`));
      };

      xhr.ontimeout = () => {
        if (settled) return;
        didTimeout = true;
        settled = true;
        reject(new Error(`XHR request timeout (${timeoutMs}ms): ${method} ${url}`));
      };

      // Send request
      if (options?.body) {
        if (typeof options.body === "string") {
          xhr.send(options.body);
        } else if (options.body instanceof ArrayBuffer) {
          xhr.send(options.body);
        } else if (options.body instanceof Uint8Array) {
          xhr.send(options.body);
        } else {
          xhr.send(options.body as any);
        }
      } else {
        xhr.send();
      }
    });
  }

  async createWebSocket(url: string, _options?: WebSocketOptions): Promise<IWebSocket> {
    const formatWebSocketError = (value: unknown): string => {
      if (value instanceof Error) return value.message;
      if (typeof value === "string") return value;
      if (value && typeof value === "object") {
        const maybeMessage =
          "message" in value && typeof (value as { message?: unknown }).message === "string"
            ? (value as { message: string }).message
            : null;
        if (maybeMessage) return maybeMessage;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }
      return String(value);
    };

    // RN WebSocket supports constructor headers via the third argument.
    // Edge TTS relies on Origin/User-Agent/Cookie, so we must pass them through.
    // We also wait for `open` so send() never races the handshake.
    const ReactNativeWebSocket = WebSocket as unknown as new (
      url: string,
      protocols?: string | string[] | null,
      options?: { headers?: Record<string, string> },
    ) => WebSocket;

    const ws = new ReactNativeWebSocket(url, undefined, {
      headers: _options?.headers ?? {},
    });
    ws.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let pendingErrorMessage = "";
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {}
        reject(new Error(`WebSocket connection timeout: ${url}`));
      }, 10000);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };

      ws.onerror = (err) => {
        if (settled) return;
        pendingErrorMessage = formatWebSocketError(err);
      };

      ws.onclose = (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const closeReason =
          event && typeof event === "object" && "reason" in event
            ? String((event as { reason?: unknown }).reason || "")
            : "";
        const detail = closeReason || pendingErrorMessage || formatWebSocketError(event);
        reject(new Error(`WebSocket closed before open: ${url} (${detail})`));
      };
    });

    return {
      send(data: string | ArrayBuffer) {
        if (ws.readyState !== WebSocket.OPEN) {
          throw new Error(`WebSocket is not open (readyState=${ws.readyState})`);
        }
        ws.send(data);
      },
      close() {
        ws.close();
      },
      onMessage(handler) {
        ws.onmessage = (evt) => handler(evt.data);
      },
      onClose(handler) {
        ws.onclose = () => handler();
      },
      onError(handler) {
        ws.onerror = (err) => handler(new Error(formatWebSocketError(err)));
      },
    };
  }

  // ---- App info ----

  async getAppVersion(): Promise<string> {
    return Constants.expoConfig?.version ?? "1.0.0";
  }

  // ---- Update (GitHub releases) ----

  async checkUpdate() {
    try {
      const response = await fetch(
        "https://api.github.com/repos/codedogQBY/ReadAny/releases/latest",
      );
      if (!response.ok) return null;

      const release = await response.json();
      const latestVersion = release.tag_name.replace(/^v/, "");
      const currentVersion = await this.getAppVersion();

      if (this._compareVersions(latestVersion, currentVersion) > 0) {
        const apkAsset = release.assets.find((a: { name: string }) => a.name === "ReadAny.apk");
        if (apkAsset) {
          return {
            version: latestVersion,
            notes: release.body || undefined,
            date: release.published_at || undefined,
            downloadUrl: apkAsset.browser_download_url,
          };
        }
      }
      return null;
    } catch (e) {
      console.error("[Updater] Check failed:", e);
      return null;
    }
  }

  async installUpdate(downloadUrl?: string) {
    if (!downloadUrl) return;
    const { Linking } = await import("react-native");
    await Linking.openURL(downloadUrl);
  }

  private _compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  // ---- KV Storage (backed by expo-secure-store) ----

  private async _getKeysIndex(): Promise<string[]> {
    try {
      const raw = await SecureStore.getItemAsync(KV_KEYS_INDEX);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private async _addKeyToIndex(key: string): Promise<void> {
    const keys = await this._getKeysIndex();
    if (!keys.includes(key)) {
      keys.push(key);
      await SecureStore.setItemAsync(KV_KEYS_INDEX, JSON.stringify(keys));
    }
  }

  private async _removeKeyFromIndex(key: string): Promise<void> {
    const keys = await this._getKeysIndex();
    const idx = keys.indexOf(key);
    if (idx !== -1) {
      keys.splice(idx, 1);
      await SecureStore.setItemAsync(KV_KEYS_INDEX, JSON.stringify(keys));
    }
  }

  async kvGetItem(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (e) {
      console.error(`[SecureStore] getItem failed for key "${key}":`, e);
      return null;
    }
  }

  async kvSetItem(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
      await this._addKeyToIndex(key);
      console.log(`[SecureStore] Saved key "${key}" successfully`);
    } catch (e) {
      console.error(`[SecureStore] setItem failed for key "${key}":`, e);
      throw e;
    }
  }

  async kvRemoveItem(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
      await this._removeKeyFromIndex(key);
    } catch (e) {
      console.error(`[SecureStore] deleteItem failed for key "${key}":`, e);
    }
  }

  async kvGetAllKeys(): Promise<string[]> {
    return this._getKeysIndex();
  }

  // ---- Clipboard ----

  async copyToClipboard(content: string): Promise<void> {
    await Clipboard.setStringAsync(content);
  }

  // ---- File sharing / download ----

  async shareOrDownloadFile(
    content: string,
    filename: string,
    mimeType: string,
  ): Promise<string | null> {
    const filepath = `${LegacyFS.documentDirectory}${filename}`;
    await LegacyFS.writeAsStringAsync(filepath, content);

    const available = await Sharing.isAvailableAsync();
    if (available) {
      await Sharing.shareAsync(filepath, { mimeType });
      return filepath;
    }
    console.warn("Sharing not available on this device");
    return null;
  }

  // ---- LAN Sync ----

  async isOnWifi(): Promise<boolean> {
    try {
      const state = await Network.getNetworkStateAsync();
      return state.type === Network.NetworkStateType.WIFI;
    } catch {
      return false;
    }
  }

  async getLocalIP(): Promise<string> {
    try {
      const ip = await Network.getIpAddressAsync();
      return ip ?? "";
    } catch {
      return "";
    }
  }

  async startLANServer(
    port: number,
    handler: (
      method: string,
      path: string,
      headers: Record<string, string>,
    ) => Promise<{ status: number; body?: Uint8Array; headers?: Record<string, string> }>,
  ): Promise<{ port: number; server: unknown }> {
    const isExpoGo =
      Constants.executionEnvironment === "storeClient" || Constants.appOwnership === "expo";
    if (isExpoGo) {
      throw new Error(i18n.t("settings.syncLANExpoGoUnsupported"));
    }

    let TcpSocket: any;
    let BufferMod: any;
    try {
      TcpSocket = (await import("react-native-tcp-socket")).default;
      BufferMod = (await import("buffer")).Buffer;
    } catch (e) {
      throw new Error(`Native TCP Socket unavailable: ${e instanceof Error ? e.message : e}`);
    }

    return new Promise((resolve, reject) => {
      const server = TcpSocket.createServer((socket: any) => {
        let buffer = "";

        socket.on("data", async (data: any) => {
          buffer += data.toString();

          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd !== -1) {
            const headerPart = buffer.slice(0, headerEnd);
            const lines = headerPart.split("\r\n");
            if (lines.length === 0) return;

            const [method, path] = lines[0].split(" ");

            const reqHeaders: Record<string, string> = {};
            for (let i = 1; i < lines.length; i++) {
              const line = lines[i];
              const colonPos = line.indexOf(":");
              if (colonPos !== -1) {
                const k = line.slice(0, colonPos).trim().toLowerCase();
                const v = line.slice(colonPos + 1).trim();
                reqHeaders[k] = v;
              }
            }

            buffer = ""; // clear buffer

            try {
              const response = await handler(method, path, reqHeaders);

              let resHead = `HTTP/1.1 ${response.status} OK\r\n`;
              if (response.headers) {
                for (const [k, v] of Object.entries(response.headers)) {
                  resHead += `${k}: ${v}\r\n`;
                }
              }
              resHead += "Connection: close\r\n\r\n";

              socket.write(resHead);
              if (response.body) {
                socket.write(BufferMod.from(response.body));
              }
              socket.end();
            } catch (err) {
              console.error("TCP Sync handler Error:", err);
              socket.write("HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
              socket.end();
            }
          }
        });

        socket.on("error", (err: any) => {
          console.warn("Socket error:", err);
        });
      });

      server.on("error", (err: any) => {
        reject(err);
      });

      server.listen({ port, host: "0.0.0.0" }, () => {
        resolve({ port: (server.address() as any)?.port || port, server });
      });
    });
  }

  async stopLANServer(server: unknown): Promise<void> {
    if (server && typeof (server as any).close === "function") {
      (server as any).close();
    }
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Map book file extensions to MIME types for document picker */
function extensionToMime(ext: string): string {
  const map: Record<string, string> = {
    epub: "application/epub+zip",
    pdf: "application/pdf",
    mobi: "application/x-mobipocket-ebook",
    azw: "application/vnd.amazon.ebook",
    azw3: "application/vnd.amazon.ebook",
    cbz: "application/vnd.comicbook+zip",
    fb2: "application/x-fictionbook+xml",
    fbz: "application/x-zip-compressed-fb2",
    txt: "text/plain",
    umd: "application/octet-stream",
    zip: "application/zip",
  };
  return map[ext.toLowerCase()] || "application/octet-stream";
}
