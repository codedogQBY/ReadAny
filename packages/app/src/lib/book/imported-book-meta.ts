import type { BookMeta } from "@readany/core/types";
import {
  type ExtractedBookMetadata,
  mergeBookMetadataSources,
  normalizeIsbn,
} from "@readany/core/utils";

type EmbeddedBookMetadata = ExtractedBookMetadata & { coverUrl?: string };

type FoliateLanguageMap = Record<string, string>;
type FoliateText = string | FoliateLanguageMap;

export interface FoliateContributor {
  name?: FoliateText;
  sortAs?: FoliateText;
  role?: string[];
  code?: string;
  scheme?: string;
}

export interface FoliateDocumentMetadata extends Record<string, unknown> {
  identifier?: string;
  altIdentifier?: Array<string | { scheme?: string; value?: string }>;
  isbn?: string;
  title?: FoliateText;
  author?: string | FoliateContributor | Array<string | FoliateContributor>;
  contributor?: string | FoliateContributor | Array<string | FoliateContributor>;
  publisher?: string | FoliateContributor | Array<string | FoliateContributor>;
  language?: string | string[];
  published?: string;
  description?: FoliateText;
  subject?: string | FoliateContributor | Array<string | FoliateContributor>;
}

export interface DesktopImportFileContext {
  path: string;
  name?: string;
  metadata?: Partial<BookMeta>;
}

export type DesktopImportFile = string | DesktopImportFileContext;

export function shouldPersistEmbeddedCover(
  existing?: Partial<BookMeta>,
  imported?: Partial<BookMeta>,
): boolean {
  return !existing?.coverUrl?.trim() && !imported?.coverUrl?.trim();
}

export function buildImportedBookMeta(input: {
  existing?: Partial<BookMeta>;
  opds?: Partial<BookMeta>;
  embedded?: EmbeddedBookMetadata;
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

export function normalizeDesktopImportFile(file: DesktopImportFile): DesktopImportFileContext {
  return typeof file === "string" ? { path: file } : file;
}

export function buildDesktopImportedBookMeta(input: {
  file: DesktopImportFile;
  existing?: Partial<BookMeta>;
  embedded?: EmbeddedBookMetadata;
  fallbackTitle: string;
}): BookMeta {
  const file = normalizeDesktopImportFile(input.file);
  return buildImportedBookMeta({
    existing: input.existing,
    opds: file.metadata,
    embedded: input.embedded,
    fallbackTitle: input.fallbackTitle,
  });
}

export function fromDocumentMetadata(
  meta: FoliateDocumentMetadata | undefined,
): ExtractedBookMetadata {
  return {
    title: firstMetadataText(meta?.title),
    author: joinMetadataText(meta?.author),
    publisher: joinMetadataText(meta?.publisher) || undefined,
    language: firstMetadataText(meta?.language) || undefined,
    isbn:
      firstValidIsbn(meta?.isbn, explicitIsbnIdentifier(meta?.identifier), meta?.altIdentifier) ||
      undefined,
    publishDate: firstMetadataText(meta?.published) || undefined,
    description: firstMetadataText(meta?.description) || undefined,
    subjects: collectMetadataText(meta?.subject),
  };
}

export function fromPdfMetadata(
  info: Record<string, unknown> | undefined,
  metadata: { get(name: string): unknown } | undefined,
): ExtractedBookMetadata {
  const xmp = (name: string) => metadata?.get(name);
  const xmpSubjects = collectMetadataText(xmp("dc:subject"));
  const infoSubjects = splitPdfKeywords(info?.Keywords);

  return {
    title: firstMetadataText(xmp("dc:title")) || firstMetadataText(info?.Title),
    author: joinMetadataText(xmp("dc:creator")) || joinMetadataText(info?.Author),
    publisher:
      joinMetadataText(xmp("dc:publisher")) || joinMetadataText(info?.Publisher) || undefined,
    language:
      firstMetadataText(xmp("dc:language")) || firstMetadataText(info?.Language) || undefined,
    isbn: firstValidIsbn(xmp("dc:identifier"), info?.ISBN, info?.Isbn, info?.isbn) || undefined,
    publishDate:
      firstMetadataText(xmp("prism:publicationdate")) ||
      firstMetadataText(xmp("dcterms:issued")) ||
      firstMetadataText(getPdfCustomInfo(info, "PublicationDate")) ||
      firstMetadataText(getPdfCustomInfo(info, "PublishDate")) ||
      firstMetadataText(getPdfCustomInfo(info, "Published")) ||
      undefined,
    description:
      firstMetadataText(xmp("dc:description")) || firstMetadataText(info?.Subject) || undefined,
    subjects: xmpSubjects.length > 0 ? xmpSubjects : infoSubjects,
  };
}

function collectMetadataText(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(collectMetadataText);
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  if (record.name != null) return collectMetadataText(record.name);
  if (record.value != null) return collectMetadataText(record.value);
  return Object.values(record).flatMap(collectMetadataText);
}

function firstMetadataText(value: unknown): string {
  return collectMetadataText(value)[0] ?? "";
}

function joinMetadataText(value: unknown): string {
  return collectMetadataText(value).join(", ");
}

function explicitIsbnIdentifier(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  return /^(?:urn:isbn:|isbn(?:-1[03])?:)/i.test(value.trim()) ? value : undefined;
}

function firstValidIsbn(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstValidIsbn(...value);
      if (nested) return nested;
      continue;
    }
    if (value && typeof value === "object") {
      const candidate = value as { scheme?: unknown; value?: unknown };
      if (typeof candidate.scheme === "string" && candidate.scheme.toLowerCase() === "isbn") {
        const isbn = normalizeIsbn(candidate.value);
        if (isbn) return isbn;
      }
      continue;
    }
    const isbn = normalizeIsbn(value);
    if (isbn) return isbn;
  }
  return "";
}

function splitPdfKeywords(value: unknown): string[] {
  const text = firstMetadataText(value);
  return text
    ? text
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function getPdfCustomInfo(info: Record<string, unknown> | undefined, key: string): unknown {
  const custom = info?.Custom;
  return custom && typeof custom === "object"
    ? (custom as Record<string, unknown>)[key]
    : undefined;
}
