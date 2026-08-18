import { describe, expect, it } from "vitest";
import {
  MOBILE_VECTORIZE_UNSUPPORTED_FORMAT_DESCRIPTION,
  getMobileVectorizeCapability,
} from "./mobile-vectorize-capability";

describe("getMobileVectorizeCapability", () => {
  it.each([
    ["epub", "application/epub+zip"],
    ["pdf", "application/pdf"],
    ["txt", "text/plain"],
    ["umd", "application/epub+zip"],
    ["mobi", "application/x-mobipocket-ebook"],
    ["azw", "application/vnd.amazon.ebook"],
    ["azw3", "application/vnd.amazon.ebook"],
  ])("supports %s", (format, mimeType) => {
    expect(getMobileVectorizeCapability(format)).toEqual({ supported: true, mimeType });
  });

  it("normalizes case and rejects other formats", () => {
    expect(getMobileVectorizeCapability("MOBI")).toEqual({
      supported: true,
      mimeType: "application/x-mobipocket-ebook",
    });
    expect(getMobileVectorizeCapability("kfx")).toEqual({ supported: false, mimeType: null });
    expect(getMobileVectorizeCapability("unknown")).toEqual({ supported: false, mimeType: null });
    expect(getMobileVectorizeCapability(undefined)).toEqual({ supported: false, mimeType: null });
  });

  it("describes MOBI-family support as DRM-free", () => {
    expect(MOBILE_VECTORIZE_UNSUPPORTED_FORMAT_DESCRIPTION).toBe(
      "Mobile vectorization supports EPUB, PDF, TXT, UMD, and DRM-free MOBI, AZW, and AZW3 books.",
    );
  });
});
