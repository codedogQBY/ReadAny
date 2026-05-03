import {
  createRangeReadableFile,
  extractBookMetadata,
  extractBookMetadataFromFile,
} from "@/lib/book/metadata-extractor";
import { queueBook as queueAutoVectorize } from "@/lib/rag/auto-vectorize-service";
import {
  type ImportBooksResult,
  createEmptyImportBooksResult,
  createImportDuplicateIndex,
  findDuplicateBookByHash,
} from "@readany/core";
import * as db from "@readany/core/db/database";
import { runWithDbRetry } from "@readany/core/db/write-retry";
import { getPlatformService } from "@readany/core/services";
import type { Book, BookGroup, LibraryFilter, SortField, SortOrder } from "@readany/core/types";
import { generateId } from "@readany/core/utils";
import { create } from "zustand";
import { debouncedSave, loadFromFS } from "./persist";
import { useVectorModelStore } from "./vector-model-store";

// Hermes (React Native) only supports UTF-8 in TextDecoder.
// text-encoding polyfill detects the native TextDecoder and skips installing
// its own full-encoding version. Workaround: temporarily hide the native
// TextDecoder so the polyfill installs unconditionally, then restore native.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _nativeTD = globalThis.TextDecoder;
const _nativeTE = globalThis.TextEncoder;
// @ts-expect-error — temporarily remove native TextDecoder/TextEncoder
globalThis.TextDecoder = undefined;
// @ts-expect-error
globalThis.TextEncoder = undefined;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TextDecoder: PolyfillTextDecoder } = require("text-encoding") as {
  TextDecoder: typeof TextDecoder;
};
// Restore native TextDecoder/TextEncoder for rest of the app
globalThis.TextDecoder = _nativeTD;
globalThis.TextEncoder = _nativeTE;

// Verify polyfill can decode non-UTF-8 at module load time
try {
  new PolyfillTextDecoder("gb18030");
} catch (e) {
  console.error("[text-encoding] Polyfill BROKEN: gb18030 not supported!", e);
}

export type LibraryViewMode = "grid" | "list";
export interface RemoveBookOptions {
  preserveData?: boolean;
}

export interface LibraryState {
  books: Book[];
  groups: BookGroup[];
  filter: LibraryFilter;
  viewMode: LibraryViewMode;
  isGroupView: boolean;
  isImporting: boolean;
  isLoaded: boolean;
  allTags: string[];
  activeTag: string;
  activeGroupId: string;

  loadBooks: (deletedTags?: string[]) => Promise<void>;
  loadGroups: () => Promise<void>;
  setBooks: (books: Book[]) => void;
  setGroupView: (enabled: boolean) => void;
  setActiveGroupId: (groupId: string) => void;
  addBook: (book: Book) => Promise<void>;
  removeBook: (bookId: string, options?: RemoveBookOptions) => Promise<void>;
  updateBook: (bookId: string, updates: Partial<Book>) => void;
  setFilter: (filter: Partial<LibraryFilter>) => void;
  setViewMode: (mode: LibraryViewMode) => void;
  setSortField: (field: SortField) => void;
  setSortOrder: (order: SortOrder) => void;
  importBooks: (files: Array<{ uri: string; name?: string }>) => Promise<ImportBooksResult>;
  inspectDeletedBookCandidate: (
    bookId: string,
    file: { uri: string; name?: string },
  ) => Promise<{
    title: string;
    author: string;
    format: Book["format"];
    fileHash?: string;
  } | null>;
  reimportDeletedBook: (
    bookId: string,
    file: { uri: string; name?: string },
  ) => Promise<Book | null>;
  setActiveTag: (tag: string) => void;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  renameTag: (oldName: string, newName: string) => void;
  addGroup: (name: string) => Promise<BookGroup | null>;
  renameGroup: (groupId: string, name: string) => void;
  removeGroup: (groupId: string) => Promise<void>;
  moveBookToGroup: (bookId: string, groupId?: string) => void;
  moveBooksToGroup: (bookIds: string[], groupId?: string) => void;
  removeBookFromGroup: (bookId: string) => void;
  addTagToBook: (bookId: string, tag: string) => void;
  removeTagFromBook: (bookId: string, tag: string) => void;
}

async function resolveAppPath(relativePath: string): Promise<string> {
  const platform = getPlatformService();
  const appData = await platform.getAppDataDir();
  return platform.joinPath(appData, relativePath);
}

function isRelativeAppPath(path: string): boolean {
  return (
    !path.startsWith("/") &&
    !path.startsWith("file://") &&
    !path.startsWith("asset://") &&
    !path.startsWith("http")
  );
}

async function ensureAppSubDir(subDir: string): Promise<void> {
  const platform = getPlatformService();
  const absDir = await resolveAppPath(subDir);
  try {
    await platform.mkdir(absDir);
  } catch {
    /* may exist */
  }
}

