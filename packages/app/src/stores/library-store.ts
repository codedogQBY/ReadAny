import type { Book, LibraryFilter, SortField, SortOrder } from "@/types";
import * as db from "@/lib/db/database";
/**
 * Library store — book collection CRUD, import, filtering
 * Connected to SQLite for persistence.
 * Uses FS-level JSON cache for fast startup (avoids re-querying SQLite every launch).
 */
import { create } from "zustand";
import { debouncedSave, loadFromFS } from "./persist";

interface EpubMeta {
  title: string;
  author: string;
  coverBlob: Blob | null;
}

/** Lightweight EPUB metadata + cover extraction (no full rendering needed) */
async function extractEpubMetadata(blob: Blob): Promise<EpubMeta> {
  const { entries } = await unzipBlob(blob);
  const containerXml = await readTextFromMap(entries, "META-INF/container.xml");
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, "application/xml");
  const rootfileEl = containerDoc.querySelector("rootfile");
  const opfPath = rootfileEl?.getAttribute("full-path") || "content.opf";
  const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

  const opfXml = await readTextFromMap(entries, opfPath);
  const opfDoc = parser.parseFromString(opfXml, "application/xml");

  const title =
    opfDoc.querySelector("metadata > dc\\:title, metadata > title")?.textContent?.trim() || "";
  const author =
    opfDoc.querySelector("metadata > dc\\:creator, metadata > creator")?.textContent?.trim() || "";

  // Extract cover image
  let coverBlob: Blob | null = null;
  try {
    // Method 1: <item properties="cover-image"> (EPUB 3)
    let coverHref: string | null = null;
    const coverImageItem = opfDoc.querySelector('manifest > item[properties~="cover-image"]');
    if (coverImageItem) {
      coverHref = coverImageItem.getAttribute("href");
    }

    // Method 2: <meta name="cover" content="cover-id"> → find item by id (EPUB 2)
    if (!coverHref) {
      const coverMeta = opfDoc.querySelector('metadata > meta[name="cover"]');
      const coverId = coverMeta?.getAttribute("content");
      if (coverId) {
        const coverItem = opfDoc.querySelector(`manifest > item[id="${coverId}"]`);
        coverHref = coverItem?.getAttribute("href") || null;
      }
    }

    // Method 3: find any item with media-type image and "cover" in id/href
    if (!coverHref) {
      const items = opfDoc.querySelectorAll('manifest > item[media-type^="image/"]');
      for (const item of items) {
        const id = item.getAttribute("id")?.toLowerCase() || "";
        const href = item.getAttribute("href")?.toLowerCase() || "";
        if (id.includes("cover") || href.includes("cover")) {
          coverHref = item.getAttribute("href");
          break;
        }
      }
    }

    if (coverHref) {
      // Resolve relative path against OPF directory
      const coverPath = opfDir + coverHref;
      // Try exact path first, then try without directory prefix
      coverBlob = entries.get(coverPath) || entries.get(coverHref) || null;
      // Try case-insensitive match as fallback
      if (!coverBlob) {
        const lowerTarget = coverPath.toLowerCase();
        for (const [key, value] of entries) {
          if (key.toLowerCase() === lowerTarget) {
            coverBlob = value;
            break;
          }
        }
      }
    }
  } catch {
    // Cover extraction failed, not critical
  }

  return { title, author, coverBlob };
}

