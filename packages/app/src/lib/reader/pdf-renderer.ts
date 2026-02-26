/**
 * PDFRenderer — renders PDF files using pdf.js
 * Implements the DocumentRenderer interface.
 *
 * Optimizations applied (SageReader-style):
 * - #1  Dynamic import: pdf.js + worker loaded only when PDF is opened
 * - #5  CSS-based layout: CSS Grid for zero-reflow page positioning
 * - #7  CSS Grid zero-reflow: layout changes via CSS custom properties only
 * - #8  Multi-level debounce/throttle: scroll 250ms, resize 100ms, progress save 5000ms
 * - #10 Lightweight style update: theme changes via CSS variables, no DOM rebuild
 * - #11 Layout stability detection: rAF polling 5 frames before triggering render
 * - #13 Tauri convertFileSrc: used at ReaderView level (not in renderer)
 * - #15 Page turn animation: CSS transform + requestAnimationFrame + easeOutQuad
 */
import type {
  AnnotationMark,
  DocumentRenderer,
  Location,
  RendererEvents,
  Selection,
  TOCItem,
} from "./document-renderer";
import { debounce } from "@/lib/utils/debounce";

type EventCallback = (...args: unknown[]) => void;

/** Outline node type matching pdfjs-dist getOutline() return */
interface PdfOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  url: string | null;
  items: PdfOutlineNode[];
}

// biome-ignore lint: pdfjs types are complex
type PdfjsLib = any;
// biome-ignore lint: pdfjs types are complex
type PdfDocProxy = any;
// biome-ignore lint: pdfjs types are complex
type PdfPageProxy = any;
// biome-ignore lint: pdfjs types are complex
type PageViewport = any;

/** easeOutQuad easing function for smooth animations */
function easeOutQuad(t: number): number {
  return t * (2 - t);
}

export class PDFRenderer implements DocumentRenderer {
  private container: HTMLElement | null = null;
  private scrollContainer: HTMLElement | null = null;
  private pdfDoc: PdfDocProxy | null = null;
  private pdfjsLib: PdfjsLib | null = null;
  private pageCanvases: Map<number, HTMLCanvasElement> = new Map();
  private renderedPages: Set<number> = new Set();
  private renderingPages: Set<number> = new Set();
  private currentPage = 1;
  private totalPages = 0;
  private toc: TOCItem[] = [];
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private resizeObserver: ResizeObserver | null = null;
  private theme: "light" | "dark" | "sepia" = "light";
  private destroyed = false;
  private viewMode: "paginated" | "scroll" = "paginated";
  private wheelCooldown = false;
  private isAnimating = false;
  private animationFrameId: number | null = null;

  // Debounced/throttled handlers (SageReader optimization #8)
  private debouncedScroll = debounce(() => {
    if (this.destroyed) return;
    this.detectCurrentPage();
    this.renderVisiblePages();
  }, 250);

  private debouncedResize = debounce(() => {
    if (this.destroyed || !this.pdfDoc) return;
    this.checkLayoutStability(() => {
      this.renderedPages.clear();
      this.renderingPages.clear();
      this.setPlaceholderSizes().then(() => {
        if (this.viewMode === "paginated") {
          this.showOnlyCurrentPage();
          this.renderPage(this.currentPage);
        } else {
          this.renderVisiblePages();
        }
      });
    });
  }, 100);

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    container.style.position = "relative";
    container.style.overflow = "hidden";
    container.style.width = "100%";
    container.style.height = "100%";

    // Create scrollable wrapper with CSS Grid for zero-reflow layout (#7)
    const scrollEl = document.createElement("div");
    scrollEl.className = "pdf-scroll-container";
    scrollEl.style.cssText = [
      "width:100%", "height:100%",
      "overflow-y:auto", "overflow-x:hidden",
      "display:grid",
      "grid-template-columns:1fr",
      "justify-items:center",
      "gap:8px",
      "padding:16px 0",
      // CSS custom properties for theme (#10)
      "--pdf-bg:", "--pdf-page-shadow:0 2px 8px rgba(0,0,0,0.1)",
    ].join(";");
    container.appendChild(scrollEl);
    this.scrollContainer = scrollEl;

