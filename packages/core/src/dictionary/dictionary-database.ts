import type { DictionaryLanguage } from "./types";

export interface DictionaryDatabaseConnection {
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  closeAsync(): Promise<void>;
}

export interface DictionaryDatabaseAdapter {
  open(language: DictionaryLanguage, absolutePath: string): Promise<DictionaryDatabaseConnection>;
}

export class DictionaryLookupError extends Error {
  constructor(
    readonly code: "unsupported-selection" | "pack-not-installed" | "pack-invalid",
    message: string,
  ) {
    super(message);
    this.name = "DictionaryLookupError";
  }
}
