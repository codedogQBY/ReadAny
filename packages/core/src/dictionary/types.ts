export type DictionaryLanguage = "en" | "zh";

export interface DictionarySense {
  order: number;
  definition: string;
}

export interface DictionaryEntry {
  id: number;
  language: DictionaryLanguage;
  headword: string;
  simplified?: string;
  traditional?: string;
  pronunciation?: string;
  partOfSpeech: string;
  senses: DictionarySense[];
}

interface DictionaryPackDescriptorBase {
  version: string;
  schemaVersion: 1;
  sourceDumpDate: string;
  sizeBytes: number;
  sha256: string;
  url: string;
  sourceArchiveUrl: string;
  attributionUrl: string;
}

export type DictionarySourceEdition = "wordnet-3.1" | "enwiktionary" | "zhwiktionary";
export type DictionaryLicense = "WordNet 3.1 License" | "CC BY-SA 4.0";

export type DictionarySource =
  | {
      language: "en";
      sourceEdition: "wordnet-3.1";
      license: "WordNet 3.1 License";
    }
  | {
      language: "en";
      sourceEdition: "enwiktionary";
      license: "CC BY-SA 4.0";
    }
  | {
      language: "zh";
      sourceEdition: "zhwiktionary";
      license: "CC BY-SA 4.0";
    };

export type EnglishDictionaryPackDescriptor = DictionaryPackDescriptorBase &
  Extract<DictionarySource, { language: "en" }>;

export type ChineseDictionaryPackDescriptor = DictionaryPackDescriptorBase &
  Extract<DictionarySource, { language: "zh" }>;

export type DictionaryPackDescriptor =
  | EnglishDictionaryPackDescriptor
  | ChineseDictionaryPackDescriptor;

export interface DictionaryManifest {
  manifestVersion: 1;
  packs: {
    en: EnglishDictionaryPackDescriptor;
    zh: ChineseDictionaryPackDescriptor;
  };
}

export type PreparedDictionarySelection =
  | { ok: true; language: DictionaryLanguage; key: string; displayText: string }
  | { ok: false; reason: "empty" | "mixed-script" | "unsupported-script" | "too-long" };
