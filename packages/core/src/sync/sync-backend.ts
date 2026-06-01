/**
 * Unified sync backend interface — abstracts WebDAV, S3, and LAN sync.
 * All backends must implement this interface for consistent sync behavior.
 */

/** Sync backend type identifier */
export type SyncBackendType = "webdav" | "s3" | "lan";

/** Remote file information */
export interface RemoteFile {
  name: string;
  path: string;
  size: number;
  lastModified: number;
  isDirectory: boolean;
}

/** Unified sync backend interface */
export interface ISyncBackend {
  /** Backend type identifier */
  readonly type: SyncBackendType;

  /** Test if the backend is reachable and credentials are valid */
  testConnection(): Promise<boolean>;

  /** Ensure the remote directory structure exists */
  ensureDirectories(): Promise<void>;

  /** Upload data to a path */
  put(path: string, data: Uint8Array): Promise<void>;

  /** Download data from a path */
  get(path: string): Promise<Uint8Array>;

  /** Download data with progress reporting (optional — falls back to get() if not implemented) */
  getWithProgress?(
    path: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Uint8Array>;

  /** Upload a local file directly when the platform/backend supports native file transfer. */
  putFile?(
    path: string,
    localFilePath: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void>;

  /** Download directly into a local file when the platform/backend supports native file transfer. */
  getFileToPath?(
    path: string,
    localFilePath: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void>;

  /** Get JSON data from a path, returns null if not found */
  getJSON<T>(path: string): Promise<T | null>;

  /** Upload JSON data to a path */
  putJSON<T>(path: string, data: T): Promise<void>;

  /** List directory contents */
  listDir(path: string): Promise<RemoteFile[]>;

  /** Delete a file at the given path */
  delete(path: string): Promise<void>;

  /** Check if a file exists */
  exists(path: string): Promise<boolean>;

  /**
   * Move/rename a file from `fromPath` to `toPath`.
   * Implementations should create intermediate directories on the destination side.
   * Should be atomic where the backend supports it; otherwise copy + delete.
   * Throws if the source does not exist or if the destination already exists.
   */
  move(fromPath: string, toPath: string): Promise<void>;

  /** Get a display name for the backend (for UI) */
  getDisplayName(): Promise<string>;

  /** Clean up resources (for LAN sync) */
  dispose?(): Promise<void>;
}

/** Backend-specific configuration types */

/** WebDAV configuration */
export interface WebDavConfig {
  type: "webdav";
  url: string;
  username: string;
  remoteRoot?: string;
  allowInsecure?: boolean;
  autoSync: boolean;
  syncIntervalMins: number;
  wifiOnly: boolean;
  notifyOnComplete: boolean;
}

/** S3 configuration */
export interface S3Config {
  type: "s3";
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  remoteRoot?: string;
  pathStyle?: boolean;
  autoSync: boolean;
  syncIntervalMins: number;
  wifiOnly: boolean;
  notifyOnComplete: boolean;
}

/** LAN sync configuration (temporary, not persisted) */
export interface LANConfig {
  type: "lan";
}

/** Union type for all sync configurations */
export type SyncConfig = WebDavConfig | S3Config | LANConfig;

/** Default configuration values */
export const DEFAULT_SYNC_CONFIG = {
  autoSync: false,
  syncIntervalMins: 30,
  wifiOnly: false,
  notifyOnComplete: true,
} as const;

export const DEFAULT_WEBDAV_REMOTE_ROOT = "readany";
export const DEFAULT_S3_REMOTE_ROOT = "readany";

/** Secret keys for each backend type */
export const SYNC_SECRET_KEYS = {
  webdav: "sync_webdav_password",
  s3: "sync_s3_secret_key",
} as const;

/** Configuration storage key */
export const SYNC_CONFIG_KEY = "sync_config";

/** Active backend storage key. Backend configs are persisted separately so switching providers keeps prior settings. */
export const SYNC_ACTIVE_BACKEND_KEY = "sync_active_backend";

/** Per-backend configuration storage keys. */
export const SYNC_BACKEND_CONFIG_KEYS = {
  webdav: "sync_webdav_config",
  s3: "sync_s3_config",
} as const;
