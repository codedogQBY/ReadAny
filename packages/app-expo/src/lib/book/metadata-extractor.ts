/**
 * Book metadata + cover extraction for React Native (Expo).
 *
 * EPUB: pure-JS ZIP decompression + XML parsing (no DOMParser dependency).
 * PDF:  title extracted from file name (pdfjs-dist not available in RN).
 *
 * Uses pako for Deflate decompression (Hermes does NOT support DecompressionStream).
 *
 * Optimized: only decompresses the 2-3 ZIP entries needed for metadata
 * (container.xml, OPF, cover image) instead of the entire EPUB.
 */
import pako from "pako";

export interface ExtractedMeta {
  title: string;
  author: string;
  coverBytes: Uint8Array | null;
  coverMimeType: string | null;
}

interface SliceReadable {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface BlobLikeFile {
  size?: number;
  slice(start?: number, end?: number, contentType?: string): SliceReadable;
}

// ─── EPUB extraction ────────────────────────────────────────────────

export async function extractEpubMetadata(fileBytes: Uint8Array): Promise<ExtractedMeta> {
  const buf = new Uint8Array(fileBytes);
  const directory = parseZipDirectory(buf);

  // 1. Read container.xml to find OPF path
  const containerXml = readTextFromZip(buf, directory, "META-INF/container.xml");
  if (!containerXml) {
    console.warn("[extractEpubMetadata] container.xml not found");
    return { title: "", author: "", coverBytes: null, coverMimeType: null };
  }

  const opfPath = parseAttribute(containerXml, "rootfile", "full-path") || "content.opf";
  const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

  // 2. Read OPF and extract title / author
  const opfXml = readTextFromZip(buf, directory, opfPath);
  if (!opfXml) {
    console.warn(`[extractEpubMetadata] OPF not found at: ${opfPath}`);
    return { title: "", author: "", coverBytes: null, coverMimeType: null };
  }

  const title = extractTagContent(opfXml, "dc:title") || extractTagContent(opfXml, "title") || "";
  const author =
    extractTagContent(opfXml, "dc:creator") || extractTagContent(opfXml, "creator") || "";

  // 3. Extract cover image (only decompress the cover entry)
  let coverBytes: Uint8Array | null = null;
  let coverMimeType: string | null = null;

  try {
    const coverHref = findCoverHref(opfXml);
    if (coverHref) {
      const decoded = decodeURIComponent(coverHref);
      const candidates = [opfDir + decoded, opfDir + coverHref, decoded, coverHref];
      for (const candidate of candidates) {
        const data = readBytesFromZip(buf, directory, candidate);
        if (data) {
          coverBytes = data;
          coverMimeType = guessMimeType(candidate);
          break;
        }
      }
    }
  } catch (err) {
    console.warn("[extractEpubMetadata] cover extraction error:", err);
  }

  return { title: title.trim(), author: author.trim(), coverBytes, coverMimeType };
}

// ─── Generic metadata from file bytes ──────────────────────────────

export async function extractBookMetadata(
  fileBytes: Uint8Array,
  format: string,
  fileName: string,
): Promise<ExtractedMeta> {
  const fallback: ExtractedMeta = {
    title: fileName.replace(/\.\w+$/i, "") || "Untitled",
    author: "",
    coverBytes: null,
    coverMimeType: null,
  };

  try {
    switch (format) {
      case "epub":
        return await extractEpubMetadata(fileBytes);
      // Future: mobi/azw3/fb2 parsers can be added here
      default:
        return fallback;
    }
  } catch (err) {
    console.warn(`[extractBookMetadata] failed for ${format}:`, err);
    return fallback;
  }
}

export async function extractBookMetadataFromFile(
  file: BlobLikeFile,
  format: string,
  fileName: string,
): Promise<ExtractedMeta> {
  const fallback: ExtractedMeta = {
    title: fileName.replace(/\.\w+$/i, "") || "Untitled",
    author: "",
    coverBytes: null,
    coverMimeType: null,
  };

  try {
    switch (format) {
      case "mobi":
      case "azw":
      case "azw3":
        return await extractMobiMetadata(file, fileName);
      default:
        return fallback;
    }
  } catch (err) {
    console.warn(`[extractBookMetadataFromFile] failed for ${format}:`, err);
    return fallback;
  }
}

async function extractMobiMetadata(file: BlobLikeFile, fileName: string): Promise<ExtractedMeta> {
  const fallback: ExtractedMeta = {
    title: fileName.replace(/\.\w+$/i, "") || "Untitled",
    author: "",
    coverBytes: null,
    coverMimeType: null,
  };

  const header = await parseMobiHeader(file).catch((error) => {
    console.warn("[extractMobiMetadata] failed to parse MOBI header:", error);
    return null;
  });

  if (!header) {
    return fallback;
  }

  let coverBytes: Uint8Array | null = null;
  let coverMimeType: string | null = null;

  try {
    const coverRecordIndex =
      header.coverOffset != null
        ? header.resourceStart + header.coverOffset
        : header.thumbnailOffset != null
          ? header.resourceStart + header.thumbnailOffset
          : null;

    if (coverRecordIndex != null) {
      const coverBuffer = await readPdbRecord(file, header.recordOffsets, coverRecordIndex);
      if (coverBuffer) {
        coverBytes = new Uint8Array(coverBuffer);
        coverMimeType = guessMimeTypeFromBytes(coverBytes) || guessMimeType(fileName) || "image/jpeg";
      }
    }
  } catch (err) {
    console.warn("[extractMobiMetadata] cover extraction error:", err);
  }

  return {
    title: String(header.title || fallback.title).trim(),
    author: String(header.author || "").trim(),
    coverBytes,
    coverMimeType,
  };
}

interface ParsedMobiHeader {
  title: string;
  author: string;
  resourceStart: number;
  coverOffset: number | null;
  thumbnailOffset: number | null;
  recordOffsets: number[];
}

const PDB_HEADER_LENGTH = 78;
const PDB_RECORD_ENTRY_LENGTH = 8;
const MOBI_MAGIC_OFFSET = 16;
const MOBI_TITLE_OFFSET_OFFSET = 84;
const MOBI_TITLE_LENGTH_OFFSET = 88;
const MOBI_ENCODING_OFFSET = 28;
const MOBI_VERSION_OFFSET = 36;
const MOBI_RESOURCE_START_OFFSET = 108;
const MOBI_EXTH_FLAG_OFFSET = 128;
const EXTH_START_BASE_OFFSET = 16;
const MAX_MOBI_RECORD_BYTES = 16 * 1024 * 1024;
const RANGE_READ_CHUNK_BYTES = 256 * 1024;

async function parseMobiHeader(file: BlobLikeFile): Promise<ParsedMobiHeader | null> {
  const headerBuffer = await file.slice(0, PDB_HEADER_LENGTH).arrayBuffer();
  if (headerBuffer.byteLength < PDB_HEADER_LENGTH) return null;
  const headerView = new DataView(headerBuffer);
  const numRecords = headerView.getUint16(76, false);
  if (numRecords <= 0) return null;

  const recordsBuffer = await file
    .slice(PDB_HEADER_LENGTH, PDB_HEADER_LENGTH + numRecords * PDB_RECORD_ENTRY_LENGTH)
    .arrayBuffer();
  const recordOffsets = extractPdbRecordOffsets(recordsBuffer, numRecords, file.size ?? undefined);
  if (recordOffsets.length === 0) return null;

  let recordIndex = 0;
  let recordBuffer = await readPdbRecord(file, recordOffsets, recordIndex);
  if (!recordBuffer) return null;

  let mobiHeader = parseMobiRecordHeader(recordBuffer);
  if (!mobiHeader) return null;

  if (mobiHeader.version < 8 && mobiHeader.boundary != null && mobiHeader.boundary < recordOffsets.length) {
    const comboBuffer = await readPdbRecord(file, recordOffsets, mobiHeader.boundary);
    const comboHeader = comboBuffer ? parseMobiRecordHeader(comboBuffer) : null;
    if (comboHeader) {
      recordIndex = mobiHeader.boundary;
      recordBuffer = comboBuffer!;
      mobiHeader = comboHeader;
    }
  }

  const decoder = getMobiDecoder(mobiHeader.encoding);
  const title = decoder
    .decode(recordBuffer.slice(mobiHeader.titleOffset, mobiHeader.titleOffset + mobiHeader.titleLength))
    .replace(/\0/g, "")
    .trim();

  return {
    title,
    author: mobiHeader.author,
    resourceStart: mobiHeader.resourceStart,
    coverOffset: mobiHeader.coverOffset,
    thumbnailOffset: mobiHeader.thumbnailOffset,
    recordOffsets: recordOffsets.map((offset, index) => offset - (index >= recordIndex ? 0 : 0)),
  };
}

function extractPdbRecordOffsets(
  recordsBuffer: ArrayBuffer,
  numRecords: number,
  fileSize?: number,
): number[] {
  const view = new DataView(recordsBuffer);
  const offsets: number[] = [];
  let previous = -1;
  for (let i = 0; i < numRecords; i++) {
    const base = i * PDB_RECORD_ENTRY_LENGTH;
    if (base + 4 > view.byteLength) break;
    const offset = view.getUint32(base, false);
    if (
      !Number.isFinite(offset) ||
      offset < 0 ||
      offset <= previous ||
      (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize > 0 && offset >= fileSize)
    ) {
      break;
    }
    offsets.push(offset);
    previous = offset;
  }
  if (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize > 0) {
    offsets.push(fileSize);
  }
  return offsets;
}

async function readPdbRecord(
  file: BlobLikeFile,
  offsets: number[],
  index: number,
): Promise<Uint8Array | null> {
  const start = offsets[index];
  const end = offsets[index + 1];
  if (
    typeof start !== "number" ||
    !Number.isFinite(start) ||
    start < 0 ||
    typeof end !== "number" ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > MAX_MOBI_RECORD_BYTES
  ) {
    return null;
  }
  const buffer = await file.slice(start, end).arrayBuffer();
  return new Uint8Array(buffer);
}

function parseMobiRecordHeader(record: Uint8Array): {
  encoding: number;
  version: number;
  titleOffset: number;
  titleLength: number;
  resourceStart: number;
  coverOffset: number | null;
  thumbnailOffset: number | null;
  boundary: number | null;
  author: string;
} | null {
  if (record.byteLength < 256) return null;
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  const magic = new TextDecoder().decode(record.slice(MOBI_MAGIC_OFFSET, MOBI_MAGIC_OFFSET + 4));
  if (magic !== "MOBI") return null;

  const mobiLength = view.getUint32(MOBI_MAGIC_OFFSET + 4, false);
  const encoding = view.getUint32(MOBI_ENCODING_OFFSET, false);
  const version = view.getUint32(MOBI_VERSION_OFFSET, false);
  const titleOffset = view.getUint32(MOBI_TITLE_OFFSET_OFFSET, false);
  const titleLength = view.getUint32(MOBI_TITLE_LENGTH_OFFSET, false);
  const resourceStart = view.getUint32(MOBI_RESOURCE_START_OFFSET, false);
  const exthFlag = view.getUint32(MOBI_EXTH_FLAG_OFFSET, false);

  let coverOffset: number | null = null;
  let thumbnailOffset: number | null = null;
  let boundary: number | null = null;
  let author = "";

  if ((exthFlag & 0b1000000) !== 0) {
    const exthStart = EXTH_START_BASE_OFFSET + mobiLength;
    if (exthStart + 12 <= record.byteLength) {
      const exth = parseExth(record.slice(exthStart), encoding);
      coverOffset = exth.coverOffset;
      thumbnailOffset = exth.thumbnailOffset;
      boundary = exth.boundary;
      author = exth.author;
    }
  }

  return {
    encoding,
    version,
    titleOffset,
    titleLength,
    resourceStart,
    coverOffset,
    thumbnailOffset,
    boundary,
    author,
  };
}

function parseExth(
  exthRecord: Uint8Array,
  encoding: number,
): {
  coverOffset: number | null;
  thumbnailOffset: number | null;
  boundary: number | null;
  author: string;
} {
  if (exthRecord.byteLength < 12) {
    return { coverOffset: null, thumbnailOffset: null, boundary: null, author: "" };
  }

  const view = new DataView(exthRecord.buffer, exthRecord.byteOffset, exthRecord.byteLength);
  const magic = new TextDecoder().decode(exthRecord.slice(0, 4));
  if (magic !== "EXTH") {
    return { coverOffset: null, thumbnailOffset: null, boundary: null, author: "" };
  }

  const count = view.getUint32(8, false);
  const decoder = getMobiDecoder(encoding);

  let offset = 12;
  let coverOffset: number | null = null;
  let thumbnailOffset: number | null = null;
  let boundary: number | null = null;
  let author = "";

  for (let i = 0; i < count; i++) {
    if (offset + 8 > exthRecord.byteLength) break;
    const type = view.getUint32(offset, false);
    const length = view.getUint32(offset + 4, false);
    if (length < 8 || offset + length > exthRecord.byteLength) break;

    const data = exthRecord.slice(offset + 8, offset + length);
    if (type === 100 && !author) {
      author = decoder.decode(data).replace(/\0/g, "").trim();
    } else if (type === 121 && data.byteLength >= 4) {
      boundary = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false);
    } else if (type === 201 && data.byteLength >= 4) {
      coverOffset = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false);
    } else if (type === 202 && data.byteLength >= 4) {
      thumbnailOffset = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false);
    }

    offset += length;
  }

  return { coverOffset, thumbnailOffset, boundary, author };
}

