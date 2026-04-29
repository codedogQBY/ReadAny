/**
 * Persist utility — 500ms debounced FS persistence + flushAllWrites
 * Uses IPlatformService for platform-agnostic file I/O.
 */
import type { StateCreator, StoreApi } from "zustand";
import { getPlatformService, waitForPlatformService } from "../services/platform";

const DEBOUNCE_MS = 500;
const STORE_DIR = "readany-store";
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
const writePromises = new Map<string, Promise<void>>();
const pendingData = new Map<string, unknown>();

/** Save state to FS with debounce */
export function debouncedSave(key: string, data: unknown): void {
  const existing = pendingWrites.get(key);
  if (existing) clearTimeout(existing);

  pendingData.set(key, data);

  const timer = setTimeout(() => {
    pendingWrites.delete(key);
    const dataToWrite = pendingData.get(key);
    pendingData.delete(key);
    const promise = writeToFS(key, dataToWrite);
    writePromises.set(key, promise);
    promise.finally(() => writePromises.delete(key));
  }, DEBOUNCE_MS);

  pendingWrites.set(key, timer);
}

/** Write data to app data directory via IPlatformService */
async function writeToFS(key: string, data: unknown): Promise<void> {
  try {
    const platform = getPlatformService();
    const appData = await platform.getAppDataDir();
    const dir = await platform.joinPath(appData, STORE_DIR);
    try {
      await platform.mkdir(dir);
    } catch {
      // directory may already exist
    }
    const filePath = await platform.joinPath(dir, `${key}.json`);
    await platform.writeTextFile(filePath, JSON.stringify(data));
  } catch (err) {
    console.error(`Failed to persist ${key}:`, err);
  }
}

/** Load state from app data directory via IPlatformService */
export async function loadFromFS<T>(key: string): Promise<T | null> {
  try {
    const platform = await waitForPlatformService();
    const appData = await platform.getAppDataDir();
    const filePath = await platform.joinPath(appData, STORE_DIR, `${key}.json`);
    const text = await platform.readTextFile(filePath);
    return JSON.parse(text) as T;
  } catch {
    // File doesn't exist yet or parse error
    return null;
  }
}

/** Flush all pending writes — call before window close */
export async function flushAllWrites(): Promise<void> {
  // Clear all pending timers and write immediately
  for (const [key, timer] of pendingWrites.entries()) {
    clearTimeout(timer);
    pendingWrites.delete(key);
    const data = pendingData.get(key);
    pendingData.delete(key);
    if (data !== undefined) {
      const promise = writeToFS(key, data);
      writePromises.set(key, promise);
      promise.finally(() => writePromises.delete(key));
    }
  }
  // Wait for in-flight writes
  await Promise.all(writePromises.values());
}

/** Create a persisted store middleware */
export function withPersist<T extends object>(
  key: string,
  creator: StateCreator<T>,
  /** Keys to always reset to these values after hydration (transient state that should not be restored) */
  resetAfterHydrate?: Partial<T>,
  migrate?: (persisted: T) => T,
): StateCreator<T> {
  return (set, get, api) => {
    const wrappedSet = ((partial: unknown, replace?: boolean) => {
      if (replace) {
        (set as (state: T, replace: true) => void)(partial as T, true);
      } else {
        (set as (partial: T | Partial<T> | ((state: T) => T | Partial<T>)) => void)(
          partial as T | Partial<T> | ((state: T) => T | Partial<T>),
        );
      }
      debouncedSave(key, (api as StoreApi<T>).getState());
    }) as typeof set;
    const state = creator(wrappedSet, get, api);
    // Load persisted state on creation
    loadFromFS<T>(key).then((persisted) => {
      if (persisted) {
        const migrated = migrate ? migrate(persisted) : persisted;
        set({
          ...migrated,
          ...(resetAfterHydrate ?? {}),
          _hasHydrated: true,
        } as unknown as Partial<T>);
      } else {
        set({ ...(resetAfterHydrate ?? {}), _hasHydrated: true } as unknown as Partial<T>);
      }
    });
    return state;
  };
}
