/**
 * Pooling for sentence-embedding models run through onnxruntime.
 * `data` is the flattened `last_hidden_state` tensor, shape [1, seqLength, dimension].
 */

function hiddenSize(data: Float32Array, seqLength: number): number {
  const dimension = data.length / seqLength;
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error("Local model returned an invalid embedding shape.");
  }
  return dimension;
}

function normalize(vector: number[]): number[] {
  let norm = 0;
  for (const value of vector) norm += value ** 2;
  norm = Math.sqrt(norm) || 1;
  return vector.map((value) => value / norm);
}

/** CLS pooling: the first token's hidden state, L2-normalised. */
export function clsPoolAndNormalize(data: Float32Array, seqLength: number): number[] {
  const dimension = hiddenSize(data, seqLength);
  return normalize(Array.from(data.subarray(0, dimension)));
}

/** Mean pooling over the first `tokenCount` tokens (padding excluded), L2-normalised. */
export function meanPoolAndNormalize(
  data: Float32Array,
  tokenCount: number,
  seqLength: number,
): number[] {
  const dimension = hiddenSize(data, seqLength);
  const output = new Array<number>(dimension).fill(0);
  for (let token = 0; token < tokenCount; token++) {
    for (let d = 0; d < dimension; d++) output[d] += data[token * dimension + d];
  }
  for (let d = 0; d < dimension; d++) output[d] /= tokenCount;
  return normalize(output);
}