function getMobiDecoder(encoding: number): TextDecoder {
  try {
    if (encoding === 65001) return new TextDecoder("utf-8");
    if (encoding === 1252) return new TextDecoder("windows-1252");
    return new TextDecoder("utf-8");
  } catch {
    return new TextDecoder();
  }
}

function guessMimeTypeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length >= 8) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return "image/png";
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    ) {
      return "image/gif";
    }
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return "image/webp";
    }
  }
  return null;
}

export async function createRangeReadableFile(
  fileUri: string,
  fileSize?: number,
): Promise<BlobLikeFile> {
  const LegacyFileSystem = await import("expo-file-system/legacy");
  const { toByteArray } = await import("base64-js");
  const info =
    typeof fileSize === "number" && fileSize >= 0 ? null : await LegacyFileSystem.getInfoAsync(fileUri);

  const resolvedSize =
    typeof fileSize === "number" && fileSize >= 0
      ? fileSize
      : info && info.exists
        ? ((info as { size?: number }).size ?? 0)
        : 0;

  return {
    size: resolvedSize,
    slice(start = 0, end = resolvedSize) {
      const normalizedStart = Math.max(0, start);
      const normalizedEnd = Math.max(normalizedStart, Math.min(end, resolvedSize));
      const length = Math.max(0, normalizedEnd - normalizedStart);

      return {
        async arrayBuffer() {
          if (length === 0) {
            return new ArrayBuffer(0);
          }

          const chunks: Uint8Array[] = [];
          let totalLength = 0;

          for (
            let cursor = normalizedStart;
            cursor < normalizedEnd;
            cursor += RANGE_READ_CHUNK_BYTES
          ) {
            const chunkLength = Math.min(RANGE_READ_CHUNK_BYTES, normalizedEnd - cursor);
            const base64 = await LegacyFileSystem.readAsStringAsync(fileUri, {
              encoding: LegacyFileSystem.EncodingType.Base64,
              position: cursor,
              length: chunkLength,
            });
            const bytes = Uint8Array.from(toByteArray(base64));
            chunks.push(bytes);
            totalLength += bytes.byteLength;
          }

          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return merged.buffer;
        },
      };
    },
  };
}

