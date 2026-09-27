/**
 * LAN sync server implementation.
 * Provides a local HTTP server for peer-to-peer sync.
 */

import { getDB, getDeviceId } from "../db/database";
import { getPlatformService } from "../services/platform";
import { getSyncAdapter } from "./sync-adapter";
import { type LANQRData, createLANQRData, generatePairCode } from "./lan-backend";
import type { ISyncBackend, RemoteFile } from "./sync-backend";
import {
  buildBookFolderName,
  isCoverFileName,
  parseBookFolderName,
  sanitizeBookTitleForFs,
} from "./sync-naming";
import { REMOTE_BOOKS_ROOT } from "./sync-types";
import { collectChanges, type DeviceSyncPayload } from "./simple-sync";

const LAN_SYNC_DIR = "/readany/sync";

function getLanDeviceSnapshotPath(deviceId: string): string {
  return `${LAN_SYNC_DIR}/device-${deviceId}.json`;
}

/**
 * Local filesystem backend for the LAN server.
 * Serves files from the device's own data directory for sync.
 */
class LocalFsBackend implements ISyncBackend {
  readonly type = "lan" as const;

  private async getCurrentDeviceSnapshot(): Promise<DeviceSyncPayload> {
    return collectChanges(0);
  }

  /**
   * Device id only — deliberately does NOT build the sync payload.
   *
   * listDir()/exists() need the device id solely to synthesise the
   * `device-<id>.json` path. Calling getCurrentDeviceSnapshot() for that runs
   * collectChanges(0), i.e. a full read of every synced table plus a
   * JSON.stringify of the whole library, on the renderer thread — for a
   * string comparison. The device id is a metadata lookup, so read it directly.
   */
  private async getDeviceIdOnly(): Promise<string> {
    return getDeviceId();
  }

  private async getDataDir(): Promise<string> {
    const adapter = getSyncAdapter();
    return await adapter.getAppDataDir();
  }

  private async mapVirtualPath(path: string): Promise<string> {
    const adapter = getSyncAdapter();
    const dataDir = await this.getDataDir();

    // Remote structure mapping to local storage:
    // /readany/data/readany.db                    -> local DB file
    // /readany/data/books/{title-id}/{title}.ext  -> local books/{id}.ext or covers/{id}.ext
    // /readany/data/file/*                        -> local books/*    (legacy layout)
    // /readany/data/cover/*                       -> local covers/*   (legacy layout)

    if (path === "/readany/data/readany.db") {
      return await adapter.getDatabasePath();
    }

    if (path.startsWith(`${REMOTE_BOOKS_ROOT}/`)) {
      // /readany/data/books/{title-id}/{filename}
      const rest = path.substring(REMOTE_BOOKS_ROOT.length + 1);
      const slashIdx = rest.indexOf("/");
      if (slashIdx === -1) {
        // Caller asked to map the dir itself — return books root local equivalent (best-effort).
        return adapter.joinPath(dataDir, "books");
      }
      const folderName = rest.substring(0, slashIdx);
      const fileName = rest.substring(slashIdx + 1);
      const bookId = parseBookFolderName(folderName) ?? folderName.split("-").pop() ?? folderName;
      const ext = fileName.includes(".") ? fileName.split(".").pop()! : "";
      const targetSubdir = isCoverFileName(fileName) ? "covers" : "books";
      return adapter.joinPath(dataDir, targetSubdir, ext ? `${bookId}.${ext}` : bookId);
    }

    if (path.startsWith("/readany/data/file")) {
      const subPath = path.substring("/readany/data/file".length);
      return adapter.joinPath(dataDir, "books", subPath);
    }

    if (path.startsWith("/readany/data/cover")) {
      const subPath = path.substring("/readany/data/cover".length);
      return adapter.joinPath(dataDir, "covers", subPath);
    }

    if (path.startsWith("/readany/data/")) {
      const subPath = path.substring("/readany/data/".length);
      return adapter.joinPath(dataDir, subPath);
    }

    return adapter.joinPath(dataDir, path);
  }

  async testConnection(): Promise<boolean> { return true; }
  async ensureDirectories(): Promise<void> {}

  async put(path: string, data: Uint8Array): Promise<void> {
    const platform = getPlatformService();
    const resolvedPath = await this.mapVirtualPath(path);
    const dir = resolvedPath.substring(0, resolvedPath.lastIndexOf("/"));
    if (dir) {
      const adapter = getSyncAdapter();
      await adapter.ensureDir(dir);
    }
    await platform.writeFile(resolvedPath, data);
  }

