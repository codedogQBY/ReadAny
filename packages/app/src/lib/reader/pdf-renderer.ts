/**
 * PDFRenderer — renders PDF files using pdf.js
 * Implements the DocumentRenderer interface.
 * Uses official pdfjs TextLayer for accurate text selection.
 */
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import type {
  AnnotationMark,
  DocumentRenderer,
  Location,
  RendererEvents,
  Selection,
  TOCItem,
} from "./document-renderer";

// Configure pdf.js worker — use multiple strategies for reliability in Tauri
function initWorker() {
  try {
    // Strategy 1: Use the bundled worker via new URL() — works with Vite
    const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.href;
  } catch {
    // Strategy 2: CDN fallback
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }
}
initWorker();

type EventCallback = (...args: unknown[]) => void;

/** Outline node type matching pdfjs-dist getOutline() return */
interface PdfOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  url: string | null;
  items: PdfOutlineNode[];
}

export class PDFRenderer implements DocumentRenderer {
  private container: HTMLElement | null = null;
  private scrollContainer: HTMLElement | null = null;
  private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  private pageCanvases: Map<number, HTMLCanvasElement> = new Map();
  private renderedPages: Set<number> = new Set();
  private currentPage = 1;
  private totalPages = 0;
  private toc: TOCItem[] = [];
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private resizeObserver: ResizeObserver | null = null;
  private scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private theme: "light" | "dark" | "sepia" = "light";
  private destroyed = false;
  private viewMode: "paginated" | "scroll" = "paginated";
  private wheelCooldown = false;

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    container.style.position = "relative";
    container.style.overflow = "hidden";
    container.style.width = "100%";
    container.style.height = "100%";

    // Create scrollable wrapper
    const scrollEl = document.createElement("div");
    scrollEl.style.cssText =
      "width:100%;height:100%;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 0;";
    scrollEl.className = "pdf-scroll-container";
    container.appendChild(scrollEl);
    this.scrollContainer = scrollEl;

    // Track scroll for page detection (scroll mode)
    scrollEl.addEventListener("scroll", this.handleScroll);

    // Wheel event — in paginated mode, intercept and turn pages
    scrollEl.addEventListener("wheel", (e: WheelEvent) => {
      if (this.viewMode === "paginated") {
        e.preventDefault();
        if (this.wheelCooldown) return;
        this.wheelCooldown = true;
        setTimeout(() => { this.wheelCooldown = false; }, 250);

        if (e.deltaY > 0) {
          this.next();
        } else if (e.deltaY < 0) {
          this.prev();
        }
      }
    }, { passive: false });

    // Click to turn pages — left 37.5% prev, right 37.5% next
    scrollEl.addEventListener("click", (e: MouseEvent) => {
      if (this.viewMode !== "paginated") return;
      // Ignore clicks on text layer (allow text selection)
      const target = e.target as HTMLElement;
      if (target.closest(".textLayer")) return;

      const rect = scrollEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;

      if (ratio < 0.375) {
        this.prev();
      } else if (ratio > 0.625) {
        this.next();
      }
    });

