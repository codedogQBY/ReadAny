import { describe, expect, it } from "vitest";

import { normalizeS3Key, s3KeyToLogicalPath, sanitizeS3RemoteRoot } from "../s3-paths";

describe("s3-backend path helpers", () => {
  it("sanitizes the configured remote root", () => {
    expect(sanitizeS3RemoteRoot(" /ReadAny//Sync/ ")).toBe("readany/sync");
    expect(sanitizeS3RemoteRoot("readany\u0000-prod")).toBe("readany-prod");
  });

  it("maps ReadAny logical paths into the default S3 prefix", () => {
    expect(normalizeS3Key("readany", "/readany/sync/device-a.json")).toBe(
      "readany/sync/device-a.json",
    );
    expect(normalizeS3Key("readany", "sync/device-a.json")).toBe("readany/sync/device-a.json");
  });

  it("maps ReadAny logical paths into a custom S3 prefix", () => {
    expect(normalizeS3Key("/apps/readany/", "/readany/data/books/book.epub")).toBe(
      "apps/readany/data/books/book.epub",
    );
    expect(normalizeS3Key("apps/readany", "data/books/book.epub")).toBe(
      "apps/readany/data/books/book.epub",
    );
  });

  it("converts S3 keys back to ReadAny logical paths", () => {
    expect(s3KeyToLogicalPath("apps/readany", "apps/readany/sync/device-a.json")).toBe(
      "/readany/sync/device-a.json",
    );
    expect(s3KeyToLogicalPath("apps/readany", "apps/readany/data/books/")).toBe(
      "/readany/data/books",
    );
  });
});
