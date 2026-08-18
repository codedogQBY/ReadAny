import { describe, expect, it } from "vitest";
import { isVectorizationCancellable } from "./vectorization-cancel-state";

describe("isVectorizationCancellable", () => {
  it.each([undefined, "loading", "extracting", "chunking", "vectorizing", "embedding", "indexing"])(
    "allows cancellation while active in %s",
    (status) => expect(isVectorizationCancellable(true, status)).toBe(true),
  );

  it.each(["cancelling", "completed", "error", "cancelled"])(
    "disables the terminal %s overlay",
    (status) => expect(isVectorizationCancellable(true, status)).toBe(false),
  );

  it("does not expose a cancel action for an inactive card", () => {
    expect(isVectorizationCancellable(false, "embedding")).toBe(false);
  });
});
