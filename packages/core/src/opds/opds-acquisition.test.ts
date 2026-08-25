import { describe, expect, it, vi } from "vitest";
import type { IPlatformService } from "../services/platform";
import {
  OPDS_MAX_ACQUISITION_BYTES,
  createExclusiveOpdsDownloadRunner,
  downloadOpdsAcquisition,
  listSupportedAcquisitions,
  toBookMeta,
} from "./opds-acquisition";
import { OpdsClient, OpdsError } from "./opds-client";
import type { OpdsAcquisition, OpdsCredentials, OpdsPublication } from "./opds-types";

function publication(acquisitions: OpdsAcquisition[]): OpdsPublication {
  return {
    id: "urn:test:book",
    title: "../A / Strange \\ Book\u0000",
    authors: ["First Author", "Second Author"],
    publisher: "Press",
    language: "en",
    identifier: "9781234567897",
    published: "2024-01-02",
    description: "Description",
    subjects: ["Fiction", "Adventure"],
    images: [],
    acquisitions,
    readingOrder: [],
  };
}

function acquisition(url: string, type?: string, format: OpdsAcquisition["format"] = null) {
  return { rel: ["http://opds-spec.org/acquisition"], url, type, format };
}

function fakePlatform(
  fetchImpl: IPlatformService["fetch"],
  writeFile = vi.fn(async () => undefined),
) {
  return {
    fetch: fetchImpl,
    writeFile,
  };
}

function streamResponse(chunks: Uint8Array[], headers?: HeadersInit): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { status: 200, headers },
  );
}

