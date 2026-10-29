/**
 * SentencePiece Unigram tokenizer for the XLM-R vocabulary used by
 * multilingual-e5-small (Hugging Face `tokenizer.json`, `model.type === "Unigram"`).
 *
 * The WordPiece encoder in native-onnx-embedding-engine.ts cannot read this file:
 * its vocabulary is an array of `[piece, score]` pairs, not a `{piece: id}` map.
 *
 * Pipeline, as declared in tokenizer.json:
 *   normalizer     NFKC-style charsmap, then collapse runs of spaces
 *   pre_tokenizer  Metaspace: spaces become "▁", every word starts with "▁"
 *   model          Unigram, Viterbi over piece scores, consecutive unknowns fused
 *   post_processor <s> ... </s>
 *
 * The charsmap is a binary SentencePiece rule table; NFKC plus control-character
 * handling reproduces it for ordinary text.
 */

interface UnigramJson {
  model?: { type?: string; vocab?: [string, number][]; unk_id?: number };
  added_tokens?: { id: number; content: string }[];
  post_processor?: {
    special_tokens?: Record<string, { ids: number[] }>;
  };
}

const SPACE_MARK = "▁";
// SentencePiece scores an unknown character below the worst real piece.
const UNK_PENALTY = 10;
const MAX_PIECE_CODE_POINTS = 32;
// SentencePiece's nmt_nfkc table turns line breaks, Unicode space separators and
// zero-width characters into a plain space and drops the remaining control characters.
const WHITESPACE_CONTROLS = /[\t\n\r\f\u0085\u1680\u200b-\u200f\u2028\u2029\ufeff\ufffd]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const DROPPED_CONTROLS = /[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u0084\u0086-\u009f]/g;

export class UnigramTokenizer {
  private readonly pieces = new Map<string, number>();
  private readonly scores: number[];
  private readonly unkId: number;
  private readonly unkScore: number;
  private readonly bosId: number;
  private readonly eosId: number;
  private readonly maxPieceLength: number;

  constructor(json: UnigramJson) {
    const model = json.model;
    if (!model || model.type !== "Unigram" || !Array.isArray(model.vocab)) {
      throw new Error("Tokenizer file is not a Unigram model with a vocabulary list.");
    }
    this.unkId = model.unk_id ?? 3;
    this.scores = new Array<number>(model.vocab.length);
    let minScore = Number.POSITIVE_INFINITY;
    let maxLength = 1;
    for (let id = 0; id < model.vocab.length; id++) {
      const [piece, score] = model.vocab[id];
      this.scores[id] = score;
      // Control pieces such as <s> and <pad> carry score 0 and must never be produced
      // by text, so only ordinary pieces enter the lookup table.
      if (id === 0 || id === 1 || id === 2 || id === this.unkId) continue;
      this.pieces.set(piece, id);
      if (score < minScore) minScore = score;
      const length = Array.from(piece).length;
      if (length > maxLength) maxLength = length;
    }
    this.unkScore = minScore - UNK_PENALTY;
    this.maxPieceLength = Math.min(maxLength, MAX_PIECE_CODE_POINTS);
    const special = json.post_processor?.special_tokens;
    this.bosId = special?.["<s>"]?.ids?.[0] ?? 0;
    this.eosId = special?.["</s>"]?.ids?.[0] ?? 2;
  }

  /** Token ids for `text`, wrapped in <s> ... </s>, at most `maxTokens` long. */
  encode(text: string, maxTokens: number): number[] {
    const ids: number[] = [this.bosId];
    const budget = maxTokens - 1; // keep room for </s>
    for (const word of this.preTokenize(text)) {
      if (ids.length - 1 >= budget) break;
      for (const id of this.encodeWord(word)) ids.push(id);
    }
    if (ids.length > budget) ids.length = budget;
    ids.push(this.eosId);
    return ids;
  }

  private normalize(text: string): string {
    return text
      .normalize("NFKC")
      .replace(WHITESPACE_CONTROLS, " ")
      .replace(DROPPED_CONTROLS, "")
      .replace(/ {2,}/g, " ");
  }

  /** Metaspace: split into words that each start with "▁". */
  private preTokenize(text: string): string[] {
    const normalized = this.normalize(text).replace(/ /g, SPACE_MARK);
    if (!normalized) return [];
    const prefixed = normalized.startsWith(SPACE_MARK) ? normalized : SPACE_MARK + normalized;
    const words: string[] = [];
    let start = 0;
    for (let index = 1; index < prefixed.length; index++) {
      if (prefixed[index] === SPACE_MARK) {
        words.push(prefixed.slice(start, index));
        start = index;
      }
    }
    words.push(prefixed.slice(start));
    return words;
  }

  private encodeWord(word: string): number[] {
    const chars = Array.from(word);
    const count = chars.length;
    const best = new Array<number>(count + 1).fill(Number.NEGATIVE_INFINITY);
    const backStart = new Array<number>(count + 1).fill(0);
    const backId = new Array<number>(count + 1).fill(this.unkId);
    best[0] = 0;

    for (let start = 0; start < count; start++) {
      if (best[start] === Number.NEGATIVE_INFINITY) continue;
      let matchedSingle = false;
      let piece = "";
      const limit = Math.min(count, start + this.maxPieceLength);
      for (let end = start + 1; end <= limit; end++) {
        piece += chars[end - 1];
        const id = this.pieces.get(piece);
        if (id === undefined) continue;
        if (end === start + 1) matchedSingle = true;
        const score = best[start] + this.scores[id];
        if (score > best[end]) {
          best[end] = score;
          backStart[end] = start;
          backId[end] = id;
        }
      }
      if (!matchedSingle) {
        const score = best[start] + this.unkScore;
        if (score > best[start + 1]) {
          best[start + 1] = score;
          backStart[start + 1] = start;
          backId[start + 1] = this.unkId;
        }
      }
    }

    const reversed: number[] = [];
    for (let end = count; end > 0; end = backStart[end]) reversed.push(backId[end]);
    reversed.reverse();

    // Consecutive unknown characters collapse into a single <unk>.
    const fused: number[] = [];
    for (const id of reversed) {
      if (id === this.unkId && fused[fused.length - 1] === this.unkId) continue;
      fused.push(id);
    }
    return fused;
  }
}