// ─── Lazy ZIP reader: parse directory first, decompress on demand ───

interface ZipDirectoryEntry {
  filename: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Parse the ZIP central directory WITHOUT decompressing any entries.
 * This is fast O(n) on entry count, with no decompression overhead.
 */
function parseZipDirectory(buf: Uint8Array): ZipDirectoryEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const entries: ZipDirectoryEntry[] = [];

  // Find End of Central Directory
  let eocdOffset = -1;
  for (let i = buf.byteLength - 22; i >= 0 && i >= buf.byteLength - 65557; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return entries;

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdCount = view.getUint16(eocdOffset + 10, true);

  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (pos + 46 > buf.byteLength) break;
    if (view.getUint32(pos, true) !== 0x02014b50) break;

    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const filenameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    const filename = new TextDecoder().decode(buf.slice(pos + 46, pos + 46 + filenameLen));

    entries.push({
      filename,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    pos += 46 + filenameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Decompress a single ZIP entry on demand.
 */
function decompressEntry(buf: Uint8Array, entry: ZipDirectoryEntry): Uint8Array | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (entry.localHeaderOffset + 30 > buf.byteLength) return null;

  const localFilenameLen = view.getUint16(entry.localHeaderOffset + 26, true);
  const localExtraLen = view.getUint16(entry.localHeaderOffset + 28, true);
  const dataStart = entry.localHeaderOffset + 30 + localFilenameLen + localExtraLen;

  if (entry.compressionMethod === 0) {
    // Stored (no compression)
    if (dataStart + entry.compressedSize > buf.byteLength) return null;
    return buf.slice(dataStart, dataStart + entry.compressedSize);
  }

  if (entry.compressionMethod === 8) {
    // Deflated
    if (dataStart + entry.compressedSize > buf.byteLength) return null;
    try {
      const compressed = buf.slice(dataStart, dataStart + entry.compressedSize);
      return pako.inflateRaw(compressed);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Find a ZIP entry by name (case-insensitive fallback) and decompress it.
 */
function findAndDecompress(
  buf: Uint8Array,
  directory: ZipDirectoryEntry[],
  path: string,
): Uint8Array | null {
  // Exact match first
  let entry = directory.find((e) => e.filename === path);
  if (!entry) {
    // Case-insensitive fallback
    const lower = path.toLowerCase();
    entry = directory.find((e) => e.filename.toLowerCase() === lower);
  }
  if (!entry) return null;
  return decompressEntry(buf, entry);
}

function readTextFromZip(
  buf: Uint8Array,
  directory: ZipDirectoryEntry[],
  path: string,
): string | null {
  const data = findAndDecompress(buf, directory, path);
  if (!data) return null;
  return new TextDecoder().decode(data);
}

function readBytesFromZip(
  buf: Uint8Array,
  directory: ZipDirectoryEntry[],
  path: string,
): Uint8Array | null {
  return findAndDecompress(buf, directory, path);
}

// ─── XML helpers (no DOMParser, regex-based) ────────────────────────

function extractTagContent(xml: string, tagName: string): string {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<${escapedTag}[^>]*>([^<]*)</${escapedTag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

function parseAttribute(xml: string, tagName: string, attrName: string): string | null {
  const tagRegex = new RegExp(`<${tagName}\\b([^>]*)/?>`, "i");
  const tagMatch = xml.match(tagRegex);
  if (!tagMatch) return null;

  const attrRegex = new RegExp(`${attrName}\\s*=\\s*["']([^"']*)["']`, "i");
  const attrMatch = tagMatch[0].match(attrRegex);
  return attrMatch ? attrMatch[1] : null;
}

/**
 * Find cover image href from OPF manifest using 4 strategies:
 * 1. EPUB 3: <item properties="cover-image">
 * 2. EPUB 2: <meta name="cover" content="id"> → <item id="id">
 * 3. Any image item with "cover" in id or href
 * 4. Fallback: first image item
 */
function findCoverHref(opfXml: string): string | null {
  const itemRegex = /<item\b([^>]*)\/?>(?:<\/item>)?/gi;
  const items: Array<{ id: string; href: string; mediaType: string; properties: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = itemRegex.exec(opfXml)) !== null) {
    const attrs = m[1];
    items.push({
      id: getAttr(attrs, "id"),
      href: getAttr(attrs, "href"),
      mediaType: getAttr(attrs, "media-type"),
      properties: getAttr(attrs, "properties"),
    });
  }

  // Method 1: EPUB 3 cover-image property
  for (const item of items) {
    if (item.properties.split(/\s+/).includes("cover-image")) {
      return item.href;
    }
  }

  // Method 2: EPUB 2 <meta name="cover" content="coverId">
  const metaRegex = /<meta\b([^>]*)\/?>(?:<\/meta>)?/gi;
  while ((m = metaRegex.exec(opfXml)) !== null) {
    const attrs = m[1];
    if (getAttr(attrs, "name").toLowerCase() === "cover") {
      const coverId = getAttr(attrs, "content");
      if (coverId) {
        const coverItem = items.find((it) => it.id === coverId);
        if (coverItem) return coverItem.href;
      }
    }
  }

  // Method 3: image item with "cover" in id or href
  for (const item of items) {
    if (item.mediaType.startsWith("image/")) {
      if (item.id.toLowerCase().includes("cover") || item.href.toLowerCase().includes("cover")) {
        return item.href;
      }
    }
  }

  // Method 4: first image item
  for (const item of items) {
    if (item.mediaType.startsWith("image/")) {
      return item.href;
    }
  }

  return null;
}

function getAttr(attrsStr: string, name: string): string {
  const regex = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i");
  const match = attrsStr.match(regex);
  return match ? match[1] : "";
}

// ─── Helpers ────────────────────────────────────────────────────────

function guessMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/jpeg";
  }
}
