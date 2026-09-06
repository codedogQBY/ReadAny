import { hash } from "@dr.pogodin/react-native-fs";
import { Directory, File, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import type { DictionaryPackMetadata, DictionaryPackPlatform } from "./dictionary-pack-manager";

import { validateDictionaryDatabase } from "@readany/core/dictionary/dictionary-validation";
export {
  validateDictionaryDatabase,
  type DictionaryValidationDatabase,
} from "@readany/core/dictionary/dictionary-validation";
function nativePath(path: string): string {
  return path.replace(/^file:\/\//, "");
}

export function createExpoDictionaryPackPlatform(): DictionaryPackPlatform {
  return {
    async ensureDirectory(path) {
      new Directory(path).create({ idempotent: true, intermediates: true });
    },
    async download(url, path, onProgress) {
      const task = LegacyFileSystem.createDownloadResumable(
        url,
        path,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) =>
          onProgress(
            totalBytesExpectedToWrite > 0 ? totalBytesWritten / totalBytesExpectedToWrite : 0,
          ),
      );
      const result = await task.downloadAsync();
      if (!result || result.status < 200 || result.status >= 300)
        throw new Error("Dictionary pack download failed");
    },
    async exists(path) {
      return new File(path).exists;
    },
    async size(path) {
      return new File(path).size ?? 0;
    },
    async sha256(path) {
      return hash(nativePath(path), "sha256");
    },
    async readMetadata(path) {
      return readAndValidateSqlite(path);
    },
    async move(from, to) {
      const target = new File(to);
      if (target.exists) throw new Error(`Dictionary move target already exists: ${to}`);
      new File(from).move(target);
    },
    async remove(path) {
      const file = new File(path);
      if (file.exists) file.delete();
    },
  };
}

async function readAndValidateSqlite(path: string): Promise<DictionaryPackMetadata> {
  const SQLite = await import("expo-sqlite");
  const { fileName, directory } = splitDatabasePath(path);
  const database = await SQLite.openDatabaseAsync(fileName, { useNewConnection: true }, directory);
  try {
    return await validateDictionaryDatabase(database);
  } finally {
    await database.closeAsync();
  }
}

function splitDatabasePath(path: string): { fileName: string; directory: string } {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (separator < 0 || separator === normalized.length - 1)
    throw new Error("Dictionary path has no filename");
  return {
    fileName: normalized.slice(separator + 1),
    directory: separator === 0 ? normalized.slice(0, 1) : normalized.slice(0, separator),
  };
}

export const dictionaryPackDirectory = `${Paths.document.uri.replace(/\/$/, "")}/dictionaries`;
