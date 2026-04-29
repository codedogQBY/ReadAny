/**
 * TXT to EPUB converter.
 * Converts plain text files into EPUB 2.0 format for rendering via foliate-js.
 *
 * Features:
 * - Multi-encoding detection (UTF-8, UTF-16, GBK, GB18030, Shift-JIS)
 * - Chinese & English chapter title recognition
 * - Adaptive segment splitting with fallback strategies
 * - Large file streaming support (>8MB)
 *
 * Reference: readest/apps/readest-app/src/utils/txt.ts
 */

interface Metadata {
  bookTitle: string;
  author: string;
  language: string;
  identifier: string;
}

interface Chapter {
  title: string;
  content: string;
  isVolume: boolean;
}

export interface Txt2EpubOptions {
  file: File;
  author?: string;
  language?: string;
}

export interface TxtConversionResult {
  file: File;
  bookTitle: string;
  chapterCount: number;
  language: string;
}

export interface TxtBytesConversionResult {
  epubBytes: Uint8Array;
  bookTitle: string;
  chapterCount: number;
  language: string;
}

interface ExtractChapterOptions {
  linesBetweenSegments: number;
  fallbackParagraphsPerChapter: number;
}

const LARGE_TXT_THRESHOLD_BYTES = 8 * 1024 * 1024;
const HEADER_TEXT_MAX_CHARS = 1024;
const HEADER_TEXT_MAX_BYTES = 128 * 1024;
const ENCODING_HEAD_SAMPLE_BYTES = 64 * 1024;
const ENCODING_MID_SAMPLE_BYTES = 8192;

const escapeXml = (str: string) => {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

/** Simple language detection based on character analysis */
function detectLanguage(text: string): string {
  const sample = text.slice(0, 2000);
  let cjkCount = 0;
  let latinCount = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0xf900 && code <= 0xfaff) // CJK Compatibility
    ) {
      cjkCount++;
    } else if (
      (code >= 0x41 && code <= 0x5a) || // A-Z
      (code >= 0x61 && code <= 0x7a) // a-z
    ) {
      latinCount++;
    }
  }
  if (cjkCount > latinCount * 0.5) return "zh";
  return "en";
}

/** Simple partial hash for identifier */
function simpleHash(file: File): string {
  const size = file.size;
  const name = file.name;
  return `txt-${name}-${size}-${Date.now().toString(36)}`;
}

export class TxtToEpubConverter {
  /**
   * createEpubZip is injected at runtime so the converter stays
   * environment-agnostic. Desktop (Vite) uses @zip.js/zip.js directly;
   * mobile can supply a different implementation (or the same lib
   * bundled via Metro).
   */
  private zipFactory:
    | (() => Promise<{
        BlobWriter: typeof import("@zip.js/zip.js").BlobWriter;
        TextReader: typeof import("@zip.js/zip.js").TextReader;
        ZipWriter: typeof import("@zip.js/zip.js").ZipWriter;
      }>)
    | null = null;

  setZipFactory(
    factory: () => Promise<{
      BlobWriter: typeof import("@zip.js/zip.js").BlobWriter;
      TextReader: typeof import("@zip.js/zip.js").TextReader;
      ZipWriter: typeof import("@zip.js/zip.js").ZipWriter;
    }>,
  ) {
    this.zipFactory = factory;
  }

  public async convert(options: Txt2EpubOptions): Promise<TxtConversionResult> {
    if (options.file.size <= LARGE_TXT_THRESHOLD_BYTES) {
      return await this.convertSmallFile(options);
    }
    return await this.convertLargeFile(options);
  }

  /**
   * Convert TXT to EPUB and return raw bytes (Uint8Array) instead of a File.
   * Avoids Blob/File constructors which are slow in React Native.
   * Uses Uint8ArrayWriter from @zip.js/zip.js to keep data in JS memory.
   */
  public async convertToBytes(options: Txt2EpubOptions): Promise<TxtBytesConversionResult> {
    const { chapters, metadata } =
      options.file.size <= LARGE_TXT_THRESHOLD_BYTES
        ? await this.processSmallFile(options)
        : await this.processLargeFile(options);

    const epubBytes = await this.createEpubAsBytes(chapters, metadata);
    return {
      epubBytes,
      bookTitle: metadata.bookTitle,
      chapterCount: chapters.length,
      language: metadata.language,
    };
  }

  private async processSmallFile(
    options: Txt2EpubOptions,
  ): Promise<{ chapters: Chapter[]; metadata: Metadata }> {
    const { file: txtFile, author: providedAuthor, language: providedLanguage } = options;

    const fileContent = await txtFile.arrayBuffer();
    const detectedEncoding = this.detectEncoding(fileContent) || "utf-8";
    const runtimeEncoding = this.resolveSupportedEncoding(detectedEncoding);
    const decoder = new TextDecoder(runtimeEncoding);
    const txtContent = decoder.decode(fileContent).trim();

    const bookTitle = this.extractBookTitle(this.getBaseFilename(txtFile.name));
    const fileHeader = txtContent.slice(0, HEADER_TEXT_MAX_CHARS);
    const { author, language } = this.extractAuthorAndLanguage(
      fileHeader,
      providedAuthor,
      providedLanguage,
    );
    const identifier = simpleHash(txtFile);
    const metadata = { bookTitle, author, language, identifier };

    const fallbackParagraphsPerChapter = 100;
    let chapters = this.extractChapters(txtContent, metadata, {
      linesBetweenSegments: 8,
      fallbackParagraphsPerChapter,
    });

    if (chapters.length === 0) {
      throw new Error("No chapters detected.");
    }

    if (chapters.length <= 1) {
      const probeChapterCount = this.probeChapterCount(txtContent, metadata, {
        linesBetweenSegments: 7,
        fallbackParagraphsPerChapter,
      });
      chapters = this.extractChapters(txtContent, metadata, {
        linesBetweenSegments: probeChapterCount > 1 ? 7 : 6,
        fallbackParagraphsPerChapter,
      });
    }

    return { chapters, metadata };
  }

