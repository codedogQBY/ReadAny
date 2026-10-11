import manifest from "./dictionary-manifest.json";
import { parseDictionaryManifest } from "./manifest";
export const DICTIONARY_BUNDLED_MANIFEST = parseDictionaryManifest(manifest);
export const DEFAULT_DICTIONARY_MANIFEST_URL =
  "https://raw.githubusercontent.com/codedogQBY/ReadAny/main/dictionary-packs/manifest.json";
