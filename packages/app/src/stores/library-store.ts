import * as db from "@/lib/db/database";
import { triggerVectorizeBook } from "@/lib/rag/vectorize-trigger";
import {
  getDesktopLibraryRoot,
  isDesktopManagedRelativePath,
  resolveDesktopDataPath,
} from "@/lib/storage/desktop-library-root";
import {
  type ImportBooksResult,
  createEmptyImportBooksResult,
  createImportDuplicateIndex,
  findDuplicateBookByHash,
} from "@readany/core";
import { debouncedSave, loadFromFS } from "@readany/core/stores/persist";
import { useVectorModelStore } from "@readany/core/stores/vector-model-store";
import type { Book, BookGroup, LibraryFilter, SortField, SortOrder } from "@readany/core/types";
import { create } from "zustand";

interface EpubMeta {
  title: string;
  author: string;
  coverBlob: Blob | null;
}

/**
 * Lightweight EPUB metadata + cover extraction.
 * Uses zip.js BlobReader for lazy/on-demand entry decompression — only reads
 * container.xml, OPF, and cover image entry. Does NOT decompress the entire ZIP.
 * Memory usage for a 70MB EPUB: ~1-2MB (metadata + cover image only).
 */
export async function extractEpubMetadata(blob: Blob): Promise<EpubMeta> {
  const { configure, ZipReader, BlobReader, TextWriter, BlobWriter } = await import(
    "@zip.js/zip.js"
  );
  configure({ useWebWorkers: false });

  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  const entryMap = new Map(entries.map((e) => [e.filename, e]));

  const getTextEntry = async (name: string): Promise<string | null> => {
    const entry = entryMap.get(name);
    if (!entry || entry.directory || !entry.getData) return null;
    return entry.getData(new TextWriter());
  };

  const getBlobEntry = async (name: string): Promise<Blob | null> => {
    // Try exact match first, then case-insensitive
    let entry = entryMap.get(name);
    if (!entry) {
      const lower = name.toLowerCase();
      for (const [key, val] of entryMap) {
        if (key.toLowerCase() === lower) {
          entry = val;
          break;
        }
      }
    }
    if (!entry || entry.directory || !entry.getData) return null;
    return entry.getData(new BlobWriter());
  };

  // 1. Read container.xml
  const containerXml = await getTextEntry("META-INF/container.xml");
  if (!containerXml) {
    await reader.close();
    return { title: "", author: "", coverBlob: null };
  }

  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, "application/xml");
  const rootfileEl = containerDoc.querySelector("rootfile");
  const opfPath = rootfileEl?.getAttribute("full-path") || "content.opf";
  const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

  // 2. Read OPF
  const opfXml = await getTextEntry(opfPath);
  if (!opfXml) {
    await reader.close();
    return { title: "", author: "", coverBlob: null };
  }

  const opfDoc = parser.parseFromString(opfXml, "text/html");
  const title =
    opfDoc.querySelector("metadata dc\\:title, metadata title")?.textContent?.trim() || "";
  const author =
    opfDoc.querySelector("metadata dc\\:creator, metadata creator")?.textContent?.trim() || "";

  // 3. Find cover image path from OPF
  let coverBlob: Blob | null = null;
  try {
    let coverHref: string | null = null;
    const allItems = opfDoc.querySelectorAll("item");

    // Method 1: EPUB 3 <item properties="cover-image">
    for (const item of allItems) {
      const props = item.getAttribute("properties") || "";
      if (props.split(/\s+/).includes("cover-image")) {
        coverHref = item.getAttribute("href");
        break;
      }
    }

    // Method 2: EPUB 2 <meta name="cover" content="id">
    if (!coverHref) {
      const allMetas = opfDoc.querySelectorAll("meta");
      for (const meta of allMetas) {
        if (meta.getAttribute("name") === "cover") {
          const coverId = meta.getAttribute("content");
          if (coverId) {
            for (const item of allItems) {
              if (item.getAttribute("id") === coverId) {
                coverHref = item.getAttribute("href");
                break;
              }
            }
          }
          break;
        }
      }
    }

    // Method 3: image with "cover" in id or href
    if (!coverHref) {
      for (const item of allItems) {
        const mediaType = item.getAttribute("media-type") || "";
        if (mediaType.startsWith("image/")) {
          const id = (item.getAttribute("id") || "").toLowerCase();
          const href = (item.getAttribute("href") || "").toLowerCase();
          if (id.includes("cover") || href.includes("cover")) {
            coverHref = item.getAttribute("href");
            break;
          }
        }
      }
    }

    // Method 4: first image item
    if (!coverHref) {
      for (const item of allItems) {
        const mediaType = item.getAttribute("media-type") || "";
        if (mediaType.startsWith("image/")) {
          coverHref = item.getAttribute("href");
          break;
        }
      }
    }

    if (coverHref) {
      const decodedHref = decodeURIComponent(coverHref);
      const candidates = [opfDir + decodedHref, opfDir + coverHref, decodedHref, coverHref];
      for (const candidate of candidates) {
        coverBlob = await getBlobEntry(candidate);
        if (coverBlob) break;
      }
    }
  } catch (err) {
    console.warn("[extractEpubMetadata] cover extraction error:", err);
  }

  await reader.close();
  return { title, author, coverBlob };
}

