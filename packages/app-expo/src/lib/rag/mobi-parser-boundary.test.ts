import { describe, expect, it } from "vitest";
import { MOBI } from "../../../../foliate-js/mobi.js";

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index++) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function createProtectedMobiFile(): Blob {
  const bytes = new Uint8Array(512);
  const view = new DataView(bytes.buffer);
  const recordOffset = 86;

  writeAscii(bytes, 60, "BOOKMOBI");
  view.setUint16(76, 1);
  view.setUint32(78, recordOffset);

  view.setUint16(recordOffset, 1);
  view.setUint16(recordOffset + 12, 1);
  writeAscii(bytes, recordOffset + 16, "MOBI");
  view.setUint32(recordOffset + 20, 232);
  view.setUint32(recordOffset + 28, 65001);
  view.setUint32(recordOffset + 32, 1);
  view.setUint32(recordOffset + 36, 6);
  view.setUint32(recordOffset + 108, 1);

  return new Blob([bytes], { type: "application/x-mobipocket-ebook" });
}

function createProtectedComboMobiFile(): Blob {
  const bytes = new Uint8Array(800);
  const view = new DataView(bytes.buffer);
  const mobi6Offset = 94;
  const kf8Offset = 400;

  writeAscii(bytes, 60, "BOOKMOBI");
  view.setUint16(76, 2);
  view.setUint32(78, mobi6Offset);
  view.setUint32(86, kf8Offset);

  view.setUint16(mobi6Offset, 1);
  writeAscii(bytes, mobi6Offset + 16, "MOBI");
  view.setUint32(mobi6Offset + 20, 232);
  view.setUint32(mobi6Offset + 28, 65001);
  view.setUint32(mobi6Offset + 32, 1);
  view.setUint32(mobi6Offset + 36, 6);
  view.setUint32(mobi6Offset + 108, 2);
  view.setUint32(mobi6Offset + 128, 0b100_0000);
  writeAscii(bytes, mobi6Offset + 248, "EXTH");
  view.setUint32(mobi6Offset + 252, 24);
  view.setUint32(mobi6Offset + 256, 1);
  view.setUint32(mobi6Offset + 260, 121);
  view.setUint32(mobi6Offset + 264, 12);
  view.setUint32(mobi6Offset + 268, 1);

  view.setUint16(kf8Offset, 1);
  view.setUint16(kf8Offset + 12, 1);
  writeAscii(bytes, kf8Offset + 16, "MOBI");
  view.setUint32(kf8Offset + 20, 232);
  view.setUint32(kf8Offset + 28, 65001);
  view.setUint32(kf8Offset + 32, 2);
  view.setUint32(kf8Offset + 36, 8);

  return new Blob([bytes], { type: "application/x-mobipocket-ebook" });
}

describe("MOBI parser protection boundary", () => {
  it("rejects encrypted PalmDOC records before text extraction", async () => {
    const parser = new MOBI({ unzlib: (value: Uint8Array) => value });

    await expect(parser.open(createProtectedMobiFile())).rejects.toThrow(
      "Encrypted MOBI records are not supported",
    );
  });

  it("does not swallow encryption in a combo file's KF8 records", async () => {
    const parser = new MOBI({ unzlib: (value: Uint8Array) => value });

    await expect(parser.open(createProtectedComboMobiFile())).rejects.toThrow(
      "Encrypted MOBI records are not supported",
    );
  });
});
