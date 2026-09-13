import type { BookMeta } from "@readany/core/types";
import { mergeBookMetadataSources } from "@readany/core/utils";
import type { ExtractedMeta } from "./metadata-extractor";

export function shouldPersistEmbeddedCover(
  existing?: Partial<BookMeta>,
  imported?: Partial<BookMeta>,
): boolean {
  return !existing?.coverUrl?.trim() && !imported?.coverUrl?.trim();
}

export function buildImportedBookMeta(input: {
  existing?: Partial<BookMeta>;
  opds?: Partial<BookMeta>;
  embedded?: Partial<BookMeta> | (ExtractedMeta & { coverUrl?: string });
  fallbackTitle: string;
}): BookMeta {
  const merged = mergeBookMetadataSources(input.existing, input.opds, input.embedded, {
    title: input.fallbackTitle,
    author: "",
  });
  return {
    ...input.existing,
    ...merged,
    title: merged.title || input.existing?.title || "Untitled",
    author: merged.author || input.existing?.author || "",
  };
}
