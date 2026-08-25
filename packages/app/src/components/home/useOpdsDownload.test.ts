import type {
  ImportBooksResult,
  OpdsAcquisition,
  OpdsAssetResponse,
  OpdsPublication,
} from "@readany/core";
import { describe, expect, it, vi } from "vitest";
import type { DesktopImportFile } from "../../lib/book/imported-book-meta";
vi.mock("../../stores/library-store", () => ({ useLibraryStore: vi.fn() }));
import { createOpdsDownloadAdapter } from "./useOpdsDownload";

const selected: OpdsAcquisition = {
  rel: ["http://opds-spec.org/acquisition"],
  url: "https://catalog.test/book.pdf",
  type: "application/pdf",
  format: "pdf",
};

const publication: OpdsPublication = {
  title: "Desktop Book",
  authors: ["Author"],
  subjects: ["Subject"],
  images: [],
  acquisitions: [selected],
  readingOrder: [],
};

function asset(): OpdsAssetResponse {
  return Object.assign(new Response(new Uint8Array([1])), {
    cancel: vi.fn(async (_reason?: unknown) => undefined),
  }) as unknown as OpdsAssetResponse;
}

function dependencies() {
  return {
    platform: {
      writeFile: vi.fn(async (_path: string, _data: Uint8Array) => undefined),
      deleteFile: vi.fn(async (_path: string) => undefined),
      mkdir: vi.fn(async (_path: string) => undefined),
      joinPath: vi.fn(async (...parts: string[]) => parts.join("\\")),
    },
    client: {
      fetchAsset: vi.fn(
        async (_url: string, _origin: string, _credentials?: unknown, _signal?: AbortSignal) =>
          asset(),
      ),
    },
    importBooks: vi.fn(
      async (_files: DesktopImportFile[], _options?: { transactional?: boolean }) =>
        ({
          imported: [{ id: "desktop-book" }],
          skippedDuplicates: [],
          failures: [],
        }) as unknown as ImportBooksResult,
    ),
    getTempDirectory: vi.fn(async () => "C:\\Temp"),
    createId: () => "fixed-id",
  };
}

describe("desktop OPDS download adapter", () => {
  it("announces the import point of no return after download and before library mutation", async () => {
    const deps = dependencies();
    const events: string[] = [];
    deps.platform.writeFile.mockImplementationOnce(async () => {
      events.push("downloaded");
    });
    deps.importBooks.mockImplementationOnce(async () => {
      events.push("importing");
      return {
        imported: [{ id: "desktop-book" }],
        skippedDuplicates: [],
        failures: [],
      } as unknown as ImportBooksResult;
    });
    const run = createOpdsDownloadAdapter(deps as never);

    await run({
      publication,
      acquisition: selected,
      catalogOrigin: "https://catalog.test",
      onImportStart: () => events.push("point-of-no-return"),
    });

    expect(events).toEqual(["downloaded", "point-of-no-return", "importing"]);
  });

  it("passes metadata through the backward-compatible desktop input and cleans once", async () => {
    const deps = dependencies();
    const run = createOpdsDownloadAdapter(deps as never);

    await run({
      publication,
      acquisition: selected,
      catalogOrigin: "https://catalog.test",
    });

    const [[files]] = deps.importBooks.mock.calls;
    expect(deps.importBooks.mock.calls[0]?.[1]).toEqual({ transactional: true });
    expect(files).toEqual([
      {
        path: expect.stringMatching(/^C:\\Temp\\readany-opds-import\\opds-.*\.pdf$/),
        name: "Desktop Book.pdf",
        metadata: {
          title: "Desktop Book",
          author: "Author",
          subjects: ["Subject"],
        },
      },
    ]);
    const importedFile = files[0];
    expect(typeof importedFile).toBe("object");
    if (typeof importedFile === "string") throw new Error("Expected desktop import context");
    expect(importedFile.metadata).not.toHaveProperty("tags");
    expect(deps.platform.deleteFile).toHaveBeenCalledExactlyOnceWith(importedFile.path);
  });

  it("maps temporary setup failure to download-failed without cleanup", async () => {
    const deps = dependencies();
    deps.platform.mkdir.mockRejectedValueOnce(new Error("C:\\private\\backend detail"));
    const run = createOpdsDownloadAdapter(deps as never);

    const error = await run({ publication, catalogOrigin: "https://catalog.test" }).catch(
      (value: unknown) => value,
    );

    expect(error).toMatchObject({ code: "download-failed" });
    expect(String(error)).not.toContain("private");
    expect(deps.platform.deleteFile).not.toHaveBeenCalled();
  });

  it("cleans exactly once when the desktop store throws and returns a stable error", async () => {
    const deps = dependencies();
    deps.importBooks.mockRejectedValueOnce(new Error("sqlite private detail"));
    const run = createOpdsDownloadAdapter(deps as never);

    const error = await run({ publication, catalogOrigin: "https://catalog.test" }).catch(
      (value: unknown) => value,
    );

    expect(error).toMatchObject({ code: "import-failed" });
    expect(String(error)).not.toContain("sqlite private detail");
    expect(deps.platform.deleteFile).toHaveBeenCalledOnce();
  });

  it("does not auto-pick when multiple formats are present", async () => {
    const deps = dependencies();
    const run = createOpdsDownloadAdapter(deps as never);

    await expect(
      run({
        publication: {
          ...publication,
          acquisitions: [
            selected,
            {
              rel: ["http://opds-spec.org/acquisition"],
              url: "https://catalog.test/book.epub",
              type: "application/epub+zip",
              format: "epub",
            },
          ],
        },
        catalogOrigin: "https://catalog.test",
      }),
    ).rejects.toMatchObject({ code: "unsupported-acquisition" });
    expect(deps.importBooks).not.toHaveBeenCalled();
    expect(deps.platform.deleteFile).not.toHaveBeenCalled();
  });
});
