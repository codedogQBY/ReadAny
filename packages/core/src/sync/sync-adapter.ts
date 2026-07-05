/**
 * Platform-specific sync operations that differ between Tauri and Expo.
 * Each platform must provide an implementation of this interface.
 */
export interface ISyncAdapter {
  /** Create a snapshot of the current DB via VACUUM INTO */
  vacuumInto(targetPath: string): Promise<void>;

  /** Check integrity of a database file. Returns true if valid. */
  integrityCheck(dbPath: string): Promise<boolean>;

  /** Close the active database connection */
  closeDatabase(): Promise<void>;

  /** Reopen the database connection (after replacing the file) */
  reopenDatabase(): Promise<void>;

  /** Get the absolute path to the active database file */
  getDatabasePath(): Promise<string>;

  /** Get a temp directory path for staging files */
  getTempDir(): Promise<string>;

  /** Get the app data directory (where books/covers live) */
  getAppDataDir(): Promise<string>;

  /** Compute SHA-256 hash of a file, returns hex string */
  hashFile(filePath: string): Promise<string>;

  /** Read a file as Uint8Array */
  readFileBytes(filePath: string): Promise<Uint8Array>;

  /** Get file size in bytes, or null when unavailable. */
  getFileSize(filePath: string): Promise<number | null>;

  /** Max bytes this platform can safely buffer for fallback sync transfers. */
  maxBufferedTransferBytes?: number;

  /** Write Uint8Array to a file */
  writeFileBytes(filePath: string, data: Uint8Array): Promise<void>;

  /** Copy file from source to destination */
  copyFile(src: string, dest: string): Promise<void>;

  /** Delete a file */
  deleteFile(filePath: string): Promise<void>;

  /** Check if a file exists */
  fileExists(filePath: string): Promise<boolean>;

  /** List files in a directory (returns file names, not full paths) */
  listFiles(dirPath: string): Promise<string[]>;

  /** Ensure a directory exists (create if needed) */
  ensureDir(dirPath: string): Promise<void>;

  /** Join path segments */
  joinPath(...segments: string[]): string;

  /** Get current app version string */
  getAppVersion(): Promise<string>;

  /** Get device name for manifest */
  getDeviceName(): Promise<string>;
}

/** Singleton holder for the sync adapter */
let _syncAdapter: ISyncAdapter | null = null;

export function setSyncAdapter(adapter: ISyncAdapter): void {
  _syncAdapter = adapter;
}

export function getSyncAdapter(): ISyncAdapter {
  if (!_syncAdapter) {
    throw new Error("Sync adapter not initialized. Call setSyncAdapter() first.");
  }
  return _syncAdapter;
}
