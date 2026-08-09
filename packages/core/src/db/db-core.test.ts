import { describe, expect, it } from "vitest";
import { deserializeEmbedding, serializeEmbedding } from "./db-core";

describe("embedding serialization", () => {
  it("decodes the JSON byte-array TEXT form persisted by Tauri SQL", () => {
    const original = [0.125, -0.5, 1.25];
    const bytes = serializeEmbedding(original)!;

    expect(deserializeEmbedding(JSON.stringify(Array.from(bytes)))).toEqual(original);
  });

  it("rejects malformed byte lengths instead of constructing a partial float", () => {
    expect(deserializeEmbedding("[1,2,3]")).toBeUndefined();
  });
});