describe("listSupportedAcquisitions", () => {
  it("keeps every supported direct format as an explicit choice", () => {
    const formats = [
      ["application/epub+zip", "epub"],
      ["application/pdf", "pdf"],
      ["application/x-mobipocket-ebook", "mobi"],
      ["application/vnd.amazon.ebook", "azw"],
      ["application/vnd.amazon.mobi8-ebook", "azw3"],
      ["application/x-fictionbook+xml", "fb2"],
      ["application/x-fictionbook+zip", "fbz"],
      ["application/vnd.comicbook+zip", "cbz"],
      ["text/plain", "txt"],
      ["application/x-umd", "umd"],
    ] as const;
    const input = publication(
      formats.map(([type], index) => acquisition(`https://catalog.test/book-${index}`, type)),
    );

    expect(listSupportedAcquisitions(input).map(({ format }) => format)).toEqual(
      formats.map(([, format]) => format),
    );
  });

  it("falls back to supported extensions and excludes unknown or indirect links", () => {
    const input = publication([
      acquisition("https://catalog.test/book.FBZ?download=1"),
      acquisition("https://catalog.test/book.azw3"),
      { ...acquisition("https://catalog.test/license.epub"), rel: ["license"] },
      acquisition("https://catalog.test/book.exe", "application/octet-stream"),
    ]);

    expect(listSupportedAcquisitions(input).map(({ format }) => format)).toEqual(["fbz", "azw3"]);
  });

  it("recognizes reader MIME aliases and uses the extension to disambiguate Amazon ebooks", () => {
    const input = publication([
      acquisition("https://catalog.test/book.fb2.zip", "application/x-zip-compressed-fb2"),
      acquisition("https://catalog.test/book.azw3", "application/vnd.amazon.ebook"),
    ]);

    expect(listSupportedAcquisitions(input).map(({ format }) => format)).toEqual(["fbz", "azw3"]);
  });

  it("uses the advertised MIME format when the URL extension disagrees", () => {
    const [choice] = listSupportedAcquisitions(
      publication([acquisition("https://catalog.test/wrong.pdf", "application/epub+zip")]),
    );

    expect(choice).toMatchObject({ format: "epub" });
    expect(choice.suggestedFileName).toMatch(/\.epub$/);
    expect(choice.suggestedFileName).not.toContain("..");
    expect(choice.suggestedFileName).not.toMatch(/[\\/:*?"<>|]/);
    expect(choice.suggestedFileName).not.toContain("\u0000");
  });

  it("avoids Windows device names in suggested filenames", () => {
    const input = publication([
      acquisition("https://catalog.test/book.epub", "application/epub+zip"),
    ]);
    input.title = "CON";

    expect(listSupportedAcquisitions(input)[0]?.suggestedFileName).toBe("_CON.epub");
  });

  it("protects a reserved Windows device stem before a suffix", () => {
    const input = publication([
      acquisition("https://catalog.test/book.epub", "application/epub+zip"),
    ]);
    input.title = "CON.txt";

    expect(listSupportedAcquisitions(input)[0]?.suggestedFileName).toBe("_CON.txt.epub");
  });
});

describe("toBookMeta", () => {
  it("maps catalog metadata with subjects kept separate from library tags", () => {
    const meta = toBookMeta(publication([]));

    expect(meta).toEqual({
      title: "../A / Strange \\ Book\u0000",
      author: "First Author, Second Author",
      publisher: "Press",
      language: "en",
      isbn: "9781234567897",
      publishDate: "2024-01-02",
      description: "Description",
      subjects: ["Fiction", "Adventure"],
    });
    expect(meta).not.toHaveProperty("tags");
  });

  it("does not put a non-ISBN OPDS identifier into the ISBN field", () => {
    const input = publication([]);
    input.identifier = "urn:uuid:not-an-isbn";

    expect(toBookMeta(input)).not.toHaveProperty("isbn");
  });

  it("stores an OPDS HTML description as readable plain text", () => {
    const input = publication([]);
    input.description =
      "<p>A <strong>safe</strong> description.</p><p>Second &amp; final.<br>Line.</p><script>hidden()</script>";

    expect(toBookMeta(input).description).toBe("A safe description.\nSecond & final.\nLine.");
  });
});

describe("downloadOpdsAcquisition", () => {
  it("requires an explicit choice when multiple formats are supported", async () => {
    const input = publication([
      acquisition("https://catalog.test/book.epub", "application/epub+zip"),
      acquisition("https://catalog.test/book.pdf", "application/pdf"),
    ]);
    const platform = fakePlatform(vi.fn());

    await expect(
      downloadOpdsAcquisition({
        publication: input,
        client: new OpdsClient(platform),
        platform,
        catalogOrigin: "https://catalog.test",
        destinationPath: "/cache/book.epub",
      }),
    ).rejects.toMatchObject({ code: "unsupported-acquisition" });
    expect(platform.fetch).not.toHaveBeenCalled();
  });

  it("rejects a selected acquisition that does not belong to the publication", async () => {
    const input = publication([
      acquisition("https://catalog.test/book.epub", "application/epub+zip"),
    ]);
    const platform = fakePlatform(vi.fn());

    await expect(
      downloadOpdsAcquisition({
        publication: input,
        acquisition: acquisition("https://evil.test/book.epub", "application/epub+zip"),
        client: new OpdsClient(platform),
        platform,
        catalogOrigin: "https://catalog.test",
        destinationPath: "/cache/book.epub",
      }),
    ).rejects.toMatchObject({ code: "unsupported-acquisition" });
  });

  it("routes same-origin credentials through OpdsClient and strips them after a cross-origin redirect", async () => {
    const seen: Array<{ url: string; authorization: string | null }> = [];
    const platform = fakePlatform(
      vi.fn(async (url: string, options?: RequestInit) => {
        const headers = new Headers(options?.headers);
        seen.push({ url, authorization: headers.get("Authorization") });
        if (url === "https://catalog.test/book.epub") {
          return new Response(null, {
            status: 302,
            headers: { Location: "https://cdn.test/book.epub" },
          });
        }
        return streamResponse([new Uint8Array([1, 2, 3])], { "Content-Length": "3" });
      }) as IPlatformService["fetch"],
    );
    const credentials: OpdsCredentials = {
      username: "reader",
      password: "secret-password",
      catalogOrigin: "https://catalog.test",
    };

    await downloadOpdsAcquisition({
      publication: publication([
        acquisition("https://catalog.test/book.epub", "application/epub+zip"),
      ]),
      client: new OpdsClient(platform),
      platform,
      catalogOrigin: "https://catalog.test",
      credentials,
      destinationPath: "/cache/book.epub",
    });

    expect(seen[0]?.authorization).toMatch(/^Basic /);
    expect(seen[1]).toEqual({ url: "https://cdn.test/book.epub", authorization: null });
    expect(JSON.stringify(seen)).not.toContain("secret-password");
  });

  it("reports monotonic bounded progress for streamed and unknown-length assets", async () => {
    const platform = fakePlatform(
      vi.fn(async () =>
        streamResponse([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])]),
      ) as IPlatformService["fetch"],
    );
    const progress: Array<{ loaded: number; total: number }> = [];

    const result = await downloadOpdsAcquisition({
      publication: publication([
        acquisition("https://catalog.test/book.epub", "application/epub+zip"),
      ]),
      client: new OpdsClient(platform),
      platform,
      catalogOrigin: "https://catalog.test",
      destinationPath: "/cache/book.epub",
      onProgress: (value) => progress.push(value),
    });

    expect(progress).toEqual([
      { loaded: 0, total: 0 },
      { loaded: 2, total: 0 },
      { loaded: 3, total: 0 },
      { loaded: 6, total: 0 },
    ]);
    expect(result.bytesWritten).toBe(6);
    expect(platform.writeFile).toHaveBeenCalledWith(
      "/cache/book.epub",
      new Uint8Array([1, 2, 3, 4, 5, 6]),
    );
  });

  it("clamps a dishonest content length instead of emitting out-of-range progress", async () => {
    const platform = fakePlatform(
      vi.fn(async () =>
        streamResponse([new Uint8Array([1, 2]), new Uint8Array([3, 4])], {
          "Content-Length": "3",
        }),
      ) as IPlatformService["fetch"],
    );
    const progress: Array<{ loaded: number; total: number }> = [];

    await downloadOpdsAcquisition({
      publication: publication([
        acquisition("https://catalog.test/book.epub", "application/epub+zip"),
      ]),
      client: new OpdsClient(platform),
      platform,
      catalogOrigin: "https://catalog.test",
      destinationPath: "/cache/book.epub",
      onProgress: (value) => progress.push(value),
    });

    expect(progress).toEqual([
      { loaded: 0, total: 3 },
      { loaded: 2, total: 3 },
      { loaded: 3, total: 3 },
    ]);
  });

  it("cancels a download during streaming and never writes the partial bytes", async () => {
    let releaseChunk!: () => void;
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    const response = new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new Uint8Array([1]));
          await chunkGate;
          controller.enqueue(new Uint8Array([2]));
          controller.close();
        },
      }),
      { status: 200 },
    );
    const platform = fakePlatform(vi.fn(async () => response) as IPlatformService["fetch"]);
    const controller = new AbortController();
    const progress: number[] = [];
    const promise = downloadOpdsAcquisition({
      publication: publication([
        acquisition("https://catalog.test/book.epub", "application/epub+zip"),
      ]),
      client: new OpdsClient(platform),
      platform,
      catalogOrigin: "https://catalog.test",
      destinationPath: "/cache/book.epub",
      signal: controller.signal,
      onProgress: ({ loaded }) => {
        progress.push(loaded);
        if (loaded === 1) controller.abort();
      },
    });
    releaseChunk();

    await expect(promise).rejects.toMatchObject({ code: "cancelled" });
    expect(platform.writeFile).not.toHaveBeenCalled();
  });

  it("waits for an in-flight write, then reports cancellation", async () => {
    let finishWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const writeFile = vi.fn(async () => writeGate);
    const platform = fakePlatform(
      vi.fn(async () => streamResponse([new Uint8Array([1])])) as IPlatformService["fetch"],
      writeFile,
    );
    const controller = new AbortController();
    const promise = downloadOpdsAcquisition({
      publication: publication([
        acquisition("https://catalog.test/book.epub", "application/epub+zip"),
      ]),
      client: new OpdsClient(platform),
      platform,
      catalogOrigin: "https://catalog.test",
      destinationPath: "/cache/book.epub",
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    controller.abort();
    finishWrite();

    await expect(promise).rejects.toMatchObject({ code: "cancelled" });
  });

  it("maps transport and write errors to download-failed without leaking their messages", async () => {
    const secret = "secret-password";
    const transport = fakePlatform(
      vi.fn(async () => {
        throw new Error(`network exposed ${secret}`);
      }) as IPlatformService["fetch"],
    );
    const write = fakePlatform(
      vi.fn(async () => streamResponse([new Uint8Array([1])])) as IPlatformService["fetch"],
      vi.fn(async () => {
        throw new Error(`disk exposed ${secret}`);
      }),
    );
    const run = (platform: ReturnType<typeof fakePlatform>) =>
      downloadOpdsAcquisition({
        publication: publication([
          acquisition("https://catalog.test/book.epub", "application/epub+zip"),
        ]),
        client: new OpdsClient(platform),
        platform,
        catalogOrigin: "https://catalog.test",
        destinationPath: "/cache/book.epub",
      });

    for (const platform of [transport, write]) {
      const error = await run(platform).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(OpdsError);
      expect(error).toMatchObject({ code: "download-failed" });
      expect(String(error)).not.toContain(secret);
    }
  });

  it("rejects an oversized advertised asset before reading and cancels its transport", async () => {
    const response = streamResponse([new Uint8Array([1])], {
      "Content-Length": String(OPDS_MAX_ACQUISITION_BYTES + 1),
    }) as Response & { cancel: ReturnType<typeof vi.fn> };
    response.cancel = vi.fn(async () => undefined);
    const client = { fetchAsset: vi.fn(async () => response) };
    const platform = fakePlatform(vi.fn());

    await expect(
      downloadOpdsAcquisition({
        publication: publication([
          acquisition("https://catalog.test/book.epub", "application/epub+zip"),
        ]),
        client,
        platform,
        catalogOrigin: "https://catalog.test",
        destinationPath: "/cache/book.epub",
      }),
    ).rejects.toMatchObject({ code: "asset-too-large" });
    expect(response.cancel).toHaveBeenCalledOnce();
    expect(platform.writeFile).not.toHaveBeenCalled();
  });

  it("bounds a missing or dishonest content length by cumulative bytes", async () => {
    const response = streamResponse([
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
    ]) as Response & { cancel: ReturnType<typeof vi.fn> };
    response.cancel = vi.fn(async () => undefined);
    const platform = fakePlatform(vi.fn());

    await expect(
      downloadOpdsAcquisition({
        publication: publication([
          acquisition("https://catalog.test/book.epub", "application/epub+zip"),
        ]),
        client: { fetchAsset: vi.fn(async () => response) },
        platform,
        catalogOrigin: "https://catalog.test",
        destinationPath: "/cache/book.epub",
        maxBytes: 5,
      }),
    ).rejects.toMatchObject({ code: "asset-too-large" });
    expect(response.cancel).toHaveBeenCalledOnce();
    expect(platform.writeFile).not.toHaveBeenCalled();
  });
});

describe("createExclusiveOpdsDownloadRunner", () => {
  it("rejects overlap, keeps cancellation on the first operation, and permits a later retry", async () => {
    let started = 0;
    const execute = vi.fn(
      (input: { value: number; signal: AbortSignal; onProgress: (value: number) => void }) =>
        new Promise<number>((resolve, reject) => {
          started += 1;
          input.onProgress(input.value);
          if (input.value === 2) {
            resolve(input.value);
            return;
          }
          input.signal.addEventListener("abort", () => reject(new OpdsError("cancelled")), {
            once: true,
          });
        }),
    );
    const progress: number[] = [];
    const runner = createExclusiveOpdsDownloadRunner(execute, {
      onProgress: (value) => progress.push(value),
    });

    const first = runner.download({ value: 1 });
    await expect(runner.download({ value: 99 })).rejects.toMatchObject({
      code: "download-in-progress",
    });
    expect(runner.isActive()).toBe(true);
    runner.cancel();
    await expect(first).rejects.toMatchObject({ code: "cancelled" });
    await expect(runner.download({ value: 2 })).resolves.toBe(2);

    expect(started).toBe(2);
    expect(progress).toEqual([1, 2]);
    expect(runner.isActive()).toBe(false);
  });
});