async function saveCoverToAppData(bookId: string, coverBlob: Blob): Promise<string> {
  const platform = getPlatformService();
  await ensureAppSubDir("covers");
  const ext = coverBlob.type.includes("png") ? "png" : "jpg";
  const relativePath = `covers/${bookId}.${ext}`;
  const absPath = await resolveAppPath(relativePath);
  const arrayBuffer = await coverBlob.arrayBuffer();
  await platform.writeFile(absPath, new Uint8Array(arrayBuffer));
  return relativePath;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

const MOBILE_IMPORT_METADATA_MAX_BYTES = 32 * 1024 * 1024;
const MOBILE_AUTO_VECTORIZER_MAX_BYTES = 12 * 1024 * 1024;

async function getMobileFileStat(path: string): Promise<{ size: number; md5?: string }> {
  const LegacyFileSystem = await import("expo-file-system/legacy");
  const info = await LegacyFileSystem.getInfoAsync(path);
  return {
    size: info.exists && !info.isDirectory ? (info.size ?? 0) : 0,
    md5: undefined,
  };
}

async function extractMobileImportMetadata(params: {
  filePath: string;
  format: Book["format"];
  fileName: string;
  fileSize: number;
  sourceBytes?: Uint8Array;
}) {
  const { filePath, format, fileName, fileSize, sourceBytes } = params;

  if (format === "epub") {
    const bytes =
      sourceBytes ??
      (fileSize > 0 && fileSize <= MOBILE_IMPORT_METADATA_MAX_BYTES
        ? await getPlatformService().readFile(filePath)
        : null);
    if (bytes) {
      return extractBookMetadata(bytes, format, fileName);
    }
    console.warn(
      `[extractMobileImportMetadata] Skip EPUB metadata for large file: ${fileName} (${fileSize} bytes)`,
    );
  }

  if (format === "mobi" || format === "azw" || format === "azw3") {
    const rangeReadable = await createRangeReadableFile(filePath, fileSize);
    return extractBookMetadataFromFile(rangeReadable, format, fileName);
  }

  return {
    title: fileName.replace(/\.\w+$/i, "") || "Untitled",
    author: "",
    coverBytes: null,
    coverMimeType: null,
  };
}

function shouldAutoVectorizeMobile(format: Book["format"], size: number): boolean {
  if (size <= 0 || size > MOBILE_AUTO_VECTORIZER_MAX_BYTES) {
    return false;
  }
  return format === "epub" || format === "txt";
}

/**
 * Ensure raw bytes are UTF-8 encoded. Hermes (React Native) only supports
 * UTF-8 in TextDecoder — GBK/GB18030/Shift-JIS etc. are NOT supported.
 * If the bytes are not UTF-8, use text-encoding polyfill to convert to UTF-8.
 */
function ensureUtf8Bytes(bytes: Uint8Array): Uint8Array {
  // Check BOM markers
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes; // UTF-8 with BOM
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = new PolyfillTextDecoder("utf-16le").decode(bytes);
    return new TextEncoder().encode(text);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const text = new PolyfillTextDecoder("utf-16be").decode(bytes);
    return new TextEncoder().encode(text);
  }

  // Try strict UTF-8 validation on a sample.
  // IMPORTANT: must align the sample end to a UTF-8 character boundary,
  // otherwise a multi-byte char split at the boundary causes a false failure.
  let sampleEnd = Math.min(bytes.length, 64 * 1024);
  // Back up past any UTF-8 continuation bytes (10xxxxxx = 0x80-0xBF) at the end
  while (sampleEnd > 0 && sampleEnd < bytes.length && ((bytes[sampleEnd] ?? 0) & 0xc0) === 0x80) {
    sampleEnd--;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, sampleEnd));
    if (bytes.length > sampleEnd * 2) {
      let midStart = Math.floor(bytes.length / 2);
      // Align mid-sample start to a UTF-8 character boundary
      while (midStart < bytes.length && ((bytes[midStart] ?? 0) & 0xc0) === 0x80) {
        midStart++;
      }
      let midEnd = Math.min(midStart + 8192, bytes.length);
      while (midEnd > midStart && midEnd < bytes.length && ((bytes[midEnd] ?? 0) & 0xc0) === 0x80) {
        midEnd--;
      }
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(midStart, midEnd));
    }
    console.log("[ensureUtf8Bytes] passed UTF-8 validation");
    return bytes; // Valid UTF-8
  } catch {
    // Not valid UTF-8 — detect which encoding it is
  }

  // Disambiguate GBK/GB18030 vs Shift-JIS by counting distinctive byte patterns.
  // GBK double-byte: lead 0xA1-0xFE, trail 0xA1-0xFE (dominant in Chinese text)
  // Shift-JIS distinctive: lead 0x81-0x9F (below GBK lead range)
  const sample = bytes.subarray(0, Math.min(4096, bytes.length));
  let highBytes = 0;
  for (let i = 0; i < sample.length; i++) {
    if ((sample[i] ?? 0) >= 0x80) highBytes++;
  }
  const highRatio = sample.length > 0 ? highBytes / sample.length : 0;

  let gbkPairs = 0;
  let sjisDistinctPairs = 0;
  for (let i = 0; i < sample.length - 1; i++) {
    const b1 = sample[i] ?? 0;
    const b2 = sample[i + 1] ?? 0;
    if (b1 >= 0xa1 && b1 <= 0xfe && b2 >= 0xa1 && b2 <= 0xfe) {
      gbkPairs++;
      i++;
    } else if (
      b1 >= 0x81 &&
      b1 <= 0x9f &&
      ((b2 >= 0x40 && b2 <= 0x7e) || (b2 >= 0x80 && b2 <= 0xfc))
    ) {
      sjisDistinctPairs++;
      i++;
    }
  }

  const isShiftJIS = sjisDistinctPairs > 0 && sjisDistinctPairs > gbkPairs;
  const encoding = isShiftJIS ? "shift_jis" : highRatio > 0.1 ? "gb18030" : "gbk";
  console.log(`[ensureUtf8Bytes] Detected non-UTF-8 encoding: ${encoding}, converting to UTF-8`);

  try {
    const text = new PolyfillTextDecoder(encoding).decode(bytes);
    return new TextEncoder().encode(text);
  } catch (err) {
    console.warn("[ensureUtf8Bytes] Polyfill decode failed, returning raw bytes:", err);
    return bytes;
  }
}

