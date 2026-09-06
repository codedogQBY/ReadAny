import type { DictionaryLanguage } from "@readany/core/dictionary";
import {
  type DictionaryDatabaseAdapter,
  type DictionaryDatabaseConnection,
  DictionaryLookupError,
} from "@readany/core/dictionary/dictionary-database";
export * from "@readany/core/dictionary/dictionary-database";

interface DictionaryMetadataRow {
  key: string;
  value: string;
}

function splitDatabasePath(absolutePath: string): { fileName: string; directory: string } {
  const normalizedPath = absolutePath.replace(/[\\/]+$/, "");
  const separator = Math.max(normalizedPath.lastIndexOf("/"), normalizedPath.lastIndexOf("\\"));
  if (separator < 0 || separator === normalizedPath.length - 1) {
    throw new DictionaryLookupError("pack-invalid", "Dictionary pack path must include a filename");
  }

  return {
    fileName: normalizedPath.slice(separator + 1),
    directory: separator === 0 ? normalizedPath.slice(0, 1) : normalizedPath.slice(0, separator),
  };
}

export class ExpoDictionaryDatabaseAdapter implements DictionaryDatabaseAdapter {
  async open(
    language: DictionaryLanguage,
    absolutePath: string,
  ): Promise<DictionaryDatabaseConnection> {
    const { fileName, directory } = splitDatabasePath(absolutePath);
    const SQLite = await import("expo-sqlite");
    const database = await SQLite.openDatabaseAsync(
      fileName,
      { useNewConnection: true },
      directory,
    );

    try {
      await database.execAsync("PRAGMA query_only = ON");
      const metadata = new Map(
        (
          await database.getAllAsync<DictionaryMetadataRow>(
            "SELECT key, value FROM metadata WHERE key IN ('schema_version', 'language')",
          )
        ).map((row) => [row.key, row.value]),
      );
      if (metadata.get("schema_version") !== "1" || metadata.get("language") !== language) {
        throw new Error("metadata did not match the expected schema version and language");
      }
    } catch (error) {
      try {
        await database.closeAsync();
      } catch {
        // The invalid handle cannot be reused; retain the original validation error.
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new DictionaryLookupError("pack-invalid", `Dictionary pack is invalid: ${detail}`);
    }

    return {
      getAllAsync: async <T>(sql: string, ...params: unknown[]) =>
        database.getAllAsync<T>(sql, ...(params as string[])),
      closeAsync: () => database.closeAsync(),
    };
  }
}
