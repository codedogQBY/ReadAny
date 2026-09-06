import { DEFAULT_DICTIONARY_MANIFEST_URL } from "@readany/core/dictionary/dictionary-config";
export { DICTIONARY_BUNDLED_MANIFEST } from "@readany/core/dictionary/dictionary-config";
export const DICTIONARY_REMOTE_MANIFEST_URL =
  process.env.EXPO_PUBLIC_DICTIONARY_MANIFEST_URL?.trim() || DEFAULT_DICTIONARY_MANIFEST_URL;