/**
 * Copy book to app data directory. Uses OS-level file copy when possible
 * to avoid loading the full file into JS memory.
 * Falls back to readFile+writeFile only when sourceBytes are already available.
 */
async function copyBookToAppData(
  bookId: string,
  ext: string,
  srcPath: string,
  sourceBytes?: Uint8Array,
): Promise<{ relativePath: string; absPath: string }> {
  const platform = getPlatformService();
  await ensureAppSubDir("books");
  const relativePath = `books/${bookId}.${ext}`;
  const absPath = await resolveAppPath(relativePath);

  if (sourceBytes) {
    // If bytes are already in memory (e.g. from hash calculation), just write them
    await platform.writeFile(absPath, sourceBytes);
  } else {
    // Use expo-file-system File.copy() for OS-level copy (no JS memory)
    const ExpoFS = await import("expo-file-system");
    const srcFile = new ExpoFS.File(srcPath);
    const destFile = new ExpoFS.File(absPath);
    if (destFile.exists) {
      destFile.delete();
    }
    srcFile.copy(destFile);
  }
  return { relativePath, absPath };
}

async function persistBookUpdate(bookId: string, updates: Partial<Book>): Promise<void> {
  await runWithDbRetry(() => db.updateBook(bookId, updates));
}

async function restoreDeletedMobileBook(
  bookId: string,
  fileInfo: { uri: string; name?: string },
): Promise<Book | null> {
  await db.initDatabase();
  const originalBook = await db.getBook(bookId, { includeDeleted: true });
  if (!originalBook) return null;

  const filePath = fileInfo.uri;
  const originalName = fileInfo.name
    ? decodeURIComponent(fileInfo.name)
    : decodeURIComponent(filePath.split("/").pop() || "book");
  const ext = originalName.split(".").pop()?.toLowerCase();
  const formatMap: Record<string, Book["format"]> = {
    epub: "epub",
    pdf: "pdf",
    mobi: "mobi",
    azw: "azw",
    azw3: "azw3",
    cbz: "cbz",
    cbr: "cbz",
    fb2: "fb2",
    fbz: "fbz",
    txt: "txt",
  };
  const format: Book["format"] = formatMap[ext || ""] || "epub";
  const fileName = originalName;
  const platform = getPlatformService();
  const { size: fileSize, md5: fileHash } = await getMobileFileStat(filePath);

  if (ext === "txt") {
    const sourceBytes = await platform.readFile(filePath);
    const { TxtToEpubConverter } = await import("@readany/core/utils/txt-to-epub");
    const bytes = ensureUtf8Bytes(sourceBytes);
    const txtFile = {
      name: fileName,
      size: bytes.byteLength,
      type: "text/plain",
      arrayBuffer: () =>
        Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      slice: (start?: number, end?: number) => {
        const sliced = bytes.slice(start ?? 0, end ?? bytes.byteLength);
        return {
          arrayBuffer: () =>
            Promise.resolve(
              sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength),
            ),
          size: sliced.byteLength,
        };
      },
      stream: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
    } as unknown as File;

    const conversion = await new TxtToEpubConverter().convertToBytes({ file: txtFile });
    await ensureAppSubDir("books");
    const relativePath = `books/${bookId}.epub`;
    await platform.writeFile(await resolveAppPath(relativePath), conversion.epubBytes);

    return {
      ...originalBook,
      filePath: relativePath,
      format: "epub",
      meta: {
        ...originalBook.meta,
        title: conversion.bookTitle || originalBook.meta.title || fileName.replace(/\.\w+$/i, ""),
        author: originalBook.meta.author || "",
        coverUrl: originalBook.meta.coverUrl,
      },
      deletedAt: undefined,
      fileHash,
      syncStatus: "local",
      isVectorized: false,
      vectorizeProgress: 0,
      updatedAt: Date.now(),
      lastOpenedAt: Date.now(),
    };
  }

  const { relativePath } = await copyBookToAppData(bookId, ext || "epub", filePath);

  let title = originalBook.meta.title || fileName.replace(/\.\w+$/i, "") || "Untitled";
  let author = originalBook.meta.author || "";
  let coverUrl = originalBook.meta.coverUrl;

  try {
    const meta = await extractMobileImportMetadata({
      filePath,
      format,
      fileName,
      fileSize,
    });
    if (meta.title) title = meta.title;
    if (meta.author) author = meta.author;

    if (meta.coverBytes && meta.coverBytes.length > 0) {
      const mimeType = meta.coverMimeType || "image/jpeg";
      const coverExt = mimeType.includes("png") ? "png" : "jpg";
      await ensureAppSubDir("covers");
      const coverRelPath = `covers/${bookId}.${coverExt}`;
      await platform.writeFile(await resolveAppPath(coverRelPath), meta.coverBytes);
      coverUrl = coverRelPath;
    }
  } catch (metaErr) {
    console.warn(`[restoreDeletedMobileBook] Metadata extraction failed for ${fileName}:`, metaErr);
  }

  return {
    ...originalBook,
    filePath: relativePath,
    format,
    meta: {
      ...originalBook.meta,
      title,
      author,
      coverUrl,
    },
    deletedAt: undefined,
    fileHash,
    syncStatus: "local",
    isVectorized: false,
    vectorizeProgress: 0,
    updatedAt: Date.now(),
    lastOpenedAt: Date.now(),
  };
}