/** Generate PDF cover by rendering the first page to canvas.
 * Accepts either raw bytes or a file path (avoids loading large PDFs into memory). */
async function generatePdfCover(source: Uint8Array | string): Promise<Blob | null> {
  try {
    const pdfjsLib = await import("pdfjs-dist");

    // Always set worker to match the API version
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

    const pdfSource =
      typeof source === "string"
        ? { url: source, useWorkerFetch: false, isEvalSupported: false }
        : { data: new Uint8Array(source), useWorkerFetch: false, isEvalSupported: false };

    const pdfDoc = await pdfjsLib.getDocument(pdfSource).promise;
    const page = await pdfDoc.getPage(1);

    // Render at a reasonable thumbnail size (width ~400px)
    const viewport = page.getViewport({ scale: 1 });
    const targetWidth = 400;
    const scale = targetWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    // Create an HTMLCanvasElement for pdfjs v5 compatibility
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(scaledViewport.width);
    canvas.height = Math.floor(scaledViewport.height);

    await page.render({
      canvas: canvas,
      viewport: scaledViewport,
    }).promise;

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
    });
    pdfDoc.destroy();
    return blob;
  } catch (err) {
    console.warn("Failed to generate PDF cover:", err);
    return null;
  }
}

/** Resolve a relative path (e.g. "books/xxx.epub") to an absolute path on desktop. */
async function resolveAppPath(relativePath: string): Promise<string> {
  return resolveDesktopDataPath(relativePath);
}

/**
 * Resolve a book or cover path to a displayable asset:// URL.
 * Handles both legacy absolute/asset:// paths and new relative paths.
 */
export async function resolveFileSrc(path: string): Promise<string> {
  if (!path) return "";
  // Already a displayable URL
  if (path.startsWith("asset://") || path.startsWith("http")) return path;
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(await resolveDesktopDataPath(path));
}

/**
 * Copy book file into desktop library root/books/{id}.{ext} using OS-level copy.
 * This avoids loading the entire file into JS memory (critical for large files 50MB+).
 */
async function copyBookToAppData(
  bookId: string,
  ext: string,
  srcPath: string,
): Promise<{ relativePath: string; destPath: string }> {
  const { copyFile, mkdir } = await import("@tauri-apps/plugin-fs");
  const { join } = await import("@tauri-apps/api/path");

  const libraryRoot = await getDesktopLibraryRoot();
  const booksDir = await join(libraryRoot, "books");
  try {
    await mkdir(booksDir, { recursive: true });
  } catch {
    /* exists */
  }

  const relativePath = `books/${bookId}.${ext}`;
  const destPath = await join(libraryRoot, relativePath);
  await copyFile(srcPath, destPath);
  return { relativePath, destPath };
}

