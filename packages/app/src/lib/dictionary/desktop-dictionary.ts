import type { DictionaryLanguage } from "@readany/core/dictionary";
import {
  type DictionaryDatabaseAdapter,
  type DictionaryDatabaseConnection,
  DictionaryLookupError,
} from "@readany/core/dictionary/dictionary-database";
import type { DictionaryPackPlatform } from "@readany/core/dictionary/dictionary-pack-manager";
import { createDictionaryRuntime } from "@readany/core/dictionary/dictionary-runtime";
import { validateDictionaryDatabase } from "@readany/core/dictionary/dictionary-validation";
import { Channel, invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, remove, rename, stat } from "@tauri-apps/plugin-fs";

function query<T>(path: string, sql: string, values: unknown[] = []): Promise<T[]> {
  return invoke<T[]>("dictionary_query", { path, query: sql, values });
}

export class DesktopDictionaryDatabaseAdapter implements DictionaryDatabaseAdapter {
  async open(language: DictionaryLanguage, path: string): Promise<DictionaryDatabaseConnection> {
    const metadata = await query<{ key: string; value: string }>(
      path,
      "SELECT key, value FROM metadata WHERE key IN ('schema_version', 'language')",
    );
    const values = new Map(metadata.map((row) => [row.key, row.value]));
    if (values.get("schema_version") !== "1" || values.get("language") !== language) {
      throw new DictionaryLookupError("pack-invalid", "Dictionary metadata does not match");
    }
    let closed = false;
    const pending = new Set<Promise<unknown>>();
    return {
      getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
        if (closed) return Promise.reject(new Error("Dictionary connection is closed"));
        const operation = query<T>(path, sql, params);
        pending.add(operation);
        void operation.then(
          () => pending.delete(operation),
          () => pending.delete(operation),
        );
        return operation;
      },
      async closeAsync() {
        closed = true;
        // Native queries own their handles; wait for all of them before replacing files.
        await Promise.allSettled([...pending]);
      },
    };
  }
}

export function createDesktopDictionaryPackPlatform(): DictionaryPackPlatform {
  return {
    ensureDirectory: (path) => mkdir(path, { recursive: true }),
    exists,
    size: async (path) => (await stat(path)).size,
    sha256: (path) => invoke<string>("sync_hash_file", { path }),
    async download(url, path, onProgress) {
      let acceptingProgress = true;
      const progress = new Channel<{ receivedBytes: number; totalBytes: number | null }>();
      progress.onmessage = ({ receivedBytes, totalBytes }) => {
        if (acceptingProgress)
          onProgress(totalBytes && totalBytes > 0 ? Math.min(receivedBytes / totalBytes, 1) : 0);
      };
      try {
        const report = await invoke<{ bytes: number; elapsedMs: number }>("dictionary_download", {
          url,
          path,
          onProgress: progress,
        });
        onProgress(1);
        console.info(`[Dictionary] Transferred ${report.bytes} bytes in ${report.elapsedMs} ms`);
      } finally {
        acceptingProgress = false;
      }
    },
    readMetadata: (path) =>
      validateDictionaryDatabase({
        getAllAsync: <T>(sql: string) => query<T>(path, sql),
        getFirstAsync: async <T>(sql: string) => (await query<T>(path, sql))[0] ?? null,
      }),
    async move(from, to) {
      if (await exists(to)) throw new Error(`Dictionary move target already exists: ${to}`);
      await rename(from, to);
    },
    async remove(path) {
      if (await exists(path)) await remove(path);
    },
  };
}

export async function loadDesktopDictionaryRuntime() {
  return createDictionaryRuntime({
    database: new DesktopDictionaryDatabaseAdapter(),
    directory: await join(await appDataDir(), "dictionaries"),
    platform: createDesktopDictionaryPackPlatform(),
  });
}
