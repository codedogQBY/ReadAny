/**
 * Book Extractor — extracts chapter text content from book files
 * Uses foliate-js DocumentLoader to parse the book, then extracts
 * plain text from each section's DOM Document.
 */
import { DocumentLoader } from "@/lib/reader/document-loader";
import type { TOCItem } from "@/lib/reader/document-loader";

export interface ChapterData {
  index: number;
  title: string;
  content: string;
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
      const text = doc.body?.textContent?.trim() ?? "";
      if (!text) continue;

      const title = tocMap.get(i) ?? tocMap.get(section.href ?? "") ?? `Section ${i + 1}`;

      chapters.push({ index: i, title, content: text });
    } catch (err) {
      console.warn(`[extractBookChapters] Failed to extract section ${i}:`, err);
    }
  }

  return chapters;
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
      chapters.push({
        index: start - 1,
        title: `Pages ${start}-${end}`,
        content: texts.join("\n\n"),
      });
    }
  }

  pdfDoc.destroy();
  return chapters;
}