async function inspectDeletedMobileBookCandidate(
  bookId: string,
  fileInfo: { uri: string; name?: string },
): Promise<{
  title: string;
  author: string;
  format: Book["format"];
  fileHash?: string;
} | null> {
  await db.initDatabase();
  const originalBook = await db.getBook(bookId, { includeDeleted: true });
  if (!originalBook) return null;

  const filePath = fileInfo.uri;
  const originalName = fileInfo.name
    ? decodeURIComponent(fileInfo.name)
    : decodeURIComponent(filePath.split("/").pop() || "book");
  const ext = originalName.split(".").pop()?.toLowerCase();
  const formatMap: Record<string, Book["format"]> = {
    epub: "epub",
    pdf: "pdf",
    mobi: "mobi",
    azw: "azw",
    azw3: "azw3",
    cbz: "cbz",
    cbr: "cbz",
    fb2: "fb2",
    fbz: "fbz",
    txt: "txt",
  };
  const format: Book["format"] = formatMap[ext || ""] || "epub";
  const fileName = originalName;
  const { size: fileSize, md5: fileHash } = await getMobileFileStat(filePath);

  if (ext === "txt") {
    try {
      const { TxtToEpubConverter } = await import("@readany/core/utils/txt-to-epub");
      const platform = getPlatformService();
      const sourceBytes = await platform.readFile(filePath);
      const bytes = ensureUtf8Bytes(sourceBytes);
      const txtFile = {
        name: fileName,
        size: bytes.byteLength,
        type: "text/plain",
        arrayBuffer: () =>
          Promise.resolve(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          ),
        slice: (start?: number, end?: number) => {
          const sliced = bytes.slice(start ?? 0, end ?? bytes.byteLength);
          return {
            arrayBuffer: () =>
              Promise.resolve(
                sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength),
              ),
            size: sliced.byteLength,
          };
        },
        stream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
      } as unknown as File;
      const conversion = await new TxtToEpubConverter().convertToBytes({ file: txtFile });
      return {
        title: conversion.bookTitle || fileName.replace(/\.\w+$/i, "") || originalBook.meta.title,
        author: "",
        format: "epub",
        fileHash,
      };
    } catch {
      return {
        title: fileName.replace(/\.\w+$/i, "") || originalBook.meta.title,
        author: "",
        format: "epub",
        fileHash,
      };
    }
  }

  let title = fileName.replace(/\.\w+$/i, "") || originalBook.meta.title || "Untitled";
  let author = "";
  try {
    const meta = await extractMobileImportMetadata({
      filePath,
      format,
      fileName,
      fileSize,
    });
    if (meta.title) title = meta.title;
    if (meta.author) author = meta.author;
  } catch {
    // Fallback to filename only.
  }

  return { title, author, format, fileHash };
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  groups: [],
  filter: {
    search: "",
    tags: [],
    sortField: "lastOpenedAt",
    sortOrder: "desc",
  },
  viewMode: "grid",
  isGroupView: true,
  isImporting: false,
  isLoaded: false,
  allTags: [],
  activeTag: "",
  activeGroupId: "",

  loadBooks: async (deletedTags?: string[]) => {
    const computeTags = (books: Book[]) => {
      const tagSet = new Set<string>();
      for (const b of books) for (const t of b.tags) tagSet.add(t);
      return [...tagSet].sort();
    };

    try {
      const cached = await loadFromFS<Book[]>("library-books");
      const cachedGroups = await loadFromFS<BookGroup[]>("library-groups");
      if (cached && cached.length > 0) {
        set({
          books: cached,
          groups: cachedGroups ?? get().groups,
          isLoaded: true,
          allTags: computeTags(cached),
        });
      }
    } catch {
      /* cache miss */
    }

    try {
      await db.initDatabase();
      const [books, groups] = await Promise.all([db.getBooks(), db.getGroups()]);
      const dbTags = computeTags(books);

      // Load saved tags from FS (may include empty tags not assigned to any book)
      let savedTags: string[] = [];
      try {
        const loaded = await loadFromFS<string[]>("library-tags");
        if (loaded) savedTags = loaded;
      } catch {
        /* no saved tags */
      }

      // Remove deleted tags from savedTags
      const deletedSet = new Set(deletedTags || []);
      savedTags = savedTags.filter((t) => !deletedSet.has(t));

      // Merge: dbTags (from books) + empty tags from FS (not in dbTags and not deleted)
      const dbTagSet = new Set(dbTags);
      const emptyTags = savedTags.filter((t) => !dbTagSet.has(t) && !deletedSet.has(t));
      const allTags = [...dbTags, ...emptyTags].sort();

      set({ books, groups, isLoaded: true, allTags });
      debouncedSave("library-books", books);
      debouncedSave("library-groups", groups);
      debouncedSave("library-tags", allTags);
    } catch (err) {
      console.error("Failed to load books from database:", err);
      set({ isLoaded: true });
    }
  },

  loadGroups: async () => {
    try {
      await db.initDatabase();
      const groups = await db.getGroups();
      set({ groups });
      debouncedSave("library-groups", groups);
    } catch (err) {
      console.error("Failed to load groups from database:", err);
    }
  },

  setBooks: (books) => set({ books }),

  setGroupView: (enabled) =>
    set((state) => ({
      isGroupView: enabled,
      activeGroupId: enabled ? state.activeGroupId : "",
    })),

  setActiveGroupId: (groupId) =>
    set({
      activeGroupId: groupId,
      activeTag: "",
      isGroupView: Boolean(groupId) || get().isGroupView,
    }),

  addBook: async (book) => {
    set((state) => ({ books: [...state.books, book] }));
    try {
      await db.initDatabase();
      await db.insertBook(book);
    } catch (err) {
      console.error("Failed to insert book into database:", err);
    }
    debouncedSave("library-books", get().books);
  },

  removeBook: async (bookId, options = {}) => {
    const preserveData = options.preserveData ?? false;
    const bookToRemove = get().books.find((b) => b.id === bookId);
    set((state) => ({ books: state.books.filter((b) => b.id !== bookId) }));
    try {
      await db.initDatabase();
      await db.deleteBook(bookId, { preserveData });
    } catch (err) {
      console.error("Failed to delete book from database:", err);
    }
    if (bookToRemove) {
      try {
        const platform = getPlatformService();
        if (bookToRemove.filePath && isRelativeAppPath(bookToRemove.filePath)) {
          const absPath = await resolveAppPath(bookToRemove.filePath);
          await platform.deleteFile(absPath);
        }
        if (
          !preserveData &&
          bookToRemove.meta.coverUrl &&
          isRelativeAppPath(bookToRemove.meta.coverUrl)
        ) {
          const coverAbsPath = await resolveAppPath(bookToRemove.meta.coverUrl);
          await platform.deleteFile(coverAbsPath);
        }
      } catch {
        /* file may not exist */
      }
    }
    debouncedSave("library-books", get().books);
  },

  updateBook: (bookId, updates) => {
    set((state) => ({
      books: state.books.map((b) => (b.id === bookId ? { ...b, ...updates } : b)),
    }));
    persistBookUpdate(bookId, updates).catch((err) =>
      console.error("Failed to update book in database:", err),
    );
    debouncedSave("library-books", get().books);
  },

  setFilter: (filter) => set((state) => ({ filter: { ...state.filter, ...filter } })),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSortField: (field) => set((state) => ({ filter: { ...state.filter, sortField: field } })),
  setSortOrder: (order) => set((state) => ({ filter: { ...state.filter, sortOrder: order } })),

  importBooks: async (files) => {
    set({ isImporting: true });
    const result = createEmptyImportBooksResult();
    const duplicateIndex = createImportDuplicateIndex(get().books);
    try {
      await db.initDatabase();
      for (const fileInfo of files) {
        const filePath = fileInfo.uri;
        const originalName = fileInfo.name
          ? decodeURIComponent(fileInfo.name)
          : decodeURIComponent(filePath.split("/").pop() || "book");
        try {
          const ext = originalName.split(".").pop()?.toLowerCase();
          const formatMap: Record<string, Book["format"]> = {
            epub: "epub",
            pdf: "pdf",
            mobi: "mobi",
            azw: "azw",
            azw3: "azw3",
            cbz: "cbz",
            cbr: "cbz",
            fb2: "fb2",
            fbz: "fbz",
            txt: "txt",
          };
          const format: Book["format"] = formatMap[ext || ""] || "epub";
          const fileName = originalName;
          const platform = getPlatformService();
          const { size: fileSize, md5: fileHash } = await getMobileFileStat(filePath);

          const existingDuplicate = findDuplicateBookByHash(duplicateIndex, fileHash);
          if (existingDuplicate) {
            result.skippedDuplicates.push({
              name: fileName,
              existingBook: existingDuplicate,
            });
            continue;
          }

          const deletedMatch = fileHash
            ? await db.getDeletedBookByFileHash(fileHash).catch(() => null)
            : null;
          const bookId = deletedMatch?.id ?? generateId();

          console.log(
            `[importBooks] Importing: name=${fileName}, format=${format}, uri=${filePath}`,
          );

          // For TXT files: convert to EPUB bytes directly, skip Blob/File (slow in RN)
          if (ext === "txt") {
            try {
              const { TxtToEpubConverter } = await import("@readany/core/utils/txt-to-epub");
              const sourceBytes = await platform.readFile(filePath);

              // Hermes only supports UTF-8 in TextDecoder. Convert GBK/GB18030
              // etc. to UTF-8 using text-encoding polyfill before passing to converter.
              const bytes = ensureUtf8Bytes(sourceBytes);

              // React Native Blob/File constructor doesn't support ArrayBuffer/Uint8Array.
              // Create a File-like shim that provides the methods TxtToEpubConverter needs.
              const txtFile = {
                name: fileName,
                size: bytes.byteLength,
                type: "text/plain",
                arrayBuffer: () =>
                  Promise.resolve(
                    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
                  ),
                slice: (start?: number, end?: number) => {
                  const sliced = bytes.slice(start ?? 0, end ?? bytes.byteLength);
                  return {
                    arrayBuffer: () =>
                      Promise.resolve(
                        sliced.buffer.slice(
                          sliced.byteOffset,
                          sliced.byteOffset + sliced.byteLength,
                        ),
                      ),
                    size: sliced.byteLength,
                  };
                },
                stream: () =>
                  new ReadableStream({
                    start(controller) {
                      controller.enqueue(bytes);
                      controller.close();
                    },
                  }),
              } as unknown as File;

              // Use convertToBytes: pure-JS ZIP builder, no Blob bridge
              const converter = new TxtToEpubConverter();
              const conversion = await converter.convertToBytes({ file: txtFile });

              // Write EPUB bytes directly to final app data location
              await ensureAppSubDir("books");
              const relativePath = `books/${bookId}.epub`;
              const absPath = await resolveAppPath(relativePath);
              await platform.writeFile(absPath, conversion.epubBytes);

              // TXT-converted EPUBs have no cover, and title is already known from converter.
              // Skip metadata extraction entirely — saves a full EPUB re-parse.
              const title = conversion.bookTitle || fileName.replace(/\.\w+$/i, "") || "Untitled";
              const book: Book = {
                id: bookId,
                filePath: relativePath,
                format: "epub",
                meta: {
                  ...(deletedMatch?.meta ?? {}),
                  title,
                  author: "",
                  coverUrl: deletedMatch?.meta.coverUrl,
                },
                groupId: deletedMatch?.groupId,
                progress: deletedMatch?.progress ?? 0,
                currentCfi: deletedMatch?.currentCfi,
                isVectorized: false,
                vectorizeProgress: 0,
                tags: deletedMatch?.tags ?? [],
                fileHash,
                syncStatus: "local",
                addedAt: deletedMatch?.addedAt ?? Date.now(),
                updatedAt: Date.now(),
                lastOpenedAt: deletedMatch?.lastOpenedAt ?? Date.now(),
              };

              if (deletedMatch) {
                set((state) => ({ books: [...state.books, book] }));
                await db.updateBook(book.id, {
                  filePath: book.filePath,
                  format: book.format,
                  meta: book.meta,
                  deletedAt: undefined,
                  progress: book.progress,
                  currentCfi: book.currentCfi,
                  isVectorized: false,
                  vectorizeProgress: 0,
                  tags: book.tags,
                  fileHash: book.fileHash,
                  syncStatus: "local",
                  lastOpenedAt: Date.now(),
                });
                debouncedSave("library-books", get().books);
              } else {
                await get().addBook(book);
              }
              result.imported.push(book);
              if (fileHash) {
                duplicateIndex.byHash.set(fileHash, book);
              }
              console.log(`[importBooks] TXT imported as EPUB: ${title}`);

              // Auto-vectorize if enabled. Keep failures isolated so a
              // successful import doesn't get reported as a failed import.
              try {
                const vmState = useVectorModelStore.getState();
                if (
                  vmState.vectorModelEnabled &&
                  vmState.hasVectorCapability() &&
                  shouldAutoVectorizeMobile("txt", conversion.epubBytes.byteLength)
                ) {
                  const base64 = bytesToBase64(conversion.epubBytes);
                  queueAutoVectorize(book, base64, "application/epub+zip");
                } else if (vmState.vectorModelEnabled && vmState.hasVectorCapability()) {
                  console.warn(
                    `[importBooks] Skip auto-vectorize for large TXT conversion: ${fileName} (${conversion.epubBytes.byteLength} bytes)`,
                  );
                }
              } catch (autoVectorizeErr) {
                console.warn(
                  `[importBooks] Auto-vectorize enqueue failed for ${fileName}:`,
                  autoVectorizeErr,
                );
              }
              continue;
            } catch (convErr) {
              console.error("[importBooks] TXT conversion failed:", convErr);
              throw convErr;
            }
          }

          const { relativePath } = await copyBookToAppData(bookId, ext || "epub", filePath);
          console.log(`[importBooks] File copied. relativePath: ${relativePath}`);

          // Extract metadata (title, author, cover) from book content
          let title = fileName.replace(/\.\w+$/i, "") || "Untitled";
          let author = "";
          let coverUrl: string | undefined;

          try {
            console.log(`[importBooks] Extracting metadata for format=${format}...`);
            const meta = await extractMobileImportMetadata({
              filePath,
              format,
              fileName,
              fileSize,
            });
            console.log(
              `[importBooks] Metadata result: title="${meta.title}", author="${meta.author}", hasCover=${!!meta.coverBytes}, coverSize=${meta.coverBytes?.length ?? 0}`,
            );
            if (meta.title) title = meta.title;
            if (meta.author) author = meta.author;

            // Save cover image to app data
            if (meta.coverBytes && meta.coverBytes.length > 0) {
              try {
                const mimeType = meta.coverMimeType || "image/jpeg";
                const coverExt = mimeType.includes("png") ? "png" : "jpg";
                await ensureAppSubDir("covers");
                const coverRelPath = `covers/${bookId}.${coverExt}`;
                const coverAbsPath = await resolveAppPath(coverRelPath);
                console.log(`[importBooks] Saving cover to: ${coverAbsPath}`);
                const platform = getPlatformService();
                await platform.writeFile(coverAbsPath, meta.coverBytes);
                coverUrl = coverRelPath;
                console.log(`[importBooks] Cover saved. coverUrl=${coverUrl}`);
              } catch (coverErr) {
                console.warn(`[importBooks] Failed to save cover for ${fileName}:`, coverErr);
              }
            }
          } catch (metaErr) {
            console.warn(`[importBooks] Metadata extraction failed for ${fileName}:`, metaErr);
          }

          console.log(
            `[importBooks] Final book: title="${title}", author="${author}", coverUrl="${coverUrl}"`,
          );
          const book: Book = {
            id: bookId,
            filePath: relativePath,
            format,
            meta: {
              ...(deletedMatch?.meta ?? {}),
              title,
              author,
              coverUrl: coverUrl || deletedMatch?.meta.coverUrl,
            },
            groupId: deletedMatch?.groupId,
            progress: deletedMatch?.progress ?? 0,
            currentCfi: deletedMatch?.currentCfi,
            isVectorized: false,
            vectorizeProgress: 0,
            tags: deletedMatch?.tags ?? [],
            fileHash,
            syncStatus: "local",
            addedAt: deletedMatch?.addedAt ?? Date.now(),
            updatedAt: Date.now(),
            lastOpenedAt: deletedMatch?.lastOpenedAt ?? Date.now(),
          };
          if (deletedMatch) {
            set((state) => ({ books: [...state.books, book] }));
            await db.updateBook(book.id, {
              filePath: book.filePath,
              format: book.format,
              meta: book.meta,
              deletedAt: undefined,
              progress: book.progress,
              currentCfi: book.currentCfi,
              isVectorized: false,
              vectorizeProgress: 0,
              tags: book.tags,
              fileHash: book.fileHash,
              syncStatus: "local",
              lastOpenedAt: Date.now(),
            });
            debouncedSave("library-books", get().books);
          } else {
            await get().addBook(book);
          }
          result.imported.push(book);
          if (fileHash) {
            duplicateIndex.byHash.set(fileHash, book);
          }

          // Auto-vectorize if enabled. Keep failures isolated so a
          // successful import doesn't get reported as a failed import.
          try {
            const vmState = useVectorModelStore.getState();
            if (
              vmState.vectorModelEnabled &&
              vmState.hasVectorCapability() &&
              shouldAutoVectorizeMobile(format, fileSize)
            ) {
              const sourceBytes = await platform.readFile(filePath);
              const base64 = bytesToBase64(sourceBytes);
              const mimeTypes: Record<string, string> = {
                epub: "application/epub+zip",
                pdf: "application/pdf",
                mobi: "application/x-mobipocket-ebook",
                azw: "application/vnd.amazon.ebook",
                azw3: "application/vnd.amazon.ebook",
                cbz: "application/vnd.comicbook+zip",
                cbr: "application/vnd.comicbook+zip",
                fb2: "application/x-fictionbook+xml",
                fbz: "application/x-zip-compressed-fb2",
                txt: "text/plain",
              };
              const mimeType = mimeTypes[format] || "application/epub+zip";
              queueAutoVectorize(book, base64, mimeType);
            } else if (vmState.vectorModelEnabled && vmState.hasVectorCapability()) {
              console.warn(
                `[importBooks] Skip auto-vectorize for large/unsupported mobile import: ${fileName} (${fileSize} bytes, format=${format})`,
              );
            }
          } catch (autoVectorizeErr) {
            console.warn(
              `[importBooks] Auto-vectorize enqueue failed for ${fileName}:`,
              autoVectorizeErr,
            );
          }
        } catch (err) {
          console.error(`Failed to import ${fileInfo.uri}:`, err);
          result.failures.push({
            name: originalName,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      set({ isImporting: false });
    }
    return result;
  },

  inspectDeletedBookCandidate: async (bookId, file) =>
    inspectDeletedMobileBookCandidate(bookId, file),

  reimportDeletedBook: async (bookId, file) => {
    const restoredBook = await restoreDeletedMobileBook(bookId, file);
    if (!restoredBook) return null;

    set((state) => {
      const exists = state.books.some((book) => book.id === restoredBook.id);
      return {
        books: exists
          ? state.books.map((book) => (book.id === restoredBook.id ? restoredBook : book))
          : [...state.books, restoredBook],
      };
    });

    try {
      await db.updateBook(restoredBook.id, {
        filePath: restoredBook.filePath,
        format: restoredBook.format,
        meta: restoredBook.meta,
        deletedAt: undefined,
        progress: restoredBook.progress,
        currentCfi: restoredBook.currentCfi,
        isVectorized: false,
        vectorizeProgress: 0,
        tags: restoredBook.tags,
        fileHash: restoredBook.fileHash,
        syncStatus: "local",
        lastOpenedAt: restoredBook.lastOpenedAt,
      });
      debouncedSave("library-books", get().books);
    } catch (err) {
      console.error("Failed to restore deleted book from database:", err);
      return null;
    }

    return restoredBook;
  },

  setActiveTag: (tag) => set({ activeTag: tag, activeGroupId: "" }),

  addTag: (tag) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    set((state) => {
      if (state.allTags.includes(trimmed)) return state;
      const allTags = [...state.allTags, trimmed].sort();
      debouncedSave("library-tags", allTags);
      return { allTags };
    });
  },

  addGroup: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = get().groups.find((group) => group.name === trimmed);
    if (existing) return existing;

    try {
      await db.initDatabase();
      const group = await db.insertGroup({
        name: trimmed,
        sortOrder: get().groups.length,
      });
      const groups = [...get().groups, group].sort((a, b) => a.sortOrder - b.sortOrder);
      set({ groups });
      debouncedSave("library-groups", groups);
      return group;
    } catch (err) {
      console.error("Failed to create group:", err);
      return null;
    }
  },

  renameGroup: (groupId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => {
      const groups = state.groups.map((group) =>
        group.id === groupId ? { ...group, name: trimmed, updatedAt: Date.now() } : group,
      );
      debouncedSave("library-groups", groups);
      return { groups };
    });
    db.updateGroup(groupId, { name: trimmed }).catch((err) =>
      console.error("Failed to rename group:", err),
    );
  },

  removeGroup: async (groupId) => {
    set((state) => {
      const groups = state.groups.filter((group) => group.id !== groupId);
      const books = state.books.map((book) =>
        book.groupId === groupId ? { ...book, groupId: undefined } : book,
      );
      debouncedSave("library-groups", groups);
      debouncedSave("library-books", books);
      return {
        groups,
        books,
        activeGroupId: state.activeGroupId === groupId ? "" : state.activeGroupId,
        isGroupView: state.activeGroupId === groupId ? true : state.isGroupView,
      };
    });
    try {
      await db.deleteGroup(groupId);
    } catch (err) {
      console.error("Failed to delete group:", err);
    }
  },

  moveBookToGroup: (bookId, groupId) => {
    get().moveBooksToGroup([bookId], groupId);
  },

  moveBooksToGroup: (bookIds, groupId) => {
    const targetIds = new Set(bookIds);
    set((state) => {
      const books = state.books.map((book) =>
        targetIds.has(book.id) ? { ...book, groupId } : book,
      );
      debouncedSave("library-books", books);
      return { books };
    });
    for (const bookId of bookIds) {
      db.updateBook(bookId, { groupId }).catch((err) =>
        console.error("Failed to move book to group:", err),
      );
    }
  },

  removeBookFromGroup: (bookId) => {
    get().moveBookToGroup(bookId, undefined);
  },

  removeTag: (tag) => {
    set((state) => {
      const allTags = state.allTags.filter((t) => t !== tag);
      const books = state.books.map((b) =>
        b.tags.includes(tag) ? { ...b, tags: b.tags.filter((t) => t !== tag) } : b,
      );
      debouncedSave("library-tags", allTags);
      debouncedSave("library-books", books);
      return { allTags, books, activeTag: state.activeTag === tag ? "" : state.activeTag };
    });
    const books = get().books;
    for (const b of books) {
      db.updateBook(b.id, { tags: b.tags }).catch(() => {});
    }
  },

  renameTag: (oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    set((state) => {
      const allTags = state.allTags.map((t) => (t === oldName ? trimmed : t)).sort();
      const books = state.books.map((b) =>
        b.tags.includes(oldName)
          ? { ...b, tags: b.tags.map((t) => (t === oldName ? trimmed : t)) }
          : b,
      );
      debouncedSave("library-tags", allTags);
      debouncedSave("library-books", books);
      return { allTags, books, activeTag: state.activeTag === oldName ? trimmed : state.activeTag };
    });
    for (const b of get().books) {
      if (b.tags.includes(trimmed)) {
        db.updateBook(b.id, { tags: b.tags }).catch(() => {});
      }
    }
  },

  addTagToBook: (bookId, tag) => {
    set((state) => {
      const books = state.books.map((b) =>
        b.id === bookId && !b.tags.includes(tag) ? { ...b, tags: [...b.tags, tag] } : b,
      );
      const allTags = state.allTags.includes(tag) ? state.allTags : [...state.allTags, tag].sort();
      debouncedSave("library-books", books);
      debouncedSave("library-tags", allTags);
      return { books, allTags };
    });
    const book = get().books.find((b) => b.id === bookId);
    if (book) db.updateBook(bookId, { tags: book.tags }).catch(() => {});
  },

  removeTagFromBook: (bookId, tag) => {
    set((state) => {
      const books = state.books.map((b) =>
        b.id === bookId ? { ...b, tags: b.tags.filter((t) => t !== tag) } : b,
      );
      debouncedSave("library-books", books);
      return { books };
    });
    const book = get().books.find((b) => b.id === bookId);
    if (book) db.updateBook(bookId, { tags: book.tags }).catch(() => {});
  },
}));
