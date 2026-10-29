import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Book } from "@readany/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getInfoAsync = vi.fn();

vi.mock("expo-file-system/legacy", () => ({
  getInfoAsync: (...args: unknown[]) => getInfoAsync(...args),
}));

vi.mock("@readany/core/services", () => ({
  getPlatformService: () => ({
    getAppDataDir: async () => "/data",
    joinPath: async (...parts: string[]) => parts.join("/"),
  }),
}));

vi.mock("./auto-vectorize-service", () => ({
  queueBook: vi.fn(),
}));

import { getMobileVectorizeMimeType, inspectMobileBookForVectorize } from "./auto-vectorize-book";

function makeBook(format: string): Book {
  return { id: "b1", filePath: `/books/book.${format}`, format } as unknown as Book;
}

describe("getMobileVectorizeMimeType", () => {
  it("maps every format the hidden reader can extract text from", () => {
    expect(getMobileVectorizeMimeType("epub")).toBe("application/epub+zip");
    expect(getMobileVectorizeMimeType("pdf")).toBe("application/pdf");
    expect(getMobileVectorizeMimeType("fb2")).toBe("application/x-fictionbook+xml");
    expect(getMobileVectorizeMimeType("fbz")).toBe("application/x-zip-compressed-fb2");
    expect(getMobileVectorizeMimeType("txt")).toBe("text/plain");
    // UMD imports are converted to EPUB on mobile.
    expect(getMobileVectorizeMimeType("umd")).toBe("application/epub+zip");
  });

  it("is case-insensitive", () => {
    expect(getMobileVectorizeMimeType("FB2")).toBe("application/x-fictionbook+xml");
  });

  it("still rejects formats without a text layer or extraction path", () => {
    for (const format of ["cbz", "cbr", "mobi", "azw", "azw3", "", undefined]) {
      expect(getMobileVectorizeMimeType(format)).toBeNull();
    }
  });
});

describe("inspectMobileBookForVectorize", () => {
  beforeEach(() => {
    getInfoAsync.mockReset();
  });

  it("allows an FB2 book whose file exists", async () => {
    getInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 2048 });

    const info = await inspectMobileBookForVectorize(makeBook("fb2"));

    expect(info.canVectorize).toBe(true);
    expect(info.mimeType).toBe("application/x-fictionbook+xml");
    expect(info.reason).toBeUndefined();
  });

  it("reports a missing file for FB2/FBZ instead of an unsupported format", async () => {
    getInfoAsync.mockResolvedValue({ exists: false });

    for (const format of ["fb2", "fbz"]) {
      const info = await inspectMobileBookForVectorize(makeBook(format));
      expect(info.canVectorize).toBe(false);
      expect(info.reason).toBe("missing-file");
    }
  });

  it("keeps CBZ unsupported without touching the file", async () => {
    const info = await inspectMobileBookForVectorize(makeBook("cbz"));

    expect(info.canVectorize).toBe(false);
    expect(info.reason).toBe("unsupported-format");
    expect(getInfoAsync).not.toHaveBeenCalled();
  });
});

describe("hidden extractor WebView", () => {
  it("knows a file extension for every vectorize mime type", () => {
    const source = readFileSync(
      resolve(__dirname, "../../components/rag/ExtractorWebView.tsx"),
      "utf8",
    );
    for (const format of ["epub", "pdf", "fb2", "fbz", "txt", "umd"]) {
      const mime = getMobileVectorizeMimeType(format);
      expect(mime).not.toBeNull();
      expect(source).toContain(`"${mime}"`);
    }
  });
});
