/**
 * EPUB Renderer — implements DocumentRenderer using foliate-js <foliate-view>
 *
 * foliate-js provides a web-component <foliate-view> that handles:
 * - EPUB/MOBI/FB2/CBZ parsing and rendering
 * - Paginated and scrolled layouts via CSS columns
 * - CFI-based navigation and progress tracking
 * - Annotation overlay via Overlayer
 * - Section lazy loading/unloading with Blob URL ref-counting (#2, #3)
 * - Shadow DOM encapsulation (#6)
 * - CSS Column native pagination (#5)
 * - CSS Grid zero-reflow layout (#7)
 * - Page turn CSS Transform animation (#15)
 *
 * Optimizations applied (SageReader-style):
 * - #8  Multi-level debounce: styles 50ms, resize 100ms
 * - #10 Lightweight style update: setStyles() only, no re-init
 * - #11 Layout stability detection: rAF polling 5 frames
 * - #12 File-size-based progress estimation (handled by foliate-js)
 */
import type {
  AnnotationMark,
  BookDoc,
  DocumentRenderer,
  Location,
  RendererEvents,
  Selection,
  TOCItem,
} from "./document-renderer";
import { debounce } from "@/lib/utils/debounce";

type EventCallback = (...args: unknown[]) => void;

// Polyfills required by foliate-js
// biome-ignore lint: polyfill for foliate-js
(Object as any).groupBy ??= (iterable: Iterable<unknown>, callbackfn: (value: unknown, index: number) => string) => {
  const obj = Object.create(null);
  let i = 0;
  for (const value of iterable) {
    const key = callbackfn(value, i++);
    if (key in obj) obj[key].push(value);
    else obj[key] = [value];
  }
  return obj;
};

// biome-ignore lint: polyfill for foliate-js
(Map as any).groupBy ??= (iterable: Iterable<unknown>, callbackfn: (value: unknown, index: number) => unknown) => {
  const map = new Map();
  let i = 0;
  for (const value of iterable) {
    const key = callbackfn(value, i++);
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  }
  return map;
};

/**
 * FoliateView — typed interface for the <foliate-view> custom element
 */
interface FoliateView extends HTMLElement {
  // biome-ignore lint: foliate-js uses `any` types
  book: any;
  // biome-ignore lint: foliate-js uses `any` types
  renderer: any;
  // biome-ignore lint: foliate-js uses `any` types
  lastLocation: any;
  open(book: File | Blob): Promise<void>;
  close(): void;
  init(opts?: { lastLocation?: string }): Promise<void>;
  goTo(target: string | number): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  getCFI(index: number, range?: Range): string;
  addAnnotation(annotation: { value: string }, remove?: boolean): Promise<void>;
  deleteAnnotation(annotation: { value: string }): Promise<void>;
}

export class EPUBRenderer implements DocumentRenderer {
  private container: HTMLElement | null = null;
  private foliateView: FoliateView | null = null;
  private toc: TOCItem[] = [];
  private progress = 0;
  private currentChapterIndex = 0;
  private currentChapterTitle = "";
  private annotations: Map<string, AnnotationMark> = new Map();
  private eventListeners: Map<string, Set<EventCallback>> = new Map();
  private viewMode: "paginated" | "scroll" = "paginated";
  private fontSize = 16;
  private lineHeight = 1.6;
  private theme: "light" | "dark" | "sepia" = "light";
  private lastCFI: string | undefined;
  private totalPages = 0;
  private resizeObserver: ResizeObserver | null = null;
  private selectionCleanups: Array<() => void> = [];

  /** Debounced style application — 50ms (#8) */
  private debouncedApplyStyles = debounce(() => {
    this.doApplyStyles();
  }, 50);

  /** Debounced resize handler — 100ms (#8) */
  private debouncedResize = debounce(() => {
    this.checkLayoutStability(() => {
      // After layout is stable, foliate-view auto-adapts — we just need to re-apply max sizes
      const renderer = this.foliateView?.renderer;
      if (renderer) {
        renderer.setAttribute("max-inline-size", "720px");
        renderer.setAttribute("max-block-size", "1440px");
      }
    });
  }, 100);

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;

    this.emit("loading-stage", "parsing");

    // Dynamically import foliate-js view.js to register <foliate-view> (#1)
    await import("foliate-js/view.js");

    // Create the <foliate-view> custom element
    const view = document.createElement("foliate-view") as FoliateView;
    view.style.width = "100%";
    view.style.height = "100%";
    container.appendChild(view);
    this.foliateView = view;

    // Listen for relocate events (progress/location changes)
    view.addEventListener("relocate", ((e: CustomEvent) => {
      this.handleRelocate(e.detail);
    }) as EventListener);

    // Listen for load events (section loaded)
    view.addEventListener("load", ((e: CustomEvent) => {
      this.handleSectionLoad(e.detail);
    }) as EventListener);

