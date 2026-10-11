import type { Book } from "@readany/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractLocalBookMetadata } from "./auto-metadata";
import { extractBookMetadataFromFile } from "./metadata-extractor";

type SparseSegment = { offset: number; bytes: Uint8Array };

const LARGE_FILE_SIZE = 33 * 1024 * 1024;

const mobileFile = vi.hoisted(() => ({
  exists: true,
  size: 33 * 1024 * 1024,
  read: (_start: number, _end: number) => new Uint8Array(),
}));

const platform = vi.hoisted(() => ({
  getAppDataDir: vi.fn(async () => "/app"),
  joinPath: vi.fn(async (...parts: string[]) => parts.join("/")),
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => {
    throw new Error("large repair must not read the whole file");
  }),
}));

vi.mock("@readany/core/services", () => ({ getPlatformService: () => platform }));
vi.mock("@/lib/book/metadata-extractor", async () => import("./metadata-extractor"));
vi.mock("expo-file-system/legacy", () => ({
  EncodingType: { Base64: "base64" },
  getInfoAsync: vi.fn(async () => ({
    exists: mobileFile.exists,
    isDirectory: false,
    size: mobileFile.size,
  })),
  readAsStringAsync: vi.fn(async (_uri: string, options: { position: number; length: number }) =>
    Buffer.from(mobileFile.read(options.position, options.position + options.length)).toString(
      "base64",
    ),
  ),
}));

describe("range-readable book metadata extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mobileFile.exists = true;
  });

  it("extracts metadata from an EPUB larger than 32 MiB using bounded slices", async () => {
    const file = createLargeEpubFile();

    await expect(extractBookMetadataFromFile(file, "epub", "large.epub")).resolves.toMatchObject({
      title: "Large Book",
      publisher: "Range Press",
      subjects: ["History"],
    });
    expect(file.slice).toHaveBeenCalled();
    expectBoundedReads(file.slice);
  });

  it.each(["mobi", "azw", "azw3"])(
    "extracts %s metadata from a large file using bounded slices",
    async (format) => {
      const file = createLargeMobiFile();

      await expect(
        extractBookMetadataFromFile(file, format, `book.${format}`),
      ).resolves.toMatchObject({
        title: "Large MOBI",
        author: "Author",
      });
      expect(file.slice).toHaveBeenCalled();
      expectBoundedReads(file.slice);
    },
  );

  it("routes large local EPUB Book Details repair through range reads", async () => {
    const file = createLargeEpubFile();
    mobileFile.size = file.size;
    mobileFile.read = file.read;

    await expect(
      extractLocalBookMetadata({
        id: "legacy-large",
        filePath: "books/large.epub",
        format: "epub",
        syncStatus: "local",
        meta: { title: "Saved title", author: "Saved author" },
        progress: 0,
        addedAt: 1,
      } as Book),
    ).resolves.toMatchObject({
      title: "Large Book",
      publisher: "Range Press",
      coverBytes: expect.any(Uint8Array),
      coverMimeType: "image/png",
    });
    expect(platform.readFile).not.toHaveBeenCalled();
    expect(platform.writeFile).not.toHaveBeenCalled();
  });

  it("returns extracted text and cover bytes without persisting during extraction", async () => {
    const file = createLargeEpubFile();
    mobileFile.size = file.size;
    mobileFile.read = file.read;

    await expect(
      extractLocalBookMetadata({
        id: "cover-failure",
        filePath: "books/large.epub",
        format: "epub",
        syncStatus: "local",
        meta: { title: "Saved title", author: "Saved author" },
        progress: 0,
        addedAt: 1,
      } as Book),
    ).resolves.toMatchObject({
      title: "Large Book",
      publisher: "Range Press",
      coverBytes: expect.any(Uint8Array),
    });
    expect(platform.writeFile).not.toHaveBeenCalled();
  });

  it.each(["mobi", "azw", "azw3"])(
    "routes local %s Book Details repair through range reads",
    async (format) => {
      const file = createLargeMobiFile();
      mobileFile.size = file.size;
      mobileFile.read = file.read;

      await expect(
        extractLocalBookMetadata({
          id: `legacy-${format}`,
          filePath: `books/large.${format}`,
          format,
          syncStatus: "local",
          meta: { title: "", author: "" },
          progress: 0,
          addedAt: 1,
        } as Book),
      ).resolves.toMatchObject({ title: "Large MOBI", author: "Author" });
      expect(platform.readFile).not.toHaveBeenCalled();
    },
  );

  it("leaves a missing local file untouched without trying a whole-file read", async () => {
    mobileFile.exists = false;

    await expect(
      extractLocalBookMetadata({
        id: "missing",
        filePath: "books/missing.epub",
        format: "epub",
        syncStatus: "local",
        meta: { title: "Saved title", author: "Saved author" },
        progress: 0,
        addedAt: 1,
      } as Book),
    ).resolves.toBeNull();
    expect(platform.readFile).not.toHaveBeenCalled();
  });
});

