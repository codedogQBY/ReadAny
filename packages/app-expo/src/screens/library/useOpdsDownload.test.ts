import type {
  ImportBooksResult,
  OpdsAcquisition,
  OpdsAssetResponse,
  OpdsPublication,
} from "@readany/core";
import { describe, expect, it, vi } from "vitest";
import type { MobileImportFile } from "../../stores/library-store";
vi.mock("../../stores/library-store", () => ({ useLibraryStore: vi.fn() }));
import { createOpdsDownloadAdapter, createOpdsDownloadUnmountGuard } from "./useOpdsDownload";

const selected: OpdsAcquisition = {
  rel: ["http://opds-spec.org/acquisition"],
  url: "https://catalog.test/book.epub",
  type: "application/epub+zip",
  format: "epub",
};

const publication: OpdsPublication = {
  title: "../../Catalog Book",
  authors: ["Catalog Author"],
  publisher: "Catalog Press",
  language: "en",
  identifier: "9781234567897",
  published: "2025",
  description: "Catalog description",
  subjects: ["Subject A", "Subject B"],
  images: [],
  acquisitions: [selected],
  readingOrder: [],
};

function asset(bytes = new Uint8Array([1, 2, 3])): OpdsAssetResponse {
  const response = new Response(bytes, {
    headers: { "Content-Length": String(bytes.byteLength) },
  });
  return Object.assign(response, {
    cancel: vi.fn(async (_reason?: unknown) => undefined),
  }) as unknown as OpdsAssetResponse;
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const platform = {
    writeFile: vi.fn(async (_path: string, _data: Uint8Array) => undefined),
    deleteFile: vi.fn(async (_path: string) => undefined),
    mkdir: vi.fn(async (_path: string) => undefined),
    joinPath: vi.fn(async (...parts: string[]) => parts.join("/")),
  };
  const importBooks = vi.fn(
    async (_files: MobileImportFile[], _options?: { transactional?: boolean }) =>
      ({
        imported: [{ id: "book-id" }],
        skippedDuplicates: [],
        failures: [],
      }) as unknown as ImportBooksResult,
  );
  return {
    platform,
    client: {
      fetchAsset: vi.fn(
        async (_url: string, _origin: string, _credentials?: unknown, _signal?: AbortSignal) =>
          asset(),
      ),
    },
    importBooks,
    getTempDirectory: vi.fn(async () => "file:///cache"),
    createId: () => "fixed-id",
    ...overrides,
  };
}

