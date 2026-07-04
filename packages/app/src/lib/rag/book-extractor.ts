/**
 * Book Extractor — extracts chapter text content from book files
 * Uses foliate-js DocumentLoader to parse the book, then extracts
 * text segments with EPUB CFI references for precise navigation.
 */
import { DocumentLoader } from "@/lib/reader/document-loader";
import { buildChapterSectionGroups } from "@readany/core/rag";
import type { ChapterSectionGroup, TocTreeItemLike } from "@readany/core/rag";
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
  let chapterGroups = buildChapterSectionGroups(sections, toc);
  if (format === "EPUB" && hasOnlyGenericSectionTitles(chapterGroups)) {
    const directToc = await extractEpubTocFromFile(file);
    if (directToc.length > 0) {
      const directGroups = buildChapterSectionGroups(sections, directToc);
      if (!hasOnlyGenericSectionTitles(directGroups)) {
        console.log("[extractBookChapters] Using EPUB TOC fallback", {
          tocItems: directToc.length,
          groups: directGroups.length,
          sampleTitles: directGroups.slice(0, 5).map((group) => group.title),
        });
        chapterGroups = directGroups;
      }
    }
  }

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

function hasOnlyGenericSectionTitles(groups: ChapterSectionGroup[]): boolean {
  return groups.length > 0 && groups.every((group) => /^Section\s+\d+$/i.test(group.title));
}

async function extractEpubTocFromFile(file: File): Promise<TocTreeItemLike[]> {
  const { configure, ZipReader, BlobReader, TextWriter } = await import("@zip.js/zip.js");
  configure({ useWebWorkers: false });

  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    const entryMap = new Map(entries.map((entry) => [entry.filename, entry]));

    const readTextEntry = async (entryPath: string): Promise<string | null> => {
      let entry = entryMap.get(entryPath);
      if (!entry) {
        const lowerPath = entryPath.toLowerCase();
        entry = entries.find((candidate) => candidate.filename.toLowerCase() === lowerPath);
      }
      if (!entry || entry.directory || !entry.getData) return null;
      return entry.getData(new TextWriter());
    };

    const containerXml = await readTextEntry("META-INF/container.xml");
    if (!containerXml) return [];

    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, "application/xml");
    const opfPath =
      Array.from(containerDoc.getElementsByTagName("*")).find(
        (element) => element.localName === "rootfile",
      )?.getAttribute("full-path") || "content.opf";
    const opfXml = await readTextEntry(opfPath);
    if (!opfXml) return [];

    const opfDoc = parser.parseFromString(opfXml, "application/xml");
    const tocPath = getTocPathFromOpf(opfDoc, opfPath);
    if (!tocPath) return [];

    const tocXml = await readTextEntry(tocPath);
    if (!tocXml) return [];

    const tocDoc = parser.parseFromString(tocXml, "application/xml");
    if (tocPath.toLowerCase().endsWith(".ncx")) {
      return parseNcxToc(tocDoc);
    }
    return parseNavToc(tocDoc);
  } catch (error) {
    console.warn("[extractBookChapters] Failed to read EPUB TOC directly:", error);
    return [];
  } finally {
    await reader.close();
  }
}

function getTocPathFromOpf(opfDoc: Document, opfPath: string): string | null {
  const opfDir = getDirname(opfPath);
  const elements = Array.from(opfDoc.getElementsByTagName("*"));
  const spine = elements.find((element) => element.localName === "spine");
  const tocId = spine?.getAttribute("toc") || "";
  const manifestItems = elements.filter((element) => element.localName === "item");
  const ncxItem =
    manifestItems.find((item) => item.getAttribute("id") === tocId) ||
    manifestItems.find((item) => item.getAttribute("media-type") === "application/x-dtbncx+xml");
  const navItem = manifestItems.find((item) =>
    (item.getAttribute("properties") || "").split(/\s+/).includes("nav"),
  );
  const href = ncxItem?.getAttribute("href") || navItem?.getAttribute("href");
  return href ? joinEpubPath(opfDir, href) : null;
}

function parseNcxToc(doc: Document): TocTreeItemLike[] {
  const navMap = Array.from(doc.getElementsByTagName("*")).find(
    (element) => element.localName === "navMap",
  );
  if (!navMap) return [];

  return childElementsByLocalName(navMap, "navPoint")
    .map(parseNcxNavPoint)
    .filter((item): item is TocTreeItemLike => item !== null);
}

function parseNcxNavPoint(element: Element): TocTreeItemLike | null {
  const labelElement = childElementsByLocalName(element, "navLabel")[0];
  const label = labelElement?.textContent?.replace(/\s+/g, " ").trim() || "";
  const href = childElementsByLocalName(element, "content")[0]?.getAttribute("src") || "";
  if (!label && !href) return null;

  const subitems = childElementsByLocalName(element, "navPoint")
    .map(parseNcxNavPoint)
    .filter((item): item is TocTreeItemLike => item !== null);
  return { label, href, subitems };
}

function parseNavToc(doc: Document): TocTreeItemLike[] {
  const navElements = Array.from(doc.getElementsByTagName("*")).filter(
    (element) => element.localName === "nav",
  );
  const tocNav =
    navElements.find((element) => /\btoc\b/i.test(element.getAttribute("epub:type") || "")) ||
    navElements[0];
  if (!tocNav) return [];

  const rootList = Array.from(tocNav.getElementsByTagName("*")).find(
    (element) => element.localName === "ol",
  );
  if (!rootList) return [];

  return childElementsByLocalName(rootList, "li")
    .map(parseNavListItem)
    .filter((item): item is TocTreeItemLike => item !== null);
}

function parseNavListItem(element: Element): TocTreeItemLike | null {
  const link = childElements(element).find(
    (child) => child.localName === "a" || child.localName === "span",
  );
  const label = link?.textContent?.replace(/\s+/g, " ").trim() || "";
  const href = link?.localName === "a" ? link.getAttribute("href") || "" : "";
  const childList = childElements(element).find((child) => child.localName === "ol");
  const subitems = childList
    ? childElementsByLocalName(childList, "li")
        .map(parseNavListItem)
        .filter((item): item is TocTreeItemLike => item !== null)
    : [];
  if (!label && !href && subitems.length === 0) return null;
  return { label, href, subitems };
}

function childElementsByLocalName(element: Element, localName: string): Element[] {
  return childElements(element).filter((child) => child.localName === localName);
}

function childElements(element: Element): Element[] {
  return Array.from(element.children);
}

function getDirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function joinEpubPath(baseDir: string, relativePath: string): string {
  const parts = `${baseDir}/${relativePath}`.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join("/");
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
