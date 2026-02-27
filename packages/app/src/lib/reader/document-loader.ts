/**
 * DocumentLoader — unified document loading for all book formats.
 * Reference: readest/apps/readest-app/src/libs/document.ts
 *
 * Detects format via magic bytes and dispatches to the appropriate
 * foliate-js parser. Returns a unified BookDoc interface.
 */

export type BookFormat =
  | "EPUB"
  | "PDF"
  | "MOBI"
  | "AZW"
  | "AZW3"
  | "CBZ"
  | "FB2"
  | "FBZ";

export interface TOCItem {
  id: number;
  label: string;
  href: string;
  index: number;
  cfi?: string;
  subitems?: TOCItem[];
}

export interface SectionItem {
  id: string;
  cfi: string;
  size: number;
  linear: string;
  href?: string;
  pageSpread?: "left" | "right" | "center" | "";
  createDocument: () => Promise<Document>;
}

export interface BookMetadata {
  title: string | Record<string, string>;
  author: string | { name?: string; file_as?: string };
  language: string | string[];
  publisher?: string;
  published?: string;
  description?: string;
  identifier?: string;
  subject?: string | string[];
}

export interface BookDoc {
  metadata: BookMetadata;
  rendition?: {
    layout?: "pre-paginated" | "reflowable";
    spread?: "auto" | "none";
    viewport?: { width: number; height: number };
  };
  dir: string;
  toc?: TOCItem[];
  sections?: SectionItem[];
  transformTarget?: EventTarget;
  splitTOCHref(href: string): Array<string | number>;
  getCover(): Promise<Blob | null>;
}

/** File extension map */
const EXTS: Record<BookFormat, string> = {
  EPUB: "epub",
  PDF: "pdf",
  MOBI: "mobi",
  AZW: "azw",
  AZW3: "azw3",
  CBZ: "cbz",
  FB2: "fb2",
  FBZ: "fbz",
};

export class DocumentLoader {
  private file: File;

  constructor(file: File) {
    this.file = file;
  }

  private async isZip(): Promise<boolean> {
    const arr = new Uint8Array(await this.file.slice(0, 4).arrayBuffer());
    return (
      arr[0] === 0x50 &&
      arr[1] === 0x4b &&
      arr[2] === 0x03 &&
      arr[3] === 0x04
    );
  }

  private async isPDF(): Promise<boolean> {
    const arr = new Uint8Array(await this.file.slice(0, 5).arrayBuffer());
    return (
      arr[0] === 0x25 &&
      arr[1] === 0x50 &&
      arr[2] === 0x44 &&
      arr[3] === 0x46 &&
      arr[4] === 0x2d
    );
  }

  private async makeZipLoader() {
    const { configure, ZipReader, BlobReader, TextWriter, BlobWriter } =
      await import("@zip.js/zip.js");
    configure({ useWebWorkers: false });

    type Entry = import("@zip.js/zip.js").Entry;
    const reader = new ZipReader(new BlobReader(this.file));
    const entries = await reader.getEntries();
    const map = new Map(entries.map((entry) => [entry.filename, entry]));

    const load =
      (
        f: (entry: Entry, type?: string) => Promise<string | Blob> | null,
      ) =>
      (name: string, ...args: [string?]) =>
        map.has(name) ? f(map.get(name)!, ...args) : null;

    const loadText = load((entry: Entry) =>
      !entry.directory ? entry.getData!(new TextWriter()) : null,
    );
    const loadBlob = load((entry: Entry, type?: string) =>
      !entry.directory ? entry.getData!(new BlobWriter(type!)) : null,
    );
    const getSize = (name: string) =>
      map.get(name)?.uncompressedSize ?? 0;

    return { entries, loadText, loadBlob, getSize, sha1: undefined };
  }

  private isCBZ(): boolean {
    return (
      this.file.type === "application/vnd.comicbook+zip" ||
      this.file.name.endsWith(`.${EXTS.CBZ}`)
    );
  }

  private isFB2(): boolean {
    return (
      this.file.type === "application/x-fictionbook+xml" ||
      this.file.name.endsWith(`.${EXTS.FB2}`)
    );
  }

  private isFBZ(): boolean {
    return (
      this.file.type === "application/x-zip-compressed-fb2" ||
      this.file.name.endsWith(".fb.zip") ||
      this.file.name.endsWith(".fb2.zip") ||
      this.file.name.endsWith(`.${EXTS.FBZ}`)
    );
  }

  public async open(): Promise<{ book: BookDoc; format: BookFormat }> {
    // biome-ignore lint: foliate-js returns untyped book objects
    let book: any = null;
    let format: BookFormat = "EPUB";

    if (!this.file.size) {
      throw new Error("File is empty");
    }

    try {
      if (await this.isZip()) {
        const loader = await this.makeZipLoader();
        const { entries } = loader;

        if (this.isCBZ()) {
          const { makeComicBook } = await import("foliate-js/comic-book.js");
          book = await makeComicBook(loader, this.file);
          format = "CBZ";
        } else if (this.isFBZ()) {
          const entry = entries.find((e) =>
            e.filename.endsWith(`.${EXTS.FB2}`),
          );
          const blob = await loader.loadBlob(
            (entry ?? entries[0]!).filename,
          );
          const { makeFB2 } = await import("foliate-js/fb2.js");
          book = await makeFB2(blob);
          format = "FBZ";
        } else {
          const { EPUB } = await import("foliate-js/epub.js");
          book = await new EPUB(loader).init();
          format = "EPUB";
        }
      } else if (await this.isPDF()) {
        const { makePDF } = await import("foliate-js/pdf.js");
        book = await makePDF(this.file);
        format = "PDF";
      } else if (
        await (await import("foliate-js/mobi.js")).isMOBI(this.file)
      ) {
        const fflate = await import("foliate-js/vendor/fflate.js");
        const { MOBI } = await import("foliate-js/mobi.js");
        book = await new MOBI({ unzlib: fflate.unzlibSync }).open(
          this.file,
        );
        const ext = this.file.name.split(".").pop()?.toLowerCase();
        switch (ext) {
          case "azw":
            format = "AZW";
            break;
          case "azw3":
            format = "AZW3";
            break;
          default:
            format = "MOBI";
        }
      } else if (this.isFB2()) {
        const { makeFB2 } = await import("foliate-js/fb2.js");
        book = await makeFB2(this.file);
        format = "FB2";
      } else {
        throw new Error(
          `Unsupported file format: ${this.file.name}`,
        );
      }
    } catch (e: unknown) {
      console.error("Failed to open document:", e);
      if (
        e instanceof Error &&
        e.message?.includes("not a valid zip")
      ) {
        throw new Error("Unsupported or corrupted book file");
      }
      throw e;
    }

    return { book, format } as { book: BookDoc; format: BookFormat };
  }
}

/** Detect writing direction from a document */
export const getDirection = (doc: Document) => {
  const { defaultView } = doc;
  if (!defaultView) return { vertical: false, rtl: false };
  const { writingMode, direction } = defaultView.getComputedStyle(
    doc.body,
  );
  const vertical =
    writingMode === "vertical-rl" || writingMode === "vertical-lr";
  const rtl =
    doc.body.dir === "rtl" ||
    direction === "rtl" ||
    doc.documentElement.dir === "rtl";
  return { vertical, rtl };
};

/** Check if format is fixed layout (pre-paginated) */
export const isFixedLayoutFormat = (format: BookFormat): boolean =>
  format === "PDF" || format === "CBZ";
