import { describe, expect, it } from "vitest";
import { getToolResultError, isToolErrorResult } from "../tool-result";

describe("tool result helpers", () => {
  it("detects structured tool errors", () => {
    const result = { error: "fallbackToc is not available" };

    expect(getToolResultError(result)).toBe("fallbackToc is not available");
    expect(isToolErrorResult(result)).toBe(true);
  });

  it("detects JSON string tool errors", () => {
    expect(getToolResultError(JSON.stringify({ error: "Reader extraction failed" }))).toBe(
      "Reader extraction failed",
    );
  });

  it("detects success=false failures with a reason", () => {
    expect(getToolResultError({ success: false, reason: "Permission denied" })).toBe(
      "Permission denied",
    );
  });

  it("prefers explicit errors for success=false knowledge tool failures", () => {
    expect(
      getToolResultError({
        success: false,
        error: "Invalid parentId: parent_not_folder",
        documentId: "doc-1",
      }),
    ).toBe("Invalid parentId: parent_not_folder");
  });

  it("does not treat normal empty results as failures", () => {
    expect(getToolResultError("")).toBeNull();
    expect(getToolResultError(0)).toBeNull();
    expect(getToolResultError({ success: true, items: [] })).toBeNull();
  });
});