describe("mobile OPDS download adapter", () => {
  it("cancels on unmount and suppresses later hook state updates", () => {
    const cancel = vi.fn();
    const update = vi.fn();
    const lifecycle = createOpdsDownloadUnmountGuard(cancel);

    lifecycle.runIfMounted(update);
    lifecycle.dispose();
    lifecycle.runIfMounted(update);
    lifecycle.dispose();

    expect(update).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("imports through the actual mobile file signature and cleans the temp file once", async () => {
    const deps = dependencies();
    const run = createOpdsDownloadAdapter(deps as never);

    const result = await run({
      publication,
      acquisition: selected,
      catalogOrigin: "https://catalog.test",
    });

    expect(deps.importBooks).toHaveBeenCalledOnce();
    expect(deps.importBooks.mock.calls[0]?.[1]).toEqual({ transactional: true });
    const [[files]] = deps.importBooks.mock.calls;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      name: "Catalog Book.epub",
      metadata: {
        title: "../../Catalog Book",
        author: "Catalog Author",
        publisher: "Catalog Press",
        subjects: ["Subject A", "Subject B"],
      },
    });
    expect(files[0].metadata).not.toHaveProperty("tags");
    expect(files[0].uri).toMatch(/^file:\/\/\/cache\/readany-opds-import\/opds-/);
    expect(files[0].uri).toMatch(/\.epub$/);
    expect(deps.platform.deleteFile).toHaveBeenCalledExactlyOnceWith(files[0].uri);
    expect(result.cleanupFailed).toBe(false);
  });

  it("uses the React Native-safe ID path without a createId test override", async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(7);
        return bytes;
      },
    });
    const deps = dependencies();
    const { createId: _createId, ...productionDeps } = deps;
    const run = createOpdsDownloadAdapter(productionDeps as never);

    await expect(
      run({ publication, catalogOrigin: "https://catalog.test" }),
    ).resolves.toBeDefined();
    expect(deps.platform.writeFile.mock.calls[0]?.[0]).toContain(
      "07070707-0707-4707-8707-070707070707",
    );
    vi.stubGlobal("crypto", originalCrypto);
  });

  it.each(["getTempDirectory", "joinPath", "mkdir"] as const)(
    "maps %s setup failures without trying cleanup before a path exists",
    async (operation) => {
      const deps = dependencies();
      if (operation === "getTempDirectory") {
        deps.getTempDirectory.mockRejectedValueOnce(new Error("C:/private/temp detail"));
      } else {
        deps.platform[operation].mockRejectedValueOnce(new Error("C:/private/temp detail"));
      }
      const run = createOpdsDownloadAdapter(deps as never);

      const error = await run({ publication, catalogOrigin: "https://catalog.test" }).catch(
        (value: unknown) => value,
      );

      expect(error).toMatchObject({ code: "download-failed" });
      expect(String(error)).not.toContain("private");
      expect(deps.platform.deleteFile).not.toHaveBeenCalled();
    },
  );

  it("maps store failures to import-failed and preserves that error when cleanup also fails", async () => {
    const onCleanupError = vi.fn();
    const deps = dependencies({
      importBooks: vi.fn(async () => ({
        imported: [],
        skippedDuplicates: [],
        failures: [{ name: "book.epub", error: "database secret detail" }],
      })),
      onCleanupError,
    });
    deps.platform.deleteFile.mockRejectedValueOnce(new Error("cleanup detail"));
    const run = createOpdsDownloadAdapter(deps as never);

    const error = await run({
      publication,
      catalogOrigin: "https://catalog.test",
    }).catch((value: unknown) => value);

    expect(error).toMatchObject({ code: "import-failed" });
    expect(String(error)).not.toContain("database secret detail");
    expect(deps.platform.deleteFile).toHaveBeenCalledOnce();
    expect(onCleanupError).toHaveBeenCalledWith(expect.any(Error), error);
  });

  it("never lets a throwing cleanup reporter mask the primary error", async () => {
    const deps = dependencies({
      importBooks: vi.fn(async () => {
        throw new Error("database detail");
      }),
      onCleanupError: vi.fn(() => {
        throw new Error("reporter detail");
      }),
    });
    deps.platform.deleteFile.mockRejectedValueOnce(new Error("cleanup detail"));
    const run = createOpdsDownloadAdapter(deps as never);

    await expect(run({ publication, catalogOrigin: "https://catalog.test" })).rejects.toMatchObject(
      {
        code: "import-failed",
      },
    );
  });

  it("cleans once on cancellation before import", async () => {
    const controller = new AbortController();
    const deps = dependencies();
    deps.platform.writeFile.mockImplementationOnce(async () => {
      controller.abort();
    });
    const run = createOpdsDownloadAdapter(deps as never);

    await expect(
      run({
        publication,
        catalogOrigin: "https://catalog.test",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(deps.importBooks).not.toHaveBeenCalled();
    expect(deps.platform.deleteFile).toHaveBeenCalledOnce();
  });

  it("finishes an import atomically when cancellation arrives after import begins", async () => {
    const controller = new AbortController();
    let finishImport!: () => void;
    const importGate = new Promise<void>((resolve) => {
      finishImport = resolve;
    });
    const deps = dependencies({
      importBooks: vi.fn(async () => {
        controller.abort();
        await importGate;
        return { imported: [{ id: "book-id" }], skippedDuplicates: [], failures: [] };
      }),
    });
    const run = createOpdsDownloadAdapter(deps as never);
    const pending = run({
      publication,
      catalogOrigin: "https://catalog.test",
      signal: controller.signal,
    });
    finishImport();

    await expect(pending).resolves.toMatchObject({ cleanupFailed: false });
    expect(deps.platform.deleteFile).toHaveBeenCalledOnce();
  });

  it("announces the noncancellable import boundary synchronously before touching the store", async () => {
    const order: string[] = [];
    const deps = dependencies({
      importBooks: vi.fn(async () => {
        order.push("import");
        return { imported: [{ id: "book-id" }], skippedDuplicates: [], failures: [] };
      }),
    });
    const run = createOpdsDownloadAdapter(deps as never);

    await run({
      publication,
      catalogOrigin: "https://catalog.test",
      onImportStart: () => order.push("boundary"),
    });

    expect(order).toEqual(["boundary", "import"]);
  });

  it("reports a cleanup-only failure without turning a successful managed import into failure", async () => {
    const onCleanupError = vi.fn();
    const deps = dependencies({ onCleanupError });
    deps.platform.deleteFile.mockRejectedValueOnce(new Error("cleanup detail"));
    const run = createOpdsDownloadAdapter(deps as never);

    const result = await run({ publication, catalogOrigin: "https://catalog.test" });

    expect(result.cleanupFailed).toBe(true);
    expect(onCleanupError).toHaveBeenCalledWith(expect.any(Error), undefined);
  });

  it("uses collision-proof names for concurrent downloads and new names on retry", async () => {
    const deps = dependencies();
    const fetchAsset = deps.client.fetchAsset;
    fetchAsset.mockRejectedValueOnce(new Error("offline"));
    const run = createOpdsDownloadAdapter(deps as never);

    await expect(run({ publication, catalogOrigin: "https://catalog.test" })).rejects.toMatchObject(
      {
        code: "download-failed",
      },
    );
    await Promise.all([
      run({ publication, catalogOrigin: "https://catalog.test" }),
      run({ publication, catalogOrigin: "https://catalog.test" }),
    ]);

    const paths = deps.platform.writeFile.mock.calls.map(([path]) => path);
    expect(new Set(paths).size).toBe(2);
    const cleaned = deps.platform.deleteFile.mock.calls.map(([path]) => path);
    expect(new Set(cleaned).size).toBe(3);
    expect(deps.platform.deleteFile).toHaveBeenCalledTimes(3);
  });
});