  private async processLargeFile(
    options: Txt2EpubOptions,
  ): Promise<{ chapters: Chapter[]; metadata: Metadata }> {
    const { file: txtFile, author: providedAuthor, language: providedLanguage } = options;
    const detectedEncoding = (await this.detectEncodingFromFile(txtFile)) || "utf-8";
    const runtimeEncoding = this.resolveSupportedEncoding(detectedEncoding);

    const bookTitle = this.extractBookTitle(this.getBaseFilename(txtFile.name));
    const fileHeader = await this.readHeaderTextFromFile(
      txtFile,
      runtimeEncoding,
      HEADER_TEXT_MAX_CHARS,
      HEADER_TEXT_MAX_BYTES,
    );
    const { author, language } = this.extractAuthorAndLanguage(
      fileHeader,
      providedAuthor,
      providedLanguage,
    );
    const identifier = simpleHash(txtFile);
    const metadata = { bookTitle, author, language, identifier };

    const fallbackParagraphsPerChapter = 100;
    let chapters = await this.extractChaptersFromFileBySegments(
      txtFile,
      runtimeEncoding,
      metadata,
      { linesBetweenSegments: 8, fallbackParagraphsPerChapter },
    );

    if (chapters.length === 0) {
      throw new Error("No chapters detected.");
    }

    if (chapters.length <= 1) {
      const probeChapterCount = await this.probeChapterCountFromFileBySegments(
        txtFile,
        runtimeEncoding,
        metadata,
        { linesBetweenSegments: 7, fallbackParagraphsPerChapter },
      );
      chapters = await this.extractChaptersFromFileBySegments(txtFile, runtimeEncoding, metadata, {
        linesBetweenSegments: probeChapterCount > 1 ? 7 : 6,
        fallbackParagraphsPerChapter,
      });
    }

    return { chapters, metadata };
  }

  private async convertSmallFile(options: Txt2EpubOptions): Promise<TxtConversionResult> {
    const { chapters, metadata } = await this.processSmallFile(options);
    const fileName = `${metadata.bookTitle}.epub`;
    const blob = await this.createEpub(chapters, metadata);
    return {
      file: new File([blob], fileName),
      bookTitle: metadata.bookTitle,
      chapterCount: chapters.length,
      language: metadata.language,
    };
  }

  private async convertLargeFile(options: Txt2EpubOptions): Promise<TxtConversionResult> {
    const { chapters, metadata } = await this.processLargeFile(options);
    const fileName = `${metadata.bookTitle}.epub`;
    const blob = await this.createEpub(chapters, metadata);
    return {
      file: new File([blob], fileName),
      bookTitle: metadata.bookTitle,
      chapterCount: chapters.length,
      language: metadata.language,
    };
  }

  // ── Chapter extraction ──

  private extractChapters(
    txtContent: string,
    metadata: Metadata,
    option: ExtractChapterOptions,
  ): Chapter[] {
    const { linesBetweenSegments } = option;
    const segmentRegex = this.createSegmentRegex(linesBetweenSegments);
    const chapters: Chapter[] = [];
    const segments = txtContent.split(segmentRegex);
    for (const segment of segments) {
      const segmentChapters = this.extractChaptersFromSegment(
        segment,
        metadata,
        option,
        chapters.length,
      );
      chapters.push(...segmentChapters);
    }
    return chapters;
  }

  private probeChapterCount(
    txtContent: string,
    metadata: Metadata,
    option: ExtractChapterOptions,
  ): number {
    const { linesBetweenSegments } = option;
    const segmentRegex = this.createSegmentRegex(linesBetweenSegments);
    let chapterCount = 0;
    const segments = txtContent.split(segmentRegex);
    for (const segment of segments) {
      chapterCount += this.probeChapterCountFromSegment(segment, metadata, option);
      if (chapterCount > 1) return chapterCount;
    }
    return chapterCount;
  }

