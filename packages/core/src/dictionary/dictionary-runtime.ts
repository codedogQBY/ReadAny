import type { DictionaryDatabaseAdapter } from "./dictionary-database";
import { DictionaryLookupService } from "./dictionary-lookup-service";
import { DictionaryPackManager, type DictionaryPackPlatform } from "./dictionary-pack-manager";

export interface DictionaryRuntimeOptions {
  database: DictionaryDatabaseAdapter;
  directory: string;
  platform: DictionaryPackPlatform;
}

export function createDictionaryRuntime(options: DictionaryRuntimeOptions): {
  lookup: DictionaryLookupService;
  manager: DictionaryPackManager;
} {
  // biome-ignore lint/style/useConst: the lookup resolves installed paths through the manager created below.
  let manager: DictionaryPackManager | undefined;
  const lookup = new DictionaryLookupService(
    options.database,
    async (language) => {
      if (!manager) throw new Error("Dictionary runtime is not initialized");
      return manager.getActivePath(language);
    },
    (language) => {
      manager?.invalidate(language);
    },
  );
  manager = new DictionaryPackManager(options.platform, options.directory, lookup);
  return { lookup, manager };
}