  async get(path: string): Promise<Uint8Array> {
    const platform = getPlatformService();
    const adapter = getSyncAdapter();

    if (path.startsWith(`${LAN_SYNC_DIR}/device-`) && path.endsWith(".json")) {
      const snapshot = await this.getCurrentDeviceSnapshot();
      const expectedPath = getLanDeviceSnapshotPath(snapshot.deviceId);
      if (path !== expectedPath) {
        const err = new Error("File not found");
        (err as any).statusCode = 404;
        throw err;
      }
      return new TextEncoder().encode(JSON.stringify(snapshot));
    }

    const resolvedPath = await this.mapVirtualPath(path);
    
    // Special handling for database to ensure consistency (snapshot via vacuum)
    const dbPath = await adapter.getDatabasePath();
    if (resolvedPath === dbPath) {
      const tempDir = await adapter.getTempDir();
      const snapshotPath = adapter.joinPath(tempDir, `sync_snapshot_${Date.now()}.db`);
      try {
        console.log(`[LAN Server] Creating DB snapshot for sync at ${snapshotPath}...`);
        await adapter.vacuumInto(snapshotPath);
        const data = await platform.readFile(snapshotPath);
        await adapter.deleteFile(snapshotPath);
        return data;
      } catch (e) {
        console.error(`[LAN Server] Failed to snapshot database:`, e);
        // Fallback to direct read if vacuum fails (might be inconsistent but better than nothing)
        return await platform.readFile(resolvedPath);
      }
    }

    if (!(await adapter.fileExists(resolvedPath))) {
      const err = new Error("File not found");
      (err as any).statusCode = 404;
      throw err;
    }
    
    try {
      return await platform.readFile(resolvedPath);
    } catch (e) {
      console.error(`[LAN Server] Failed to read file ${resolvedPath}:`, e);
      throw e;
    }
  }

  async getJSON<T>(path: string): Promise<T | null> {
    try {
      const data = await this.get(path);
      return JSON.parse(new TextDecoder().decode(data)) as T;
    } catch { return null; }
  }

  async putJSON<T>(path: string, data: T): Promise<void> {
    await this.put(path, new TextEncoder().encode(JSON.stringify(data)));
  }

  async listDir(path: string): Promise<RemoteFile[]> {
    if (path === LAN_SYNC_DIR) {
      // Only the device id is needed here; the payload itself is not built.
      const deviceId = await this.getDeviceIdOnly();
      const virtualPath = getLanDeviceSnapshotPath(deviceId);
      return [
        {
          name: `device-${deviceId}.json`,
          path: virtualPath,
          size: 0,
          // Virtual entry — the payload is generated per request rather than
          // stored, so there is no meaningful mtime. Matches the books-root
          // projection below; no LAN sync consumer reads this field.
          lastModified: 0,
          isDirectory: false,
        },
      ];
    }

    // The per-book folders under REMOTE_BOOKS_ROOT don't exist on local disk (local stays
    // UUID-flat). Project them from the DB instead so remote clients see the canonical layout.
    if (path === REMOTE_BOOKS_ROOT || path === `${REMOTE_BOOKS_ROOT}/`) {
      try {
        const db = await getDB();
        const books = await db.select<{ id: string; title: string }>(
          "SELECT id, title FROM books WHERE deleted_at IS NULL",
          [],
        );
        return books.map((b) => {
          const folderName = buildBookFolderName(b);
          return {
            name: folderName,
            path: `${REMOTE_BOOKS_ROOT}/${folderName}`,
            size: 0,
            lastModified: 0,
            isDirectory: true,
          };
        });
      } catch (e) {
        console.warn("[LAN Server] Failed to project books root from DB:", e);
        return [];
      }
    }

    if (path.startsWith(`${REMOTE_BOOKS_ROOT}/`)) {
      const folderName = path.substring(REMOTE_BOOKS_ROOT.length + 1).replace(/\/$/, "");
      const bookId = parseBookFolderName(folderName) ?? folderName.split("-").pop() ?? "";
      if (!bookId) return [];
      try {
        const db = await getDB();
        const rows = await db.select<{
          id: string;
          title: string;
          file_path: string | null;
          cover_url: string | null;
        }>("SELECT id, title, file_path, cover_url FROM books WHERE id = ? AND deleted_at IS NULL", [bookId]);
        if (rows.length === 0) return [];
        const book = rows[0];
        const stem = sanitizeBookTitleForFs(book.title);
        const entries: RemoteFile[] = [];
        if (book.file_path) {
          const ext = book.file_path.split(".").pop() || "epub";
          const name = `${stem}.${ext}`;
          entries.push({
            name,
            path: `${REMOTE_BOOKS_ROOT}/${folderName}/${name}`,
            size: 0,
            lastModified: 0,
            isDirectory: false,
          });
        }
        if (book.cover_url) {
          const ext = book.cover_url.split(".").pop() || "jpg";
          const name = `${stem}.${ext}`;
          entries.push({
            name,
            path: `${REMOTE_BOOKS_ROOT}/${folderName}/${name}`,
            size: 0,
            lastModified: 0,
            isDirectory: false,
          });
        }
        return entries;
      } catch (e) {
        console.warn(`[LAN Server] Failed to project book folder ${folderName} from DB:`, e);
        return [];
      }
    }

    const adapter = getSyncAdapter();
    const resolvedPath = await this.mapVirtualPath(path);
    try {
      if (!(await adapter.fileExists(resolvedPath))) return [];
      const names = await adapter.listFiles(resolvedPath);
      return names.map((name) => {
        const childVirtualPath = path.endsWith("/") ? path + name : path + "/" + name;
        return {
          name,
          path: childVirtualPath,
          size: 0,
          lastModified: 0,
          isDirectory: false,
        };
      });
    } catch (e) {
      console.warn(`[LAN Server] Failed to list dir ${resolvedPath}:`, e);
      return [];
    }
  }