/** Generate PDF cover by rendering the first page to canvas */
async function generatePdfCover(fileBytes: Uint8Array): Promise<Blob | null> {
  try {
    const pdfjsLib = await import("pdfjs-dist");

    // Set worker if not already configured
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      try {
        const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.href;
      } catch {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      }
    }

    const pdfDoc = await pdfjsLib.getDocument({
      data: new Uint8Array(fileBytes),
      useWorkerFetch: false,
      isEvalSupported: false,
    }).promise;
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

/** Save cover image to appData and return a URL usable by <img> */
async function saveCoverToAppData(bookId: string, coverBlob: Blob): Promise<string> {
  const { writeFile, mkdir } = await import("@tauri-apps/plugin-fs");
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  const { convertFileSrc } = await import("@tauri-apps/api/core");

  const appData = await appDataDir();
  const coversDir = await join(appData, "covers");

  // Ensure covers directory exists
  try {
    await mkdir(coversDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  const ext = coverBlob.type.includes("png") ? "png" : "jpg";
  const coverPath = await join(coversDir, `${bookId}.${ext}`);
  const arrayBuffer = await coverBlob.arrayBuffer();
  await writeFile(coverPath, new Uint8Array(arrayBuffer));

  // Convert to a file:// URL that webview can display
  return convertFileSrc(coverPath);
}

async function unzipBlob(blob: Blob): Promise<{ entries: Map<string, Blob> }> {
  const entries = new Map<string, Blob>();
  const arrayBuffer = await blob.arrayBuffer();
  const dataView = new DataView(arrayBuffer);

  // Find end of central directory
  let eocdOffset = -1;
  for (let i = arrayBuffer.byteLength - 22; i >= 0; i--) {
    if (dataView.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return { entries };

  const cdOffset = dataView.getUint32(eocdOffset + 16, true);
  const cdCount = dataView.getUint16(eocdOffset + 10, true);

  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (dataView.getUint32(pos, true) !== 0x02014b50) break;
    const compressionMethod = dataView.getUint16(pos + 10, true);
    const compressedSize = dataView.getUint32(pos + 20, true);
    const filenameLen = dataView.getUint16(pos + 28, true);
    const extraLen = dataView.getUint16(pos + 30, true);
    const commentLen = dataView.getUint16(pos + 32, true);
    const localHeaderOffset = dataView.getUint32(pos + 42, true);

    const filenameBytes = new Uint8Array(arrayBuffer, pos + 46, filenameLen);
    const filename = new TextDecoder().decode(filenameBytes);

    // Read from local file header
    const localExtraLen = dataView.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + filenameLen + localExtraLen;

    if (compressionMethod === 0) {
      entries.set(filename, new Blob([new Uint8Array(arrayBuffer, dataStart, compressedSize)]));
    } else if (compressionMethod === 8) {
      try {
        const compressed = new Uint8Array(arrayBuffer, dataStart, compressedSize);
        const ds = new DecompressionStream("raw-deflate" as CompressionFormat);
        const writer = ds.writable.getWriter();
        writer.write(compressed);
        writer.close();
        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        entries.set(filename, new Blob(chunks));
      } catch {
        // skip undecompressable entries
      }
    }

    pos += 46 + filenameLen + extraLen + commentLen;
  }
  return { entries };
}

async function readTextFromMap(entries: Map<string, Blob>, path: string): Promise<string> {
  const blob = entries.get(path);
  if (!blob) throw new Error(`Entry not found: ${path}`);
  return await blob.text();
}

export type LibraryViewMode = "grid" | "list";

export interface LibraryState {
  books: Book[];
  filter: LibraryFilter;
  viewMode: LibraryViewMode;
  isImporting: boolean;
  isLoaded: boolean;

  // Actions
  loadBooks: () => Promise<void>;
  setBooks: (books: Book[]) => void;
  addBook: (book: Book) => void;
  removeBook: (bookId: string) => void;
  updateBook: (bookId: string, updates: Partial<Book>) => void;
  setFilter: (filter: Partial<LibraryFilter>) => void;
  setViewMode: (mode: LibraryViewMode) => void;
  setSortField: (field: SortField) => void;
  setSortOrder: (order: SortOrder) => void;
  importBooks: (filePaths: string[]) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  filter: {
    search: "",
    tags: [],
    sortField: "lastOpenedAt",
    sortOrder: "desc",
  },
  viewMode: "grid",
  isImporting: false,
  isLoaded: false,

  loadBooks: async () => {
    // 1) Fast path: restore from FS cache so UI shows books instantly
    try {
      const cached = await loadFromFS<Book[]>("library-books");
      if (cached && cached.length > 0) {
        set({ books: cached, isLoaded: true });
      }
    } catch {
      // cache miss is fine
    }

    // 2) Full path: init DB and load from SQLite (source of truth)
    try {
      await db.initDatabase();
      const books = await db.getBooks();
      set({ books, isLoaded: true });
      // Update the cache for next launch
      debouncedSave("library-books", books);
    } catch (err) {
      console.error("Failed to load books from database:", err);
      set({ isLoaded: true });
    }
  },

  setBooks: (books) => set({ books }),

  addBook: (book) => {
    set((state) => ({ books: [...state.books, book] }));
    // Persist to DB (fire and forget)
    db.insertBook(book).catch((err) =>
      console.error("Failed to insert book into database:", err),
    );
    // Update FS cache
    debouncedSave("library-books", get().books);
  },

  removeBook: (bookId) => {
    set((state) => ({ books: state.books.filter((b) => b.id !== bookId) }));
    db.deleteBook(bookId).catch((err) =>
      console.error("Failed to delete book from database:", err),
    );
    // Update FS cache
    debouncedSave("library-books", get().books);
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
    try {
      const { readFile } = await import("@tauri-apps/plugin-fs");
      for (const filePath of filePaths) {
        try {
          const ext = filePath.split(".").pop()?.toLowerCase();
          const format: "epub" | "pdf" = ext === "pdf" ? "pdf" : "epub";
          let title = filePath.split("/").pop()?.replace(/\.(epub|pdf)$/i, "") || "Untitled";
          let author = "";
          let coverUrl: string | undefined;
          const bookId = crypto.randomUUID();

          const fileBytes = await readFile(filePath);

          if (format === "epub") {
            try {
              const blob = new Blob([fileBytes]);
              const meta = await extractEpubMetadata(blob);
              if (meta.title) title = meta.title;
              if (meta.author) author = meta.author;
              if (meta.coverBlob) {
                try {
                  coverUrl = await saveCoverToAppData(bookId, meta.coverBlob);
                } catch {
                  // Cover save failed, not critical
                }
              }
            } catch {
              // Fall back to filename as title
            }
          } else if (format === "pdf") {
            // Generate cover from first page
            try {
              const coverBlob = await generatePdfCover(fileBytes);
              if (coverBlob) {
                coverUrl = await saveCoverToAppData(bookId, coverBlob);
              }
            } catch {
              // Cover generation failed, not critical
            }
          }

          const book: Book = {
            id: bookId,
            filePath,
            format,
            meta: { title, author, coverUrl },
            progress: 0,
            isVectorized: false,
            vectorizeProgress: 0,
            tags: [],
            addedAt: Date.now(),
            lastOpenedAt: Date.now(),
          };
          get().addBook(book);
        } catch (err) {
          console.error(`Failed to import ${filePath}:`, err);
        }
      }
    } finally {
      set({ isImporting: false });
    }
  },
}));
