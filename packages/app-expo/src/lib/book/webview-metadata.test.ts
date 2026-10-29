import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readAsStringAsync = vi.fn();

vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: (...args: unknown[]) => readAsStringAsync(...args),
  EncodingType: { Base64: "base64" },
}));

import {
  WEBVIEW_METADATA_MAX_BYTES,
  extractMetadataViaWebView,
  setWebViewMetadataExtractor,
  supportsWebViewMetadata,
} from "./webview-metadata";

const baseMeta = {
  title: "Война и мир",
  author: "Лев Толстой",
  publisher: "",
  language: "ru",
  description: "",
  subjects: [] as string[],
  coverBase64: "",
  coverMimeType: "",
};

describe("webview-metadata", () => {
  const extractMetadata = vi.fn();

  beforeEach(() => {
    readAsStringAsync.mockResolvedValue("Ym9vaw==");
    extractMetadata.mockResolvedValue(baseMeta);
    setWebViewMetadataExtractor({ extractMetadata });
  });

  afterEach(() => {
    setWebViewMetadataExtractor(null);
    vi.clearAllMocks();
  });

  it("only handles formats the lightweight parsers skip", () => {
    for (const format of ["fb2", "fbz", "cbz", "pdf"] as const) {
      expect(supportsWebViewMetadata(format)).toBe(true);
    }
    for (const format of ["epub", "mobi", "azw3", "txt", "umd"] as const) {
      expect(supportsWebViewMetadata(format)).toBe(false);
    }
  });

  it("returns title, author and decoded cover bytes", async () => {
    extractMetadata.mockResolvedValue({
      ...baseMeta,
      // bytes 0xFF 0xD8 0xFF -> JPEG magic
      coverBase64: "/9j/",
      coverMimeType: "image/jpeg",
    });

    const meta = await extractMetadataViaWebView({
      filePath: "file:///books/a.fb2",
      format: "fb2",
      fileName: "a.fb2",
      fileSize: 1024,
    });

    expect(extractMetadata).toHaveBeenCalledWith("Ym9vaw==", "application/x-fictionbook+xml");
    expect(meta?.title).toBe("Война и мир");
    expect(meta?.author).toBe("Лев Толстой");
    expect(Array.from(meta?.coverBytes ?? [])).toEqual([0xff, 0xd8, 0xff]);
    expect(meta?.coverMimeType).toBe("image/jpeg");
  });

  it("has no cover bytes or mime type when the book has no cover", async () => {
    const meta = await extractMetadataViaWebView({
      filePath: "file:///books/a.pdf",
      format: "pdf",
      fileName: "a.pdf",
      fileSize: 1024,
    });

    expect(meta?.coverBytes).toBeNull();
    expect(meta?.coverMimeType).toBeNull();
  });

  it("strips the file extension foliate reports as a comic's title", async () => {
    extractMetadata.mockResolvedValue({ ...baseMeta, title: "Saga 01.cbz", author: "" });

    const meta = await extractMetadataViaWebView({
      filePath: "file:///books/Saga 01.cbz",
      format: "cbz",
      fileName: "Saga 01.cbz",
      fileSize: 1024,
    });

    expect(meta?.title).toBe("Saga 01");
  });

  it("skips files over the size cap without reading them", async () => {
    const meta = await extractMetadataViaWebView({
      filePath: "file:///books/big.pdf",
      format: "pdf",
      fileName: "big.pdf",
      fileSize: WEBVIEW_METADATA_MAX_BYTES + 1,
    });

    expect(meta).toBeNull();
    expect(readAsStringAsync).not.toHaveBeenCalled();
    expect(extractMetadata).not.toHaveBeenCalled();
  });

  it("returns null when the WebView extractor is not mounted", async () => {
    setWebViewMetadataExtractor(null);

    const meta = await extractMetadataViaWebView({
      filePath: "file:///books/a.fb2",
      format: "fb2",
      fileName: "a.fb2",
      fileSize: 1024,
    });

    expect(meta).toBeNull();
  });
});

describe("reader WebView bridge", () => {
  it("handles the extractMetadata command in the template and the built reader", () => {
    const dir = resolve(__dirname, "../../../assets/reader");
    for (const file of ["reader.template.html", "reader.html"]) {
      const html = readFileSync(resolve(dir, file), "utf8");
      expect(html).toContain("case 'extractMetadata'");
      expect(html).toContain("postToRN('metadataExtracted'");
    }
  });
});
