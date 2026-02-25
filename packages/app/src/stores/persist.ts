/**
 * Persist utility — 500ms debounced Tauri FS persistence + flushAllWrites
 */
import type { StateCreator, StoreApi } from "zustand";

const DEBOUNCE_MS = 500;
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
const writePromises = new Map<string, Promise<void>>();

/** Save state to Tauri FS with debounce */
export function debouncedSave(key: string, data: unknown): void {
  const existing = pendingWrites.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingWrites.delete(key);
    const promise = writeToFS(key, data);
    writePromises.set(key, promise);
    promise.finally(() => writePromises.delete(key));
  }, DEBOUNCE_MS);

  pendingWrites.set(key, timer);
}

/** Write data to Tauri FS */
async function writeToFS(key: string, data: unknown): Promise<void> {
  // TODO: Use @tauri-apps/plugin-fs to write JSON to app data dir
  void key;
  void data;
}

/** Load state from Tauri FS */
export async function loadFromFS<T>(key: string): Promise<T | null> {
  // TODO: Use @tauri-apps/plugin-fs to read JSON from app data dir
  void key;
  return null;
}

/** Flush all pending writes — call before window close */
export async function flushAllWrites(): Promise<void> {
  // Clear all pending timers and write immediately
  for (const [key, timer] of pendingWrites.entries()) {
    clearTimeout(timer);
    pendingWrites.delete(key);
    // TODO: write immediately
    void key;
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
