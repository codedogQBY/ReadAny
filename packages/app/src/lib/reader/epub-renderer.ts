/**
 * EPUB Renderer — implements DocumentRenderer using foliate-js
 *
 * foliate-js provides a web-component <foliate-view> that handles:
 * - EPUB parsing and rendering
 * - Paginated and scrolled layouts
 * - CFI-based navigation
 * - Annotation overlay via Overlayer
 *
 * Since foliate-js may not be available as an npm package, we implement
 * a robust EPUB renderer using the EPUB spec directly with iframes.
 * This serves as a fully functional implementation that doesn't require
 * external native EPUB libraries.
 */
import type {
  AnnotationMark,
  DocumentRenderer,
  Location,
  RendererEvents,
  Selection,
  TOCItem,
} from "./document-renderer";

type EventCallback = (...args: unknown[]) => void;

interface EPUBSpineItem {
  href: string;
  id: string;
  index: number;
  title?: string;
}

interface EPUBMetadata {
  title: string;
  author: string;
  language: string;
  description?: string;
  publisher?: string;
}

export class EPUBRenderer implements DocumentRenderer {
  private container: HTMLElement | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private zip: Map<string, Blob> = new Map();
  private spine: EPUBSpineItem[] = [];
  private toc: TOCItem[] = [];
  private metadata: EPUBMetadata | null = null;
  private currentSpineIndex = 0;
  private progress = 0;
  private annotations: Map<string, AnnotationMark> = new Map();
  private eventListeners: Map<string, Set<EventCallback>> = new Map();
  private contentBasePath = "";
  private viewMode: "paginated" | "scroll" = "paginated";
  private fontSize = 16;
  private lineHeight = 1.6;
  private theme: "light" | "dark" | "sepia" = "light";

  // Pagination state — tracks column offset within a chapter
  private totalColumns = 1;
  private columnPageIndex = 0; // current page within chapter

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;

    // Create iframe for isolated EPUB rendering
    this.iframe = document.createElement("iframe");
    this.iframe.style.width = "100%";
    this.iframe.style.height = "100%";
    this.iframe.style.border = "none";
    this.iframe.style.backgroundColor = "transparent";
    this.iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
    container.appendChild(this.iframe);

