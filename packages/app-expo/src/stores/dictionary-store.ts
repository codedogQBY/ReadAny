import {
  type DictionaryRuntime,
  createRuntimeBackedDictionaryStore,
} from "@readany/core/dictionary/dictionary-store";
export * from "@readany/core/dictionary/dictionary-store";
import {
  DICTIONARY_BUNDLED_MANIFEST,
  DICTIONARY_REMOTE_MANIFEST_URL,
} from "../config/dictionary-config";
async function loadExpoDictionaryRuntime(): Promise<DictionaryRuntime> {
  const [databaseModule, platformModule, runtimeModule] = await Promise.all([
    import("../lib/dictionary/dictionary-database"),
    import("../lib/dictionary/dictionary-pack-platform"),
    import("../lib/dictionary/dictionary-runtime"),
  ]);
  return runtimeModule.createDictionaryRuntime({
    database: new databaseModule.ExpoDictionaryDatabaseAdapter(),
    directory: platformModule.dictionaryPackDirectory,
    platform: platformModule.createExpoDictionaryPackPlatform(),
  });
}

async function fetchRemoteDictionaryManifest(): Promise<unknown> {
  const response = await fetch(DICTIONARY_REMOTE_MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`Dictionary manifest request failed with HTTP ${response.status}`);
  }
  return response.json();
}

export const useDictionaryStore = createRuntimeBackedDictionaryStore({
  loadRuntime: loadExpoDictionaryRuntime,
  fetchRemoteManifest: fetchRemoteDictionaryManifest,
  getBundledManifest: async () => DICTIONARY_BUNDLED_MANIFEST,
});
