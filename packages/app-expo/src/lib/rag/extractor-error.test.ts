import { describe, expect, it } from "vitest";
import {
  BookExtractionError,
  classifyBookExtractionError,
  getBookExtractionErrorMessageKeys,
  toBookExtractionError,
} from "./extractor-error";

describe("classifyBookExtractionError", () => {
  it.each([
    ["mobi", "Encrypted MOBI records are not supported"],
    ["azw", "DRM protected content"],
    ["azw3", "encryption is not supported"],
  ])("classifies narrow protection evidence for %s", (format, message) => {
    expect(classifyBookExtractionError(new Error(message), format)).toBe("drm-protected");
  });

  it.each(["epub", "pdf", "kfx", undefined])(
    "does not classify protection wording for non-MOBI format %s",
    (format) => {
      expect(classifyBookExtractionError(new Error("encrypted content"), format)).toBe("unknown");
    },
  );

  it.each([
    "invalid PDB record offset",
    "truncated MOBI header",
    "invalid record structure",
    "record offset is outside the file",
    "Invalid HUFF record",
    "Invalid CDIC record",
    "Invalid INDX record",
    "Invalid TAGX section",
    "Invalid EXTH header",
    "Missing MOBI header",
    "Missing FDST record",
    "Record index out of bounds",
    "Offset is outside the bounds of the DataView",
  ])("classifies malformed structure evidence: %s", (message) => {
    expect(classifyBookExtractionError(new Error(message), "mobi")).toBe("malformed");
  });

  it("does not guess DRM from a generic MOBI parser failure", () => {
    expect(classifyBookExtractionError(new Error("loader failed"), "mobi")).toBe("unknown");
  });

  it("classifies explicit unsupported-format failures", () => {
    expect(classifyBookExtractionError(new Error("unsupported format: kfx"), "kfx")).toBe(
      "unsupported-format",
    );
  });

  it("handles non-Error rejections without broadening classification", () => {
    expect(classifyBookExtractionError("loader failed", "azw3")).toBe("unknown");
  });
});

describe("BookExtractionError", () => {
  it("carries bounded parser classification across the extraction boundary", () => {
    const cause = new Error("Encrypted MOBI records are not supported");

    const error = toBookExtractionError(cause, "mobi");

    expect(error).toBeInstanceOf(BookExtractionError);
    expect(error.message).toBe(cause.message);
    expect(error.category).toBe("drm-protected");
    expect(error.cause).toBe(cause);
  });

  it("keeps extraction message keys distinct for every category", () => {
    expect(getBookExtractionErrorMessageKeys("drm-protected")).toEqual({
      title: "vectorize.protectedBookTitle",
      description: "vectorize.protectedBookDesc",
    });
    expect(getBookExtractionErrorMessageKeys("malformed")).toEqual({
      title: "vectorize.malformedBookTitle",
      description: "vectorize.malformedBookDesc",
    });
    expect(getBookExtractionErrorMessageKeys("unsupported-format")).toEqual({
      title: "vectorize.unsupportedFormatTitle",
      description: "vectorize.unsupportedFormatDesc",
    });
    expect(getBookExtractionErrorMessageKeys("unknown")).toEqual({
      title: "vectorize.extractionFailedTitle",
      description: "vectorize.extractionFailedDesc",
    });
  });
});
