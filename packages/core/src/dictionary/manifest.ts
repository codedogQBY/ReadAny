import { z } from "zod";
import type { DictionaryManifest } from "./types";

export const MAX_DICTIONARY_PACK_BYTES = 150 * 1024 * 1024;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:(?:0|[1-9]\d*)|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const semverSchema = z.string().regex(SEMVER);
const calendarDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  });

const descriptorFields = {
  version: semverSchema,
  schemaVersion: z.literal(1),
  sourceDumpDate: calendarDateSchema,
  sizeBytes: z.number().int().positive().max(MAX_DICTIONARY_PACK_BYTES),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  url: httpsUrlSchema,
  sourceArchiveUrl: httpsUrlSchema,
  attributionUrl: httpsUrlSchema,
} as const;

const englishPackDescriptorSchema = z.discriminatedUnion("sourceEdition", [
  z.strictObject({
    ...descriptorFields,
    language: z.literal("en"),
    sourceEdition: z.literal("wordnet-3.1"),
    license: z.literal("WordNet 3.1 License"),
  }),
  z.strictObject({
    ...descriptorFields,
    language: z.literal("en"),
    sourceEdition: z.literal("enwiktionary"),
    license: z.literal("CC BY-SA 4.0"),
  }),
]);

const chinesePackDescriptorSchema = z.strictObject({
  ...descriptorFields,
  language: z.literal("zh"),
  sourceEdition: z.literal("zhwiktionary"),
  license: z.literal("CC BY-SA 4.0"),
});

const dictionaryManifestSchema = z.strictObject({
  manifestVersion: z.literal(1),
  packs: z.strictObject({
    en: englishPackDescriptorSchema,
    zh: chinesePackDescriptorSchema,
  }),
});

export function parseDictionaryManifest(value: unknown): DictionaryManifest {
  return dictionaryManifestSchema.parse(value);
}