/** Save cover image to desktop library root and return a relative path (covers/{id}.{ext}) */
async function saveCoverToAppData(bookId: string, coverBlob: Blob): Promise<string> {
  const { writeFile, mkdir } = await import("@tauri-apps/plugin-fs");
  const { join } = await import("@tauri-apps/api/path");

  const libraryRoot = await getDesktopLibraryRoot();
  const coversDir = await join(libraryRoot, "covers");

  // Ensure covers directory exists
  try {
    await mkdir(coversDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  const ext = coverBlob.type.includes("png") ? "png" : "jpg";
  const relativePath = `covers/${bookId}.${ext}`;
  const coverPath = await join(libraryRoot, relativePath);
  const arrayBuffer = await coverBlob.arrayBuffer();
  await writeFile(coverPath, new Uint8Array(arrayBuffer));

  return relativePath;
}

export async function repairMissingCovers(): Promise<number> {
  const { exists, readFile } = await import("@tauri-apps/plugin-fs");
  const { convertFileSrc } = await import("@tauri-apps/api/core");

  const books = useLibraryStore.getState().books;
  let repaired = 0;

  for (const book of books) {
    const coverUrl = book.meta.coverUrl;
    if (!coverUrl || !isDesktopManagedRelativePath(coverUrl)) continue;

    const coverAbsPath = await resolveAppPath(coverUrl);
    if (await exists(coverAbsPath)) continue;

    if (!book.filePath || !isDesktopManagedRelativePath(book.filePath)) continue;
    const bookAbsPath = await resolveAppPath(book.filePath);
    if (!(await exists(bookAbsPath))) continue;

    try {
      let coverBlob: Blob | null = null;

      if (book.format === "epub" || book.filePath.endsWith(".epub")) {
        const epubBytes = await readFile(bookAbsPath);
        const blob = new Blob([epubBytes]);
        const meta = await extractEpubMetadata(blob);
        coverBlob = meta.coverBlob;
      } else if (book.format === "pdf") {
        const pdfUrl = convertFileSrc(bookAbsPath);
        coverBlob = await generatePdfCover(pdfUrl);
      }

      if (coverBlob) {
        await saveCoverToAppData(book.id, coverBlob);
        repaired++;
        console.log(`[repairMissingCovers] Extracted cover for "${book.meta.title}"`);
      }
    } catch (err) {
      console.warn(`[repairMissingCovers] Failed for "${book.meta.title}":`, err);
    }
  }

  if (repaired > 0) {
    console.log(`[repairMissingCovers] Repaired ${repaired} cover(s)`);
  }
  return repaired;
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
  /** All unique tags across all books */
  allTags: string[];
  /** Currently selected tag for filtering (empty = all books) */
  activeTag: string;
  /** Currently selected group for detail view/filtering (empty = no group) */
  activeGroupId: string;

  // Actions
  loadBooks: (deletedTags?: string[]) => Promise<void>;
  loadGroups: () => Promise<void>;
  setBooks: (books: Book[]) => void;
  setGroupView: (enabled: boolean) => void;
  setActiveGroupId: (groupId: string) => void;
  addBook: (book: Book) => void;
  removeBook: (bookId: string, options?: RemoveBookOptions) => Promise<void>;
  updateBook: (bookId: string, updates: Partial<Book>) => void;
  setFilter: (filter: Partial<LibraryFilter>) => void;
  setViewMode: (mode: LibraryViewMode) => void;
  setSortField: (field: SortField) => void;
  setSortOrder: (order: SortOrder) => void;
  importBooks: (filePaths: string[]) => Promise<ImportBooksResult>;
  inspectDeletedBookCandidate: (
    bookId: string,
    filePath: string,
  ) => Promise<{
    title: string;
    author: string;
    format: Book["format"];
    fileHash?: string;
  } | null>;
  reimportDeletedBook: (bookId: string, filePath: string) => Promise<Book | null>;
  // Tag management
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

async function restoreDeletedDesktopBook(bookId: string, filePath: string): Promise<Book | null> {
  await db.initDatabase();
  const originalBook = await db.getBook(bookId, { includeDeleted: true });
  if (!originalBook) return null;

  const fileName = decodeURIComponent(filePath.replace(/\\/g, "/").split("/").pop() || "book");
  const ext = filePath.split(".").pop()?.toLowerCase() || "epub";
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
  const format: Book["format"] = formatMap[ext] || "epub";
  let title = originalBook.meta.title || fileName.replace(/\.\w+$/i, "") || "Untitled";
  let author = originalBook.meta.author || "";
  let coverUrl = originalBook.meta.coverUrl;
  let fileHash: string | undefined;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    fileHash = await invoke<string>("sync_hash_file", { path: filePath });
  } catch {
    // Hash calculation is best effort.
  }

  const { relativePath, destPath } =
    ext === "txt"
      ? await (async () => {
          const { TxtToEpubConverter } = await import("@readany/core/utils/txt-to-epub");
          const { readFile, writeFile, mkdir } = await import("@tauri-apps/plugin-fs");
          const { join } = await import("@tauri-apps/api/path");
          const rawBytes = await readFile(filePath);
          const txtFile = new File(
            [rawBytes],
            filePath.replace(/\\/g, "/").split("/").pop() || "book.txt",
            {
              type: "text/plain",
            },
          );
          const converter = new TxtToEpubConverter();
          const conversion = await converter.convert({ file: txtFile });
          title = conversion.bookTitle || title;
          const epubBytes = new Uint8Array(await conversion.file.arrayBuffer());
          await mkdir(await join(await getDesktopLibraryRoot(), "books"), { recursive: true });
          const relPath = `books/${bookId}.epub`;
          const dest = await resolveAppPath(relPath);
          await writeFile(dest, epubBytes);
          return { relativePath: relPath, destPath: dest };
        })()
      : await copyBookToAppData(bookId, ext, filePath);

  // Extract metadata using lightweight approach (avoids full file load for EPUB/PDF)
  try {
    if (format === "epub" || ext === "txt") {
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const epubBytes = await readFile(destPath);
      const blob = new Blob([epubBytes]);
      const epubMeta = await extractEpubMetadata(blob);
      if (epubMeta.title) title = epubMeta.title;
      if (epubMeta.author) author = epubMeta.author;
      if (epubMeta.coverBlob) {
        coverUrl = await saveCoverToAppData(bookId, epubMeta.coverBlob);
      }
    } else if (format === "pdf") {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      const pdfUrl = convertFileSrc(destPath);
      const coverBlob = await generatePdfCover(pdfUrl);
      if (coverBlob) {
        coverUrl = await saveCoverToAppData(bookId, coverBlob);
      }
    } else {
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const fileBytes = await readFile(destPath);
      const blob = new Blob([fileBytes]);
      const effectiveFileName = ext === "txt" ? fileName.replace(/\.txt$/i, ".epub") : fileName;
      const file = new File([blob], effectiveFileName, {
        type: blob.type || "application/octet-stream",
      });
      const { DocumentLoader } = await import("@/lib/reader/document-loader");
      const loader = new DocumentLoader(file);
      const { book: bookDoc } = await loader.open();
      const meta = bookDoc.metadata;
      if (meta) {
        const rawTitle =
          typeof meta.title === "string"
            ? meta.title
            : meta.title
              ? Object.values(meta.title)[0]
              : "";
        if (rawTitle) title = rawTitle;
        const rawAuthor = typeof meta.author === "string" ? meta.author : meta.author?.name || "";
        if (rawAuthor) author = rawAuthor;
      }
      try {
        const coverBlob = await bookDoc.getCover();
        if (coverBlob) {
          coverUrl = await saveCoverToAppData(bookId, coverBlob);
        }
      } catch (err) {
        console.warn("[restoreDeletedDesktopBook] getCover failed:", err);
      }
    }
  } catch (err) {
    console.warn("[restoreDeletedDesktopBook] Metadata extraction failed, falling back:", err);
    if (format === "pdf") {
      try {
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        const coverBlob = await generatePdfCover(convertFileSrc(destPath));
        if (coverBlob) {
          coverUrl = await saveCoverToAppData(bookId, coverBlob);
        }
      } catch {
        // Non-critical.
      }
    }
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

async function inspectDeletedDesktopBookCandidate(
  bookId: string,
  filePath: string,
): Promise<{
  title: string;
  author: string;
  format: Book["format"];
  fileHash?: string;
} | null> {
  await db.initDatabase();
  const originalBook = await db.getBook(bookId, { includeDeleted: true });
  if (!originalBook) return null;

  const fileName = decodeURIComponent(filePath.replace(/\\/g, "/").split("/").pop() || "book");
  const ext = filePath.split(".").pop()?.toLowerCase() || "epub";
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
  const format: Book["format"] = formatMap[ext] || "epub";
  let title = fileName.replace(/\.\w+$/i, "") || originalBook.meta.title || "Untitled";
  let author = "";
  let fileHash: string | undefined;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    fileHash = await invoke<string>("sync_hash_file", { path: filePath });
  } catch {
    // Best effort.
  }

  if (ext === "txt") {
    try {
      const { TxtToEpubConverter } = await import("@readany/core/utils/txt-to-epub");
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const rawBytes = await readFile(filePath);
      const txtFile = new File(
        [rawBytes],
        filePath.replace(/\\/g, "/").split("/").pop() || "book.txt",
        { type: "text/plain" },
      );
      const conversion = await new TxtToEpubConverter().convert({ file: txtFile });
      title = conversion.bookTitle || title;
    } catch {
      // Fallback to filename.
    }
    return { title, author, format: "epub", fileHash };
  }

  try {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const fileBytes = await readFile(filePath);
    const blob = new Blob([fileBytes]);
    const file = new File([blob], fileName, {
      type: blob.type || "application/octet-stream",
    });
    const { DocumentLoader } = await import("@/lib/reader/document-loader");
    const loader = new DocumentLoader(file);
    const { book: bookDoc } = await loader.open();
    const meta = bookDoc.metadata;
    if (meta) {
      const rawTitle =
        typeof meta.title === "string"
          ? meta.title
          : meta.title
            ? Object.values(meta.title)[0]
            : "";
      if (rawTitle) title = rawTitle;

      const rawAuthor = typeof meta.author === "string" ? meta.author : meta.author?.name || "";
      if (rawAuthor) author = rawAuthor;
    }
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

    // 1) Fast path: restore from FS cache so UI shows books instantly
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
      // cache miss is fine
    }

    // 2) Full path: init DB and load from SQLite (source of truth for books)
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
      // Update the cache for next launch
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

  addBook: (book) => {
    set((state) => ({ books: [...state.books, book] }));
    // Persist to DB (fire and forget)
    db.insertBook(book).catch((err) => console.error("Failed to insert book into database:", err));
    // Update FS cache
    debouncedSave("library-books", get().books);
  },

  removeBook: async (bookId, options = {}) => {
    const preserveData = options.preserveData ?? false;
    // Find the book before removing to get file paths
    const book = get().books.find((b) => b.id === bookId);

    set((state) => ({ books: state.books.filter((b) => b.id !== bookId) }));
    db.deleteBook(bookId, { preserveData }).catch((err) =>
      console.error("Failed to delete book from database:", err),
    );
    // Update FS cache
    debouncedSave("library-books", get().books);

    // Clean up files from app data dir (only for relative paths)
    if (book) {
      try {
        const { exists, remove } = await import("@tauri-apps/plugin-fs");

        // Delete book file if it's a relative path (in app data dir)
        if (book.filePath && isDesktopManagedRelativePath(book.filePath)) {
          try {
            const bookAbsPath = await resolveAppPath(book.filePath);
            if (await exists(bookAbsPath)) {
              await remove(bookAbsPath);
              console.log("[removeBook] Deleted book file:", book.filePath);
            }
          } catch (err) {
            console.warn("[removeBook] Failed to delete book file:", err);
          }
        }

        if (
          !preserveData &&
          book.meta.coverUrl &&
          isDesktopManagedRelativePath(book.meta.coverUrl)
        ) {
          try {
            const coverAbsPath = await resolveAppPath(book.meta.coverUrl);
            if (await exists(coverAbsPath)) {
              await remove(coverAbsPath);
              console.log("[removeBook] Deleted cover file:", book.meta.coverUrl);
            }
          } catch (err) {
            console.warn("[removeBook] Failed to delete cover file:", err);
          }
        }
      } catch (err) {
        console.error("[removeBook] File cleanup error:", err);
      }
    }
  },

  updateBook: (bookId, updates) => {
    set((state) => ({
      books: state.books.map((b) => (b.id === bookId ? { ...b, ...updates } : b)),
    }));
    db.updateBook(bookId, updates).catch((err) =>
      console.error("Failed to update book in database:", err),
    );
    // Update FS cache
    debouncedSave("library-books", get().books);
  },

  setFilter: (filter) => set((state) => ({ filter: { ...state.filter, ...filter } })),

  setViewMode: (mode) => set({ viewMode: mode }),

  setSortField: (field) => set((state) => ({ filter: { ...state.filter, sortField: field } })),

  setSortOrder: (order) => set((state) => ({ filter: { ...state.filter, sortOrder: order } })),

  importBooks: async (filePaths) => {
    set({ isImporting: true });
    const result = createEmptyImportBooksResult();
    const duplicateIndex = createImportDuplicateIndex(get().books);
    try {
      await db.initDatabase();
      const { DocumentLoader } = await import("@/lib/reader/document-loader");

      for (const filePath of filePaths) {
        const fileName = decodeURIComponent(
          filePath.replace(/\\/g, "/").split("/").pop() || "book",
        );
        try {
          const ext = filePath.split(".").pop()?.toLowerCase() || "epub";
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
          const format: Book["format"] = formatMap[ext] || "epub";
          let title = fileName.replace(/\.\w+$/i, "") || "Untitled";
          let author = "";
          let coverUrl: string | undefined;
          let fileHash: string | undefined;

          try {
            const { invoke } = await import("@tauri-apps/api/core");
            fileHash = await invoke<string>("sync_hash_file", { path: filePath });
          } catch {
            // Hash calculation is best effort.
          }

          const existingDuplicate = findDuplicateBookByHash(duplicateIndex, fileHash);
          if (existingDuplicate) {
            result.skippedDuplicates.push({
              name: fileName,
              existingBook: existingDuplicate,
            });
            continue;
          }

          let deletedMatch = fileHash
            ? await db.getDeletedBookByFileHash(fileHash).catch(() => null)
            : null;
          // Fallback: match by title if hash lookup failed (e.g. hash was null on first import)
          if (!deletedMatch && title) {
            deletedMatch = await db.getDeletedBookByTitle(title).catch(() => null);
          }
          const bookId = deletedMatch?.id ?? crypto.randomUUID();

          // For TXT files, convert to EPUB first before storing
          if (ext === "txt") {
            const { TxtToEpubConverter } = await import("@readany/core/utils/txt-to-epub");
            const { readFile } = await import("@tauri-apps/plugin-fs");
            const rawBytes = await readFile(filePath);
            const txtFile = new File(
              [rawBytes],
              filePath.replace(/\\/g, "/").split("/").pop() || "book.txt",
              {
                type: "text/plain",
              },
            );
            const converter = new TxtToEpubConverter();
            const result = await converter.convert({ file: txtFile });
            title = result.bookTitle;
            if (result.language) author = "";
            // Write the converted EPUB directly into the managed library location
            const { writeFile, mkdir } = await import("@tauri-apps/plugin-fs");
            const { join } = await import("@tauri-apps/api/path");
            const epubBytes = new Uint8Array(await result.file.arrayBuffer());
            await mkdir(await join(await getDesktopLibraryRoot(), "books"), { recursive: true });
            const tmpPath = await resolveAppPath(`books/${bookId}.epub`);
            await writeFile(tmpPath, epubBytes);
          }

          // Copy book file into the managed library root (books/{id}.{ext})
          // For TXT: already written above; for others: OS-level copy (no JS memory)
          let relativePath: string;
          let destPath: string;
          if (ext === "txt") {
            relativePath = `books/${bookId}.epub`;
            destPath = await resolveAppPath(relativePath);
          } else {
            const copyResult = await copyBookToAppData(bookId, ext, filePath);
            relativePath = copyResult.relativePath;
            destPath = copyResult.destPath;
          }

          // Extract metadata WITHOUT loading the full file into JS memory.
          // For EPUB: use lightweight ZIP directory parsing (only reads OPF + cover entry).
          // For PDF: use pdfjs with file URL (streams from disk).
          // For other formats (MOBI/AZW/FB2/CBZ): fall back to DocumentLoader (requires File).
          try {
            if (format === "epub" || ext === "txt") {
              // Lightweight EPUB metadata: only decompress container.xml + OPF + cover
              const { readFile } = await import("@tauri-apps/plugin-fs");
              const epubBytes = await readFile(destPath);
              const blob = new Blob([epubBytes]);
              const epubMeta = await extractEpubMetadata(blob);
              if (epubMeta.title) title = epubMeta.title;
              if (epubMeta.author) author = epubMeta.author;
              if (epubMeta.coverBlob) {
                coverUrl = await saveCoverToAppData(bookId, epubMeta.coverBlob);
              }
            } else if (format === "pdf") {
              // PDF: use convertFileSrc URL so pdfjs streams from disk
              const { convertFileSrc } = await import("@tauri-apps/api/core");
              const pdfUrl = convertFileSrc(destPath);
              const coverBlob = await generatePdfCover(pdfUrl);
              if (coverBlob) {
                coverUrl = await saveCoverToAppData(bookId, coverBlob);
              }
              // PDF title: try extracting from PDF metadata
              try {
                const pdfjsLib = await import("pdfjs-dist");
                pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
                const pdfDoc = await pdfjsLib.getDocument({
                  url: pdfUrl,
                  useWorkerFetch: false,
                  isEvalSupported: false,
                }).promise;
                const metadata = await pdfDoc.getMetadata();
                const pdfTitle = (metadata?.info as Record<string, unknown>)?.Title as string;
                if (pdfTitle?.trim()) title = pdfTitle.trim();
                pdfDoc.destroy();
              } catch {
                // PDF metadata extraction is best effort
              }
            } else {
              // Other formats (MOBI/AZW/FB2/CBZ): need DocumentLoader, load file into memory
              const { readFile } = await import("@tauri-apps/plugin-fs");
              const fileBytes = await readFile(destPath);
              const blob = new Blob([fileBytes]);
              const docFileName = fileName;
              const file = new File([blob], docFileName, {
                type: blob.type || "application/octet-stream",
              });
              const loader = new DocumentLoader(file);
              const { book: bookDoc } = await loader.open();

              const meta = bookDoc.metadata;
              if (meta) {
                const rawTitle =
                  typeof meta.title === "string"
                    ? meta.title
                    : meta.title
                      ? Object.values(meta.title)[0]
                      : "";
                if (rawTitle) title = rawTitle;

                const rawAuthor =
                  typeof meta.author === "string" ? meta.author : meta.author?.name || "";
                if (rawAuthor) author = rawAuthor;
              }

              try {
                const coverBlob = await bookDoc.getCover();
                if (coverBlob) {
                  coverUrl = await saveCoverToAppData(bookId, coverBlob);
                }
              } catch (err) {
                console.warn("[importBooks] getCover failed:", err);
              }
            }
          } catch (err) {
            console.warn("[importBooks] Metadata extraction failed, using filename:", err);
          }

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
            db.updateBook(book.id, {
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
            }).catch((err) => console.error("Failed to restore deleted book from database:", err));
            debouncedSave("library-books", get().books);
          } else {
            get().addBook(book);
          }
          result.imported.push(book);
          if (fileHash) {
            duplicateIndex.byHash.set(fileHash, book);
          }

          // Auto-vectorize if enabled
          const vmState = useVectorModelStore.getState();
          if (vmState.vectorModelEnabled && vmState.hasVectorCapability()) {
            triggerVectorizeBook(book.id, relativePath).catch((err) => {
              console.warn(`[importBooks] Auto-vectorize failed for ${title}:`, err);
            });
          }
        } catch (err) {
          console.error(`Failed to import ${filePath}:`, err);
          result.failures.push({
            name: fileName,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      set({ isImporting: false });
    }
    return result;
  },

  inspectDeletedBookCandidate: async (bookId, filePath) =>
    inspectDeletedDesktopBookCandidate(bookId, filePath),

  reimportDeletedBook: async (bookId, filePath) => {
    const restoredBook = await restoreDeletedDesktopBook(bookId, filePath);
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

  // ── Tag management ──

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
    // Remove from allTags list, and remove from all books that have it
    set((state) => {
      const allTags = state.allTags.filter((t) => t !== tag);
      const books = state.books.map((b) =>
        b.tags.includes(tag) ? { ...b, tags: b.tags.filter((t) => t !== tag) } : b,
      );
      debouncedSave("library-tags", allTags);
      debouncedSave("library-books", books);
      return { allTags, books, activeTag: state.activeTag === tag ? "" : state.activeTag };
    });
    // Persist book tag changes to DB
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
      // Ensure tag is in allTags
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
