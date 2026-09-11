import { describe, expect, it } from "vitest";
import { hasActiveAIStream } from "./ai-streaming-keep-awake-state";

describe("hasActiveAIStream", () => {
  it("is false with no sessions or only completed sessions", () => {
    expect(hasActiveAIStream({})).toBe(false);
    expect(hasActiveAIStream({ done: { isStreaming: false } })).toBe(false);
  });

  it("stays true until the final concurrent stream completes", () => {
    expect(
      hasActiveAIStream({
        book: { isStreaming: false },
        general: { isStreaming: true },
      }),
    ).toBe(true);
  });
});
