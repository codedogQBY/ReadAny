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
import { Overlayer } from "foliate-js/overlayer.js";

// Polyfills required by foliate-js
// biome-ignore lint: polyfill for foliate-js
(Object as any).groupBy ??= (
  iterable: Iterable<unknown>,
  callbackfn: (value: unknown, index: number) => string,
) => {
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
(Map as any).groupBy ??= (
  iterable: Iterable<unknown>,
  callbackfn: (value: unknown, index: number) => unknown,
) => {
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
  range?: Range; // Original range for re-selection
  annotated?: boolean; // true if this is an existing annotation
  highlightId?: string; // the existing highlight's id
  color?: string; // the existing highlight's color
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
  search: (opts: {
    query: string;
    matchCase?: boolean;
    wholeWords?: boolean;
  }) => AsyncGenerator | null;
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
  onSectionLoad?: (index: number) => void;
  onError?: (error: Error) => void;
  onSelection?: (selection: BookSelection | null) => void;
  onShowAnnotation?: (cfi: string, range: Range, index: number) => void;
  onToggleSearch?: () => void;
  onToggleToc?: () => void;
  onToggleChat?: () => void;
}

export const FoliateViewer = forwardRef<FoliateViewerHandle, FoliateViewerProps>(
  function FoliateViewer(
    {
      bookKey,
      bookDoc,
      format,
      viewSettings,
      lastLocation,
      onRelocate,
      onTocReady,
      onLoaded,
      onSectionLoad,
      onError,
      onSelection,
      onShowAnnotation,
      onToggleSearch,
      onToggleToc,
      onToggleChat,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<FoliateView | null>(null);
    const isViewCreated = useRef(false);
    const [loading, setLoading] = useState(true);

    const isFixedLayout = isFixedLayoutFormat(format);
    // Track when view is ready so hooks/events re-bind
    const [viewReady, setViewReady] = useState(false);

    // --- Imperative handle for parent ---
    useImperativeHandle(
      ref,
      () => ({
        goNext: () => {
          viewRef.current?.goRight();
        },
        goPrev: () => {
          viewRef.current?.goLeft();
        },
        goToHref: (href: string) => {
          viewRef.current?.goTo(href);
        },
        goToFraction: (fraction: number) => {
          viewRef.current?.goToFraction(fraction);
        },
        goToCFI: (cfi: string) => {
          viewRef.current?.goTo(cfi);
        },
        addAnnotation: (annotation: unknown, remove?: boolean) => {
          viewRef.current?.addAnnotation(annotation, remove);
        },
        deleteAnnotation: (annotation: unknown) => {
          viewRef.current?.deleteAnnotation(annotation);
        },
        search: (opts: { query: string; matchCase?: boolean; wholeWords?: boolean }) => {
          if (!viewRef.current) return null;
          return viewRef.current.search(opts);
        },
        clearSearch: () => {
          viewRef.current?.clearSearch();
        },
        getView: () => viewRef.current,
      }),
      [viewReady],
    );

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

        // Notify parent that a section has loaded (for re-rendering annotations)
        // This is critical: when switching chapters, foliate-js reloads the content
        // and all annotations need to be re-added
        if (detail.index !== undefined) {
          onSectionLoad?.(detail.index);
        }
      },
      [bookKey, viewSettings, onLoaded, onSectionLoad, isFixedLayout],
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
          // Extract visible text from the current page
          let surroundingText = "";
          try {
            const view = viewRef.current;
            const contents = view?.renderer?.getContents?.();
            if (contents?.[0]?.doc) {
              const doc = contents[0].doc as Document;
              const rawText = doc.body?.textContent || "";
              // Trim and limit to ~2000 chars to avoid overly large context
              surroundingText = rawText.replace(/\s+/g, " ").trim().slice(0, 2000);
            }
          } catch {
            // Ignore extraction errors
          }

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
            surroundingText,
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

    // --- Draw annotation handler ---
    // This is called by foliate-js when an annotation needs to be rendered
    const drawAnnotationHandler = useCallback((event: Event) => {
      const detail = (event as CustomEvent).detail;
      const { draw, annotation, doc, range } = detail;

      if (!draw || !annotation) return;

      // Get color from annotation, default to yellow
      const color = annotation.color || "yellow";

      // Map color names to hex values
      // Map color names to rgba values for highlight rendering
      // Match readest's HIGHLIGHT_COLOR_HEX with alpha for background highlight
      const colorMap: Record<string, string> = {
        red: "rgba(248, 113, 113, 0.4)", // red-400
        yellow: "rgba(250, 204, 21, 0.4)", // yellow-400
        green: "rgba(74, 222, 128, 0.4)", // green-400
        blue: "rgba(96, 165, 250, 0.4)", // blue-400
        violet: "rgba(167, 139, 250, 0.4)", // violet-400
      };

      const hexColor = colorMap[color] || colorMap.yellow;

      // Check writing mode for vertical text support
      let writingMode = "horizontal-tb";
      let vertical = false;
      if (doc && range) {
        try {
          const node = range.startContainer;
          const el = node.nodeType === 1 ? node : node.parentElement;
          if (el && doc.defaultView) {
            const style = doc.defaultView.getComputedStyle(el);
            writingMode = style.writingMode || "horizontal-tb";
            vertical = writingMode?.includes("vertical") || false;
          }
        } catch {
          // Ignore errors in getting writing mode
        }
      }

      // If annotation has a note, only draw wavy underline (no highlight background)
      if (annotation.note) {
        // Black wavy underline to indicate note presence — no highlight color
        draw(Overlayer.squiggly, { color: "#000000", width: 1.5, writingMode });
        // Hover tooltip
        if (doc && range) {
          try {
            createNoteTooltip(doc, range, annotation.note, annotation.value);
          } catch {
            // Ignore tooltip creation errors
          }
        }
      } else {
        // Draw regular highlight
        draw(Overlayer.highlight, { color: hexColor, vertical });
      }
    }, []);

    // --- Delete annotation handler ---
    // Clean up tooltip registry when an annotation is removed
    const deleteAnnotationHandler = useCallback((event: Event) => {
      const { value, doc } = (event as CustomEvent).detail;
      if (value && doc) removeNoteTooltip(doc, value);
    }, []);

    // --- Show annotation handler ---
    // This is called when user clicks on an existing annotation
    const onShowAnnotationRef = useRef(onShowAnnotation);
    onShowAnnotationRef.current = onShowAnnotation;

    const showAnnotationHandler = useCallback((event: Event) => {
      const detail = (event as CustomEvent).detail;
      const { value, index, range } = detail;

      if (!value || !range) return;

      // Call the callback with annotation info
      onShowAnnotationRef.current?.(value, range, index);
    }, []);

    // --- Selection listener ---
    // Use ref so the pointerup handler always calls the latest onSelection callback,
    // even if the React prop has been updated since the listener was attached.
    const onSelectionRef = useRef(onSelection);
    onSelectionRef.current = onSelection;

    // Track current selection range (for re-selecting when clicking inside selection)
    const currentSelectionRange = useRef<Range | null>(null);
    const currentSelectionIndex = useRef<number | undefined>(undefined);
    // Track if there was a selection before pointerdown (for toolbar toggle prevention)
    const hadSelectionOnPointerDown = useRef(false);

    const attachSelectionListener = useCallback((doc: Document) => {
      // Avoid double-registering
      // biome-ignore lint: runtime flag on Document
      if ((doc as any).__readany_selection_registered) return;
      // biome-ignore lint: runtime flag on Document
      (doc as any).__readany_selection_registered = true;

      const handlePointerDown = () => {
        // Record if there's a selection when pointer goes down
        const view = viewRef.current;
        const contents = view?.renderer?.getContents?.();
        if (contents?.[0]?.doc) {
          const iframeDoc = contents[0].doc as Document;
          const sel = iframeDoc.getSelection();
          hadSelectionOnPointerDown.current = !!(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
        }
      };

      const handlePointerUp = (ev: PointerEvent) => {
        // Capture coordinates immediately (before setTimeout)
        const clientX = ev.clientX;
        const clientY = ev.clientY;

        setTimeout(() => {
          const view = viewRef.current;
          const contents = view?.renderer?.getContents?.();
          if (!contents?.[0]?.doc) return;

          const iframeDoc = contents[0].doc as Document;
          const sel = iframeDoc.getSelection();
          const hasSelectionNow = sel && !sel.isCollapsed && sel.toString().trim().length > 0;

          // Check if there's a new selection being made
          const newSel = getSelectionFromView();

          if (newSel) {
            // New selection made - update stored range and notify parent
            currentSelectionRange.current = newSel.range ?? null;
            currentSelectionIndex.current = newSel.chapterIndex;
            onSelectionRef.current?.(newSel);
          } else if (currentSelectionRange.current) {
            // No new selection, but we had a previous selection
            // Check if click was inside the old selection
            const isInsideSelection = isPointerInsideRange(
              currentSelectionRange.current,
              clientX,
              clientY,
            );

            // Selection was cleared (either by clicking inside to dismiss, or outside)
            // Always notify parent to hide the popover
            currentSelectionRange.current = null;
            onSelectionRef.current?.(null);
          } else {
            // No previous selection and no new selection
            // This is a simple click - toggle toolbar if there was no selection before
            if (!hadSelectionOnPointerDown.current && !hasSelectionNow) {
              // Send message to toggle toolbar
              console.log("[handlePointerUp] sending iframe-single-click, bookKey:", bookKey);
              window.postMessage({
                type: "iframe-single-click",
                bookKey,
                clientX,
                clientY,
              }, "*");
            }
          }
        }, 10);
      };
      
      doc.addEventListener("pointerdown", handlePointerDown);
      doc.addEventListener("pointerup", handlePointerUp);
    }, [bookKey]);

    // Helper: check if point is inside a range
    const isPointerInsideRange = (range: Range, x: number, y: number): boolean => {
      const rects = range.getClientRects();
      const padding = 30;
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i]!;
        if (
          x >= rect.left - padding &&
          x <= rect.right + padding &&
          y >= rect.top - padding &&
          y <= rect.bottom + padding
        ) {
          return true;
        }
      }
      return false;
    };

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
              (r) => new DOMRect(r.x + containerRect.x, r.y + containerRect.y, r.width, r.height),
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

      return { text, cfi, chapterIndex, rects: offsetRects, range };
    }, []);

    // Bind foliate events (use viewReady state to ensure re-bind after view creation)
    useFoliateEvents(viewReady ? viewRef.current : null, {
      onLoad: docLoadHandler,
      onRelocate: relocateHandler,
      onDrawAnnotation: drawAnnotationHandler,
      onShowAnnotation: showAnnotationHandler,
    });

    // --- Open book ---
    useEffect(() => {
      if (isViewCreated.current) return;
      isViewCreated.current = true;

      const openBook = async () => {
        try {
          await import("foliate-js/view.js");

          const view = wrappedFoliateView(document.createElement("foliate-view"));
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
          view.addEventListener("draw-annotation", drawAnnotationHandler);
          view.addEventListener("delete-annotation", deleteAnnotationHandler);
          view.addEventListener("show-annotation", showAnnotationHandler);
          setViewReady(true);

          // Navigate to last location or start
          if (lastLocation && !isFixedLayout) {
            await view.init({ lastLocation });
          } else {
            await view.goToFraction(0);
          }
        } catch (err) {
          console.error("[FoliateViewer] Failed to open book:", err);
          onError?.(err instanceof Error ? err : new Error("Failed to open book"));
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
  },
);

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
function applyRendererSettings(view: FoliateView, settings: ViewSettings, isFixedLayout: boolean) {
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
function applyRendererStyles(view: FoliateView, settings: ViewSettings, isFixedLayout: boolean) {
  const renderer = view.renderer;
  if (!renderer?.setStyles) return;

  const themes: Record<string, { bg: string; fg: string; link: string }> = {
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

/**
 * Note tooltip system — uses event delegation with real-time position calculation.
 * No fixed-position hover divs; works correctly after resize/reflow.
 */
const NOTE_TOOLTIP_STYLES = `
  .foliate-note-tooltip {
    position: absolute;
    z-index: 9999;
    max-width: 320px;
    padding: 10px 14px;
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.95);
    color: #f1f5f9;
    font-size: 13px;
    line-height: 1.5;
    box-shadow: 0 8px 24px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.15);
    backdrop-filter: blur(8px);
    pointer-events: none;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 0.15s ease, transform 0.15s ease;
    word-break: break-word;
    white-space: pre-wrap;
    border: 1px solid rgba(100, 116, 139, 0.3);
  }
  .foliate-note-tooltip.visible {
    opacity: 1;
    transform: translateY(0);
  }
  .foliate-note-tooltip::before {
    content: '';
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 6px solid rgba(15, 23, 42, 0.95);
  }
  .foliate-note-tooltip.below::before {
    top: -6px; bottom: auto;
    border-top: none;
    border-bottom: 6px solid rgba(15, 23, 42, 0.95);
  }
  .foliate-note-tooltip .note-content {
    display: -webkit-box;
    -webkit-line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
`;

// Per-doc registry: cfi -> { range, note }
const docNoteRegistries = new WeakMap<Document, Map<string, { range: Range; note: string }>>();

function ensureNoteTooltipSystem(doc: Document) {
  if (doc.getElementById("foliate-note-tooltip-styles")) return;

  // Inject styles
  const style = doc.createElement("style");
  style.id = "foliate-note-tooltip-styles";
  style.textContent = NOTE_TOOLTIP_STYLES;
  doc.head.appendChild(style);

  // Create shared tooltip element
  const tooltip = doc.createElement("div");
  tooltip.className = "foliate-note-tooltip";
  tooltip.id = "foliate-note-shared-tooltip";
  const content = doc.createElement("div");
  content.className = "note-content";
  tooltip.appendChild(content);
  doc.body.appendChild(tooltip);

  let activeCfi: string | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const showTooltip = (note: string, range: Range) => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    content.textContent = note;
    tooltip.classList.remove("below");
    // Make visible off-screen to measure
    tooltip.style.left = "-9999px";
    tooltip.style.top = "-9999px";
    tooltip.classList.add("visible");

    // Get fresh rects from range (correct after resize)
    const rects = range.getClientRects();
    if (rects.length === 0) {
      tooltip.classList.remove("visible");
      return;
    }
    const firstRect = rects[0];
    const scrollX = doc.defaultView?.scrollX || 0;
    const scrollY = doc.defaultView?.scrollY || 0;
    const tooltipW = tooltip.offsetWidth;
    const tooltipH = tooltip.offsetHeight;
    const viewW = doc.documentElement.clientWidth;

    let left = firstRect.left + scrollX + firstRect.width / 2 - tooltipW / 2;
    left = Math.max(8, Math.min(left, viewW - tooltipW - 8 + scrollX));
    let top = firstRect.top + scrollY - tooltipH - 10;
    if (top < scrollY + 8) {
      // Show below
      const lastRect = rects[rects.length - 1];
      top = lastRect.bottom + scrollY + 10;
      tooltip.classList.add("below");
    }
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const hideTooltip = () => {
    hideTimer = setTimeout(() => {
      tooltip.classList.remove("visible");
      activeCfi = null;
    }, 100);
  };

  // Check if a point is inside any rect of a range
  const isPointInRange = (range: Range, x: number, y: number): boolean => {
    for (const rect of range.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return true;
      }
    }
    return false;
  };

  // Event delegation on doc body
  doc.addEventListener("mousemove", (e: MouseEvent) => {
    const registry = docNoteRegistries.get(doc);
    if (!registry || registry.size === 0) return;

    let found: { cfi: string; range: Range; note: string } | null = null;
    for (const [cfi, entry] of registry) {
      if (isPointInRange(entry.range, e.clientX, e.clientY)) {
        found = { cfi, ...entry };
        break;
      }
    }

    if (found) {
      if (activeCfi !== found.cfi) {
        activeCfi = found.cfi;
        showTooltip(found.note, found.range);
      }
    } else if (activeCfi) {
      hideTooltip();
    }
  });
}

function createNoteTooltip(doc: Document, range: Range, note: string, cfi?: string) {
  if (!cfi) return;
  ensureNoteTooltipSystem(doc);
  let registry = docNoteRegistries.get(doc);
  if (!registry) {
    registry = new Map();
    docNoteRegistries.set(doc, registry);
  }
  registry.set(cfi, { range, note });
}

function removeNoteTooltip(doc: Document, cfi: string) {
  const registry = docNoteRegistries.get(doc);
  if (registry) registry.delete(cfi);
}
