const PREFIX = "readany:";
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encode bytes to base64 */
function toBase64(bytes: Uint8Array): string {
  let r = "";
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0, c = i + 2 < n ? bytes[i + 2] : 0;
    r += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + (i + 1 < n ? B64[((b & 0xf) << 2) | (c >> 6)] : "=") + (i + 2 < n ? B64[c & 0x3f] : "=");
  }
  return r;
}

/** Decode base64 to bytes */
function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]), b = B64.indexOf(clean[i + 1]),
          c = B64.indexOf(clean[i + 2]), d = B64.indexOf(clean[i + 3]);
    bytes.push((a << 2) | (b >> 4));
    if (clean[i + 2] !== "=") bytes.push(((b & 0xf) << 4) | (c >> 2));
    if (clean[i + 3] !== "=") bytes.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(bytes);
}

/** Encode any JSON-serializable data into a transfer token */
export function encodeConfig(data: unknown): string {
  const json = JSON.stringify(data);
  // UTF-8 encode
  const bytes = new Uint8Array(new TextEncoder().encode(json));
  return PREFIX + toBase64(bytes);
}

/** Decode a transfer token back to data. Returns null if invalid. */
export function decodeConfig<T>(token: string): T | null {
  try {
    const trimmed = token.trim();
    if (!trimmed.startsWith(PREFIX)) return null;
    const base64 = trimmed.slice(PREFIX.length);
    const bytes = fromBase64(base64);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
