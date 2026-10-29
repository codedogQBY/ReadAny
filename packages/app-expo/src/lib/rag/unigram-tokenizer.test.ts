import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UnigramTokenizer } from "./unigram-tokenizer";
import fixture from "./unigram-tokenizer.fixture.json";

// Ids follow the XLM-R layout: <s>=0, <pad>=1, </s>=2, <unk>=3.
const vocab: [string, number][] = [
  ["<s>", 0],
  ["<pad>", 0],
  ["</s>", 0],
  ["<unk>", 0],
  ["▁", -3],
  ["▁a", -4],
  ["▁ab", -4.5],
  ["b", -3.5],
  ["c", -3.5],
  ["▁abc", -9],
  ["▁x", -5],
  ["y", -5],
  ["xy", -3],
  ["▁hi", -2],
];

function makeTokenizer() {
  return new UnigramTokenizer({
    model: { type: "Unigram", vocab, unk_id: 3 },
    post_processor: {
      special_tokens: { "<s>": { ids: [0] }, "</s>": { ids: [2] } },
    },
  });
}

const ID = Object.fromEntries(vocab.map(([piece], id) => [piece, id])) as Record<string, number>;

describe("UnigramTokenizer", () => {
  it("rejects a tokenizer file that is not a Unigram model", () => {
    expect(() => new UnigramTokenizer({ model: { type: "WordPiece" } })).toThrow(/Unigram/);
  });

  it("wraps the ids in <s> and </s>, and an empty text yields only those", () => {
    const tokenizer = makeTokenizer();
    expect(tokenizer.encode("", 16)).toEqual([0, 2]);
    expect(tokenizer.encode("hi", 16)).toEqual([0, ID["▁hi"], 2]);
  });

  it("prefixes every word with the Metaspace marker", () => {
    const tokenizer = makeTokenizer();
    // "▁a b" -> words "▁a" and "▁b"; "▁b" is not a piece, so it is "▁" + "b".
    expect(tokenizer.encode("a b", 16)).toEqual([0, ID["▁a"], ID["▁"], ID.b, 2]);
  });

  it("picks the segmentation with the best total score", () => {
    const tokenizer = makeTokenizer();
    // "▁abc" as one piece scores -9; "▁ab" + "c" scores -8.
    expect(tokenizer.encode("abc", 16)).toEqual([0, ID["▁ab"], ID.c, 2]);
    // "▁" + "xy" (-6) beats "▁x" + "y" (-10).
    expect(tokenizer.encode("xy", 16)).toEqual([0, ID["▁"], ID.xy, 2]);
  });

  it("fuses consecutive unknown characters into one <unk>", () => {
    const tokenizer = makeTokenizer();
    expect(tokenizer.encode("aЖЗИ", 16)).toEqual([0, ID["▁a"], 3, 2]);
  });

  it("collapses repeated spaces and treats tabs, newlines and zero-width spaces as spaces", () => {
    const tokenizer = makeTokenizer();
    const expected = tokenizer.encode("a b", 16);
    expect(tokenizer.encode("  a   b", 16)).toEqual(expected);
    expect(tokenizer.encode("a\tb", 16)).toEqual(expected);
    expect(tokenizer.encode("a\nb", 16)).toEqual(expected);
    expect(tokenizer.encode("a​b", 16)).toEqual(expected);
  });

  it("keeps a trailing space as a lone marker, like the Hugging Face tokenizer", () => {
    const tokenizer = makeTokenizer();
    expect(tokenizer.encode("a ", 16)).toEqual([0, ID["▁a"], ID["▁"], 2]);
  });

  it("applies NFKC, so fullwidth letters match their ASCII form", () => {
    const tokenizer = makeTokenizer();
    expect(tokenizer.encode("ｈｉ", 16)).toEqual(tokenizer.encode("hi", 16));
  });

  it("truncates to maxTokens and keeps the closing </s>", () => {
    const tokenizer = makeTokenizer();
    const ids = tokenizer.encode("hi hi hi hi hi hi hi hi", 5);
    expect(ids).toHaveLength(5);
    expect(ids[0]).toBe(0);
    expect(ids[ids.length - 1]).toBe(2);
  });
});

// Parity with the Hugging Face tokenizer for the real multilingual-e5-small vocabulary.
// The 17 MB tokenizer.json is not committed: point E5_TOKENIZER_JSON at a copy of
// https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/tokenizer.json
const realTokenizerPath = process.env.E5_TOKENIZER_JSON;

describe.skipIf(!realTokenizerPath || !existsSync(realTokenizerPath))(
  "multilingual-e5-small vocabulary",
  () => {
    it("produces the same ids as the Hugging Face tokenizer", () => {
      const tokenizer = new UnigramTokenizer(
        JSON.parse(readFileSync(realTokenizerPath as string, "utf8")),
      );
      for (const { text, ids } of fixture.cases) {
        expect(tokenizer.encode(text, 512), text).toEqual(ids);
      }
    });
  },
);
