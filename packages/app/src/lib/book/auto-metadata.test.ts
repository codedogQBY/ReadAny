import type { Book } from "@readany/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractLocalBookMetadata } from "./auto-metadata";

const fsState = vi.hoisted(() => ({ exists: true }));
const readFile = vi.hoisted(() => vi.fn(async () => new Uint8Array([1, 2, 3])));
const getCover = vi.hoisted(() =>
  vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })),
);
const openDocument = vi.hoisted(() =>
  vi.fn(async () => ({
    book: {
      metadata: {
        title: "Embedded title",
        author: { name: "Embedded author" },
        publisher: "Embedded press",
        subject: ["History"],
      },
      getCover,
    },
  })),
);

vi.mock("@/lib/storage/desktop-library-root", () => ({
  resolveDesktopDataPath: vi.fn(async (path: string) => `C:/library/${path}`),
}));
vi.mock("@/lib/reader/document-loader", () => ({
  DocumentLoader: class {
    open = openDocument;
  },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => fsState.exists),
  readFile,
}));

describe("desktop local book metadata repair", () => {
  beforeEach(() => {
    fsState.exists = true;
    vi.clearAllMocks();
    getCover.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
  });

  it.each(["epub", "mobi", "azw", "azw3"])(
    "extracts metadata and cover from a local %s file",
    async (format) => {
      await expect(
        extractLocalBookMetadata(createBook(format as Book["format"])),
      ).resolves.toMatchObject({
        title: "Embedded title",
        author: "Embedded author",
        publisher: "Embedded press",
        subjects: ["History"],
        coverBlob: expect.any(Blob),
      });
      expect(openDocument).toHaveBeenCalledOnce();
      expect(getCover).toHaveBeenCalledOnce();
    },
  );

  it("keeps document metadata when cover extraction fails", async () => {
    getCover.mockRejectedValueOnce(new Error("bad cover"));

    await expect(extractLocalBookMetadata(createBook("mobi"))).resolves.toMatchObject({
      title: "Embedded title",
      publisher: "Embedded press",
      subjects: ["History"],
    });
    expect(getCover).toHaveBeenCalledOnce();
  });

  it("does not read a missing local file", async () => {
    fsState.exists = false;

    await expect(extractLocalBookMetadata(createBook("mobi"))).resolves.toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });
});

function createBook(format: Book["format"]): Book {
  return {
    id: `legacy-${format}`,
    filePath: `books/legacy.${format}`,
    format,
    syncStatus: "local",
    meta: { title: "Saved title", author: "Saved author" },
    progress: 0,
    addedAt: 1,
  } as Book;
}