  async delete(path: string): Promise<void> {
    const platform = getPlatformService();
    const resolvedPath = await this.mapVirtualPath(path);
    await platform.deleteFile(resolvedPath);
  }

  async move(fromPath: string, toPath: string): Promise<void> {
    // TODO: platform.renameFile would be more efficient; degrade to read+write+delete
    // for now since LAN sync is currently one-way and this rarely runs in practice.
    const platform = getPlatformService();
    const adapter = getSyncAdapter();
    const fromResolved = await this.mapVirtualPath(fromPath);
    const toResolved = await this.mapVirtualPath(toPath);
    if (fromResolved === toResolved) return;
    const destDir = toResolved.substring(0, toResolved.lastIndexOf("/"));
    if (destDir) await adapter.ensureDir(destDir);
    const data = await platform.readFile(fromResolved);
    await platform.writeFile(toResolved, data);
    await platform.deleteFile(fromResolved);
  }

  async exists(path: string): Promise<boolean> {
    if (path.startsWith(`${LAN_SYNC_DIR}/device-`) && path.endsWith(".json")) {
      // Path comparison only — must not build the whole sync payload.
      const deviceId = await this.getDeviceIdOnly();
      return path === getLanDeviceSnapshotPath(deviceId);
    }
    const adapter = getSyncAdapter();
    const resolvedPath = await this.mapVirtualPath(path);
    return adapter.fileExists(resolvedPath);
  }

  async getDisplayName(): Promise<string> { return "Local Filesystem"; }
}

export type { LANQRData } from "./lan-backend";

/** LAN server state */
export type LANServerStatus = "idle" | "starting" | "running" | "stopping" | "error";

/** LAN server event handlers */
export interface LANServerEvents {
  onStatusChange?: (status: LANServerStatus) => void;
  onClientConnect?: (clientIp: string) => void;
  onClientDisconnect?: (clientIp: string) => void;
  onError?: (error: string) => void;
}

/** LAN server configuration */
export interface LANServerConfig {
  port?: number;
  deviceName: string;
  events?: LANServerEvents;
}

/**
 * LAN sync server for sharing data with another device.
 * This runs a local HTTP server that serves files for download.
 */
export class LANServer {
  private status: LANServerStatus = "idle";
  private port: number;
  private deviceName: string;
  private pairCode: string;
  private qrData: LANQRData | null = null;
  private events: LANServerEvents;
  private backend: ISyncBackend | null = null;
  private abortController: AbortController | null = null;
  private serverHandle: unknown = null;
  private manualIP: string | null = null;

  constructor(config: LANServerConfig) {
    this.port = config.port ?? 0; // 0 means auto-assign
    this.deviceName = config.deviceName;
    this.pairCode = generatePairCode();
    this.events = config.events ?? {};
  }

  /** Get current server status */
  getStatus(): LANServerStatus {
    return this.status;
  }

  /** Get the pair code for this server */
  getPairCode(): string {
    return this.pairCode;
  }

  /** Get QR code data for this server */
  getQRData(): LANQRData | null {
    return this.qrData;
  }

  /** Get the port the server is listening on */
  getPort(): number {
    return this.port;
  }

  /** Set the sync backend to serve data from */
  setBackend(backend: ISyncBackend): void {
    this.backend = backend;
  }

