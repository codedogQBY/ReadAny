/**
 * Book Extractor — extracts chapter text content from book files
 * Uses foliate-js DocumentLoader to parse the book, then extracts
 * plain text from each section's DOM Document.
 *
 * Also generates EPUB CFI references for each text segment,
 * enabling precise navigation from RAG search results to book locations.
 */
import { DocumentLoader } from "@/lib/reader/document-loader";
import type { TOCItem } from "@/lib/reader/document-loader";
import * as CFI from "foliate-js/epubcfi.js";

/** A text segment with its corresponding CFI for precise navigation */
export interface TextSegment {
  text: string;
  cfi: string;
}

export interface ChapterData {
  index: number;
  title: string;
  content: string;
  /** Text segments with CFI references for precise location mapping */
  segments: TextSegment[];
}

/**
 * Extract all chapter text content from a book file.
 * Reads the file from disk, parses it via foliate-js, and iterates
 * over each section to extract plain text.
 */
export async function extractBookChapters(filePath: string): Promise<ChapterData[]> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const fileBytes = await readFile(filePath);
  const fileName = filePath.split("/").pop() || "book";
  const blob = new Blob([fileBytes]);
  const file = new File([blob], fileName, { type: blob.type || "application/octet-stream" });

  const loader = new DocumentLoader(file);
  const { book, format } = await loader.open();

  // For PDF, use pdfjs-dist to extract text per page
  if (format === "PDF") {
    return extractPdfChapters(fileBytes);
  }

  // For EPUB/MOBI/FB2/AZW/CBZ — use sections with createDocument
  const sections = book.sections ?? [];
  const toc = book.toc ?? [];
  const tocMap = buildTocMap(toc);

  const chapters: ChapterData[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section.createDocument) continue;

    try {
      const doc = await section.createDocument();
      const body = doc.body;
      if (!body) continue;

      const text = body.textContent?.trim() ?? "";
      if (!text) continue;

      const title = tocMap.get(i) ?? tocMap.get(section.href ?? "") ?? `Section ${i + 1}`;

      // Generate CFI-tagged text segments from DOM
      const baseCfi = section.cfi ?? CFI.fake.fromIndex(i);
      const segments = extractSegmentsWithCfi(doc, baseCfi);

      chapters.push({ index: i, title, content: text, segments });
    } catch (err) {
      console.warn(`[extractBookChapters] Failed to extract section ${i}:`, err);
    }
  }

  return chapters;
}

/**
 * Extract text segments from a DOM document with CFI references.
 *
 * Walks block-level elements (p, h1-h6, li, blockquote, etc.),
 * creates a Range for each block's text content, and generates a CFI
 * using epubcfi.js pure functions.
 */
function extractSegmentsWithCfi(doc: Document, baseCfi: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const body = doc.body;
  if (!body) return segments;

  // Block-level elements that typically contain readable text
  const blockSelector = "p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, figcaption, pre, td, th";
  const blocks = body.querySelectorAll(blockSelector);

  if (blocks.length === 0) {
    // Fallback: if no block elements found, use body text with section-level CFI
    const text = body.textContent?.trim();
    if (text) {
      segments.push({ text, cfi: baseCfi });
    }
    return segments;
  }

  for (const block of blocks) {
    const text = block.textContent?.trim();
    if (!text || text.length < 2) continue;

    try {
      // Create a Range covering the entire block element's content
      const range = doc.createRange();
      range.selectNodeContents(block);

      // Generate CFI from the range: joinIndir(sectionCfi, fromRange(range))
      const rangeCfi = CFI.fromRange(range);
      const fullCfi = CFI.joinIndir(baseCfi, rangeCfi);

      segments.push({ text, cfi: fullCfi });
    } catch {
      // If CFI generation fails for this block, include text with section-level CFI
      segments.push({ text, cfi: baseCfi });
    }
  }

  return segments;
}

/** Build a map from section index/href to TOC label */
function buildTocMap(toc: TOCItem[]): Map<string | number, string> {
  const map = new Map<string | number, string>();

  function walk(items: TOCItem[]) {
    for (const item of items) {
      if (item.label) {
        map.set(item.index, item.label);
        if (item.href) {
          // Strip fragment from href for matching
          const base = item.href.split("#")[0];
          map.set(base, item.label);
          map.set(item.href, item.label);
        }
      }
      if (item.subitems?.length) {
        walk(item.subitems);
      }
    }
  }

  walk(toc);
  return map;
}

/** Extract text from PDF pages using pdfjs-dist */
async function extractPdfChapters(fileBytes: Uint8Array): Promise<ChapterData[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const pdfDoc = await pdfjsLib.getDocument({
    data: new Uint8Array(fileBytes),
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  const chapters: ChapterData[] = [];
  const numPages = pdfDoc.numPages;

  // Group pages into chapters of ~10 pages each to avoid too many tiny chunks
  const pagesPerChapter = Math.max(1, Math.min(10, Math.ceil(numPages / 20)));

  for (let start = 1; start <= numPages; start += pagesPerChapter) {
    const end = Math.min(start + pagesPerChapter - 1, numPages);
    const texts: string[] = [];

    for (let p = start; p <= end; p++) {
      try {
        const page = await pdfDoc.getPage(p);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str ?? "")
          .join(" ");
        if (pageText.trim()) texts.push(pageText.trim());
      } catch {
        // skip unreadable pages
      }
    }

    if (texts.length > 0) {
      // PDF doesn't have real EPUB CFI, use empty segments
      chapters.push({
        index: start - 1,
        title: `Pages ${start}-${end}`,
        content: texts.join("\n\n"),
        segments: [],
      });
    }
  }

  pdfDoc.destroy();
  return chapters;
}