  private async extractChaptersFromFileBySegments(
    txtFile: File,
    encoding: string,
    metadata: Metadata,
    option: ExtractChapterOptions,
  ): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    for await (const segment of this.iterateSegmentsFromFile(
      txtFile,
      encoding,
      option.linesBetweenSegments,
    )) {
      const segmentChapters = this.extractChaptersFromSegment(
        segment,
        metadata,
        option,
        chapters.length,
      );
      chapters.push(...segmentChapters);
    }
    return chapters;
  }

  private async probeChapterCountFromFileBySegments(
    txtFile: File,
    encoding: string,
    metadata: Metadata,
    option: ExtractChapterOptions,
  ): Promise<number> {
    let chapterCount = 0;
    for await (const segment of this.iterateSegmentsFromFile(
      txtFile,
      encoding,
      option.linesBetweenSegments,
    )) {
      chapterCount += this.probeChapterCountFromSegment(segment, metadata, option);
      if (chapterCount > 1) return chapterCount;
    }
    return chapterCount;
  }

  private extractChaptersFromSegment(
    segment: string,
    metadata: Metadata,
    option: ExtractChapterOptions,
    chapterOffset: number,
  ): Chapter[] {
    const { language } = metadata;
    const { fallbackParagraphsPerChapter } = option;
    const trimmedSegment = segment.replace(/<!--.*?-->/g, "").trim();
    if (!trimmedSegment) return [];

    const chapterRegexps = this.createChapterRegexps(language);
    let matches: string[] = [];
    for (const chapterRegex of chapterRegexps) {
      const tryMatches = trimmedSegment.split(chapterRegex);
      if (this.isGoodMatches(tryMatches)) {
        matches = this.joinAroundUndefined(tryMatches);
        break;
      }
    }

    if (matches.length === 0 && fallbackParagraphsPerChapter > 0) {
      const chapters: Chapter[] = [];
      const paragraphs = trimmedSegment.split(/\n+/);
      const totalParagraphs = paragraphs.length;
      for (let i = 0; i < totalParagraphs; i += fallbackParagraphsPerChapter) {
        const chunks = paragraphs.slice(i, i + fallbackParagraphsPerChapter);
        const formattedSegment = this.formatSegment(chunks.join("\n"));
        const title = `${chapterOffset + chapters.length + 1}`;
        const content = `<h2>${title}</h2><p>${formattedSegment}</p>`;
        chapters.push({ title, content, isVolume: false });
      }
      return chapters;
    }

    const segmentChapters: Chapter[] = [];
    for (let j = 1; j < matches.length; j += 2) {
      const title = matches[j]?.trim() || "";
      const content = matches[j + 1]?.trim() || "";

      let isVolume = false;
      if (language === "zh") {
        isVolume = /第[零〇一二三四五六七八九十百千万0-9]+(卷|本|册|部)/.test(title);
      } else {
        isVolume = /\b(Part|Volume|Book)\b/i.test(title);
      }

      const headTitle = isVolume ? `<h1>${title}</h1>` : `<h2>${title}</h2>`;
      const formattedSegment = this.formatSegment(content);
      segmentChapters.push({
        title: escapeXml(title),
        content: `${headTitle}<p>${formattedSegment}</p>`,
        isVolume,
      });
    }

    if (matches[0] && matches[0].trim()) {
      const initialContent = matches[0].trim();
      const firstLine = initialContent.split("\n")[0]!.trim();
      const segmentTitle =
        (firstLine.length > 16 ? initialContent.split(/[\n\s\p{P}]/u)[0]!.trim() : firstLine) ||
        initialContent.slice(0, 16);
      const formattedSegment = this.formatSegment(initialContent);
      segmentChapters.unshift({
        title: escapeXml(segmentTitle),
        content: `<h3></h3><p>${formattedSegment}</p>`,
        isVolume: false,
      });
    }

    return segmentChapters;
  }

  private probeChapterCountFromSegment(
    segment: string,
    metadata: Metadata,
    option: ExtractChapterOptions,
  ): number {
    const { language } = metadata;
    const { fallbackParagraphsPerChapter } = option;
    const trimmedSegment = segment.replace(/<!--.*?-->/g, "").trim();
    if (!trimmedSegment) return 0;

    const chapterRegexps = this.createChapterRegexps(language);
    let matches: string[] = [];
    for (const chapterRegex of chapterRegexps) {
      const tryMatches = trimmedSegment.split(chapterRegex);
      if (this.isGoodMatches(tryMatches)) {
        matches = this.joinAroundUndefined(tryMatches);
        break;
      }
    }

    if (matches.length === 0 && fallbackParagraphsPerChapter > 0) {
      const paragraphs = trimmedSegment.split(/\n+/);
      return Math.ceil(paragraphs.length / fallbackParagraphsPerChapter);
    }

    let chapterCount = Math.floor(matches.length / 2);
    if (matches[0] && matches[0].trim()) {
      chapterCount++;
    }
    return chapterCount;
  }

  // ── Regex & formatting ──

  private createSegmentRegex(linesBetweenSegments: number): RegExp {
    return new RegExp(`(?:\\r?\\n){${linesBetweenSegments},}|-{8,}\r?\n`);
  }

  private formatSegment(segment: string): string {
    segment = escapeXml(segment);
    return segment
      .replace(/-{8,}|_{8,}/g, "\n")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line)
      .join("</p><p>");
  }

  private joinAroundUndefined(arr: (string | undefined)[]): string[] {
    return arr.reduce<string[]>((acc, curr, i, src) => {
      if (
        curr === undefined &&
        i > 0 &&
        i < src.length - 1 &&
        src[i - 1] !== undefined &&
        src[i + 1] !== undefined
      ) {
        acc[acc.length - 1] += src[i + 1]!;
        return acc;
      }
      if (curr !== undefined && (i === 0 || src[i - 1] !== undefined)) {
        acc.push(curr);
      }
      return acc;
    }, []);
  }

  private isGoodMatches(matches: string[], maxLength = 100000): boolean {
    const meaningfulParts = matches.filter((part) => part && part.trim().length > 0);
    if (meaningfulParts.length <= 1) return false;
    return !meaningfulParts.some((part) => part.length > maxLength);
  }

  private createChapterRegexps(language: string): RegExp[] {
    const chapterRegexps: RegExp[] = [];

    if (language === "zh") {
      chapterRegexps.push(
        new RegExp(
          String.raw`(?:^|\n)\s*` +
            "(" +
            [
              String.raw`第[零〇一二三四五六七八九十0-9][零〇一二三四五六七八九十百千万0-9]*(?:[章卷节回讲篇封本册部话])(?:[：:、 　\(\)0-9]*[^\n-]{0,24})(?!\S)`,
              String.raw`(?:楔子|前言|简介|引言|序言|序章|总论|概论|后记)(?:[：: 　][^\n-]{0,24})?(?!\S)`,
              String.raw`chapter[\s.]*[0-9]+(?:[：:. 　]+[^\n-]{0,50})?(?!\S)`,
            ].join("|") +
            ")",
          "gui",
        ),
      );
      chapterRegexps.push(
        new RegExp(
          String.raw`(?:^|\n)\s*` +
            "(" +
            [
              String.raw`[一二三四五六七八九十][零〇一二三四五六七八九十百千万]?[：:、 　][^\n-]{0,24}(?=\n|$)`,
              String.raw`[0-9]+[^\n]{0,16}(?=\n|$)`,
            ].join("|") +
            ")",
          "gu",
        ),
      );
      return chapterRegexps;
    }

    const chapterKeywords = ["Chapter", "Part", "Section", "Book", "Volume", "Act"];
    const prefaceKeywords = [
      "Prologue",
      "Epilogue",
      "Introduction",
      "Foreword",
      "Preface",
      "Afterword",
    ];

    const numberPattern = String.raw`(\d+|(?:[IVXLCDM]{2,}|V|X|L|C|D|M)\b)`;
    const dotNumberPattern = String.raw`\.\d{1,4}`;
    const titlePattern = String.raw`[^\n]{0,50}`;

    const normalChapterPattern = chapterKeywords
      .map(
        (k) =>
          String.raw`${k}\s*(?:${numberPattern}|${dotNumberPattern})(?:[:.\-–—]?\s*${titlePattern})?`,
      )
      .join("|");

    const prefacePattern = prefaceKeywords
      .map((k) => String.raw`${k}(?:[:.\-–—]?\s*${titlePattern})?`)
      .join("|");

    const combinedPattern = String.raw`(?:^|\n|\s)(?:${normalChapterPattern}|${prefacePattern})(?=\s|$)`;
    chapterRegexps.push(new RegExp(combinedPattern, "gi"));

    return chapterRegexps;
  }

  // ── Streaming ──

  private async *iterateSegmentsFromFile(
    file: File,
    encoding: string,
    linesBetweenSegments: number,
  ): AsyncGenerator<string> {
    const reader = file.stream().getReader();
    const decoder = new TextDecoder(encoding);
    const segmentRegex = this.createSegmentRegex(linesBetweenSegments);
    let pending = "";
    let completed = false;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          completed = true;
          break;
        }
        if (!value) continue;
        pending += decoder.decode(value, { stream: true });
        const consumed = this.consumeCompleteSegments(pending, segmentRegex);
        pending = consumed.pending;
        for (const segment of consumed.segments) {
          yield segment;
        }
      }

      pending += decoder.decode();
      const consumed = this.consumeCompleteSegments(pending, segmentRegex);
      for (const segment of consumed.segments) {
        yield segment;
      }
      if (consumed.pending) {
        yield consumed.pending;
      }
    } finally {
      if (!completed) {
        try {
          await reader.cancel();
        } catch {}
      }
      reader.releaseLock();
    }
  }

  private consumeCompleteSegments(
    pending: string,
    segmentRegex: RegExp,
  ): { segments: string[]; pending: string } {
    const segments: string[] = [];
    let match = segmentRegex.exec(pending);
    while (match) {
      segments.push(pending.slice(0, match.index));
      pending = pending.slice(match.index + match[0].length);
      segmentRegex.lastIndex = 0;
      match = segmentRegex.exec(pending);
    }
    return { segments, pending };
  }

  private async readHeaderTextFromFile(
    file: File,
    encoding: string,
    maxChars: number,
    maxBytes: number,
  ): Promise<string> {
    const decoder = new TextDecoder(encoding);
    const headerBytes = await file.slice(0, Math.min(file.size, maxBytes)).arrayBuffer();
    return decoder.decode(headerBytes).slice(0, maxChars).trim();
  }

  // ── Encoding detection ──

  private detectEncoding(buffer: ArrayBuffer): string | undefined {
    const utf8HeadSampleSize = Math.min(buffer.byteLength, ENCODING_HEAD_SAMPLE_BYTES);
    const utf8HeadSample = buffer.slice(0, utf8HeadSampleSize);

    try {
      this.assertStrictUtf8Sample(new Uint8Array(utf8HeadSample));
      if (buffer.byteLength > utf8HeadSampleSize * 2) {
        const midSampleSize = Math.min(
          ENCODING_MID_SAMPLE_BYTES,
          buffer.byteLength - utf8HeadSampleSize,
        );
        const midSampleStart = Math.floor((buffer.byteLength - midSampleSize) / 2);
        const midSample = buffer.slice(midSampleStart, midSampleStart + midSampleSize);
        this.assertStrictUtf8Sample(new Uint8Array(midSample));
      }
      return "utf-8";
    } catch {
      const uint8Array = new Uint8Array(buffer);
      let validBytes = 0;
      let checkedBytes = 0;
      const sampleSize = Math.min(uint8Array.length, 10000);

      for (let i = 0; i < sampleSize; i++) {
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(uint8Array.slice(i, i + 100));
          validBytes += 100;
          checkedBytes += 100;
          i += 99;
        } catch {
          checkedBytes++;
        }
      }

      const validPercentage = checkedBytes > 0 ? (validBytes / checkedBytes) * 100 : 0;
      if (validPercentage > 80) return "utf-8";
    }

    const headerBytes = new Uint8Array(buffer.slice(0, 4));
    if (headerBytes[0] === 0xff && headerBytes[1] === 0xfe) return "utf-16le";
    if (headerBytes[0] === 0xfe && headerBytes[1] === 0xff) return "utf-16be";
    if (headerBytes[0] === 0xef && headerBytes[1] === 0xbb && headerBytes[2] === 0xbf)
      return "utf-8";

    const sample = new Uint8Array(buffer.slice(0, Math.min(4096, buffer.byteLength)));
    let highByteCount = 0;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i]! >= 0x80) highByteCount++;
    }

    const highByteRatio = sample.length > 0 ? highByteCount / sample.length : 0;
    if (highByteRatio > 0.3) return "gbk";

    if (highByteRatio > 0.1) {
      // Disambiguate Shift-JIS vs GBK/GB18030 by counting distinctive patterns.
      // GBK double-byte: lead 0xA1-0xFE, trail 0xA1-0xFE
      // Shift-JIS distinctive: lead 0x81-0x9F (below GBK lead range)
      let gbkPairs = 0;
      let sjisDistinctPairs = 0;
      for (let i = 0; i < sample.length - 1; i++) {
        const b1 = sample[i]!;
        const b2 = sample[i + 1]!;
        if (b1 >= 0xa1 && b1 <= 0xfe && b2 >= 0xa1 && b2 <= 0xfe) {
          gbkPairs++;
          i++;
        } else if (
          b1 >= 0x81 &&
          b1 <= 0x9f &&
          ((b2 >= 0x40 && b2 <= 0x7e) || (b2 >= 0x80 && b2 <= 0xfc))
        ) {
          sjisDistinctPairs++;
          i++;
        }
      }
      if (sjisDistinctPairs > 0 && sjisDistinctPairs > gbkPairs) return "shift-jis";
      return "gb18030";
    }

    return "utf-8";
  }

  private async detectEncodingFromFile(file: File): Promise<string | undefined> {
    const headSampleSize = Math.min(file.size, ENCODING_HEAD_SAMPLE_BYTES);
    const headBuffer = await file.slice(0, headSampleSize).arrayBuffer();
    const headSample = new Uint8Array(headBuffer);

    try {
      this.assertStrictUtf8Sample(headSample);
      if (file.size > headSampleSize * 2) {
        const midSampleSize = Math.min(ENCODING_MID_SAMPLE_BYTES, file.size - headSampleSize);
        const midSampleStart = Math.floor((file.size - midSampleSize) / 2);
        const midBuffer = await file
          .slice(midSampleStart, midSampleStart + midSampleSize)
          .arrayBuffer();
        this.assertStrictUtf8Sample(new Uint8Array(midBuffer));
      }
      return "utf-8";
    } catch {
      let validBytes = 0;
      let checkedBytes = 0;
      const sampleSize = Math.min(headSample.length, 10000);

      for (let i = 0; i < sampleSize; i++) {
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(headSample.slice(i, i + 100));
          validBytes += 100;
          checkedBytes += 100;
          i += 99;
        } catch {
          checkedBytes++;
        }
      }

      const validPercentage = checkedBytes > 0 ? (validBytes / checkedBytes) * 100 : 0;
      if (validPercentage > 80) return "utf-8";
    }

    if (headSample[0] === 0xff && headSample[1] === 0xfe) return "utf-16le";
    if (headSample[0] === 0xfe && headSample[1] === 0xff) return "utf-16be";
    if (headSample[0] === 0xef && headSample[1] === 0xbb && headSample[2] === 0xbf) return "utf-8";

    const sample = headSample.slice(0, Math.min(4096, headSample.length));
    let highByteCount = 0;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i]! >= 0x80) highByteCount++;
    }

    const highByteRatio = sample.length > 0 ? highByteCount / sample.length : 0;
    if (highByteRatio > 0.3) return "gbk";

    if (highByteRatio > 0.1) {
      // Disambiguate Shift-JIS vs GBK/GB18030 by counting distinctive patterns.
      let gbkPairs = 0;
      let sjisDistinctPairs = 0;
      for (let i = 0; i < sample.length - 1; i++) {
        const b1 = sample[i]!;
        const b2 = sample[i + 1]!;
        if (b1 >= 0xa1 && b1 <= 0xfe && b2 >= 0xa1 && b2 <= 0xfe) {
          gbkPairs++;
          i++;
        } else if (
          b1 >= 0x81 &&
          b1 <= 0x9f &&
          ((b2 >= 0x40 && b2 <= 0x7e) || (b2 >= 0x80 && b2 <= 0xfc))
        ) {
          sjisDistinctPairs++;
          i++;
        }
      }
      if (sjisDistinctPairs > 0 && sjisDistinctPairs > gbkPairs) return "shift-jis";
      return "gb18030";
    }

    return "utf-8";
  }

  private assertStrictUtf8Sample(sample: Uint8Array): void {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      decoder.decode(sample);
      return;
    } catch {
      const maxOffset = Math.min(3, sample.length - 1);
      for (let startOffset = 0; startOffset <= maxOffset; startOffset++) {
        for (let endOffset = 0; endOffset <= maxOffset; endOffset++) {
          if (startOffset === 0 && endOffset === 0) continue;
          const end = sample.length - endOffset;
          if (end - startOffset < 16) continue;
          try {
            decoder.decode(sample.subarray(startOffset, end));
            return;
          } catch {
            // continue
          }
        }
      }
      throw new Error("invalid utf-8 sample");
    }
  }

  // ── Author / language / title ──

  private extractAuthorAndLanguage(
    fileHeader: string,
    providedAuthor?: string,
    providedLanguage?: string,
  ): { author: string; language: string } {
    const authorMatch =
      fileHeader.match(/[【\[]?作者[】\]]?[:：\s]\s*(.+)\r?\n/) ||
      fileHeader.match(/[【\[]?\s*(.+)\s+著\s*[】\]]?\r?\n/);
    let matchedAuthor = authorMatch ? authorMatch[1]!.trim() : providedAuthor || "";
    try {
      matchedAuthor = matchedAuthor.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
    } catch {}
    const author = matchedAuthor || providedAuthor || "";
    const language = providedLanguage || detectLanguage(fileHeader);
    return { author, language };
  }

  private extractBookTitle(filename: string): string {
    const match = filename.match(/《([^》]+)》/);
    return match ? match[1]! : filename.split(".")[0] || filename;
  }

  private getBaseFilename(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const name = normalized.split("/").pop() || normalized;
    return name.replace(/\.\w+$/i, "");
  }

  // ── Encoding resolution ──

  private isEncodingSupported(encoding: string): boolean {
    try {
      new TextDecoder(encoding);
      return true;
    } catch {
      return false;
    }
  }

  private resolveSupportedEncoding(detectedEncoding: string): string {
    if (!detectedEncoding) return "utf-8";
    const normalized = detectedEncoding.toLowerCase();
    const candidates = [
      normalized,
      ...(normalized === "gbk" ? ["gb18030", "gb2312"] : []),
      ...(normalized === "gb18030" ? ["gbk", "gb2312"] : []),
      ...(normalized === "shift-jis" ? ["shift_jis", "sjis"] : []),
      ...(normalized === "utf-16" ? ["utf-16le", "utf-16be"] : []),
      "utf-8",
    ];

    for (const encoding of candidates) {
      if (this.isEncodingSupported(encoding)) return encoding;
    }
    return "utf-8";
  }

  // ── EPUB generation ──

  private async createEpub(chapters: Chapter[], metadata: Metadata): Promise<Blob> {
    const { BlobWriter, TextReader, ZipWriter } = this.zipFactory
      ? await this.zipFactory()
      : await import("@zip.js/zip.js");

    const { bookTitle, author, language, identifier } = metadata;

    const zipWriteOptions = {
      lastAccessDate: new Date(0),
      lastModDate: new Date(0),
    };

    const zipWriter = new ZipWriter(new BlobWriter("application/epub+zip"), {
      extendedTimestamp: false,
    });
    await zipWriter.add("mimetype", new TextReader("application/epub+zip"), zipWriteOptions);

    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles>
        <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`.trim();

    await zipWriter.add("META-INF/container.xml", new TextReader(containerXml), zipWriteOptions);

    // TOC NCX
    let isNested = false;
    let navPoints = "";
    for (let i = 0; i < chapters.length; i++) {
      const id = `chapter${i + 1}`;
      const playOrder = i + 1;
      if (chapters[i]!.isVolume && isNested) {
        navPoints += "</navPoint>\n";
        isNested = !isNested;
      }
      navPoints +=
        `<navPoint id="navPoint-${id}" playOrder="${playOrder}">\n` +
        `<navLabel><text>${chapters[i]!.title}</text></navLabel>\n` +
        `<content src="./OEBPS/${id}.xhtml" />\n`;
      if (chapters[i]!.isVolume && !isNested) {
        isNested = !isNested;
      } else {
        navPoints += "</navPoint>\n";
      }
    }
    if (isNested) navPoints += "</navPoint>";

    const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
    <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
      <head>
        <meta name="dtb:uid" content="book-id" />
        <meta name="dtb:depth" content="1" />
        <meta name="dtb:totalPageCount" content="0" />
        <meta name="dtb:maxPageNumber" content="0" />
      </head>
      <docTitle>
        <text>${escapeXml(bookTitle)}</text>
      </docTitle>
      <docAuthor>
        <text>${escapeXml(author)}</text>
      </docAuthor>
      <navMap>
        ${navPoints}
      </navMap>
    </ncx>`.trim();

    await zipWriter.add("toc.ncx", new TextReader(tocNcx), zipWriteOptions);

    const manifest = chapters
      .map(
        (_, index) =>
          `<item id="chap${index + 1}" href="OEBPS/chapter${index + 1}.xhtml" media-type="application/xhtml+xml"/>`,
      )
      .join("\n      ");

    const spine = chapters
      .map((_, index) => `<itemref idref="chap${index + 1}"/>`)
      .join("\n      ");

    const css = `
      body { line-height: 1.6; font-size: 1em; font-family: 'Arial', sans-serif; text-align: justify; }
      p { text-indent: 2em; margin: 0; }
    `;

    await zipWriter.add("style.css", new TextReader(css), zipWriteOptions);

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i]!;
      const chapterContent = `<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
        <html xmlns="http://www.w3.org/1999/xhtml" lang="${language}" xml:lang="${language}">
          <head>
            <title>${chapter.title}</title>
            <link rel="stylesheet" type="text/css" href="../style.css"/>
          </head>
          <body>${chapter.content}</body>
        </html>`.trim();

      await zipWriter.add(
        `OEBPS/chapter${i + 1}.xhtml`,
        new TextReader(chapterContent),
        zipWriteOptions,
      );
    }

    const tocManifest = `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`;
    const styleManifest = `<item id="css" href="style.css" media-type="text/css"/>`;

    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>${escapeXml(bookTitle)}</dc:title>
          <dc:language>${language}</dc:language>
          <dc:creator>${escapeXml(author)}</dc:creator>
          <dc:identifier id="book-id">${identifier}</dc:identifier>
        </metadata>
        <manifest>
          ${manifest}
          ${tocManifest}
          ${styleManifest}
        </manifest>
        <spine toc="ncx">
          ${spine}
        </spine>
      </package>`.trim();

    await zipWriter.add("content.opf", new TextReader(contentOpf), zipWriteOptions);

    return await zipWriter.close();
  }

  /**
   * Create EPUB as raw Uint8Array without any external ZIP library.
   * Uses store-only (no compression) ZIP format — works in React Native
   * where @zip.js/zip.js fails due to missing Blob.arrayBuffer().
   */
  private async createEpubAsBytes(chapters: Chapter[], metadata: Metadata): Promise<Uint8Array> {
    const { bookTitle, author, language, identifier } = metadata;

    const entries: Array<{ name: string; data: Uint8Array }> = [];
    const encoder = new TextEncoder();

    // mimetype must be first, uncompressed, no extra field
    entries.push({ name: "mimetype", data: encoder.encode("application/epub+zip") });

    entries.push({
      name: "META-INF/container.xml",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8"?>\n<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">\n  <rootfiles>\n    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>`,
      ),
    });

    // TOC NCX
    let isNested = false;
    let navPoints = "";
    for (let i = 0; i < chapters.length; i++) {
      const id = `chapter${i + 1}`;
      const playOrder = i + 1;
      if (chapters[i]!.isVolume && isNested) {
        navPoints += "</navPoint>\n";
        isNested = !isNested;
      }
      navPoints +=
        `<navPoint id="navPoint-${id}" playOrder="${playOrder}">\n` +
        `<navLabel><text>${chapters[i]!.title}</text></navLabel>\n` +
        `<content src="./OEBPS/${id}.xhtml" />\n`;
      if (chapters[i]!.isVolume && !isNested) {
        isNested = !isNested;
      } else {
        navPoints += "</navPoint>\n";
      }
    }
    if (isNested) navPoints += "</navPoint>";

    entries.push({
      name: "toc.ncx",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head>\n    <meta name="dtb:uid" content="book-id" />\n    <meta name="dtb:depth" content="1" />\n    <meta name="dtb:totalPageCount" content="0" />\n    <meta name="dtb:maxPageNumber" content="0" />\n  </head>\n  <docTitle><text>${escapeXml(bookTitle)}</text></docTitle>\n  <docAuthor><text>${escapeXml(author)}</text></docAuthor>\n  <navMap>\n    ${navPoints}\n  </navMap>\n</ncx>`,
      ),
    });

    const css = `body { line-height: 1.6; font-size: 1em; font-family: 'Arial', sans-serif; text-align: justify; }\np { text-indent: 2em; margin: 0; }`;
    entries.push({ name: "style.css", data: encoder.encode(css) });

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i]!;
      entries.push({
        name: `OEBPS/chapter${i + 1}.xhtml`,
        data: encoder.encode(
          `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n<html xmlns="http://www.w3.org/1999/xhtml" lang="${language}" xml:lang="${language}">\n  <head>\n    <title>${chapter.title}</title>\n    <link rel="stylesheet" type="text/css" href="../style.css"/>\n  </head>\n  <body>${chapter.content}</body>\n</html>`,
        ),
      });
    }

    const manifest = chapters
      .map(
        (_, i) =>
          `<item id="chap${i + 1}" href="OEBPS/chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
      )
      .join("\n      ");
    const spine = chapters.map((_, i) => `<itemref idref="chap${i + 1}"/>`).join("\n      ");

    entries.push({
      name: "content.opf",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="2.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:title>${escapeXml(bookTitle)}</dc:title>\n    <dc:language>${language}</dc:language>\n    <dc:creator>${escapeXml(author)}</dc:creator>\n    <dc:identifier id="book-id">${identifier}</dc:identifier>\n  </metadata>\n  <manifest>\n      ${manifest}\n      <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n      <item id="css" href="style.css" media-type="text/css"/>\n  </manifest>\n  <spine toc="ncx">\n      ${spine}\n  </spine>\n</package>`,
      ),
    });

    return buildStoreOnlyZip(entries);
  }
}