    // Listen for selection events from iframe
    this.iframe.addEventListener("load", () => {
      this.setupIframeEvents();
    });
  }

  private setupIframeEvents(): void {
    const iframeDoc = this.iframe?.contentDocument;
    if (!iframeDoc) return;

    iframeDoc.addEventListener("mouseup", () => {
      this.handleSelection();
    });

    iframeDoc.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        this.next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        this.prev();
      }
    });

    // Wheel event for page turning in paginated mode
    iframeDoc.addEventListener("wheel", (e: WheelEvent) => {
      if (this.viewMode === "paginated") {
        e.preventDefault();
        if (e.deltaY > 0 || e.deltaX > 0) {
          this.next();
        } else if (e.deltaY < 0 || e.deltaX < 0) {
          this.prev();
        }
      }
    }, { passive: false });

    // Click to turn pages — left 37.5% prev, right 37.5% next, center no-op
    iframeDoc.addEventListener("click", (e: MouseEvent) => {
      if (this.viewMode !== "paginated") return;
      // Ignore clicks on links
      const target = e.target as HTMLElement;
      if (target.closest("a")) return;
      // Ignore if user is selecting text
      const sel = iframeDoc.getSelection();
      if (sel && !sel.isCollapsed) return;

      const rect = this.iframe?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX;
      const width = rect.width;
      const ratio = x / width;

      if (ratio < 0.375) {
        this.prev();
      } else if (ratio > 0.625) {
        this.next();
      }
    });
  }

  async open(file: File | Blob, initialLocation?: Location): Promise<void> {
    // Parse EPUB (ZIP) file
    await this.parseEPUB(file);

    // Emit TOC
    this.emit("toc-ready", this.toc);

    // Navigate to initial location or first chapter
    if (initialLocation?.chapterIndex !== undefined) {
      await this.goToIndex(initialLocation.chapterIndex);
    } else {
      await this.goToIndex(0);
    }
  }

  private async parseEPUB(file: File | Blob): Promise<void> {
    // Use JSZip-style parsing via the browser's native capabilities
    const { entries } = await this.unzip(file);
    this.zip = entries;

    // Parse container.xml to find the OPF file
    const containerXml = await this.readTextEntry("META-INF/container.xml");
    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, "application/xml");
    const rootfileEl = containerDoc.querySelector("rootfile");
    const opfPath = rootfileEl?.getAttribute("full-path") || "content.opf";

    // Determine base path for relative URLs
    this.contentBasePath = opfPath.includes("/")
      ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1)
      : "";

    // Parse OPF
    const opfXml = await this.readTextEntry(opfPath);
    const opfDoc = parser.parseFromString(opfXml, "application/xml");

    // Extract metadata
    this.metadata = this.parseMetadata(opfDoc);

    // Extract manifest (id -> href mapping)
    const manifest = new Map<string, string>();
    for (const item of Array.from(opfDoc.querySelectorAll("manifest > item"))) {
      const id = item.getAttribute("id") || "";
      const href = item.getAttribute("href") || "";
      manifest.set(id, href);
    }

    // Extract spine (reading order)
    this.spine = [];
    const spineEl = opfDoc.querySelector("spine");
    if (spineEl) {
      let index = 0;
      for (const itemref of Array.from(spineEl.querySelectorAll("itemref"))) {
        const idref = itemref.getAttribute("idref") || "";
        const href = manifest.get(idref) || "";
        this.spine.push({
          href: this.contentBasePath + href,
          id: idref,
          index,
        });
        index++;
      }
    }

    // Parse NCX or nav for TOC
    this.toc = await this.parseTOC(opfDoc, manifest);
  }

  private parseMetadata(opfDoc: Document): EPUBMetadata {
    const ns = "http://purl.org/dc/elements/1.1/";
    const getText = (tag: string) => opfDoc.getElementsByTagNameNS(ns, tag)[0]?.textContent || "";

    return {
      title: getText("title") || "Untitled",
      author: getText("creator") || "Unknown Author",
      language: getText("language") || "en",
      description: getText("description") || undefined,
      publisher: getText("publisher") || undefined,
    };
  }

  private async parseTOC(opfDoc: Document, manifest: Map<string, string>): Promise<TOCItem[]> {
    // Try to find nav document first (EPUB 3)
    const navItem = opfDoc.querySelector('manifest > item[properties~="nav"]');
    if (navItem) {
      const navHref = this.contentBasePath + (navItem.getAttribute("href") || "");
      try {
        const navHtml = await this.readTextEntry(navHref);
        return this.parseNavTOC(navHtml);
      } catch {
        // Fall through to NCX
      }
    }

    // Try NCX (EPUB 2)
    const ncxId = opfDoc.querySelector("spine")?.getAttribute("toc") || "ncx";
    const ncxHref = manifest.get(ncxId);
    if (ncxHref) {
      try {
        const ncxXml = await this.readTextEntry(this.contentBasePath + ncxHref);
        return this.parseNCXTOC(ncxXml);
      } catch {
        // No TOC available
      }
    }

    // Fallback: generate TOC from spine
    return this.spine.map((item, i) => ({
      id: item.id,
      title: item.title || `Chapter ${i + 1}`,
      level: 0,
      index: i,
    }));
  }

  private parseNavTOC(html: string): TOCItem[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "application/xhtml+xml");
    const nav = doc.querySelector('nav[epub\\:type="toc"], nav[role="doc-toc"], nav');
    if (!nav) return [];

    const parseLi = (li: Element, level: number): TOCItem | null => {
      const a = li.querySelector(":scope > a");
      if (!a) return null;

      const item: TOCItem = {
        id: `toc-${level}-${a.getAttribute("href") || ""}`,
        title: a.textContent?.trim() || "",
        level,
        href: a.getAttribute("href") || undefined,
      };

      // Look for nested ol
      const nestedOl = li.querySelector(":scope > ol");
      if (nestedOl) {
        item.subitems = [];
        for (const childLi of Array.from(nestedOl.querySelectorAll(":scope > li"))) {
          const sub = parseLi(childLi, level + 1);
          if (sub) item.subitems.push(sub);
        }
      }

      return item;
    };

    const items: TOCItem[] = [];
    const ol = nav.querySelector("ol");
    if (ol) {
      for (const li of Array.from(ol.querySelectorAll(":scope > li"))) {
        const item = parseLi(li, 0);
        if (item) items.push(item);
      }
    }

    return this.flattenTOC(items);
  }

  private parseNCXTOC(xml: string): TOCItem[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");

    const parseNavPoint = (navPoint: Element, level: number): TOCItem => {
      const label = navPoint.querySelector("navLabel > text")?.textContent?.trim() || "";
      const content = navPoint.querySelector("content");
      const src = content?.getAttribute("src") || "";

      const item: TOCItem = {
        id: navPoint.getAttribute("id") || `ncx-${level}-${src}`,
        title: label,
        level,
        href: src,
      };

      const children = navPoint.querySelectorAll(":scope > navPoint");
      if (children.length > 0) {
        item.subitems = Array.from(children).map((child) => parseNavPoint(child, level + 1));
      }

      return item;
    };

    const navMap = doc.querySelector("navMap");
    if (!navMap) return [];

    const items = Array.from(navMap.querySelectorAll(":scope > navPoint")).map((np) =>
      parseNavPoint(np, 0),
    );

    return this.flattenTOC(items);
  }

  private flattenTOC(items: TOCItem[]): TOCItem[] {
    const flat: TOCItem[] = [];
    const walk = (list: TOCItem[]) => {
      for (const item of list) {
        flat.push(item);
        if (item.subitems) walk(item.subitems);
      }
    };
    walk(items);
    return flat;
  }

  private async renderSpineItem(index: number, goToEnd = false): Promise<void> {
    if (!this.iframe || index < 0 || index >= this.spine.length) return;

    this.currentSpineIndex = index;
    this.columnPageIndex = 0;
    const item = this.spine[index];

    // Read the HTML content
    const html = await this.readTextEntry(item.href);

    // Get the iframe document
    const iframeDoc = this.iframe.contentDocument;
    if (!iframeDoc) return;

    // Build a complete HTML document with styles
    const styledHtml = this.wrapContentWithStyles(html);
    iframeDoc.open();
    iframeDoc.write(styledHtml);
    iframeDoc.close();

    // Re-attach events since the iframe document was replaced
    this.setupIframeEvents();

    // Resolve relative resource URLs (images, CSS)
    await this.resolveResources(iframeDoc, item.href);

    // Apply annotations
    this.renderAnnotationsInIframe(iframeDoc);

    // Wait for content to layout, then calculate columns
    await new Promise((resolve) => requestAnimationFrame(resolve));
    this.recalcColumns();

    // If navigating backwards, go to last page of this chapter
    if (goToEnd && this.totalColumns > 1) {
      this.columnPageIndex = this.totalColumns - 1;
      iframeDoc.body.scrollLeft = this.columnPageIndex * iframeDoc.body.clientWidth;
    }

    // Find chapter title from TOC
    const chapterTitle = this.getChapterTitle(index);

    // Emit events
    this.emit("load", { chapterIndex: index, chapterTitle });
    this.emitProgressUpdate();
  }

  private wrapContentWithStyles(html: string): string {
    const themeStyles = this.getThemeStyles();

    // If the content is a full HTML document, inject styles
    if (html.includes("<html") || html.includes("<HTML")) {
      // Inject our styles into the existing head
      const styleTag = `<style id="readany-styles">${themeStyles}</style>`;
      if (html.includes("</head>")) {
        return html.replace("</head>", `${styleTag}</head>`);
      }
      if (html.includes("<body") || html.includes("<BODY")) {
        return html.replace(/<body/i, `<head>${styleTag}</head><body`);
      }
    }

    // If it's a fragment, wrap it in a full document
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${themeStyles}</style>
</head>
<body>${html}</body>
</html>`;
  }

  private getThemeStyles(): string {
    const themes: Record<string, { bg: string; fg: string; link: string }> = {
      light: { bg: "#ffffff", fg: "#1a1a1a", link: "#2563eb" },
      dark: { bg: "#1a1a1a", fg: "#e5e5e5", link: "#60a5fa" },
      sepia: { bg: "#f4ecd8", fg: "#5b4636", link: "#8b6914" },
    };

    const t = themes[this.theme] || themes.light;

    return `
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        background: ${t.bg};
        color: ${t.fg};
        font-size: ${this.fontSize}px;
        line-height: ${this.lineHeight};
        font-family: var(--font-serif, Georgia, "Times New Roman", serif);
        overflow-wrap: break-word;
        word-wrap: break-word;
        -webkit-user-select: text;
        user-select: text;
      }
      body {
        padding: 2em 3em;
        max-width: 45em;
        margin: 0 auto;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      a { color: ${t.link}; }
      .readany-highlight {
        border-radius: 2px;
        padding: 0 1px;
        cursor: pointer;
      }
      ::selection {
        background: rgba(59, 130, 246, 0.3);
      }
      ${
        this.viewMode === "paginated"
          ? `
        html {
          height: 100vh;
          overflow: hidden;
        }
        body {
          height: 100vh;
          column-width: calc(100vw - 6em);
          column-gap: 6em;
          overflow: hidden;
          padding: 2em 3em;
          max-width: none;
        }
      `
          : ""
      }
    `;
  }

  private async resolveResources(doc: Document, spineHref: string): Promise<void> {
    const basePath = spineHref.includes("/")
      ? spineHref.substring(0, spineHref.lastIndexOf("/") + 1)
      : "";

    // Resolve images
    const images = doc.querySelectorAll("img[src]");
    for (const img of Array.from(images)) {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:") || src.startsWith("http")) continue;

      const fullPath = this.resolveRelativePath(basePath, src);
      const blob = this.zip.get(fullPath);
      if (blob) {
        const url = URL.createObjectURL(blob);
        img.setAttribute("src", url);
      }
    }

    // Resolve CSS links
    const links = doc.querySelectorAll('link[rel="stylesheet"]');
    for (const link of Array.from(links)) {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("http")) continue;

      const fullPath = this.resolveRelativePath(basePath, href);
      const blob = this.zip.get(fullPath);
      if (blob) {
        const cssText = await blob.text();
        const style = doc.createElement("style");
        style.textContent = cssText;
        link.replaceWith(style);
      }
    }
  }

  private resolveRelativePath(base: string, relative: string): string {
    if (relative.startsWith("/")) {
      return relative.substring(1);
    }

    const parts = (base + relative).split("/");
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === "..") {
        resolved.pop();
      } else if (part !== ".") {
        resolved.push(part);
      }
    }
    return resolved.join("/");
  }

  private getChapterTitle(spineIndex: number): string {
    // Try to find a matching TOC item
    const spineItem = this.spine[spineIndex];
    if (!spineItem) return `Chapter ${spineIndex + 1}`;

    for (const tocItem of this.toc) {
      if (tocItem.href && spineItem.href.endsWith(tocItem.href)) {
        return tocItem.title;
      }
      if (tocItem.index === spineIndex) {
        return tocItem.title;
      }
    }
    return spineItem.title || `Chapter ${spineIndex + 1}`;
  }

  private handleSelection(): void {
    const iframeDoc = this.iframe?.contentDocument;
    if (!iframeDoc) return;

    const sel = iframeDoc.getSelection();
    if (!sel || sel.isCollapsed) {
      this.emit("selection", null);
      return;
    }

    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (!text) {
      this.emit("selection", null);
      return;
    }

    const rects = Array.from(range.getClientRects());

    // Offset rects by container position for accurate positioning
    const containerRect = this.container?.getBoundingClientRect();
    const offsetRects = containerRect
      ? rects.map(
          (r) =>
            new DOMRect(
              r.x + (containerRect.x || 0),
              r.y + (containerRect.y || 0),
              r.width,
              r.height,
            ),
        )
      : rects;

    const selection: Selection = {
      text,
      start: {
        type: "cfi",
        chapterIndex: this.currentSpineIndex,
      },
      end: {
        type: "cfi",
        chapterIndex: this.currentSpineIndex,
      },
      rects: offsetRects,
    };

    this.emit("selection", selection);
  }

  private renderAnnotationsInIframe(doc: Document): void {
    // Remove existing highlights
    const existing = doc.querySelectorAll(".readany-highlight");
    for (const el of Array.from(existing)) {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(doc.createTextNode(el.textContent || ""), el);
        parent.normalize();
      }
    }

    // Re-apply annotations for this chapter
    for (const [, annotation] of this.annotations) {
      if (annotation.location.chapterIndex !== this.currentSpineIndex) continue;

      // Simple text-based highlighting: find and wrap matching text
      if (annotation.text) {
        this.highlightText(doc, annotation.text, annotation.color, annotation.id);
      }
    }
  }

  private highlightText(doc: Document, text: string, color: string, id: string): void {
    const body = doc.body;
    if (!body) return;

    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      nodes.push(node);
    }

    // Search for the text across text nodes
    const fullText = nodes.map((n) => n.textContent).join("");
    const startIdx = fullText.indexOf(text);
    if (startIdx === -1) return;

    // Find which node(s) contain the match
    let currentIdx = 0;
    for (const textNode of nodes) {
      const nodeLen = textNode.textContent?.length || 0;
      const nodeEnd = currentIdx + nodeLen;

      if (nodeEnd > startIdx && currentIdx < startIdx + text.length) {
        // This node overlaps with our highlight range
        const highlightStart = Math.max(0, startIdx - currentIdx);
        const highlightEnd = Math.min(nodeLen, startIdx + text.length - currentIdx);

        const range = doc.createRange();
        range.setStart(textNode, highlightStart);
        range.setEnd(textNode, highlightEnd);

        const span = doc.createElement("span");
        span.className = "readany-highlight";
        span.setAttribute("data-annotation-id", id);
        span.style.backgroundColor = color;
        range.surroundContents(span);
        break; // Simple: highlight first occurrence only
      }

      currentIdx = nodeEnd;
    }
  }

  // --- ZIP parsing ---

  private async unzip(file: File | Blob): Promise<{ entries: Map<string, Blob> }> {
    // Use the native CompressionStream API or fallback
    // For EPUB (which is ZIP), we parse using ArrayBuffer
    const buffer = await file.arrayBuffer();
    const entries = new Map<string, Blob>();

    const view = new DataView(buffer);
    let offset = 0;

    while (offset < buffer.byteLength - 4) {
      const signature = view.getUint32(offset, true);

      if (signature === 0x04034b50) {
        // Local file header
        const compressedSize = view.getUint32(offset + 18, true);
        const uncompressedSize = view.getUint32(offset + 22, true);
        const nameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        const compressionMethod = view.getUint16(offset + 8, true);

        const nameBytes = new Uint8Array(buffer, offset + 30, nameLength);
        const name = new TextDecoder().decode(nameBytes);

        const dataStart = offset + 30 + nameLength + extraLength;
        const rawData = new Uint8Array(buffer, dataStart, compressedSize);

        if (compressionMethod === 0) {
          // Stored (no compression)
          entries.set(name, new Blob([rawData]));
        } else if (compressionMethod === 8) {
          // Deflated
          try {
            const decompressed = await this.inflate(rawData, uncompressedSize);
            entries.set(name, new Blob([decompressed]));
          } catch {
            // Skip entries that fail to decompress
          }
        }

        offset = dataStart + compressedSize;
      } else if (
        signature === 0x02014b50 || // Central directory
        signature === 0x06054b50 // End of central directory
      ) {
        break;
      } else {
        offset++;
      }
    }

    return { entries };
  }

  private async inflate(data: Uint8Array, _expectedSize: number): Promise<Uint8Array> {
    // Use DecompressionStream (modern browsers)
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    writer.write(data);
    writer.close();

    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    // biome-ignore lint: reading stream until done
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }

    const result = new Uint8Array(totalLength);
    let pos = 0;
    for (const chunk of chunks) {
      result.set(chunk, pos);
      pos += chunk.length;
    }

    return result;
  }

  private async readTextEntry(path: string): Promise<string> {
    const blob = this.zip.get(path);
    if (!blob) {
      // Try without leading slash
      const altPath = path.startsWith("/") ? path.substring(1) : path;
      const altBlob = this.zip.get(altPath);
      if (!altBlob) {
        throw new Error(`Entry not found in EPUB: ${path}`);
      }
      return altBlob.text();
    }
    return blob.text();
  }

  // --- DocumentRenderer interface ---

  async goTo(location: Location): Promise<void> {
    if (location.chapterIndex !== undefined) {
      await this.renderSpineItem(location.chapterIndex);
    }
  }

  async goToIndex(index: number): Promise<void> {
    await this.renderSpineItem(index);
  }

  async next(): Promise<void> {
    if (this.viewMode === "paginated") {
      // Try to go to next column page within current chapter
      if (this.scrollToColumn(this.columnPageIndex + 1)) {
        return;
      }
      // Reached end of chapter — go to next spine item
      if (this.currentSpineIndex < this.spine.length - 1) {
        await this.renderSpineItem(this.currentSpineIndex + 1);
      }
    } else {
      // Scroll mode — just go to next chapter
      if (this.currentSpineIndex < this.spine.length - 1) {
        await this.renderSpineItem(this.currentSpineIndex + 1);
      }
    }
  }

  async prev(): Promise<void> {
    if (this.viewMode === "paginated") {
      // Try to go to previous column page within current chapter
      if (this.scrollToColumn(this.columnPageIndex - 1)) {
        return;
      }
      // Reached start of chapter — go to previous spine item (last page)
      if (this.currentSpineIndex > 0) {
        await this.renderSpineItem(this.currentSpineIndex - 1, true);
      }
    } else {
      if (this.currentSpineIndex > 0) {
        await this.renderSpineItem(this.currentSpineIndex - 1);
      }
    }
  }

  /**
   * Scroll to a specific column page. Returns true if successful, false if out of bounds.
   */
  private scrollToColumn(pageIndex: number): boolean {
    const iframeDoc = this.iframe?.contentDocument;
    if (!iframeDoc || this.viewMode !== "paginated") return false;

    this.recalcColumns();

    if (pageIndex < 0 || pageIndex >= this.totalColumns) {
      return false;
    }

    this.columnPageIndex = pageIndex;
    const body = iframeDoc.body;
    const viewWidth = body.clientWidth;

    if (this.totalColumns <= 1) {
      body.scrollLeft = 0;
    } else {
      // Each page is viewWidth wide (column-width: 100vw + column-gap)
      body.scrollLeft = pageIndex * viewWidth;
    }

    this.emitProgressUpdate();
    return true;
  }

  /**
   * Recalculate the total number of column pages in the current chapter.
   */
  private recalcColumns(): void {
    const iframeDoc = this.iframe?.contentDocument;
    if (!iframeDoc) return;
    const body = iframeDoc.body;
    const scrollWidth = body.scrollWidth;
    const viewWidth = body.clientWidth;
    this.totalColumns = viewWidth > 0 ? Math.max(1, Math.ceil(scrollWidth / viewWidth)) : 1;
  }

  private emitProgressUpdate(): void {
    // Progress = (chapters before + fraction of current chapter)
    const chapterFraction = this.totalColumns > 1
      ? (this.columnPageIndex + 1) / this.totalColumns
      : 1;
    this.progress = (this.currentSpineIndex + chapterFraction) / this.spine.length;

    this.emit(
      "location-change",
      {
        type: "cfi" as const,
        chapterIndex: this.currentSpineIndex,
        cfi: `spine-${this.currentSpineIndex}`,
      },
      this.progress,
    );
  }

  getTOC(): TOCItem[] {
    return this.toc;
  }

  getCurrentLocation(): Location {
    return {
      type: "cfi",
      chapterIndex: this.currentSpineIndex,
    };
  }

  getProgress(): number {
    return this.progress;
  }

  getTotalPages(): number {
    // In paginated mode, return columns in current chapter
    // In scroll mode, return spine count
    return this.viewMode === "paginated" ? this.totalColumns : this.spine.length;
  }

  /** Get current page index (0-based) within the current chapter */
  getCurrentPageIndex(): number {
    return this.columnPageIndex;
  }

  getSelection(): Selection | null {
    const iframeDoc = this.iframe?.contentDocument;
    if (!iframeDoc) return null;

    const sel = iframeDoc.getSelection();
    if (!sel || sel.isCollapsed) return null;

    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (!text) return null;

    return {
      text,
      start: { type: "cfi", chapterIndex: this.currentSpineIndex },
      end: { type: "cfi", chapterIndex: this.currentSpineIndex },
      rects: Array.from(range.getClientRects()),
    };
  }

  addAnnotation(annotation: AnnotationMark): void {
    this.annotations.set(annotation.id, annotation);
    const iframeDoc = this.iframe?.contentDocument;
    if (iframeDoc) {
      this.renderAnnotationsInIframe(iframeDoc);
    }
  }

  removeAnnotation(id: string): void {
    this.annotations.delete(id);
    const iframeDoc = this.iframe?.contentDocument;
    if (iframeDoc) {
      this.renderAnnotationsInIframe(iframeDoc);
    }
  }

  clearAnnotations(): void {
    this.annotations.clear();
    const iframeDoc = this.iframe?.contentDocument;
    if (iframeDoc) {
      this.renderAnnotationsInIframe(iframeDoc);
    }
  }

  setFontSize(size: number): void {
    this.fontSize = size;
    this.updateIframeStyles();
  }

  setLineHeight(height: number): void {
    this.lineHeight = height;
    this.updateIframeStyles();
  }

  setTheme(theme: "light" | "dark" | "sepia"): void {
    this.theme = theme;
    this.updateIframeStyles();
  }

  setViewMode(mode: "paginated" | "scroll"): void {
    this.viewMode = mode;
    this.updateIframeStyles();
  }

  private updateIframeStyles(): void {
    const iframeDoc = this.iframe?.contentDocument;
    if (!iframeDoc) return;

    const existing = iframeDoc.getElementById("readany-styles");
    if (existing) {
      existing.textContent = this.getThemeStyles();
    }
  }

  destroy(): void {
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    this.container = null;
    this.zip.clear();
    this.spine = [];
    this.toc = [];
    this.annotations.clear();
    this.eventListeners.clear();
  }

  // --- Event emitter ---

  on<K extends keyof RendererEvents>(event: K, callback: RendererEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback as EventCallback);
  }

  off<K extends keyof RendererEvents>(event: K, callback: RendererEvents[K]): void {
    this.eventListeners.get(event)?.delete(callback as EventCallback);
  }

  private emit(event: string, ...args: unknown[]): void {
    this.eventListeners.get(event)?.forEach((cb) => cb(...args));
  }

  /** Get parsed metadata */
  getMetadata(): EPUBMetadata | null {
    return this.metadata;
  }
}