function expectBoundedReads(slice: ReturnType<typeof vi.fn>) {
  for (const [start = 0, end = start] of slice.mock.calls as Array<[number?, number?]>) {
    expect(end - start).toBeLessThanOrEqual(256 * 1024);
  }
}

function createLargeEpubFile() {
  const containerXml = encode(
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf" /></rootfiles></container>',
  );
  const opfXml = encode(
    '<package><metadata><dc:title>Large Book</dc:title><dc:creator>Author</dc:creator><dc:publisher>Range Press</dc:publisher><dc:subject>History</dc:subject></metadata><manifest><item id="cover" href="cover.png" media-type="image/png" properties="cover-image" /></manifest></package>',
  );
  const coverBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const entries = [
    { name: "META-INF/container.xml", bytes: containerXml },
    { name: "content.opf", bytes: opfXml },
    { name: "cover.png", bytes: coverBytes },
  ];
  const segments: SparseSegment[] = [];
  const directoryEntries: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encode(entry.name);
    const local = new Uint8Array(30 + name.length + entry.bytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint32(18, entry.bytes.length, true);
    localView.setUint32(22, entry.bytes.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.length);
    segments.push({ offset: localOffset, bytes: local });

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint32(20, entry.bytes.length, true);
    centralView.setUint32(24, entry.bytes.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    directoryEntries.push(central);
    localOffset += local.length;
  }

  const directory = concat(directoryEntries);
  const eocd = new Uint8Array(22);
  const directoryOffset = LARGE_FILE_SIZE - eocd.length - directory.length;
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, directory.length, true);
  eocdView.setUint32(16, directoryOffset, true);
  segments.push({ offset: directoryOffset, bytes: directory });
  segments.push({ offset: LARGE_FILE_SIZE - eocd.length, bytes: eocd });
  return createSparseFile(LARGE_FILE_SIZE, segments);
}

function createLargeMobiFile() {
  const pdbHeader = new Uint8Array(78);
  new DataView(pdbHeader.buffer).setUint16(76, 2, false);

  const recordTable = new Uint8Array(16);
  const recordTableView = new DataView(recordTable.buffer);
  recordTableView.setUint32(0, 256, false);
  recordTableView.setUint32(8, 1024, false);

  const record = new Uint8Array(768);
  const view = new DataView(record.buffer);
  record.set(encode("MOBI"), 16);
  view.setUint32(20, 132, false);
  view.setUint32(28, 65001, false);
  view.setUint32(36, 8, false);
  view.setUint32(84, 300, false);
  view.setUint32(88, 10, false);
  view.setUint32(108, 1, false);
  view.setUint32(128, 0b1000000, false);
  record.set(encode("EXTH"), 148);
  view.setUint32(152, 26, false);
  view.setUint32(156, 1, false);
  view.setUint32(160, 100, false);
  view.setUint32(164, 14, false);
  record.set(encode("Author"), 168);
  record.set(encode("Large MOBI"), 300);

  return createSparseFile(LARGE_FILE_SIZE, [
    { offset: 0, bytes: pdbHeader },
    { offset: 78, bytes: recordTable },
    { offset: 256, bytes: record },
  ]);
}

function createSparseFile(size: number, segments: SparseSegment[]) {
  const read = (start: number, end: number) => {
    const result = new Uint8Array(Math.max(0, end - start));
    for (const segment of segments) {
      const overlapStart = Math.max(start, segment.offset);
      const overlapEnd = Math.min(end, segment.offset + segment.bytes.length);
      if (overlapEnd <= overlapStart) continue;
      result.set(
        segment.bytes.subarray(overlapStart - segment.offset, overlapEnd - segment.offset),
        overlapStart - start,
      );
    }
    return result;
  };
  return {
    size,
    read,
    slice: vi.fn((start = 0, end = size) => ({
      arrayBuffer: async () => read(start, end).buffer,
    })),
  };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
