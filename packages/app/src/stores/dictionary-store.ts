import {
  DEFAULT_DICTIONARY_MANIFEST_URL,
  DICTIONARY_BUNDLED_MANIFEST,
} from "@readany/core/dictionary/dictionary-config";
import { createRuntimeBackedDictionaryStore } from "@readany/core/dictionary/dictionary-store";

export const DICTIONARY_REMOTE_MANIFEST_URL =
  import.meta.env.VITE_DICTIONARY_MANIFEST_URL?.trim() || DEFAULT_DICTIONARY_MANIFEST_URL;

export const useDictionaryStore = createRuntimeBackedDictionaryStore({
  loadRuntime: async () =>
    (await import("@/lib/dictionary/desktop-dictionary")).loadDesktopDictionaryRuntime(),
  fetchRemoteManifest: async () => {
    const { fetch } = await import("@tauri-apps/plugin-http");
    const response = await fetch(DICTIONARY_REMOTE_MANIFEST_URL);
    if (!response.ok)
      throw new Error(`Dictionary manifest request failed: HTTP ${response.status}`);
    return response.json();
  },
  getBundledManifest: async () => DICTIONARY_BUNDLED_MANIFEST,
});