    // ResizeObserver for layout stability detection (#11)
    this.resizeObserver = new ResizeObserver(() => this.debouncedResize());
    this.resizeObserver.observe(container);
  }

  async open(file: File | Blob | BookDoc, initialLocation?: Location): Promise<void> {
    if (!this.foliateView) throw new Error("Not mounted");

    // Pass directly to foliate-view. If `file` is a pre-parsed BookDoc,
    // foliate-js skips makeBook() entirely (no redundant ZIP extraction).
    // If `file` is a raw Blob/File, foliate-js auto-detects and parses.
    this.emit("loading-stage", "rendering");
    console.log("[EPUBRenderer] calling foliateView.open...");
    await this.foliateView.open(file);
    console.log("[EPUBRenderer] foliateView.open resolved");

    // Extract TOC
    const book = this.foliateView.book;
    if (book?.toc) {
      this.toc = this.convertTOC(book.toc);
      this.emit("toc-ready", this.toc);
    }

    // Apply initial view settings
    this.applyViewSettings();

    // Navigate to initial location or start
    console.log("[EPUBRenderer] calling foliateView.init, initialLocation:", initialLocation);
    if (initialLocation?.cfi) {
      await this.foliateView.init({ lastLocation: initialLocation.cfi });
    } else if (initialLocation?.chapterIndex !== undefined) {
      await this.foliateView.init({});
      await this.foliateView.goTo(initialLocation.chapterIndex);
    } else {
      await this.foliateView.init({});
    }
    console.log("[EPUBRenderer] foliateView.init resolved");
  }

  private convertTOC(
    foliaToc: Array<{ id?: number; label?: string; href?: string; subitems?: unknown[] }>,
    level = 0,
  ): TOCItem[] {
    if (!foliaToc) return [];
    const items: TOCItem[] = [];

    for (let i = 0; i < foliaToc.length; i++) {
      const item = foliaToc[i];
      const tocItem: TOCItem = {
        id: String(item.id ?? `toc-${level}-${i}`),
        title: item.label || `Chapter ${i + 1}`,
        level,
        href: item.href,
        index: i,
      };

      if (item.subitems && Array.isArray(item.subitems) && item.subitems.length > 0) {
        tocItem.subitems = this.convertTOC(
          item.subitems as Array<{ id?: number; label?: string; href?: string; subitems?: unknown[] }>,
          level + 1,
        );
      }

      items.push(tocItem);
    }
    return items;
  }

  private handleRelocate(detail: {
    fraction?: number;
    section?: { current: number; total: number };
    location?: { current: number; next: number; total: number };
    tocItem?: { label?: string; href?: string; id?: number };
    cfi?: string;
  }): void {
    this.progress = detail.fraction ?? 0;

    if (detail.section) {
      this.currentChapterIndex = detail.section.current;
    }
    if (detail.tocItem) {
      this.currentChapterTitle = detail.tocItem.label || "";
    }
    if (detail.location) {
      this.totalPages = detail.location.total;
    }
    if (detail.cfi) {
      this.lastCFI = detail.cfi;
    }

    this.emit(
      "location-change",
      {
        type: "cfi" as const,
        chapterIndex: this.currentChapterIndex,
        cfi: detail.cfi || `section-${this.currentChapterIndex}`,
        pageIndex: detail.location ? detail.location.current - 1 : undefined,
      },
      this.progress,
    );
  }

  private handleSectionLoad(detail: { doc?: Document; index?: number }): void {
    const chapterTitle =
      this.currentChapterTitle || this.getChapterTitleByIndex(detail.index ?? 0);

    this.emit("load", {
      chapterIndex: detail.index ?? this.currentChapterIndex,
      chapterTitle,
    });

    // Attach selection listener to the section document
    if (detail.doc) {
      this.attachSelectionListener(detail.doc);
    }

    // Preload next chapter document in background for smoother page turns
    const currentIndex = detail.index ?? this.currentChapterIndex;
    const book = this.foliateView?.book;
    if (book?.sections) {
      const nextSection = book.sections[currentIndex + 1];
      nextSection?.createDocument?.().catch(() => {});
    }
  }

  /** Attach mouseup listener to iframe doc for selection detection */
  private attachSelectionListener(doc: Document): void {
    const handlePointerUp = () => {
      // Small delay to let the browser finalize the selection
      setTimeout(() => {
        const sel = this.getSelection();
        this.emit("selection", sel);
      }, 10);
    };

    doc.addEventListener("pointerup", handlePointerUp);
    this.selectionCleanups.push(() => doc.removeEventListener("pointerup", handlePointerUp));
  }

  private getChapterTitleByIndex(index: number): string {
    for (const item of this.toc) {
      if (item.index === index) return item.title;
    }
    return `Chapter ${index + 1}`;
  }

  private applyViewSettings(): void {
    const renderer = this.foliateView?.renderer;
    if (!renderer) return;

    // Set flow mode
    if (this.viewMode === "scroll") {
      renderer.setAttribute("flow", "scrolled");
    } else {
      renderer.removeAttribute("flow");
    }

    // Set layout constraints via CSS custom properties (#7)
    renderer.setAttribute("max-inline-size", "720px");
    renderer.setAttribute("max-block-size", "1440px");
    renderer.setAttribute("max-column-count", "2");
    renderer.setAttribute("gap", "5%");
    renderer.setAttribute("animated", ""); // Enable built-in page turn animation (#15)

    // Apply CSS styles (font, theme, etc.) — uses setStyles() lightweight path (#10)
    this.doApplyStyles();
  }

  /** Lightweight style update path — only calls setStyles(), no re-init (#10) */
  private doApplyStyles(): void {
    const renderer = this.foliateView?.renderer;
    if (!renderer?.setStyles) return;

    const themes: Record<string, { bg: string; fg: string; link: string }> = {
      light: { bg: "#ffffff", fg: "#1a1a1a", link: "#2563eb" },
      dark: { bg: "#1a1a1a", fg: "#e5e5e5", link: "#60a5fa" },
      sepia: { bg: "#f4ecd8", fg: "#5b4636", link: "#8b6914" },
    };

    const t = themes[this.theme] || themes.light;

    renderer.setStyles({
      "html, body": {
        "background-color": t.bg,
        color: t.fg,
        "font-size": `${this.fontSize}px`,
        "line-height": `${this.lineHeight}`,
      },
      a: { color: t.link },
      img: { "max-width": "100%", height: "auto" },
      "::selection": { background: "rgba(59, 130, 246, 0.3)" },
    });
  }

  /** Layout stability detection — rAF polling 5 frames (#11) */
  private checkLayoutStability(callback: () => void): void {
    let stableFrames = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    let frameCount = 0;
    const maxFrames = 15;

    const checkFrame = () => {
      const w = this.container?.clientWidth ?? 0;
      const h = this.container?.clientHeight ?? 0;

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

  // --- DocumentRenderer interface ---

  async goTo(location: Location): Promise<void> {
    if (!this.foliateView) return;

    if (location.cfi) {
      await this.foliateView.goTo(location.cfi);
    } else if (location.chapterIndex !== undefined) {
      await this.foliateView.goTo(location.chapterIndex);
    }
  }

  async goToIndex(index: number): Promise<void> {
    if (!this.foliateView) return;

    const tocItem = this.toc[index];
    if (tocItem?.href) {
      await this.foliateView.goTo(tocItem.href);
    } else {
      await this.foliateView.goTo(index);
    }
  }

  async next(): Promise<void> {
    this.emit("selection", null); // Clear selection on page turn
    await this.foliateView?.next();
  }

  async prev(): Promise<void> {
    this.emit("selection", null); // Clear selection on page turn
    await this.foliateView?.prev();
  }

  getTOC(): TOCItem[] {
    return this.toc;
  }

  getCurrentLocation(): Location {
    return {
      type: "cfi",
      chapterIndex: this.currentChapterIndex,
      cfi: this.lastCFI || `section-${this.currentChapterIndex}`,
    };
  }

  getProgress(): number {
    return this.progress;
  }

  getTotalPages(): number {
    return this.totalPages;
  }

  getSelection(): Selection | null {
    const contents = this.foliateView?.renderer?.getContents?.();
    if (!contents?.[0]?.doc) return null;

    const doc = contents[0].doc as Document;
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed) return null;

    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (!text) return null;

    const rects = Array.from(range.getClientRects());
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

    return {
      text,
      start: { type: "cfi", chapterIndex: this.currentChapterIndex },
      end: { type: "cfi", chapterIndex: this.currentChapterIndex },
      rects: offsetRects,
    };
  }

  addAnnotation(annotation: AnnotationMark): void {
    this.annotations.set(annotation.id, annotation);
    if (annotation.location.cfi) {
      this.foliateView?.addAnnotation({ value: annotation.location.cfi });
    }
  }

  removeAnnotation(id: string): void {
    const annotation = this.annotations.get(id);
    if (annotation?.location.cfi) {
      this.foliateView?.deleteAnnotation({ value: annotation.location.cfi });
    }
    this.annotations.delete(id);
  }

  clearAnnotations(): void {
    for (const [, annotation] of this.annotations) {
      if (annotation.location.cfi) {
        this.foliateView?.deleteAnnotation({ value: annotation.location.cfi });
      }
    }
    this.annotations.clear();
  }

  /** Uses debounced style update — 50ms (#8, #10) */
  setFontSize(size: number): void {
    this.fontSize = size;
    this.debouncedApplyStyles();
  }

  setLineHeight(height: number): void {
    this.lineHeight = height;
    this.debouncedApplyStyles();
  }

  setTheme(theme: "light" | "dark" | "sepia"): void {
    this.theme = theme;
    this.debouncedApplyStyles();
  }

  setViewMode(mode: "paginated" | "scroll"): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;

    const renderer = this.foliateView?.renderer;
    if (!renderer) return;

    if (mode === "scroll") {
      renderer.setAttribute("flow", "scrolled");
    } else {
      renderer.removeAttribute("flow");
    }
  }

  destroy(): void {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    for (const cleanup of this.selectionCleanups) cleanup();
    this.selectionCleanups = [];
    if (this.foliateView) {
      try { this.foliateView.close(); } catch { /* ignore */ }
      this.foliateView.remove();
      this.foliateView = null;
    }
    this.container = null;
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
}
