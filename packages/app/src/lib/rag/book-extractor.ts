/**
 * Book Extractor — extracts chapter text content from book files
 * Uses foliate-js DocumentLoader to parse the book, then extracts
 * text segments with EPUB CFI references for precise navigation.
 */
import { DocumentLoader } from "@/lib/reader/document-loader";
import { buildChapterSectionGroups } from "@readany/core/rag";
import * as CFI from "foliate-js/epubcfi.js";

export interface TextSegment {
  text: string;
  cfi: string;
}

export interface ChapterData {
  index: number;
  title: string;
  content: string;
  segments: TextSegment[];
}

export async function extractBookChapters(filePath: string): Promise<ChapterData[]> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const fileBytes = await readFile(filePath);
  const fileName = filePath.split("/").pop() || "book";
  const blob = new Blob([fileBytes]);
  const file = new File([blob], fileName, { type: blob.type || "application/octet-stream" });

  const loader = new DocumentLoader(file);
  const { book, format } = await loader.open();

  if (format === "PDF") {
    return extractPdfChapters(fileBytes);
  }

  const sections = book.sections ?? [];
  const toc = book.toc ?? [];
  const chapterGroups = buildChapterSectionGroups(sections, toc);

  const chapters: ChapterData[] = [];

  for (const group of chapterGroups) {
    const chapterSegments: TextSegment[] = [];

    for (const sectionIndex of group.sectionIndices) {
      const section = sections[sectionIndex];
      if (!section?.createDocument) continue;

      try {
        const doc = await section.createDocument();
        const body = doc.body;
        if (!body) continue;

        const baseCfi = section.cfi || CFI.fake.fromIndex(sectionIndex);
        chapterSegments.push(...extractSegmentsWithCfi(doc, baseCfi));
      } catch (err) {
        console.warn(`[extractBookChapters] Failed to extract section ${sectionIndex}:`, err);
      }
    }

    if (chapterSegments.length === 0) continue;

    const content = chapterSegments.map((s) => s.text).join("\n\n");

    chapters.push({ index: group.index, title: group.title, content, segments: chapterSegments });
  }

  return chapters;
}

/**
 * Extract text segments from a DOM document with CFI references.
 *
 * Walks all text nodes in document order, grouping consecutive text
 * within the same parent element to create meaningful segments.
 */
function extractSegmentsWithCfi(doc: Document, baseCfi: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const body = doc.body;
  if (!body) return segments;

  const blockSelector =
    "p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, figcaption, pre, td, th";
  const blocks = body.querySelectorAll(blockSelector);

  if (blocks.length === 0) {
    const text = body.textContent?.trim();
    if (text) {
      segments.push({ text, cfi: baseCfi });
    }
    return segments;
  }

  for (const block of blocks) {
    const text = extractBlockText(block);
    if (!text || text.length < 2) continue;

    try {
      const textNodes = getTextNodes(block);
      if (textNodes.length === 0) {
        segments.push({ text, cfi: baseCfi });
        continue;
      }

      const range = doc.createRange();
      const firstNode = textNodes[0];
      const lastNode = textNodes[textNodes.length - 1];

      range.setStart(firstNode, 0);
      range.setEnd(lastNode, lastNode.length);

      const rangeCfi = CFI.fromRange(range);
      const fullCfi = CFI.joinIndir(baseCfi, rangeCfi);
      segments.push({ text, cfi: fullCfi });
    } catch (e) {
      console.warn(
        "[extractSegmentsWithCfi] Failed to create CFI for block:",
        text.slice(0, 50),
        e,
      );
      segments.push({ text, cfi: baseCfi });
    }
  }

  return segments;
}

function getTextNodes(element: Element): Text[] {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);

  const nodes: Text[] = [];
  while (true) {
    const node = walker.nextNode() as Text | null;
    if (!node) break;
    if (node.textContent?.trim()) {
      nodes.push(node);
    }
  }

  return nodes;
}

function extractBlockText(block: Element): string {
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);

  const texts: string[] = [];
  while (true) {
    const node = walker.nextNode() as Text | null;
    if (!node) break;
    const text = node.textContent?.trim();
    if (text) {
      texts.push(text);
    }
  }

  return texts.join(" ");
}

async function extractPdfChapters(fileBytes: Uint8Array): Promise<ChapterData[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const pdfDoc = await pdfjsLib.getDocument({
    data: new Uint8Array(fileBytes),
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  const chapters: ChapterData[] = [];
  const numPages = pdfDoc.numPages;
  const pagesPerChapter = Math.max(1, Math.min(10, Math.ceil(numPages / 20)));

  for (let start = 1; start <= numPages; start += pagesPerChapter) {
    const end = Math.min(start + pagesPerChapter - 1, numPages);
    const segments: TextSegment[] = [];

    for (let p = start; p <= end; p++) {
      try {
        const page = await pdfDoc.getPage(p);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str ?? "").join(" ");
        if (pageText.trim()) {
          segments.push({
            text: pageText.trim(),
            cfi: `page:${p}`,
          });
        }
      } catch {
        // skip unreadable pages
      }
    }

    if (segments.length > 0) {
      chapters.push({
        index: start - 1,
        title: `Pages ${start}-${end}`,
        content: segments.map((s) => s.text).join("\n\n"),
        segments,
      });
    }
  }

  pdfDoc.destroy();
  return chapters;
}
