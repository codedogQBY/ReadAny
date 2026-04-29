import type { Book } from "../types";

export interface ImportBooksResult {
  imported: Book[];
  skippedDuplicates: Array<{
    name: string;
    existingBook: Book;
  }>;
  failures: Array<{
    name: string;
    error: string;
  }>;
}

export interface ImportDuplicateIndex {
  byHash: Map<string, Book>;
  byName: Map<string, Book>;
}

function getPathLeaf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() || normalized;
}

export function stripBookExtension(name: string): string {
  return name.trim().replace(/\.(epub|pdf|mobi|azw|azw3|cbz|cbr|fb2|fbz|txt)$/i, "");
}

export function normalizeImportIdentity(value: string): string {
  return stripBookExtension(getPathLeaf(value))
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildBookNameCandidates(book: Book): string[] {
  const candidates = [book.meta.title, getPathLeaf(book.filePath)]
    .filter(Boolean)
    .map((value) => normalizeImportIdentity(value as string))
    .filter(Boolean);

  return [...new Set(candidates)];
}

export function createImportDuplicateIndex(books: Book[]): ImportDuplicateIndex {
  const byHash = new Map<string, Book>();
  const byName = new Map<string, Book>();

  for (const book of books) {
    if (book.fileHash) {
      byHash.set(book.fileHash, book);
    }

    for (const candidate of buildBookNameCandidates(book)) {
      if (!byName.has(candidate)) {
        byName.set(candidate, book);
      }
    }
  }

  return { byHash, byName };
}

export function findDuplicateBookByHash(
  index: ImportDuplicateIndex,
  fileHash?: string,
): Book | null {
  if (!fileHash) return null;
  return index.byHash.get(fileHash) ?? null;
}

export function findLikelyDuplicateBook(
  index: ImportDuplicateIndex,
  candidate: {
    name?: string;
    title?: string;
  },
): Book | null {
  const normalizedCandidates = [candidate.title, candidate.name]
    .filter(Boolean)
    .map((value) => normalizeImportIdentity(value as string))
    .filter(Boolean);

  for (const normalized of normalizedCandidates) {
    const existing = index.byName.get(normalized);
    if (existing) return existing;
  }

  return null;
}

export function createEmptyImportBooksResult(): ImportBooksResult {
  return {
    imported: [],
    skippedDuplicates: [],
    failures: [],
  };
}
