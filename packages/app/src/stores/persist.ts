/**
 * Persist utility — 500ms debounced Tauri FS persistence + flushAllWrites
 */
import type { StateCreator, StoreApi } from "zustand";

const DEBOUNCE_MS = 500;
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
const writePromises = new Map<string, Promise<void>>();
const pendingData = new Map<string, unknown>();

/** Save state to Tauri FS with debounce */
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

/** Write data to Tauri FS app data directory */
async function writeToFS(key: string, data: unknown): Promise<void> {
  try {
    const { writeTextFile, mkdir, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    const dir = "readany-store";
    try {
      await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
    } catch {
      // directory may already exist
    }
    const filePath = `${dir}/${key}.json`;
    await writeTextFile(filePath, JSON.stringify(data), { baseDir: BaseDirectory.AppData });
  } catch (err) {
    console.error(`Failed to persist ${key}:`, err);
  }
}

/** Load state from Tauri FS app data directory */
export async function loadFromFS<T>(key: string): Promise<T | null> {
  try {
    const { readTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    const filePath = `readany-store/${key}.json`;
    const text = await readTextFile(filePath, { baseDir: BaseDirectory.AppData });
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
      if (persisted) set(persisted);
    });
    return state;
  };
}