  /** Set manual IP address (used when auto-detection fails) */
  setManualIP(ip: string): void {
    this.manualIP = ip;
  }

  /** Start the LAN server */
  async start(): Promise<void> {
    if (this.status === "running") {
      return;
    }

    this.setStatus("starting");

    try {
      const platform = getPlatformService();

      // Get local IP address (use manual IP if set)
      let localIp = this.manualIP;
      if (!localIp) {
        localIp = await this.getLocalIP();
      }
      if (!localIp) {
        throw new Error("Could not determine local IP address");
      }

      // Start HTTP server
      const { port, server } = (await platform.startLANServer?.(
        this.port,
        this.handleRequest.bind(this),
      )) ?? { port: this.port, server: null };

      if (!port) {
        throw new Error("Failed to start LAN server");
      }

      this.port = port;
      this.serverHandle = server;
      this.abortController = new AbortController();

      // Attach local-fs backend automatically if caller didn't set one
      if (!this.backend) {
        this.backend = new LocalFsBackend();
      }

      // Create QR data
      this.qrData = createLANQRData(localIp, this.port, this.deviceName, this.pairCode);

      this.setStatus("running");
      console.log(`[LAN Server] Started on port ${this.port}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.setStatus("error");
      this.events.onError?.(error);
      throw e;
    }
  }

  /** Stop the LAN server */
  async stop(): Promise<void> {
    if (this.status !== "running") {
      return;
    }

    this.setStatus("stopping");

    try {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }

      const platform = getPlatformService();
      await platform.stopLANServer?.(this.serverHandle);

      this.serverHandle = null;
      this.qrData = null;
      this.setStatus("idle");
      console.log("[LAN Server] Stopped");
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.setStatus("error");
      this.events.onError?.(error);
      throw e;
    }
  }

  /** Handle incoming HTTP request */
  private async handleRequest(
    method: string,
    path: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body?: Uint8Array; headers?: Record<string, string> }> {
    // Verify pair code (headers may be lowercased by HTTP layer)
    const pairCodeKey = Object.keys(headers).find(k => k.toLowerCase() === "x-pair-code");
    const clientPairCode = pairCodeKey ? headers[pairCodeKey] : undefined;
    if (clientPairCode !== this.pairCode) {
      console.warn(`[LAN Server] Pair code mismatch from client`);
      return { status: 403, body: new TextEncoder().encode("Forbidden") };
    }

    try {
      // Ping endpoint — no backend required
      if (method === "GET" && path === "/ping") {
        return { status: 200, body: new TextEncoder().encode("pong") };
      }

      if (!this.backend) {
        return { status: 503, body: new TextEncoder().encode("Service Unavailable") };
      }

      // File download
      if (method === "GET" && path.startsWith("/file/")) {
        const virtualPath = path.substring(5); // Remove "/file" prefix (keep leading slash)
        try {
          const data = await this.backend.get(virtualPath);
          return {
            status: 200,
            body: data,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(data.length),
            },
          };
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          const statusCode = (e as any).statusCode || 500;
          if (statusCode === 404 || error.includes("File not found")) {
             return { status: 404, body: new TextEncoder().encode("Not Found") };
          }
          throw e;
        }
      }

      // Directory listing
      if (method === "GET" && path.startsWith("/list/")) {
        const virtualPath = path.substring(5); // Remove "/list" prefix (keep leading slash)
        const files = await this.backend.listDir(virtualPath);
        const body = new TextEncoder().encode(JSON.stringify(files));
        return {
          status: 200,
          body,
          headers: {
            "Content-Type": "application/json",
          },
        };
      }

      // File exists check
      if (method === "HEAD" && path.startsWith("/exists/")) {
        const virtualPath = path.substring(7); // Remove "/exists" prefix (keep leading slash)
        const exists = await this.backend.exists(virtualPath);
        return { status: exists ? 200 : 404 };
      }

      return { status: 404, body: new TextEncoder().encode("Not Found") };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[LAN Server] Error handling ${method} ${path}:`, error);
      return { status: 500, body: new TextEncoder().encode(error) };
    }
  }

  /** Get local IP address */
  private async getLocalIP(): Promise<string | null> {
    try {
      const platform = getPlatformService();
      const ip = await platform.getLocalIP?.();
      return ip ?? null;
    } catch {
      return null;
    }
  }

  /** Update server status and notify listeners */
  private setStatus(status: LANServerStatus): void {
    this.status = status;
    this.events.onStatusChange?.(status);
  }
}

/**
 * Create a LAN sync server.
 */
export function createLANServer(config: LANServerConfig): LANServer {
  return new LANServer(config);
}
