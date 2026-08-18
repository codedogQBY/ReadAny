import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MOBI } from "../../../../foliate-js/mobi.js";
import { unzlibSync } from "../../../../foliate-js/vendor/fflate.js";
import { BookExtractionError } from "./extractor-error";
import { runVectorizeQueueJob } from "./vectorize-queue-job";

const FIXTURE_URL = new URL("./__fixtures__/", import.meta.url);

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(x?[\da-f]+);/gi, (_match, digits: string) => {
      const hexadecimal = digits[0]?.toLowerCase() === "x";
      return String.fromCodePoint(
        Number.parseInt(hexadecimal ? digits.slice(1) : digits, hexadecimal ? 16 : 10),
      );
    })
    .replace(/&(amp|apos|gt|lt|nbsp|quot);/gi, (_match, entity: string) => {
      const values: Record<string, string> = {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        nbsp: " ",
        quot: '"',
      };
      return values[entity.toLowerCase()] ?? _match;
    });
}

function htmlToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

class TextOnlyDocument {
  readonly documentElement: { textContent: string };

  constructor(source: string) {
    this.documentElement = { textContent: htmlToText(source) };
  }

  getElementsByTagName(): never[] {
    return [];
  }

  querySelectorAll(): never[] {
    return [];
  }
}

class TextOnlyDomParser {
  parseFromString(source: string): TextOnlyDocument {
    return new TextOnlyDocument(source);
  }
}

function installParserTestDom() {
  vi.stubGlobal("DOMParser", TextOnlyDomParser);
  vi.stubGlobal("XMLSerializer", class {});
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.stubGlobal("document", {
    createElement: () => {
      let html = "";
      return {
        set innerHTML(value: string) {
          html = value;
        },
        get value() {
          return decodeHtmlEntities(html);
        },
      };
    },
  });
}

async function extractFixtureSections(fixture: string): Promise<string[]> {
  const fixturePath = fileURLToPath(new URL(fixture, FIXTURE_URL).href);
  const bytes = new Uint8Array(readFileSync(fixturePath));
  const book = await new MOBI({ unzlib: unzlibSync }).open(
    new Blob([bytes], { type: "application/x-mobipocket-ebook" }),
  );

  const sections: string[] = [];
  for (const section of book.sections) {
    if (!section.createDocument) continue;
    const document = await section.createDocument();
    const text = document.documentElement?.textContent?.replace(/\s+/g, " ").trim();
    if (text) sections.push(text);
  }
  return sections;
}

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
  view.setUint32(recordOffset + 36, 6);

  return new Blob([bytes], { type: "application/x-mobipocket-ebook" });
}

describe("MOBI-family extraction fixtures", () => {
  beforeAll(installParserTestDom);
  afterAll(() => vi.unstubAllGlobals());

  it.each(["gutenberg-11.mobi", "gutenberg-11.azw3"])(
    "extracts ordered Alice text from %s with the foliate MOBI loader",
    async (fixture) => {
      const sections = await extractFixtureSections(fixture);

      expect(sections.length).toBeGreaterThan(10);
      const firstChapter = sections.findIndex((text) =>
        text.includes("Alice was beginning to get very tired"),
      );
      const secondChapter = sections.findIndex((text) => text.includes("Curiouser and curiouser"));
      const queenChapter = sections.findIndex((text) =>
        text.includes("The Queen turned crimson with fury"),
      );
      expect(firstChapter).toBeGreaterThanOrEqual(0);
      expect(secondChapter).toBeGreaterThan(firstChapter);
      expect(queenChapter).toBeGreaterThan(secondChapter);
    },
  );

  it("rejects a bounded protected header, cleans up, and never vectorizes", async () => {
    const parser = new MOBI({ unzlib: unzlibSync });
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const vectorize = vi.fn();

    const result = await runVectorizeQueueJob({
      format: "mobi",
      extract: async () => (await parser.open(createProtectedMobiFile())) as never,
      vectorize,
      cleanup,
      onEvent: vi.fn(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected protected extraction to fail");
    expect(result.error).toBeInstanceOf(BookExtractionError);
    expect(result.error).toMatchObject({ category: "drm-protected" });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(vectorize).not.toHaveBeenCalled();
  });
});
