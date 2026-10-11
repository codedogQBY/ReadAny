import { mkdirSync } from "node:fs";
import { access, mkdir, readFile as fsReadFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type {
  FetchOptions,
  FilePickerOptions,
  IDatabase,
  IPlatformService,
  IWebSocket,
  UpdateInfo,
  WebSocketOptions,
} from "@readany/core/services";

type BetterSqliteDatabaseConstructor = typeof import("better-sqlite3");

function normalizeDir(path: string): string {
  const trimmed = path.replace(/^file:\/\//, "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[\\/]+$/, "");
}

function getDefaultDataRoot(env: NodeJS.ProcessEnv): string {
  return env.READANY_HOME
    ? resolve(env.READANY_HOME)
    : join(homedir(), "Library", "Application Support", "com.readany.app");
}

function getDesktopDataRootConfigPath(env: NodeJS.ProcessEnv): string {
  return join(getDefaultDataRoot(env), "desktop-data-root.json");
}

async function readConfiguredRoot(env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const raw = await fsReadFile(getDesktopDataRootConfigPath(env), "utf8");
    const parsed = JSON.parse(raw) as { dataRoot?: string };
    const normalized = normalizeDir(parsed.dataRoot || "");
    return normalized || null;
  } catch {
    return null;
  }
}

async function getDesktopLibraryRoot(env: NodeJS.ProcessEnv): Promise<string> {
  const configured = await readConfiguredRoot(env);
  return configured || getDefaultDataRoot(env);
}

async function loadBetterSqliteDatabase(): Promise<BetterSqliteDatabaseConstructor> {
  try {
    const module = await import("better-sqlite3");
    return module.default ?? module;
  } catch (error) {
    throw new Error(
      `ReadAny CLI requires better-sqlite3 for local library access. Install native sqlite support and try again. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function wrapBetterSqliteDatabase(
  Database: BetterSqliteDatabaseConstructor,
  filePath: string,
): IDatabase {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 15000");

  return {
    async execute(sql: string, params: unknown[] = []): Promise<void> {
      const statement = db.prepare(sql);
      statement.run(...params);
    },
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const statement = db.prepare(sql);
      return statement.all(...params) as T[];
    },
    async close(): Promise<void> {
      db.close();
    },
  };
}

export class NodePlatformService implements IPlatformService {
  readonly platformType = "desktop" as const;
  readonly isMobile = false;
  readonly isDesktop = true;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async readFile(path: string): Promise<Uint8Array> {
    return fsReadFile(path);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await writeFile(path, data);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await writeFile(path, content, "utf8");
  }

  async readTextFile(path: string): Promise<string> {
    return fsReadFile(path, "utf8");
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(path: string): Promise<void> {
    const { rm } = await import("node:fs/promises");
    await rm(path, { force: true });
  }

  async getAppDataDir(): Promise<string> {
    return getDefaultDataRoot(this.env);
  }

  async getDataDir(): Promise<string> {
    return getDesktopLibraryRoot(this.env);
  }

  async joinPath(...parts: string[]): Promise<string> {
    return join(...parts);
  }

  convertFileSrc(path: string): string {
    return path.startsWith("file://") ? path : `file://${path}`;
  }

  async pickFile(_options?: FilePickerOptions): Promise<string | string[] | null> {
    throw new Error("File picker is not available in ReadAny CLI.");
  }

  async loadDatabase(path: string): Promise<IDatabase> {
    const normalizedPath = path.startsWith("sqlite:") ? path.slice("sqlite:".length) : path;
    mkdirSync(dirname(normalizedPath), { recursive: true });
    const Database = await loadBetterSqliteDatabase();
    return wrapBetterSqliteDatabase(Database, normalizedPath);
  }

  async fetch(url: string, options?: FetchOptions): Promise<Response> {
    // ReadAny-specific options are not part of RequestInit: strip them so the
    // CLI only ever hands Node's fetch a real request. Transfer tuning
    // (timeoutMs / idleTimeoutMs) is not implemented here — the size-aware
    // budget exists to keep long transfers alive on the desktop/mobile clients
    // (see packages/core/src/sync/webdav-client.ts).
    const {
      allowInsecure: _allowInsecure,
      timeoutMs: _timeoutMs,
      idleTimeoutMs: _idleTimeoutMs,
      responseType: _responseType,
      onDownloadProgress: _onDownloadProgress,
      ...fetchOptions
    } = options ?? {};
    return globalThis.fetch(url, fetchOptions);
  }

  async createWebSocket(_url: string, _options?: WebSocketOptions): Promise<IWebSocket> {
    throw new Error("WebSocket is not available in ReadAny CLI.");
  }

  async getAppVersion(): Promise<string> {
    return "0.1.0";
  }

  async kvGetItem(_key: string): Promise<string | null> {
    return null;
  }

  async kvSetItem(_key: string, _value: string): Promise<void> {}

  async kvRemoveItem(_key: string): Promise<void> {}

  async kvGetAllKeys(): Promise<string[]> {
    return [];
  }

  async copyToClipboard(_content: string): Promise<void> {
    throw new Error("Clipboard is not available in ReadAny CLI.");
  }

  async shareOrDownloadFile(
    _content: string,
    _filename: string,
    _mimeType: string,
  ): Promise<string | null> {
    throw new Error("File sharing is not available in ReadAny CLI.");
  }
}

export function createNodePlatformService(env: NodeJS.ProcessEnv = process.env): IPlatformService {
  return new NodePlatformService(env);
}
