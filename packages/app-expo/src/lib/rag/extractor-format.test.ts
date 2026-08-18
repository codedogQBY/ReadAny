import { describe, expect, it } from "vitest";
import { createExtractorCommand, resolveExtractorFormat } from "./extractor-format";

describe("resolveExtractorFormat", () => {
  it.each(["epub", "pdf", "txt", "umd", "mobi", "azw", "azw3"])(
    "prefers the supported stored %s format",
    (bookFormat) => {
      expect(
        resolveExtractorFormat({
          bookFormat,
          mimeType: "application/octet-stream",
          fileName: "misleading.epub",
        }),
      ).toBe(bookFormat);
    },
  );

  it("uses a supported filename extension when the stored format is unavailable", () => {
    expect(
      resolveExtractorFormat({
        bookFormat: undefined,
        mimeType: "application/vnd.amazon.ebook",
        fileName: "x.AZW3",
      }),
    ).toBe("azw3");
  });

  it.each([
    ["application/epub+zip", "epub"],
    ["application/pdf", "pdf"],
    ["text/plain; charset=utf-8", "txt"],
    ["application/x-mobipocket-ebook", "mobi"],
    ["application/vnd.amazon.ebook", "azw3"],
  ])("falls back from %s to %s", (mimeType, format) => {
    expect(resolveExtractorFormat({ mimeType })).toBe(format);
  });

  it("normalizes stored format and ignores query text after the filename extension", () => {
    expect(resolveExtractorFormat({ bookFormat: "MOBI" })).toBe("mobi");
    expect(resolveExtractorFormat({ fileName: "download.AZW?token=1" })).toBe("azw");
  });

  it("rejects KFX and unknown signals", () => {
    expect(
      resolveExtractorFormat({
        bookFormat: "kfx",
        mimeType: "application/octet-stream",
        fileName: "x.kfx",
      }),
    ).toBeNull();
    expect(resolveExtractorFormat({ bookFormat: "unknown" })).toBeNull();
    expect(resolveExtractorFormat({})).toBeNull();
  });
});

describe("createExtractorCommand", () => {
  it.each([
    [
      { bookFormat: "mobi", mimeType: "application/pdf", fileName: "stored.pdf" },
      { type: "openBook", bookFormat: "mobi", fileName: "stored.mobi" },
    ],
    [
      { mimeType: "application/pdf", fileName: "filename.mobi" },
      { type: "openBook", bookFormat: "mobi", fileName: "filename.mobi" },
    ],
    [
      {
        bookFormat: "pdf",
        mimeType: "application/x-mobipocket-ebook",
        fileName: "stored.mobi",
      },
      { type: "extractBookChapters", bookFormat: "pdf", fileName: "stored.pdf" },
    ],
    [
      { mimeType: "application/x-mobipocket-ebook", fileName: "filename.pdf" },
      { type: "extractBookChapters", bookFormat: "pdf", fileName: "filename.pdf" },
    ],
  ])("dispatches from resolved format for %#", (input, expected) => {
    expect(createExtractorCommand({ base64BookData: "data", ...input })).toMatchObject(expected);
  });
});

describe("extractor pending-request classification", () => {
  it.each([
    [{ mimeType: "application/octet-stream", fileName: "inferred.mobi" }, "mobi"],
    [{ mimeType: "application/vnd.amazon.ebook" }, "azw3"],
  ])("preserves the resolved %s format for error classification", (input, expected) => {
    const command = createExtractorCommand({ base64BookData: "data", ...input });

    expect(command.bookFormat).toBe(expected);
    expect(command.bookFormat ?? undefined).toBe(expected);
  });
});
