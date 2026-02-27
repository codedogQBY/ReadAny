/**
 * FoliateViewer — core book rendering component using foliate-js <foliate-view>.
 *
 * Reference: readest FoliateViewer.tsx
 *
 * This component is responsible for:
 * 1. Creating and managing the <foliate-view> Web Component
 * 2. Opening the BookDoc and navigating to initial position
 * 3. Handling section load events (inject styles, register iframe events)
 * 4. Tracking relocate events (progress, location)
 * 5. Applying view settings (font, theme, layout)
 *
 * It receives a pre-parsed BookDoc from the parent (ReaderView),
 * which is created by DocumentLoader.
 */
import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import type { BookDoc, BookFormat } from "@/lib/reader/document-loader";
import { getDirection, isFixedLayoutFormat } from "@/lib/reader/document-loader";
import { registerIframeEventHandlers } from "@/lib/reader/iframe-event-handlers";
import { useFoliateEvents } from "@/hooks/reader/useFoliateEvents";
import { usePagination } from "@/hooks/reader/usePagination";
import { useBookShortcuts } from "@/hooks/reader/useBookShortcuts";
import type { FoliateView } from "@/hooks/reader/useFoliateView";
import { wrappedFoliateView } from "@/hooks/reader/useFoliateView";
import type { ViewSettings } from "@/types";
import { readingContextService } from "@/lib/ai/reading-context-service";

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

/** Relocate event detail from foliate-view */
export interface RelocateDetail {
  fraction?: number;
  section?: { current: number; total: number };
  location?: { current: number; next: number; total: number };
  tocItem?: { label?: string; href?: string; id?: number };
  cfi?: string;
  time?: { section: number; total: number };
  range?: Range;
}

/** Section load event detail */
export interface SectionLoadDetail {
  doc?: Document;
  index?: number;
}

/** Converted TOC item for UI consumption */
export interface TOCItem {
  id: string;
  title: string;
  level: number;
  href?: string;
  index?: number;
  subitems?: TOCItem[];
}

/** Selection from book content */
export interface BookSelection {
  text: string;
  cfi?: string;
  chapterIndex?: number;
  rects: DOMRect[];
}

/** Imperative handle exposed to parent via ref */
export interface FoliateViewerHandle {
  goNext: () => void;
  goPrev: () => void;
  goToHref: (href: string) => void;
  goToFraction: (fraction: number) => void;
  goToCFI: (cfi: string) => void;
  // biome-ignore lint: foliate-js annotation format
  addAnnotation: (annotation: any, remove?: boolean) => void;
  // biome-ignore lint: foliate-js annotation format
  deleteAnnotation: (annotation: any) => void;
  search: (opts: { query: string; matchCase?: boolean; wholeWords?: boolean }) => AsyncGenerator | null;
  clearSearch: () => void;
  getView: () => FoliateView | null;
}

interface FoliateViewerProps {
  bookKey: string;
  bookDoc: BookDoc;
  format: BookFormat;
  viewSettings: ViewSettings;
  lastLocation?: string;
  onRelocate?: (detail: RelocateDetail) => void;
  onTocReady?: (toc: TOCItem[]) => void;
  onLoaded?: () => void;
  onError?: (error: Error) => void;
  onSelection?: (selection: BookSelection | null) => void;
  onToggleSearch?: () => void;
  onToggleToc?: () => void;
  onToggleChat?: () => void;
}