// ── Minimal store-only ZIP builder (no external deps, no Blob) ────────

function buildStoreOnlyZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();

  // Pre-calculate total size
  let totalSize = 0;
  const nameBytes: Uint8Array[] = [];
  for (const entry of entries) {
    const nb = encoder.encode(entry.name);
    nameBytes.push(nb);
    totalSize += 30 + nb.length + entry.data.length; // Local file header + data
    totalSize += 46 + nb.length; // Central directory header
  }
  totalSize += 22; // End of central directory

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let offset = 0;
  const localOffsets: number[] = [];

  // Write local file headers + data
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const nb = nameBytes[i]!;
    const crc = crc32(entry.data);
    localOffsets.push(offset);

    // Local file header signature
    view.setUint32(offset, 0x04034b50, true);
    offset += 4;
    // Version needed
    view.setUint16(offset, 20, true);
    offset += 2;
    // General purpose bit flag
    view.setUint16(offset, 0, true);
    offset += 2;
    // Compression method: 0 = stored
    view.setUint16(offset, 0, true);
    offset += 2;
    // Last mod time / date (zero)
    view.setUint16(offset, 0, true);
    offset += 2;
    view.setUint16(offset, 0, true);
    offset += 2;
    // CRC-32
    view.setUint32(offset, crc, true);
    offset += 4;
    // Compressed size
    view.setUint32(offset, entry.data.length, true);
    offset += 4;
    // Uncompressed size
    view.setUint32(offset, entry.data.length, true);
    offset += 4;
    // File name length
    view.setUint16(offset, nb.length, true);
    offset += 2;
    // Extra field length
    view.setUint16(offset, 0, true);
    offset += 2;
    // File name
    buf.set(nb, offset);
    offset += nb.length;
    // File data
    buf.set(entry.data, offset);
    offset += entry.data.length;
  }

  // Write central directory
  const cdStart = offset;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const nb = nameBytes[i]!;
    const crc = crc32(entry.data);

    // Central directory header signature
    view.setUint32(offset, 0x02014b50, true);
    offset += 4;
    // Version made by
    view.setUint16(offset, 20, true);
    offset += 2;
    // Version needed
    view.setUint16(offset, 20, true);
    offset += 2;
    // General purpose bit flag
    view.setUint16(offset, 0, true);
    offset += 2;
    // Compression method: 0 = stored
    view.setUint16(offset, 0, true);
    offset += 2;
    // Last mod time / date (zero)
    view.setUint16(offset, 0, true);
    offset += 2;
    view.setUint16(offset, 0, true);
    offset += 2;
    // CRC-32
    view.setUint32(offset, crc, true);
    offset += 4;
    // Compressed size
    view.setUint32(offset, entry.data.length, true);
    offset += 4;
    // Uncompressed size
    view.setUint32(offset, entry.data.length, true);
    offset += 4;
    // File name length
    view.setUint16(offset, nb.length, true);
    offset += 2;
    // Extra field length
    view.setUint16(offset, 0, true);
    offset += 2;
    // File comment length
    view.setUint16(offset, 0, true);
    offset += 2;
    // Disk number start
    view.setUint16(offset, 0, true);
    offset += 2;
    // Internal file attributes
    view.setUint16(offset, 0, true);
    offset += 2;
    // External file attributes
    view.setUint32(offset, 0, true);
    offset += 4;
    // Relative offset of local header
    view.setUint32(offset, localOffsets[i]!, true);
    offset += 4;
    // File name
    buf.set(nb, offset);
    offset += nb.length;
  }

  const cdSize = offset - cdStart;

  // End of central directory
  view.setUint32(offset, 0x06054b50, true);
  offset += 4;
  // Disk number
  view.setUint16(offset, 0, true);
  offset += 2;
  // Disk where CD starts
  view.setUint16(offset, 0, true);
  offset += 2;
  // Number of CD records on this disk
  view.setUint16(offset, entries.length, true);
  offset += 2;
  // Total CD records
  view.setUint16(offset, entries.length, true);
  offset += 2;
  // Size of central directory
  view.setUint32(offset, cdSize, true);
  offset += 4;
  // Offset of CD start
  view.setUint32(offset, cdStart, true);
  offset += 4;
  // Comment length
  view.setUint16(offset, 0, true);
  offset += 2;

  return buf;
}

/** CRC-32 lookup table */
const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crc32Table[i] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