    // Track scroll for page detection (scroll mode) — debounced 250ms (#8)
    scrollEl.addEventListener("scroll", this.handleScroll, { passive: true });

    // Wheel event — in paginated mode, intercept and turn pages with cooldown
    scrollEl.addEventListener("wheel", this.handleWheel, { passive: false });

    // Click to turn pages — left 37.5% prev, right 37.5% next
    scrollEl.addEventListener("click", this.handleClick);

    // Observe resize — debounced 100ms (#8)
    this.resizeObserver = new ResizeObserver(() => this.debouncedResize());
    this.resizeObserver.observe(container);
  }

  async open(file: File | Blob, initialLocation?: Location): Promise<void> {
    try {
      // Dynamic import of pdf.js (#1)
      const pdfjsLib = await import("pdfjs-dist");
      this.pdfjsLib = pdfjsLib;

      // Configure worker
      try {
        const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.href;
      } catch {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      }

      const arrayBuffer = await file.arrayBuffer();

      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("PDF loading timed out after 30s")), 30000);
      });
      this.pdfDoc = await Promise.race([loadingTask.promise, timeoutPromise]);
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
        await this.goToPage(initialLocation.pageIndex + 1, false);
      } else if (initialLocation?.cfi) {
        const match = initialLocation.cfi.match(/page-(\d+)/);
        if (match) {
          await this.goToPage(Number.parseInt(match[1], 10), false);
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
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.scrollContainer) {
      this.scrollContainer.removeEventListener("scroll", this.handleScroll);
      this.scrollContainer.removeEventListener("wheel", this.handleWheel);
      this.scrollContainer.removeEventListener("click", this.handleClick);
    }
    if (this.container) {
      this.container.innerHTML = "";
    }
    this.pageCanvases.clear();
    this.renderedPages.clear();
    this.renderingPages.clear();
    this.listeners.clear();
    this.pdfDoc?.destroy();
    this.pdfDoc = null;
    this.pdfjsLib = null;
  }

  // --- Navigation ---

  async goTo(location: Location): Promise<void> {
    if (location.pageIndex !== undefined) {
      await this.goToPage(location.pageIndex + 1);
    }
  }

  async goToIndex(index: number): Promise<void> {
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

  addAnnotation(_annotation: AnnotationMark): void {}
  removeAnnotation(_id: string): void {}
  clearAnnotations(): void {}

  // --- View Settings ---

  setFontSize(_size: number): void {
    // PDF has fixed layout, font size doesn't apply
  }

  setLineHeight(_height: number): void {
    // PDF has fixed layout
  }

  /** Lightweight style update — CSS variables only, no DOM rebuild (#10) */
  setTheme(theme: "light" | "dark" | "sepia"): void {
    this.theme = theme;
    this.applyThemeCSS();
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

  // ============================================================
  // Private methods
  // ============================================================

  private emit(event: string, ...args: unknown[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        try { cb(...args); } catch (e) { console.error(`Error in ${event} listener:`, e); }
      }
    }
  }

  // --- Event handlers (bound) ---

  private handleScroll = (): void => {
    if (this.viewMode === "paginated") return;
    this.debouncedScroll();
  };

  private handleWheel = (e: WheelEvent): void => {
    if (this.viewMode !== "paginated") return;
    e.preventDefault();
    if (this.wheelCooldown || this.isAnimating) return;
    this.wheelCooldown = true;
    setTimeout(() => { this.wheelCooldown = false; }, 250);

    if (e.deltaY > 0) this.next();
    else if (e.deltaY < 0) this.prev();
  };

  private handleClick = (e: MouseEvent): void => {
    if (this.viewMode !== "paginated" || this.isAnimating) return;
    const target = e.target as HTMLElement;
    if (target.closest(".textLayer")) return;

    const rect = this.scrollContainer!.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;

    if (ratio < 0.375) this.prev();
    else if (ratio > 0.625) this.next();
  };

  // --- Layout stability detection (#11) ---

  private checkLayoutStability(callback: () => void): void {
    let stableFrames = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    let frameCount = 0;
    const maxFrames = 15;

    const checkFrame = () => {
      if (this.destroyed) return;
      const w = this.scrollContainer?.clientWidth ?? 0;
      const h = this.scrollContainer?.clientHeight ?? 0;

      if (w === lastWidth && h === lastHeight) {
        stableFrames++;
      } else {
        stableFrames = 0;
      }
      lastWidth = w;
      lastHeight = h;
      frameCount++;

      if (stableFrames >= 5) {
        setTimeout(callback, 50);
        return;
      }
      if (frameCount < maxFrames) {
        requestAnimationFrame(checkFrame);
      } else {
        setTimeout(callback, 50);
      }
    };

    setTimeout(() => requestAnimationFrame(checkFrame), 50);
  }

  // --- Page turn animation (#15) ---

  private animatePageTransition(direction: "next" | "prev"): Promise<void> {
    // Skip animation if page is hidden or destroyed
    if (document.hidden || this.destroyed) return Promise.resolve();

    return new Promise((resolve) => {
      const wrapper = this.getPageWrapper(this.currentPage);
      if (!wrapper) { resolve(); return; }

      this.isAnimating = true;
      const duration = 300;
      const startTime = performance.now();
      const startX = direction === "next" ? 30 : -30;

      wrapper.style.opacity = "0";
      wrapper.style.transform = `translateX(${startX}px)`;

      const animate = (now: number) => {
        if (this.destroyed) { this.isAnimating = false; resolve(); return; }

        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = easeOutQuad(t);

        wrapper.style.opacity = String(eased);
        wrapper.style.transform = `translateX(${startX * (1 - eased)}px)`;

        if (t < 1) {
          this.animationFrameId = requestAnimationFrame(animate);
        } else {
          wrapper.style.opacity = "";
          wrapper.style.transform = "";
          this.isAnimating = false;
          this.animationFrameId = null;
          resolve();
        }
      };

      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  // --- Page management ---

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
    const location = this.getCurrentLocation();
    const progress = this.getProgress();
    // Immediate emit for UI responsiveness
    this.emit("location-change", location, progress);
  }

  private async goToPage(pageNum: number, animate = true): Promise<void> {
    const clamped = Math.max(1, Math.min(pageNum, this.totalPages));
    const direction = clamped > this.currentPage ? "next" : "prev";
    this.currentPage = clamped;

    // Ensure the page is rendered
    await this.renderPage(clamped);

    if (this.viewMode === "paginated") {
      this.showOnlyCurrentPage();

      // Scroll to top
      if (this.scrollContainer) {
        this.scrollContainer.scrollTop = 0;
      }

      // Animate page transition (#15)
      if (animate) {
        await this.animatePageTransition(direction);
      }

      // Pre-render adjacent pages
      if (clamped > 1) this.renderPage(clamped - 1);
      if (clamped < this.totalPages) this.renderPage(clamped + 1);
    } else {
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

  private showOnlyCurrentPage(): void {
    for (const [num, canvas] of this.pageCanvases) {
      const wrapper = canvas.parentElement;
      if (wrapper) {
        wrapper.style.display = num === this.currentPage ? "block" : "none";
      }
    }
  }

  private getPageWrapper(pageNum: number): HTMLElement | null {
    const canvas = this.pageCanvases.get(pageNum);
    return canvas?.parentElement ?? null;
  }

  private applyViewMode(): void {
    if (!this.scrollContainer) return;

    if (this.viewMode === "paginated") {
      this.scrollContainer.style.overflowY = "hidden";
      this.scrollContainer.style.alignContent = "center";
      this.showOnlyCurrentPage();
    } else {
      this.scrollContainer.style.overflowY = "auto";
      this.scrollContainer.style.alignContent = "";
      for (const [, canvas] of this.pageCanvases) {
        const wrapper = canvas.parentElement;
        if (wrapper) wrapper.style.display = "block";
      }
      this.renderVisiblePages();
    }
  }

  /** Lightweight theme update via CSS custom properties (#10) */
  private applyThemeCSS(): void {
    if (!this.scrollContainer) return;
    const themes: Record<string, { bg: string; shadow: string }> = {
      light: { bg: "", shadow: "0 2px 8px rgba(0,0,0,0.1)" },
      dark: { bg: "#1a1a1a", shadow: "0 2px 8px rgba(0,0,0,0.4)" },
      sepia: { bg: "#f4ecd8", shadow: "0 2px 8px rgba(0,0,0,0.08)" },
    };
    const t = themes[this.theme] || themes.light;
    this.scrollContainer.style.setProperty("--pdf-bg", t.bg);
    this.scrollContainer.style.setProperty("--pdf-page-shadow", t.shadow);
    this.scrollContainer.style.background = t.bg;

    // Update page wrappers shadows
    for (const [, canvas] of this.pageCanvases) {
      const wrapper = canvas.parentElement;
      if (wrapper) wrapper.style.boxShadow = t.shadow;
    }
  }

  private createPageElements(): void {
    if (!this.scrollContainer || !this.pdfDoc) return;

    this.scrollContainer.innerHTML = "";
    this.pageCanvases.clear();
    this.renderedPages.clear();
    this.renderingPages.clear();

    for (let i = 1; i <= this.totalPages; i++) {
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page-wrapper";
      wrapper.style.cssText = [
        "position:relative",
        "margin:0 auto",
        "box-shadow:var(--pdf-page-shadow, 0 2px 8px rgba(0,0,0,0.1))",
        "background:#fff",
        "border-radius:4px",
        "max-width:calc(100% - 32px)",
        "will-change:transform,opacity",
      ].join(";");
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

    this.setPlaceholderSizes();
    this.applyThemeCSS();
  }

  private async setPlaceholderSizes(): Promise<void> {
    if (!this.pdfDoc || !this.scrollContainer) return;

    const page = await this.pdfDoc.getPage(1);
    const containerWidth = this.scrollContainer.clientWidth - 32;
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

    if (this.viewMode === "paginated") {
      await this.renderPage(this.currentPage);
      return;
    }

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

      if (isVisible && !this.renderedPages.has(pageNum) && !this.renderingPages.has(pageNum)) {
        pagesToRender.push(pageNum);
      }
    }

    await Promise.all(pagesToRender.map((p) => this.renderPage(p)));
  }

  private async renderPage(pageNum: number): Promise<void> {
    if (!this.pdfDoc || this.renderedPages.has(pageNum) || this.renderingPages.has(pageNum) || this.destroyed) return;

    const canvas = this.pageCanvases.get(pageNum);
    if (!canvas) return;

    this.renderingPages.add(pageNum);

    try {
      const page = await this.pdfDoc.getPage(pageNum);

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
      this.renderingPages.delete(pageNum);

      // Render text layer for selection
      this.renderTextLayer(page, viewport, canvas);
    } catch (err) {
      this.renderingPages.delete(pageNum);
      console.error(`Failed to render page ${pageNum}:`, err);
    }
  }

  private async renderTextLayer(
    page: PdfPageProxy,
    viewport: PageViewport,
    canvas: HTMLCanvasElement,
  ): Promise<void> {
    const wrapper = canvas.parentElement;
    if (!wrapper || !this.pdfjsLib) return;

    // Remove existing text layer
    const existing = wrapper.querySelector(".textLayer");
    if (existing) existing.remove();

    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    textLayerDiv.style.setProperty("--total-scale-factor", String(viewport.scale));
    wrapper.appendChild(textLayerDiv);

    const textContent = await page.getTextContent();
    const { TextLayer } = this.pdfjsLib;
    const textLayer = new TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport,
    });

    await textLayer.render();

    textLayerDiv.addEventListener("mouseup", () => {
      // Debounced selection emission (#8) — 50ms
      setTimeout(() => {
        const sel = this.getSelection();
        this.emit("selection", sel);
      }, 50);
    });
  }

  private async extractTOC(): Promise<void> {
    if (!this.pdfDoc) return;

    try {
      const outline = await this.pdfDoc.getOutline();
      if (outline) {
        this.toc = await this.parseOutline(outline, 0);
      } else {
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

  private async parseOutline(items: PdfOutlineNode[], level: number): Promise<TOCItem[]> {
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
    const flat = this.flattenTOC();
    let closest = flat[0];
    for (const item of flat) {
      const itemPage = Number.parseInt(item.href || "0", 10);
      if (itemPage <= pageNum) closest = item;
      else break;
    }
    return closest?.title || `Page ${pageNum}`;
  }
}
