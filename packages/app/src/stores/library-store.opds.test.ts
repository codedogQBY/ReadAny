import type { Book } from "@readany/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const existingPaths = new Set<string>();
  return {
    db: {
      initDatabase: vi.fn(async () => undefined),
      insertBook: vi.fn(async () => undefined),
      updateBook: vi.fn(async () => undefined),
      getDeletedBookByFileHash: vi.fn(async () => null as Book | null),
      getDeletedBookByTitle: vi.fn(async () => null as Book | null),
    },
    invoke: vi.fn(async () => "same-hash" as string | undefined),
    copyFile: vi.fn(async (_source: string, _destination: string) => undefined),
    remove: vi.fn(async (_path: string) => undefined),
    exists: vi.fn(async (path: string) => existingPaths.has(path)),
    saveCover: vi.fn(async (bookId: string) => `covers/${bookId}.jpg`),
    existingPaths,
  };
});

vi.mock("@/lib/book/cover-storage", () => ({
  getCoverFileExtension: async () => "jpg",
  saveCoverToAppData: mocks.saveCover,
}));
vi.mock("@/lib/db/database", () => mocks.db);
vi.mock("@/lib/rag/vectorize-trigger", () => ({ triggerVectorizeBook: vi.fn() }));
vi.mock("@/lib/storage/desktop-library-root", () => ({
  getDesktopLibraryRoot: async () => "/library",
  isDesktopManagedRelativePath: () => true,
  resolveDesktopDataPath: async (path: string) => `/library/${path}`,
}));
vi.mock("@/lib/reader/document-loader", () => ({
  DocumentLoader: class {
    async open() {
      return {
        book: {
          metadata: { title: "Embedded title", author: "Embedded author" },
          getCover: async () => new Blob([new Uint8Array([9])]),
        },
      };
    }
  },
}));
vi.mock("@readany/core/stores/persist", () => ({
  debouncedSave: vi.fn(),
  loadFromFS: vi.fn(),
}));
vi.mock("@readany/core/stores/vector-model-store", () => ({
  useVectorModelStore: {
    getState: () => ({
      autoVectorizeOnImport: false,
      vectorModelEnabled: false,
      hasVectorCapability: () => false,
    }),
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: mocks.copyFile,
  exists: mocks.exists,
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
  remove: mocks.remove,
  writeFile: vi.fn(async () => undefined),
}));

import { useLibraryStore } from "./library-store";

function book(overrides: Partial<Book> = {}): Book {
  return {
    id: "existing-id",
    filePath: "books/existing-id.mobi",
    format: "mobi",
    meta: { title: "Saved title", author: "Saved author" },
    progress: 0.5,
    isVectorized: false,
    vectorizeProgress: 0,
    tags: ["user-tag"],
    fileHash: "same-hash",
    syncStatus: "local",
    addedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("desktop transactional OPDS imports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue("same-hash");
    mocks.db.getDeletedBookByFileHash.mockResolvedValue(null);
    mocks.db.getDeletedBookByTitle.mockResolvedValue(null);
    mocks.db.insertBook.mockResolvedValue(undefined);
    mocks.db.updateBook.mockResolvedValue(undefined);
    mocks.existingPaths.clear();
    useLibraryStore.setState({ books: [], isImporting: false });
  });

  it("skips an existing book with the same desktop file hash", async () => {
    useLibraryStore.setState({ books: [book()] });

    const result = await useLibraryStore
      .getState()
      .importBooks([{ path: "C:\\cache\\uuid.mobi", name: "Catalog.mobi" }], {
        transactional: true,
      });

    expect(result.skippedDuplicates).toHaveLength(1);
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });

  it("rolls back the managed book and cover when durable insertion fails", async () => {
    mocks.invoke.mockResolvedValueOnce("new-hash");
    mocks.db.insertBook.mockRejectedValueOnce(new Error("insert failed"));

    const result = await useLibraryStore
      .getState()
      .importBooks([{ path: "C:\\cache\\uuid.mobi", name: "Catalog.mobi" }], {
        transactional: true,
      });

    expect(result.failures).toHaveLength(1);
    expect(result.imported).toHaveLength(0);
    expect(useLibraryStore.getState().books).toHaveLength(0);
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.remove.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/library\/books\/.*\.mobi$/),
        expect.stringMatching(/^\/library\/covers\/.*\.jpg$/),
      ]),
    );
  });

  it("preserves existing managed files and state when a strict restore update fails", async () => {
    const priorBooks = [book({ id: "visible-id", fileHash: "visible-hash" })];
    useLibraryStore.setState({ books: priorBooks });
    mocks.existingPaths.add("/library/books/existing-id.mobi");
    mocks.existingPaths.add("/library/covers/existing-id.jpg");
    mocks.db.getDeletedBookByFileHash.mockResolvedValueOnce(book({ deletedAt: 10 }));
    mocks.db.updateBook.mockRejectedValueOnce(new Error("update failed"));

    const result = await useLibraryStore
      .getState()
      .importBooks([{ path: "C:\\cache\\uuid.mobi", name: "Catalog.mobi" }], {
        transactional: true,
      });

    expect(result.failures).toHaveLength(1);
    expect(useLibraryStore.getState().books).toEqual(priorBooks);
    expect(mocks.copyFile.mock.calls[0]?.[1]).toMatch(/^\/library\/books\/existing-id-.+\.mobi$/);
    expect(mocks.saveCover.mock.calls[0]?.[0]).toMatch(/^existing-id-.+/);
    expect(mocks.remove.mock.calls.map(([path]) => path)).toEqual([
      mocks.copyFile.mock.calls[0]?.[1],
      expect.stringMatching(/^\/library\/covers\/existing-id-.+\.jpg$/),
    ]);
    expect(mocks.remove).not.toHaveBeenCalledWith("/library/books/existing-id.mobi");
    expect(mocks.remove).not.toHaveBeenCalledWith("/library/covers/existing-id.jpg");
  });

  it("uses the suggested display name instead of the UUID temp basename", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("hash unavailable"));

    await useLibraryStore
      .getState()
      .importBooks([{ path: "C:\\cache\\random-uuid.mobi", name: "Catalog Title.mobi" }], {
        transactional: true,
      });

    expect(mocks.db.getDeletedBookByTitle).toHaveBeenCalledWith("Catalog Title");
  });

  it("restores to new managed paths while retaining pre-existing files", async () => {
    mocks.existingPaths.add("/library/books/existing-id.mobi");
    mocks.existingPaths.add("/library/covers/existing-id.jpg");
    mocks.db.getDeletedBookByFileHash.mockResolvedValueOnce(book({ deletedAt: 10 }));

    const result = await useLibraryStore
      .getState()
      .importBooks([{ path: "C:\\cache\\uuid.mobi", name: "Catalog.mobi" }], {
        transactional: true,
      });

    expect(result.imported).toHaveLength(1);
    expect(mocks.db.updateBook).toHaveBeenCalledTimes(1);
    expect(useLibraryStore.getState().books[0]).toMatchObject({
      id: "existing-id",
      filePath: expect.stringMatching(/^books\/existing-id-.+\.mobi$/),
      tags: ["user-tag"],
      meta: {
        title: "Saved title",
        author: "Saved author",
        coverUrl: expect.stringMatching(/^covers\/existing-id-.+\.jpg$/),
      },
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("does not title-match a deleted book after a conclusive hash miss", async () => {
    const sameTitleDeleted = book({ deletedAt: 10, fileHash: "old-hash" });
    mocks.invoke.mockResolvedValueOnce("different-valid-hash");
    mocks.db.getDeletedBookByTitle.mockResolvedValueOnce(sameTitleDeleted);

    const result = await useLibraryStore
      .getState()
      .importBooks([{ path: "C:\\cache\\uuid.mobi", name: "Saved title.mobi" }], {
        transactional: true,
      });

    expect(mocks.db.getDeletedBookByFileHash).toHaveBeenCalledWith("different-valid-hash");
    expect(mocks.db.getDeletedBookByTitle).not.toHaveBeenCalled();
    expect(mocks.db.insertBook).toHaveBeenCalledTimes(1);
    expect(mocks.db.updateBook).not.toHaveBeenCalled();
    expect(result.imported[0]).not.toMatchObject({ id: "existing-id" });
  });
});
