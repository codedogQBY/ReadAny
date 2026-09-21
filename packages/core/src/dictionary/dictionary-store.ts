import { type StoreApi, type UseBoundStore, create } from "zustand";
import type { DictionaryLookupService } from "./dictionary-lookup-service";
import type { DictionaryPackManager, DictionaryPackStatus } from "./dictionary-pack-manager";
import {
  type DictionaryEntry,
  type DictionaryLanguage,
  type DictionaryManifest,
  type DictionaryPackDescriptor,
  parseDictionaryManifest,
} from "./index";
export interface DictionaryStoreDependencies {
  manager: Pick<DictionaryPackManager, "refresh" | "install" | "remove">;
  lookup: Pick<DictionaryLookupService, "lookup">;
  fetchRemoteManifest: () => Promise<unknown>;
  getBundledManifest: () => Promise<unknown>;
}

export interface DictionaryRuntime {
  manager: Pick<DictionaryPackManager, "refresh" | "install" | "remove">;
  lookup: Pick<DictionaryLookupService, "lookup">;
}

export interface RuntimeBackedDictionaryStoreDependencies {
  loadRuntime: () => Promise<DictionaryRuntime>;
  fetchRemoteManifest: () => Promise<unknown>;
  getBundledManifest: () => Promise<unknown>;
}

export interface DictionaryStoreState {
  manifest: DictionaryManifest | null;
  packs: Record<DictionaryLanguage, DictionaryPackStatus>;
  initialize(): Promise<void>;
  refreshManifest(): Promise<void>;
  install(language: DictionaryLanguage): Promise<void>;
  remove(language: DictionaryLanguage): Promise<void>;
  retry(): Promise<void>;
  lookup(text: string): Promise<DictionaryEntry[]>;
}

const emptyPacks = (): Record<DictionaryLanguage, DictionaryPackStatus> => ({
  en: { state: "not-installed" },
  zh: { state: "not-installed" },
});

export function createDictionaryStore(
  deps: DictionaryStoreDependencies,
): UseBoundStore<StoreApi<DictionaryStoreState>> {
  return create<DictionaryStoreState>()((set, get) => {
    let remoteRefreshPromise: Promise<void> | undefined;
    let bundledReadinessPromise: Promise<void> | undefined;
    const applyManifest = async (manifest: DictionaryManifest) => {
      const packs = await deps.manager.refresh(manifest);
      set({ manifest, packs });
    };
    const loadManifest = async (): Promise<DictionaryManifest> => {
      let remoteError: unknown;
      try {
        return parseDictionaryManifest(await deps.fetchRemoteManifest());
      } catch (error) {
        remoteError = error;
      }
      try {
        return parseDictionaryManifest(await deps.getBundledManifest());
      } catch (bundledError) {
        throw new AggregateError(
          [remoteError, bundledError],
          "No valid dictionary manifest is available",
        );
      }
    };
    const refreshFromSources = (): Promise<void> => {
      if (remoteRefreshPromise) return remoteRefreshPromise;
      const operation = loadManifest().then(applyManifest);
      remoteRefreshPromise = operation;
      void operation.then(
        () => {
          if (remoteRefreshPromise === operation) remoteRefreshPromise = undefined;
        },
        () => {
          if (remoteRefreshPromise === operation) remoteRefreshPromise = undefined;
        },
      );
      return operation;
    };
    const refreshFromBundled = (): Promise<void> => {
      if (get().manifest) return Promise.resolve();
      if (bundledReadinessPromise) return bundledReadinessPromise;
      const operation = deps
        .getBundledManifest()
        .then(parseDictionaryManifest)
        .then(async (manifest) => {
          if (!get().manifest) await applyManifest(manifest);
        });
      bundledReadinessPromise = operation;
      void operation.then(
        () => {
          if (bundledReadinessPromise === operation) bundledReadinessPromise = undefined;
        },
        () => {
          if (bundledReadinessPromise === operation) bundledReadinessPromise = undefined;
        },
      );
      return operation;
    };

    return {
      manifest: null,
      packs: emptyPacks(),
      initialize: refreshFromSources,
      refreshManifest: refreshFromSources,
      install: async (language) => {
        const descriptor: DictionaryPackDescriptor | undefined = get().manifest?.packs[language];
        if (!descriptor) throw new Error("Dictionary manifest is unavailable");
        await deps.manager.install(descriptor, (status) =>
          set((state) => ({ packs: { ...state.packs, [language]: status } })),
        );
      },
      remove: async (language) => {
        await deps.manager.remove(language);
        set((state) => ({ packs: { ...state.packs, [language]: { state: "not-installed" } } }));
      },
      retry: refreshFromSources,
      lookup: async (text) => {
        if (!get().manifest) await refreshFromBundled();
        return deps.lookup.lookup(text);
      },
    };
  });
}

export function createRuntimeBackedDictionaryStore(
  deps: RuntimeBackedDictionaryStoreDependencies,
): UseBoundStore<StoreApi<DictionaryStoreState>> {
  let runtimePromise: Promise<DictionaryRuntime> | undefined;
  const runtime = () => {
    if (!runtimePromise) {
      const operation = deps.loadRuntime();
      runtimePromise = operation;
      void operation.catch(() => {
        if (runtimePromise === operation) runtimePromise = undefined;
      });
    }
    return runtimePromise;
  };
  return createDictionaryStore({
    manager: {
      refresh: async (manifest) => (await runtime()).manager.refresh(manifest),
      install: async (descriptor, onStatus) =>
        (await runtime()).manager.install(descriptor, onStatus),
      remove: async (language) => (await runtime()).manager.remove(language),
    },
    lookup: { lookup: async (text) => (await runtime()).lookup.lookup(text) },
    fetchRemoteManifest: deps.fetchRemoteManifest,
    getBundledManifest: deps.getBundledManifest,
  });
}