export const FoliateViewer = forwardRef<FoliateViewerHandle, FoliateViewerProps>(function FoliateViewer({
  bookKey,
  bookDoc,
  format,
  viewSettings,
  lastLocation,
  onRelocate,
  onTocReady,
  onLoaded,
  onError,
  onSelection,
  onToggleSearch,
  onToggleToc,
  onToggleChat,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const isViewCreated = useRef(false);
  const [loading, setLoading] = useState(true);

  const isFixedLayout = isFixedLayoutFormat(format);
  // Track when view is ready so hooks/events re-bind
  const [viewReady, setViewReady] = useState(false);

  // --- Imperative handle for parent ---
  useImperativeHandle(ref, () => ({
    goNext: () => { viewRef.current?.goRight(); },
    goPrev: () => { viewRef.current?.goLeft(); },
    goToHref: (href: string) => { viewRef.current?.goTo(href); },
    goToFraction: (fraction: number) => { viewRef.current?.goToFraction(fraction); },
    goToCFI: (cfi: string) => { viewRef.current?.goTo(cfi); },
    addAnnotation: (annotation: unknown, remove?: boolean) => { viewRef.current?.addAnnotation(annotation, remove); },
    deleteAnnotation: (annotation: unknown) => { viewRef.current?.deleteAnnotation(annotation); },
    search: (opts: { query: string; matchCase?: boolean; wholeWords?: boolean }) => {
      if (!viewRef.current) return null;
      return viewRef.current.search(opts);
    },
    clearSearch: () => { viewRef.current?.clearSearch(); },
    getView: () => viewRef.current,
  }), [viewReady]);

  // --- Hooks ---
  usePagination({ bookKey, viewRef, containerRef });
  useBookShortcuts({
    bookKey,
    viewRef,
    onToggleSearch,
    onToggleToc,
    onToggleChat,
  });

  // --- Convert TOC ---
  const convertTOC = useCallback(
    (
      foliaToc: Array<{
        id?: number;
        label?: string;
        href?: string;
        subitems?: unknown[];
      }>,
      level = 0,
    ): TOCItem[] => {
      if (!foliaToc) return [];
      return foliaToc.map((item, i) => ({
        id: String(item.id ?? `toc-${level}-${i}`),
        title: item.label || `Chapter ${i + 1}`,
        level,
        href: item.href,
        index: i,
        subitems:
          item.subitems && Array.isArray(item.subitems) && item.subitems.length > 0
            ? convertTOC(
                item.subitems as Array<{
                  id?: number;
                  label?: string;
                  href?: string;
                  subitems?: unknown[];
                }>,
                level + 1,
              )
            : undefined,
      }));
    },
    [],
  );

  // --- Section load handler ---
  // Use stable ref-based handler so openBook can register it once and it always
  // dispatches to the latest callback, avoiding stale closures and duplicate listeners.
  const docLoadHandlerImpl = useCallback(
    (event: Event) => {
      const detail = (event as CustomEvent).detail as SectionLoadDetail;
      if (!detail.doc) return;

      // Detect writing direction
      getDirection(detail.doc);

      // Apply theme styles to loaded document
      applyDocumentStyles(detail.doc, viewSettings, isFixedLayout);

      // Register iframe event handlers for this section
      registerIframeEventHandlers(bookKey, detail.doc);

      // Attach selection listener
      attachSelectionListener(detail.doc);

      setLoading(false);
      onLoaded?.();
    },
    [bookKey, viewSettings, onLoaded, isFixedLayout],
  );
  const docLoadHandlerRef = useRef(docLoadHandlerImpl);
  docLoadHandlerRef.current = docLoadHandlerImpl;

  // --- Relocate handler ---
  const relocateHandlerImpl = useCallback(
    (event: Event) => {
      const detail = (event as CustomEvent).detail as RelocateDetail;
      onRelocate?.(detail);

      // Update reading context service
      if (detail.tocItem?.label && detail.fraction !== undefined) {
        readingContextService.updateContext({
          bookId: bookKey,
          currentChapter: {
            index: detail.section?.current ?? 0,
            title: detail.tocItem.label,
            href: detail.tocItem.href || "",
          },
          currentPosition: {
            cfi: detail.cfi || "",
            percentage: detail.fraction * 100,
          },
        });
      }
    },
    [onRelocate, bookKey],
  );
  const relocateHandlerRef = useRef(relocateHandlerImpl);
  relocateHandlerRef.current = relocateHandlerImpl;

  // Stable wrapper functions that delegate to latest impl via ref
  const docLoadHandler = useCallback((event: Event) => docLoadHandlerRef.current(event), []);
  const relocateHandler = useCallback((event: Event) => relocateHandlerRef.current(event), []);

  // --- Selection listener ---
  // Use ref so the pointerup handler always calls the latest onSelection callback,
  // even if the React prop has been updated since the listener was attached.
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;

  const attachSelectionListener = useCallback(
    (doc: Document) => {
      const handlePointerUp = () => {
        setTimeout(() => {
          const sel = getSelectionFromView();
          onSelectionRef.current?.(sel);
        }, 10);
      };
      doc.addEventListener("pointerup", handlePointerUp);
    },
    [],
  );

  const getSelectionFromView = useCallback((): BookSelection | null => {
    const view = viewRef.current;
    if (!view) return null;

    const contents = view.renderer?.getContents?.();
    if (!contents?.[0]?.doc) return null;

    const doc = contents[0].doc as Document;
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed) return null;

    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (!text) return null;

    // Get CFI for the selection
    let cfi: string | undefined;
    let chapterIndex: number | undefined;
    try {
      const index = contents[0].index;
      if (index !== undefined) {
        cfi = view.getCFI(index, range);
        chapterIndex = index;
      }
    } catch {
      // CFI generation may fail for some selections
    }

    const rects = Array.from(range.getClientRects());

    // Convert iframe-local coordinates to main window coordinates.
    // For fixed-layout (PDF), iframes may have CSS transform: scale(),
    // so we need to account for both the iframe position and the scale factor.
    const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null;
    let offsetRects: DOMRect[];

    if (iframe) {
      const iframeRect = iframe.getBoundingClientRect();
      // Compute scale: iframeRect is the scaled size in main window,
      // iframe.clientWidth is the unscaled content width
      const scaleX = iframe.clientWidth > 0 ? iframeRect.width / iframe.clientWidth : 1;
      const scaleY = iframe.clientHeight > 0 ? iframeRect.height / iframe.clientHeight : 1;

      offsetRects = rects.map(
        (r) =>
          new DOMRect(
            iframeRect.left + r.x * scaleX,
            iframeRect.top + r.y * scaleY,
            r.width * scaleX,
            r.height * scaleY,
          ),
      );
    } else {
      // Fallback: use container offset (for non-iframe renderers)
      const containerRect = containerRef.current?.getBoundingClientRect();
      offsetRects = containerRect
        ? rects.map(
            (r) =>
              new DOMRect(
                r.x + containerRect.x,
                r.y + containerRect.y,
                r.width,
                r.height,
              ),
          )
        : rects;
    }

    // Update reading context service with selection
    if (cfi && chapterIndex !== undefined) {
      readingContextService.updateSelection({
        text,
        cfi,
        chapterIndex,
        chapterTitle: "", // Will be filled by relocate handler
      });
    }

    return { text, cfi, chapterIndex, rects: offsetRects };
  }, []);

  // Bind foliate events (use viewReady state to ensure re-bind after view creation)
  useFoliateEvents(viewReady ? viewRef.current : null, {
    onLoad: docLoadHandler,
    onRelocate: relocateHandler,
  });

  // --- Open book ---
  useEffect(() => {
    if (isViewCreated.current) return;
    isViewCreated.current = true;

    const openBook = async () => {
      try {
        await import("foliate-js/view.js");

        const view = wrappedFoliateView(
          document.createElement("foliate-view"),
        );
        view.id = `foliate-view-${bookKey}`;
        view.style.width = "100%";
        view.style.height = "100%";
        containerRef.current?.appendChild(view);

        // Pre-configure fixed layout (PDF/CBZ) rendition before opening
        // This is critical: foliate-js FixedLayout.#spread() reads rendition.spread
        // during open(), so it must be set before view.open()
        if (isFixedLayout && bookDoc.rendition) {
          bookDoc.rendition.spread = "auto";
          // Set first section as cover page (single page, not part of spread)
          const sections = bookDoc.sections as Array<{ pageSpread?: string }> | undefined;
          if (sections?.[0]) {
            const coverSide = bookDoc.dir === "rtl" ? "right" : "left";
            sections[0].pageSpread = coverSide;
          }
        }

        // Open the pre-parsed BookDoc
        await view.open(bookDoc);
        viewRef.current = view;

        console.log("[FoliateViewer] Book opened:", {
          format,
          isFixedLayout,
          sectionsCount: bookDoc.sections?.length,
          renditionLayout: bookDoc.rendition?.layout,
          renditionSpread: bookDoc.rendition?.spread,
        });

        // Extract and emit TOC
        if (view.book?.toc) {
          const toc = convertTOC(view.book.toc);
          onTocReady?.(toc);
        }

        // Apply renderer settings
        applyRendererSettings(view, viewSettings, isFixedLayout);

        // IMPORTANT: Register event listeners BEFORE navigation to avoid race condition.
        // React's useFoliateEvents relies on viewReady state, but setState + re-render
        // won't complete before the synchronous navigation below fires the first "load"
        // event. We attach listeners directly here so the first section load is captured.
        // useFoliateEvents will also bind them once viewReady is committed, but
        // addEventListener de-duplicates identical function references, so no double-fire.
        view.addEventListener("load", docLoadHandler);
        view.addEventListener("relocate", relocateHandler);
        setViewReady(true);

        // Navigate to last location or start
        if (lastLocation && !isFixedLayout) {
          await view.init({ lastLocation });
        } else {
          await view.goToFraction(0);
        }
      } catch (err) {
        console.error("[FoliateViewer] Failed to open book:", err);
        onError?.(
          err instanceof Error ? err : new Error("Failed to open book"),
        );
        setLoading(false);
      }
    };

    openBook();

    return () => {
      const view = viewRef.current;
      if (view) {
        try {
          view.close();
        } catch {
          /* ignore */
        }
        view.remove();
        viewRef.current = null;
        setViewReady(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Apply view settings changes ---
  useEffect(() => {
    const view = viewRef.current;
    if (!view?.renderer) return;
    // Fixed layout (PDF/CBZ): don't override font/size/lineHeight
    if (isFixedLayout) return;
    applyRendererStyles(view, viewSettings, false);
  }, [
    viewSettings.fontSize,
    viewSettings.lineHeight,
    viewSettings.theme,
    viewSettings.fontFamily,
    isFixedLayout,
  ]);

  // --- Apply view mode changes ---
  useEffect(() => {
    const view = viewRef.current;
    if (!view?.renderer) return;
    // Fixed layout doesn't support scroll mode
    if (isFixedLayout) return;

    if (viewSettings.viewMode === "scroll") {
      view.renderer.setAttribute("flow", "scrolled");
    } else {
      view.renderer.removeAttribute("flow");
    }
  }, [viewSettings.viewMode, isFixedLayout]);

  return (
    <div
      ref={containerRef}
      className="foliate-viewer h-full w-full focus:outline-none"
      tabIndex={-1}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            <p className="text-sm text-muted-foreground">Loading book...</p>
          </div>
        </div>
      )}
    </div>
  );
});

// --- Helper functions ---

/** Apply CSS styles to a loaded section document */
function applyDocumentStyles(doc: Document, settings: ViewSettings, isFixedLayout: boolean) {
  if (isFixedLayout) {
    // PDF/CBZ: don't inject styles that would break layout
    return;
  }

  // Apply theme class
  doc.documentElement.classList.remove("theme-light", "theme-dark", "theme-sepia");
  doc.documentElement.classList.add(`theme-${settings.theme}`);

  // Basic styles for images
  const images = doc.querySelectorAll("img");
  for (const img of images) {
    img.style.maxWidth = "100%";
    img.style.height = "auto";
  }
}

/** Apply renderer-level settings (layout, columns, margins) */
function applyRendererSettings(
  view: FoliateView,
  settings: ViewSettings,
  isFixedLayout: boolean,
) {
  const renderer = view.renderer;
  if (!renderer) return;

  if (isFixedLayout) {
    // Fixed layout: zoom, spread
    renderer.setAttribute("zoom", "fit-page");
    renderer.setAttribute("spread", "auto");
  } else {
    // Reflowable: columns, sizes, margins
    renderer.setAttribute("max-column-count", "2");
    renderer.setAttribute("max-inline-size", "720px");
    renderer.setAttribute("max-block-size", "1440px");
    renderer.setAttribute("gap", "5%");

    if (settings.viewMode === "scroll") {
      renderer.setAttribute("flow", "scrolled");
    }
  }

  // Enable page turn animation
  renderer.setAttribute("animated", "");

  // Apply CSS styles (skip font overrides for fixed layout)
  applyRendererStyles(view, settings, isFixedLayout);
}

/** Apply CSS styles to the renderer (lightweight update path) */
function applyRendererStyles(
  view: FoliateView,
  settings: ViewSettings,
  isFixedLayout: boolean,
) {
  const renderer = view.renderer;
  if (!renderer?.setStyles) return;

  const themes: Record<
    string,
    { bg: string; fg: string; link: string }
  > = {
    light: { bg: "#ffffff", fg: "#1a1a1a", link: "#2563eb" },
    dark: { bg: "#1a1a1a", fg: "#e5e5e5", link: "#60a5fa" },
    sepia: { bg: "#f4ecd8", fg: "#5b4636", link: "#8b6914" },
  };

  const t = themes[settings.theme] || themes.light;

  if (isFixedLayout) {
    // Fixed layout (PDF/CBZ): only set background, don't override font/size/lineHeight
    // as it would break the TextLayer positioning in PDF
    renderer.setStyles({
      "html, body": {
        "background-color": t.bg,
      },
    });
    return;
  }

  const fontFamilyMap: Record<string, string> = {
    sans: "system-ui, -apple-system, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "'Courier New', monospace",
  };

  renderer.setStyles({
    "html, body": {
      "background-color": t.bg,
      color: t.fg,
      "font-size": `${settings.fontSize}px`,
      "line-height": `${settings.lineHeight}`,
      "font-family": fontFamilyMap[settings.fontFamily] || fontFamilyMap.serif,
    },
    a: { color: t.link },
    img: { "max-width": "100%", height: "auto" },
    "::selection": { background: "rgba(59, 130, 246, 0.3)" },
  });
}