    // Observe resize to re-render visible pages
    this.resizeObserver = new ResizeObserver(() => {
      if (this.pdfDoc) this.updateScale();
    });
    this.resizeObserver.observe(container);
  }

  async open(file: File | Blob, initialLocation?: Location): Promise<void> {
    try {
      console.log("[PDFRenderer] Opening PDF, size:", file.size, "bytes");
      console.log("[PDFRenderer] Worker src:", pdfjsLib.GlobalWorkerOptions.workerSrc);

      const arrayBuffer = await file.arrayBuffer();
      console.log("[PDFRenderer] ArrayBuffer ready, length:", arrayBuffer.byteLength);

      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
      });

      // Add timeout to prevent hanging forever if worker fails
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("PDF loading timed out after 30s. Worker may have failed to load.")), 30000);
      });
      this.pdfDoc = await Promise.race([loadingTask.promise, timeoutPromise]);
      console.log("[PDFRenderer] PDF loaded, pages:", this.pdfDoc.numPages);
      this.totalPages = this.pdfDoc.numPages;

      // Extract outline/TOC
      await this.extractTOC();

      // Create page placeholders
      this.createPageElements();

      // Apply initial view mode
      this.applyViewMode();

      // Render initial visible pages
      await this.renderVisiblePages();

      // Navigate to initial location
      if (initialLocation?.pageIndex !== undefined) {
        await this.goToPage(initialLocation.pageIndex + 1);
      } else if (initialLocation?.cfi) {
        const match = initialLocation.cfi.match(/page-(\d+)/);
        if (match) {
          await this.goToPage(Number.parseInt(match[1], 10));
        }
      }

      this.emit("load", { chapterIndex: 0, chapterTitle: this.getPageTitle(this.currentPage) });
      this.emitLocationChange();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("Failed to open PDF:", error);
      this.emit("error", error);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.scrollContainer) {
      this.scrollContainer.removeEventListener("scroll", this.handleScroll);
    }
    if (this.container) {
      this.container.innerHTML = "";
    }
    this.pageCanvases.clear();
    this.renderedPages.clear();
    this.listeners.clear();
    this.pdfDoc?.destroy();
    this.pdfDoc = null;
  }

  // --- Navigation ---

  async goTo(location: Location): Promise<void> {
    if (location.pageIndex !== undefined) {
      await this.goToPage(location.pageIndex + 1);
    }
  }

  async goToIndex(index: number): Promise<void> {
    // Index is the page index (0-based) from TOCItem.index
    // which equals (pageNum - 1), so we add 1 to get page number
    await this.goToPage(index + 1);
  }

  async next(): Promise<void> {
    if (this.currentPage < this.totalPages) {
      await this.goToPage(this.currentPage + 1);
    }
  }

  async prev(): Promise<void> {
    if (this.currentPage > 1) {
      await this.goToPage(this.currentPage - 1);
    }
  }

  // --- Info ---

  getTOC(): TOCItem[] {
    return this.toc;
  }

  getCurrentLocation(): Location {
    return {
      type: "page-coord",
      pageIndex: this.currentPage - 1,
      cfi: `page-${this.currentPage}`,
    };
  }

  getProgress(): number {
    if (this.totalPages === 0) return 0;
    return this.currentPage / this.totalPages;
  }

  getTotalPages(): number {
    return this.totalPages;
  }

  // --- Selection ---

  getSelection(): Selection | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;

    const text = sel.toString().trim();
    const range = sel.getRangeAt(0);
    const rects = Array.from(range.getClientRects());

    return {
      text,
      start: { type: "page-coord", pageIndex: this.currentPage - 1, cfi: `page-${this.currentPage}` },
      end: { type: "page-coord", pageIndex: this.currentPage - 1, cfi: `page-${this.currentPage}` },
      rects,
    };
  }

  // --- Annotations (simplified for PDF) ---

  addAnnotation(_annotation: AnnotationMark): void {
    // PDF annotations could be rendered as overlay divs
    // Simplified for now
  }

  removeAnnotation(_id: string): void {}

  clearAnnotations(): void {}

  // --- View Settings ---

  setFontSize(_size: number): void {
    // PDF has fixed layout, font size doesn't apply
  }

  setLineHeight(_height: number): void {
    // PDF has fixed layout
  }

  setTheme(theme: "light" | "dark" | "sepia"): void {
    this.theme = theme;
    this.applyTheme();
  }

  setViewMode(mode: "paginated" | "scroll"): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.applyViewMode();
  }

  // --- Events ---

  on<K extends keyof RendererEvents>(event: K, callback: RendererEvents[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback);
  }

  off<K extends keyof RendererEvents>(event: K, callback: RendererEvents[K]): void {
    this.listeners.get(event)?.delete(callback as EventCallback);
  }

  // --- Private methods ---

  private emit(event: string, ...args: unknown[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(...args);
        } catch (e) {
          console.error(`Error in ${event} listener:`, e);
        }
      }
    }
  }

  private handleScroll = (): void => {
    if (this.viewMode === "paginated") return; // Don't track scroll in paginated mode
    if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
    this.scrollTimeout = setTimeout(() => {
      if (this.destroyed) return;
      this.detectCurrentPage();
      this.renderVisiblePages();
    }, 100);
  };

  private detectCurrentPage(): void {
    if (!this.scrollContainer) return;

    const containerRect = this.scrollContainer.getBoundingClientRect();
    const centerY = containerRect.top + containerRect.height / 2;

    let closestPage = 1;
    let closestDist = Number.POSITIVE_INFINITY;

    for (const [pageNum, canvas] of this.pageCanvases) {
      const wrapper = canvas.parentElement;
      if (!wrapper) continue;
      const rect = wrapper.getBoundingClientRect();
      const pageCenterY = rect.top + rect.height / 2;
      const dist = Math.abs(pageCenterY - centerY);
      if (dist < closestDist) {
        closestDist = dist;
        closestPage = pageNum;
      }
    }

    if (closestPage !== this.currentPage) {
      this.currentPage = closestPage;
      this.emitLocationChange();
      this.emit("load", {
        chapterIndex: this.currentPage - 1,
        chapterTitle: this.getPageTitle(this.currentPage),
      });
    }
  }

  private emitLocationChange(): void {
    this.emit("location-change", this.getCurrentLocation(), this.getProgress());
  }

  private async goToPage(pageNum: number): Promise<void> {
    const clamped = Math.max(1, Math.min(pageNum, this.totalPages));
    this.currentPage = clamped;

    // Ensure the page is rendered
    await this.renderPage(clamped);

    if (this.viewMode === "paginated") {
      // In paginated mode: hide all pages, show only current
      for (const [num, canvas] of this.pageCanvases) {
        const wrapper = canvas.parentElement;
        if (wrapper) {
          wrapper.style.display = num === clamped ? "block" : "none";
        }
      }
      // Scroll to top
      if (this.scrollContainer) {
        this.scrollContainer.scrollTop = 0;
      }
      // Also pre-render adjacent pages
      if (clamped > 1) this.renderPage(clamped - 1);
      if (clamped < this.totalPages) this.renderPage(clamped + 1);
    } else {
      // In scroll mode: scroll to the page
      const canvas = this.pageCanvases.get(clamped);
      if (canvas?.parentElement && this.scrollContainer) {
        canvas.parentElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    this.emitLocationChange();
    this.emit("load", {
      chapterIndex: this.currentPage - 1,
      chapterTitle: this.getPageTitle(this.currentPage),
    });
  }

  private applyViewMode(): void {
    if (!this.scrollContainer) return;

    if (this.viewMode === "paginated") {
      // Paginated: no scrolling, show one page at a time, center it
      this.scrollContainer.style.overflowY = "hidden";
      this.scrollContainer.style.justifyContent = "center";
      // Show only current page
      for (const [num, canvas] of this.pageCanvases) {
        const wrapper = canvas.parentElement;
        if (wrapper) {
          wrapper.style.display = num === this.currentPage ? "block" : "none";
        }
      }
    } else {
      // Scroll: show all pages, enable scrolling
      this.scrollContainer.style.overflowY = "auto";
      this.scrollContainer.style.justifyContent = "";
      for (const [, canvas] of this.pageCanvases) {
        const wrapper = canvas.parentElement;
        if (wrapper) {
          wrapper.style.display = "block";
        }
      }
      this.renderVisiblePages();
    }
  }

  private createPageElements(): void {
    if (!this.scrollContainer || !this.pdfDoc) return;

    this.scrollContainer.innerHTML = "";
    this.pageCanvases.clear();
    this.renderedPages.clear();

    for (let i = 1; i <= this.totalPages; i++) {
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page-wrapper";
      wrapper.style.cssText =
        "position:relative;margin:0 auto;box-shadow:0 2px 8px rgba(0,0,0,0.1);background:#fff;border-radius:4px;max-width:calc(100% - 32px);";
      wrapper.dataset.pageNum = String(i);

      const canvas = document.createElement("canvas");
      canvas.style.cssText = "display:block;width:100%;height:auto;";
      wrapper.appendChild(canvas);

      // Page number label
      const label = document.createElement("div");
      label.style.cssText =
        "position:absolute;bottom:4px;right:8px;font-size:10px;color:rgba(0,0,0,0.35);pointer-events:none;";
      label.textContent = String(i);
      wrapper.appendChild(label);

      this.scrollContainer.appendChild(wrapper);
      this.pageCanvases.set(i, canvas);
    }

    // Set initial placeholder sizes
    this.setPlaceholderSizes();
  }

  private async setPlaceholderSizes(): Promise<void> {
    if (!this.pdfDoc || !this.scrollContainer) return;

    // Use first page to determine default size
    const page = await this.pdfDoc.getPage(1);
    const containerWidth = this.scrollContainer.clientWidth - 32; // padding
    const baseViewport = page.getViewport({ scale: 1 });
    const fitScale = containerWidth / baseViewport.width;
    const viewport = page.getViewport({ scale: fitScale });

    for (const [, canvas] of this.pageCanvases) {
      const wrapper = canvas.parentElement;
      if (wrapper) {
        wrapper.style.width = `${viewport.width}px`;
        wrapper.style.minHeight = `${viewport.height}px`;
      }
    }
  }

  private async renderVisiblePages(): Promise<void> {
    if (!this.scrollContainer || !this.pdfDoc) return;

    const containerRect = this.scrollContainer.getBoundingClientRect();
    const buffer = containerRect.height; // render 1 screen ahead

    const pagesToRender: number[] = [];

    for (const [pageNum, canvas] of this.pageCanvases) {
      const wrapper = canvas.parentElement;
      if (!wrapper) continue;

      const rect = wrapper.getBoundingClientRect();
      const isVisible =
        rect.bottom > containerRect.top - buffer &&
        rect.top < containerRect.bottom + buffer;

      if (isVisible && !this.renderedPages.has(pageNum)) {
        pagesToRender.push(pageNum);
      }
    }

    await Promise.all(pagesToRender.map((p) => this.renderPage(p)));
  }

  private async renderPage(pageNum: number): Promise<void> {
    if (!this.pdfDoc || this.renderedPages.has(pageNum) || this.destroyed) return;

    const canvas = this.pageCanvases.get(pageNum);
    if (!canvas) return;

    try {
      const page = await this.pdfDoc.getPage(pageNum);

      // Calculate scale to fit container width
      const containerWidth = (this.scrollContainer?.clientWidth ?? 800) - 32;
      const baseViewport = page.getViewport({ scale: 1 });
      const fitScale = containerWidth / baseViewport.width;
      const pixelRatio = window.devicePixelRatio || 1;
      const renderScale = fitScale * pixelRatio;

      const viewport = page.getViewport({ scale: fitScale });
      const renderViewport = page.getViewport({ scale: renderScale });

      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const wrapper = canvas.parentElement;
      if (wrapper) {
        wrapper.style.width = `${viewport.width}px`;
        wrapper.style.minHeight = `${viewport.height}px`;
      }

      await page.render({
        canvas: canvas,
        viewport: renderViewport,
      }).promise;

      this.renderedPages.add(pageNum);

      // Also render text layer for selection
      this.renderTextLayer(page, viewport, canvas);
    } catch (err) {
      console.error(`Failed to render page ${pageNum}:`, err);
    }
  }

  private async renderTextLayer(
    page: pdfjsLib.PDFPageProxy,
    viewport: pdfjsLib.PageViewport,
    canvas: HTMLCanvasElement,
  ): Promise<void> {
    const wrapper = canvas.parentElement;
    if (!wrapper) return;

    // Remove existing text layer
    const existing = wrapper.querySelector(".textLayer");
    if (existing) existing.remove();

    // Create text layer container with official pdfjs CSS class
    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";

    // The official CSS uses position:absolute + inset:0, so we just need
    // to set the --total-scale-factor CSS variable for proper font sizing
    textLayerDiv.style.setProperty("--total-scale-factor", String(viewport.scale));

    wrapper.appendChild(textLayerDiv);

    // Use official TextLayer API from pdfjs-dist v5
    const textContent = await page.getTextContent();
    const textLayer = new TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport,
    });

    await textLayer.render();

    // Listen for selection changes on this layer
    textLayerDiv.addEventListener("mouseup", () => {
      setTimeout(() => {
        const sel = this.getSelection();
        this.emit("selection", sel);
      }, 10);
    });
  }

  private updateScale(): void {
    // Re-render all visible pages with new container size
    this.renderedPages.clear();
    this.setPlaceholderSizes().then(() => this.renderVisiblePages());
  }

  private applyTheme(): void {
    if (!this.scrollContainer) return;
    switch (this.theme) {
      case "dark":
        this.scrollContainer.style.background = "#1a1a1a";
        break;
      case "sepia":
        this.scrollContainer.style.background = "#f4ecd8";
        break;
      default:
        this.scrollContainer.style.background = "";
    }
  }

  private async extractTOC(): Promise<void> {
    if (!this.pdfDoc) return;

    try {
      const outline = await this.pdfDoc.getOutline();
      if (outline) {
        this.toc = await this.parseOutline(outline, 0);
      } else {
        // Fallback: create TOC from page numbers
        this.toc = [];
        const step = Math.max(1, Math.ceil(this.totalPages / 20));
        for (let i = 1; i <= this.totalPages; i += step) {
          this.toc.push({
            id: `page-${i}`,
            title: `Page ${i}`,
            level: 0,
            href: String(i),
            index: i - 1,
          });
        }
      }

      this.emit("toc-ready", this.toc);
    } catch {
      this.toc = [];
    }
  }

  private async parseOutline(
    items: PdfOutlineNode[],
    level: number,
  ): Promise<TOCItem[]> {
    const result: TOCItem[] = [];

    for (const item of items) {
      let pageNum = 1;
      if (item.dest) {
        try {
          const dest = typeof item.dest === "string"
            ? await this.pdfDoc!.getDestination(item.dest)
            : item.dest;
          if (dest) {
            const ref = dest[0];
            pageNum = await this.pdfDoc!.getPageIndex(ref) + 1;
          }
        } catch {
          // ignore
        }
      }

      const tocItem: TOCItem = {
        id: `outline-${result.length}-${level}`,
        title: item.title,
        level,
        href: String(pageNum),
        index: pageNum - 1,
      };

      if (item.items && item.items.length > 0) {
        tocItem.subitems = await this.parseOutline(item.items, level + 1);
      }

      result.push(tocItem);
    }

    return result;
  }

  private flattenTOC(items?: TOCItem[]): TOCItem[] {
    const src = items || this.toc;
    const result: TOCItem[] = [];
    for (const item of src) {
      result.push(item);
      if (item.subitems) {
        result.push(...this.flattenTOC(item.subitems));
      }
    }
    return result;
  }

  private getPageTitle(pageNum: number): string {
    // Find closest TOC entry
    const flat = this.flattenTOC();
    let closest = flat[0];
    for (const item of flat) {
      const itemPage = Number.parseInt(item.href || "0", 10);
      if (itemPage <= pageNum) {
        closest = item;
      } else {
        break;
      }
    }
    return closest?.title || `Page ${pageNum}`;
  }
}
