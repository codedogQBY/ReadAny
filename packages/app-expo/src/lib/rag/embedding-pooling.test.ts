import { describe, expect, it } from "vitest";
import { clsPoolAndNormalize, meanPoolAndNormalize } from "./embedding-pooling";

// last_hidden_state of 3 tokens (seqLength 3), hidden size 2.
const hidden = new Float32Array([3, 0, 0, 4, 100, 100]);

describe("clsPoolAndNormalize", () => {
  it("returns the first token's state, L2-normalised", () => {
    expect(clsPoolAndNormalize(hidden, 3)).toEqual([1, 0]);
  });

  it("rejects a tensor whose size does not match the sequence length", () => {
    expect(() => clsPoolAndNormalize(new Float32Array(7), 3)).toThrow(/invalid embedding shape/);
  });
});

describe("meanPoolAndNormalize", () => {
  it("averages only the real tokens, not the padding", () => {
    // mean of (3,0) and (0,4) is (1.5,2) -> normalised (0.6,0.8); the third token is padding.
    const [x, y] = meanPoolAndNormalize(hidden, 2, 3);
    expect(x).toBeCloseTo(0.6, 6);
    expect(y).toBeCloseTo(0.8, 6);
  });

  it("returns a unit vector", () => {
    const vector = meanPoolAndNormalize(hidden, 3, 3);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 6);
  });

  it("does not divide by zero for an all-zero state", () => {
    expect(meanPoolAndNormalize(new Float32Array(6), 3, 3)).toEqual([0, 0]);
  });
});
