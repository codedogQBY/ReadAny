/**
 * ReaderView — main reader page component.
 *
 * Refactored architecture (reference: Readest):
 * 1. File → DocumentLoader.open() → BookDoc (in-memory)
 * 2. BookDoc → FoliateViewer (React component)
 * 3. FoliateViewer → <foliate-view> (Web Component)
 *
 * ReaderView is responsible for:
 * - Loading the book file from disk (via Tauri)
 * - Pre-parsing it with DocumentLoader
 * - Managing reading state (progress, location, selection)
 * - Rendering the FoliateViewer and surrounding UI (toolbar, footer, panels)
 */
import { ReadSettingsPanel } from "@/components/settings/ReadSettings";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useReadingSession } from "@/hooks/use-reading-session";
import { DocumentLoader } from "@/lib/reader/document-loader";
import type { BookDoc, BookFormat } from "@/lib/reader/document-loader";
import { isFixedLayoutFormat } from "@/lib/reader/document-loader";
import type { RelocateDetail, TOCItem, BookSelection, FoliateViewerHandle } from "./FoliateViewer";
import { FoliateViewer } from "./FoliateViewer";
import { throttle } from "@/lib/utils/throttle";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useNotebookStore } from "@/stores/notebook-store";
import type { HighlightColor } from "@/types";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FooterBar } from "./FooterBar";
import { NotebookPanel } from "./NotebookPanel";
import { ReaderToolbar } from "./ReaderToolbar";
import { SearchBar } from "./SearchBar";
import { SelectionPopover } from "./SelectionPopover";
import { TOCPanel } from "./TOCPanel";
import { TranslationPopover } from "./TranslationPopover";

// --- Tauri file loading ---
async function loadFileAsBlob(filePath: string): Promise<Blob> {
  try {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const assetUrl = convertFileSrc(filePath);
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
    return await response.blob();
  } catch {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const fileBytes = await readFile(filePath);
    return new Blob([fileBytes]);
  }
}

// --- Blob cache ---
const fileBlobCache = new Map<string, Blob>();
const MAX_CACHE_SIZE = 5;

async function getCachedBlob(filePath: string): Promise<Blob> {
  const cached = fileBlobCache.get(filePath);
  if (cached) return cached;

  const blob = await loadFileAsBlob(filePath);

  if (fileBlobCache.size >= MAX_CACHE_SIZE) {
    const firstKey = fileBlobCache.keys().next().value;
    if (firstKey) fileBlobCache.delete(firstKey);
  }
  fileBlobCache.set(filePath, blob);
  return blob;
}

/**
 * Load a book file from disk and parse it with DocumentLoader.
 * Returns both the BookDoc and detected format.
 */
async function loadAndParseBook(
  filePath: string,
): Promise<{ bookDoc: BookDoc; format: BookFormat }> {
  console.log("[loadAndParseBook] start, filePath:", filePath);
  const blob = await getCachedBlob(filePath);
  console.log("[loadAndParseBook] blob loaded, size:", blob.size);

  const fileName = filePath.split("/").pop() || "book.epub";
  const file = new File([blob], fileName, {
    type: blob.type || "application/octet-stream",
  });

  const loader = new DocumentLoader(file);
  const { book, format } = await loader.open();
  console.log("[loadAndParseBook] parsed, format:", format, "sections:", book.sections?.length);
  return { bookDoc: book, format };
}

// --- Auto-hide controls hook ---
// Strategy:
// - Toolbar/FooterBar each have an invisible hover trigger zone (onMouseEnter → show)
// - Inside iframe: any single-click toggles visibility (no coordinate conversion needed)
// - Tauri's window.screenX is unreliable, so we avoid screen-to-page coord mapping
// - When clicking inside a selection, the click is not forwarded (handled in iframe-event-handlers)

function useAutoHideControls(
  containerRef: React.RefObject<HTMLDivElement | null>,
  delay = 2000,
  keepVisible = false,
) {
  const [isVisible, setIsVisible] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveringRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const hideAfterDelay = useCallback(() => {
    if (keepVisible || isHoveringRef.current) return;
    clearTimer();
    timeoutRef.current = setTimeout(() => setIsVisible(false), delay);
  }, [clearTimer, delay, keepVisible]);

  const showAndScheduleHide = useCallback(() => {
    setIsVisible(true);
    hideAfterDelay();
  }, [hideAfterDelay]);

  // Listen for iframe events
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!containerRef.current) return;

      // Handle single-click toggle
      if (data?.type !== "iframe-single-click") return;

      console.log("[ReaderView] received iframe-single-click, current isVisible:");

      setIsVisible((prev) => {
        console.log("[ReaderView] prev:", prev, "-> new:", !prev);
        if (prev) {
          clearTimer();
          return false;
        }
        showAndScheduleHide();
        return true;
      });
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [containerRef, clearTimer, showAndScheduleHide]);

  // Mouse enter/leave handlers for toolbar area
  const handleMouseEnter = useCallback(() => {
    isHoveringRef.current = true;
    clearTimer();
    setIsVisible(true);
  }, [clearTimer]);

  const handleMouseLeave = useCallback(() => {
    isHoveringRef.current = false;
    hideAfterDelay();
  }, [hideAfterDelay]);

  useEffect(() => {
    hideAfterDelay();
    return () => clearTimer();
  }, [hideAfterDelay, clearTimer]);

  useEffect(() => {
    if (keepVisible) {
      setIsVisible(true);
    } else {
      hideAfterDelay();
    }
  }, [keepVisible, hideAfterDelay]);

  return { isVisible, handleMouseEnter, handleMouseLeave };
}

// --- Main component ---

interface ReaderViewProps {
  bookId: string;
  tabId: string;
}

export function ReaderView({ bookId, tabId }: ReaderViewProps) {
  const readerTab = useReaderStore((s) => s.tabs[tabId]);
  const appTab = useAppStore((s) => s.tabs.find((t) => t.id === tabId));
  const viewSettings = useSettingsStore((s) => s.readSettings);
  const setProgress = useReaderStore((s) => s.setProgress);
  const setChapter = useReaderStore((s) => s.setChapter);
  const setSelectedText = useReaderStore((s) => s.setSelectedText);

  const books = useLibraryStore((s) => s.books);
  const updateBook = useLibraryStore((s) => s.updateBook);
  const book = books.find((b) => b.id === bookId);

  const highlights = useAnnotationStore((s) => s.highlights);
  const loadAnnotations = useAnnotationStore((s) => s.loadAnnotations);

  // Track reading session for statistics
  useReadingSession(bookId, tabId);

  // Ref to FoliateViewer imperative handle
  const foliateRef = useRef<FoliateViewerHandle>(null);

  // Track which highlights have been rendered (id -> {cfi, note}) to detect changes
  const renderedHighlightsRef = useRef<Map<string, { cfi: string; hasNote: boolean }>>(new Map());

  // Track when foliate is ready to receive annotations
  const [foliateReady, setFoliateReady] = useState(false);

  // Reset rendered highlights tracking when book changes
  useEffect(() => {
    renderedHighlightsRef.current.clear();
    setFoliateReady(false);
  }, [bookId]);

  // Navigate to initialCfi when foliate is ready (from NotesPage navigation)
  useEffect(() => {
    if (!foliateReady || !appTab?.initialCfi) return;

    const timer = setTimeout(() => {
      if (foliateRef.current && appTab.initialCfi) {
        foliateRef.current.goToCFI(appTab.initialCfi);
        // Clear the initialCfi after navigation to prevent re-navigation
        useAppStore.getState().addTab({ ...appTab, initialCfi: undefined });
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [foliateReady, appTab]);

  // Sync highlights to FoliateViewer when they change or when foliate becomes ready
  // Use a timeout to ensure the foliate view is fully initialized
  useEffect(() => {
    if (!foliateReady) return;

    // Delay to ensure foliate view is fully ready
    const timer = setTimeout(() => {
      if (!foliateRef.current) return;

      // Filter highlights for this book
      const bookHighlights = highlights.filter((h) => h.bookId === bookId);
      const currentIds = new Set(bookHighlights.map((h) => h.id));

      // Remove highlights that are no longer in the store
      for (const [id, data] of renderedHighlightsRef.current) {
        if (!currentIds.has(id)) {
          foliateRef.current.deleteAnnotation({ value: data.cfi });
          renderedHighlightsRef.current.delete(id);
        }
      }

      // Add new highlights or update existing ones if note status changed
      for (const h of bookHighlights) {
        if (!h.cfi) continue;

        const existing = renderedHighlightsRef.current.get(h.id);
        const hasNote = !!h.note;

        // Check if we need to re-render (new highlight or note status changed)
        const needsRender = !existing || existing.hasNote !== hasNote;

        if (needsRender) {
          // Remove old annotation if exists
          if (existing) {
            foliateRef.current.deleteAnnotation({ value: existing.cfi });
          }

          // Add new/updated annotation
          foliateRef.current.addAnnotation({
            value: h.cfi,
            type: "highlight",
            color: h.color || "yellow",
            note: h.note, // Pass note for wavy underline + tooltip
          });
          renderedHighlightsRef.current.set(h.id, { cfi: h.cfi, hasNote });
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [highlights, foliateReady, bookId]);

  // Book document state
  const [bookDoc, setBookDoc] = useState<BookDoc | null>(null);
  const [bookFormat, setBookFormat] = useState<BookFormat>("EPUB");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [selection, setSelection] = useState<BookSelection | null>(null);
  const [selectionPos, setSelectionPos] = useState({ x: 0, y: 0 });
  const [tocItems, setTocItems] = useState<TOCItem[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationText, setTranslationText] = useState("");
  const [translationPos, setTranslationPos] = useState({ x: 0, y: 0 });
  const [searchResults, setSearchResults] = useState<number>(0);
  const [searchIndex, setSearchIndex] = useState<number>(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const { t } = useTranslation();
  const isInitializedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-hide controls
  const keepControlsVisible = showSearch || showToc || showSettings;
  const {
    isVisible: controlsVisible,
    handleMouseEnter,
    handleMouseLeave,
  } = useAutoHideControls(containerRef, 2000, keepControlsVisible);

  // Throttled progress save
  const throttledSaveProgress = useRef(
    throttle((bId: string, prog: number, cfi: string) => {
      updateBook(bId, {
        progress: prog,
        currentCfi: cfi,
        lastOpenedAt: Date.now(),
      });
    }, 5000),
  ).current;

  // --- Load book on mount ---
  useEffect(() => {
    if (!book?.filePath || isInitializedRef.current) return;
    isInitializedRef.current = true;

    const initBook = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const { bookDoc, format } = await loadAndParseBook(book.filePath!);
        setBookDoc(bookDoc);
        setBookFormat(format);
      } catch (err) {
        console.error("[ReaderView] Failed to load book:", err);
        setError(err instanceof Error ? err.message : "Failed to load book");
        setIsLoading(false);
      }
    };

    initBook();

    return () => {
      isInitializedRef.current = false;
    };
  }, [book?.filePath]);

  // Load annotations
  useEffect(() => {
    loadAnnotations(bookId);
  }, [bookId, loadAnnotations]);

  // Handle book not found
  useEffect(() => {
    if (!book?.filePath) {
      const timer = setTimeout(() => {
        if (!book?.filePath) {
          setIsLoading(false);
          setError(t("reader.noBookFile", { bookId }));
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [book?.filePath, bookId, t]);

  // --- Event handlers from FoliateViewer ---
  const handleRelocate = useCallback(
    (detail: RelocateDetail) => {
      const progress = detail.fraction ?? 0;
      const cfi = detail.cfi || `section-${detail.section?.current ?? 0}`;

      // Update reader store (immediate)
      setProgress(tabId, progress, cfi);

      // Update chapter info
      if (detail.tocItem?.label) {
        setChapter(tabId, detail.section?.current ?? 0, detail.tocItem.label);
      }

      // Track pages (reference: Readest progressRelocateHandler)
      // For fixed layout (PDF/CBZ): use section index (real pages)
      // For reflowable (EPUB): use location (virtual loc based on sizePerLoc=1500)
      //   location.current is 0-based; display as current+1 / total
      //   At end of book, clamp to total to prevent overflow
      if (isFixedLayoutFormat(bookFormat) && detail.section) {
        setTotalPages(detail.section.total);
        setCurrentPage(detail.section.current + 1);
      } else if (detail.location) {
        const { current, total } = detail.location;
        // Check if renderer is at the very end (same as Readest's atEnd check)
        const view = foliateRef.current?.getView();
        const atEnd = view?.renderer?.atEnd || false;
        const currentLoc = atEnd && total > 0 ? total : current + 1;
        setTotalPages(total);
        setCurrentPage(currentLoc);
      }

      // Throttled save to DB
      throttledSaveProgress(bookId, progress, cfi);
    },
    [tabId, bookId, bookFormat, setProgress, setChapter, throttledSaveProgress],
  );

  const handleTocReady = useCallback((toc: TOCItem[]) => {
    setTocItems(toc);
  }, []);

  const handleLoaded = useCallback(() => {
    setIsLoading(false);
    // Mark foliate as ready to receive annotations
    setFoliateReady(true);
  }, []);

  // Handle section load (chapter change) - re-render all highlights
  // This is critical: when foliate-js loads a new section (chapter),
  // it replaces the iframe content and all previously added annotations are lost.
  // We need to re-add all highlights for the current book.
  const handleSectionLoad = useCallback(
    (sectionIndex: number) => {
      // Delay slightly to ensure foliate view is ready
      setTimeout(() => {
        if (!foliateRef.current) return;

        // Get all highlights for this book
        const bookHighlights = highlights.filter((h) => h.bookId === bookId);

        // Clear tracking since we're reloading
        renderedHighlightsRef.current.clear();

        // Re-add all highlights
        for (const h of bookHighlights) {
          if (h.cfi) {
            foliateRef.current.addAnnotation({
              value: h.cfi,
              type: "highlight",
              color: h.color || "yellow",
              note: h.note, // Pass note for wavy underline + tooltip
            });
            renderedHighlightsRef.current.set(h.id, { cfi: h.cfi, hasNote: !!h.note });
          }
        }

        console.log(
          `[ReaderView] Section ${sectionIndex} loaded, re-rendered ${bookHighlights.length} highlights`,
        );
      }, 100);
    },
    [highlights, bookId],
  );

  const handleError = useCallback((err: Error) => {
    setError(err.message);
    setIsLoading(false);
  }, []);

  const handleSelection = useCallback(
    (sel: BookSelection | null) => {
      setSelection(sel);
      if (sel) {
        setSelectedText(tabId, sel.text, null);
        if (sel.rects.length > 0) {
          // SelectionPopover uses absolute positioning relative to containerRef
          const containerRect = containerRef.current?.getBoundingClientRect();
          if (!containerRect) return;

          const containerW = containerRect.width;
          const containerH = containerRect.height;

          // Popover dimensions
          const popoverW = 200;
          const popoverH = 44;
          const gap = 8; // Gap between selection and popover
          const padding = 8; // Minimum padding from edges

          // Reference: readest getPosition & getPopupPosition
          // firstRect/lastRect are already in viewport coordinates (converted in FoliateViewer)
          // Convert to container-relative coordinates
          // IMPORTANT: rects from getClientRects() are NOT sorted by position!
          // We need to find the actual topmost and bottommost rects.
          const containerRelativeRects = sel.rects.map((r) => ({
            top: r.top - containerRect.top,
            bottom: r.bottom - containerRect.top,
            left: r.left - containerRect.left,
            right: r.right - containerRect.left,
          }));
          
          // Find the topmost rect (smallest top value)
          const topmostRect = containerRelativeRects.reduce((min, r) => 
            r.top < min.top ? r : min
          );
          // Find the bottommost rect (largest bottom value)
          const bottommostRect = containerRelativeRects.reduce((max, r) => 
            r.bottom > max.bottom ? r : max
          );

          const firstTop = topmostRect.top;
          const firstLeft = topmostRect.left;
          const firstRight = topmostRect.right;
          const lastBottom = bottommostRect.bottom;

          // Calculate X position (centered on selection)
          const centerX = (firstLeft + firstRight) / 2;
          let x = centerX - popoverW / 2;
          // Clamp X so popover doesn't overflow left/right
          x = Math.max(padding, Math.min(x, containerW - popoverW - padding));

          // Calculate potential positions above and below
          const toolbarHeight = controlsVisible ? 44 : 0;
          
          // Position above selection (y is the top of popover)
          const yAbove = firstTop - popoverH - gap;
          // Position below selection (y is the top of popover)  
          const yBelow = lastBottom + gap;

          // Check if positions are valid (within visible container area)
          const aboveValid = yAbove >= toolbarHeight + padding;
          const belowValid = yBelow + popoverH + padding <= containerH;

          let y: number;
          if (aboveValid && belowValid) {
            // Both positions valid - choose the one with more space
            const spaceAbove = firstTop - toolbarHeight;
            const spaceBelow = containerH - lastBottom;
            y = spaceAbove > spaceBelow ? yAbove : yBelow;
          } else if (aboveValid) {
            y = yAbove;
          } else if (belowValid) {
            y = yBelow;
          } else {
            // Neither position ideal - pick the one that fits better
            // Prefer below if there's any space, otherwise clamp to toolbar area
            if (lastBottom + popoverH + padding <= containerH) {
              y = yBelow;
            } else {
              y = Math.max(toolbarHeight + padding, Math.min(yAbove, yBelow));
            }
          }

          setSelectionPos({ x, y });
        }
      } else {
        setSelectedText(tabId, "", null);
      }
    },
    [tabId, setSelectedText, controlsVisible],
  );

  // --- Navigation (for toolbar buttons) ---
  const handleNavPrev = useCallback(() => {
    foliateRef.current?.goPrev();
  }, []);
  const handleNavNext = useCallback(() => {
    foliateRef.current?.goNext();
  }, []);

  const handleGoToChapter = useCallback(
    (index: number) => {
      const item = tocItems[index];
      if (item?.href) {
        foliateRef.current?.goToHref(item.href);
      }
    },
    [tocItems],
  );

  // --- Selection actions ---
  const handleHighlight = useCallback(
    (color: HighlightColor = "yellow") => {
      if (selection && selection.cfi) {
        const highlightId = crypto.randomUUID();

        // Add to store (for persistence)
        useAnnotationStore.getState().addHighlight({
          id: highlightId,
          bookId,
          text: selection.text,
          cfi: selection.cfi,
          color,
          chapterTitle: readerTab?.chapterTitle || undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Immediately render on page (don't wait for useEffect)
        foliateRef.current?.addAnnotation({
          value: selection.cfi,
          type: "highlight",
          color,
        });

        // Track as rendered
        renderedHighlightsRef.current.set(highlightId, { cfi: selection.cfi, hasNote: false });
      }
      setSelection(null);
    },
    [selection, bookId, readerTab?.chapterTitle],
  );

  // Handle note button - open notebook panel with pending note
  const handleNote = useCallback(() => {
    if (selection && selection.cfi) {
      // Check if this selection is already highlighted
      const existingHighlight = highlights.find(
        (h) => h.bookId === bookId && h.cfi === selection.cfi,
      );

      if (existingHighlight) {
        // Edit note on existing highlight
        useNotebookStore.getState().startEditNote(existingHighlight);
      } else {
        // Start new note
        useNotebookStore.getState().startNewNote({
          text: selection.text,
          cfi: selection.cfi,
          chapterTitle: readerTab?.chapterTitle,
        });
      }
    }
    setSelection(null);
  }, [selection, bookId, highlights, readerTab?.chapterTitle]);

  const handleCopy = useCallback(() => {
    if (selection?.text) navigator.clipboard.writeText(selection.text);
    setSelection(null);
  }, [selection]);

  // Handle removing an existing highlight
  const handleRemoveHighlight = useCallback(() => {
    if (selection?.annotated && selection?.highlightId && selection?.cfi) {
      // Remove from store
      useAnnotationStore.getState().removeHighlight(selection.highlightId);

      // Remove from view
      foliateRef.current?.deleteAnnotation({ value: selection.cfi });

      // Remove from rendered tracking
      renderedHighlightsRef.current.delete(selection.highlightId);
    }
    setSelection(null);
  }, [selection]);

  // Handle show-annotation event (user clicked on existing highlight)
  const handleShowAnnotation = useCallback(
    (cfi: string, range: Range, index: number) => {
      // Find the highlight with this CFI
      const highlight = highlights.find((h) => h.bookId === bookId && h.cfi === cfi);
      if (!highlight) return;

      // Get rects for positioning the popover
      const rects = Array.from(range.getClientRects());

      // Get container and iframe for coordinate transformation
      const containerRect = containerRef.current?.getBoundingClientRect();
      const view = foliateRef.current?.getView();
      const contents = view?.renderer?.getContents?.();

      let offsetRects: DOMRect[] = rects;
      if (contents?.[0]?.element) {
        const iframe = contents[0].element as HTMLIFrameElement;
        const iframeRect = iframe.getBoundingClientRect();
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
      }

      // Create selection object for the existing annotation
      const sel: BookSelection = {
        text: highlight.text,
        cfi,
        chapterIndex: index,
        rects: offsetRects,
        annotated: true,
        highlightId: highlight.id,
        color: highlight.color,
      };

      setSelection(sel);

      // Position the popover
      if (offsetRects.length > 0) {
        const firstRect = offsetRects[0];
        const offsetX = containerRect?.left ?? 0;
        const offsetY = containerRect?.top ?? 0;
        const containerW = containerRect?.width ?? 800;
        const containerH = containerRect?.height ?? 600;

        const popoverHalfW = 100;
        const popoverH = 44;

        let x = firstRect.left + firstRect.width / 2 - offsetX;
        x = Math.max(popoverHalfW + 4, Math.min(x, containerW - popoverHalfW - 4));

        let y = firstRect.top - popoverH - 4 - offsetY;
        if (y < 4) {
          y = firstRect.bottom + 8 - offsetY;
        }
        y = Math.max(4, Math.min(y, containerH - popoverH - 4));

        setSelectionPos({ x, y });
      }
    },
    [highlights, bookId],
  );

  // Handle show-note-panel event (user clicked on wavy underline with note)
  const handleShowNotePanel = useCallback(
    (cfi: string) => {
      // Find the highlight with this CFI
      const highlight = highlights.find((h) => h.bookId === bookId && h.cfi === cfi);
      if (!highlight) return;

      // Start editing this highlight's note (this also opens the notebook panel)
      useNotebookStore.getState().startEditNote(highlight);
    },
    [highlights, bookId],
  );

  const handleTranslate = useCallback(() => {
    if (selection?.text) {
      setTranslationText(selection.text);
      setTranslationPos(selectionPos);
      setShowTranslation(true);
    }
    setSelection(null);
  }, [selection, selectionPos]);

  const handleAskAI = useCallback(() => {
    if (selection?.text) {
      // Store in sessionStorage in case ChatPanel is not mounted yet
      // ChatPanel will check and consume this on mount
      sessionStorage.setItem(
        `pending-ai-quote-${bookId}`,
        JSON.stringify({
          selectedText: selection.text,
          bookId,
          chapterTitle: readerTab?.chapterTitle,
        }),
      );

      // Open chat panel
      setShowChat(true);

      // Also dispatch event for immediate handling if panel is already open
      window.dispatchEvent(
        new CustomEvent("ask-ai-from-reader", {
          detail: {
            selectedText: selection.text,
            bookId,
            chapterTitle: readerTab?.chapterTitle,
          },
        }),
      );
    }
    setSelection(null);
  }, [selection, bookId, readerTab?.chapterTitle]);

  const handleCloseSelection = useCallback(() => setSelection(null), []);
  const handleToggleSearch = useCallback(() => setShowSearch((p) => !p), []);
  const handleToggleToc = useCallback(() => setShowToc((p) => !p), []);
  const handleToggleChat = useCallback(() => setShowChat((p) => !p), []);
  const handleToggleSettings = useCallback(() => setShowSettings((p) => !p), []);

  // --- Search logic ---
  const searchGeneratorRef = useRef<AsyncGenerator | null>(null);
  const searchResultsListRef = useRef<Array<{ cfi: string; excerpt: string }>>([]);

  const handleSearch = useCallback(async (query: string) => {
    // Clear previous search
    foliateRef.current?.clearSearch();
    searchResultsListRef.current = [];

    if (!query.trim()) {
      setSearchResults(0);
      setSearchIndex(0);
      return;
    }

    const gen = foliateRef.current?.search({ query });
    if (!gen) {
      setSearchResults(0);
      setSearchIndex(0);
      return;
    }
    searchGeneratorRef.current = gen;

    // Collect results from the async generator
    // foliate-js full-book search yields two formats:
    //   - { progress: number }  (progress update, skip)
    //   - { label, subitems: [{ cfi, excerpt }] }  (per-section results)
    // Single-section search yields { cfi, excerpt } directly.
    const results: Array<{ cfi: string; excerpt: string }> = [];
    try {
      for await (const result of gen) {
        const r = result as {
          cfi?: string;
          excerpt?: string;
          progress?: number;
          subitems?: Array<{ cfi: string; excerpt: string }>;
        } | undefined;
        if (!r) continue;

        if (r.subitems) {
          // Full-book search: per-section grouped results
          for (const item of r.subitems) {
            if (item.cfi) {
              results.push({ cfi: item.cfi, excerpt: item.excerpt || "" });
            }
          }
          // Incrementally update UI as results come in
          searchResultsListRef.current = results;
          setSearchResults(results.length);
          if (results.length === 1) {
            setSearchIndex(0);
            foliateRef.current?.goToCFI(results[0].cfi);
          }
        } else if (r.cfi) {
          // Single-section search: flat results
          results.push({ cfi: r.cfi, excerpt: r.excerpt || "" });
        }
        // Skip progress-only events ({ progress: number })
      }
    } catch {
      // Generator may be interrupted by a new search
    }

    searchResultsListRef.current = results;
    setSearchResults(results.length);
    if (results.length > 0 && searchResultsListRef.current.length <= results.length) {
      setSearchIndex(0);
      foliateRef.current?.goToCFI(results[0].cfi);
    }
  }, []);

  const navigateSearchResult = useCallback((direction: "next" | "prev") => {
    const results = searchResultsListRef.current;
    if (results.length === 0) return;

    setSearchIndex((prev) => {
      const next =
        direction === "next"
          ? (prev + 1) % results.length
          : (prev - 1 + results.length) % results.length;
      foliateRef.current?.goToCFI(results[next].cfi);
      return next;
    });
  }, []);

  if (!readerTab) {
    return <div className="flex h-full items-center justify-center">{t("common.loading")}</div>;
  }

  return (
    <div className="flex h-full bg-muted/30 p-1">
      {/* Notebook sidebar — LEFT side */}
      <NotebookSidebarWrapper
        bookId={bookId}
        onGoToCfi={(cfi) => foliateRef.current?.goToCFI(cfi)}
        onAddAnnotation={(cfi, color, note) => {
          foliateRef.current?.addAnnotation({
            value: cfi,
            type: "highlight",
            color,
            note,
          });
        }}
        onDeleteAnnotation={(cfi) => {
          foliateRef.current?.deleteAnnotation({ value: cfi });
        }}
      />

      {/* Main reading area */}
      <div className="relative flex flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm">
        {/* Search bar — stacked above content when visible */}
        {showSearch && (
          <SearchBar
            onSearch={handleSearch}
            onNext={() => navigateSearchResult("next")}
            onPrev={() => navigateSearchResult("prev")}
            onClose={() => {
              setShowSearch(false);
              setSearchResults(0);
              setSearchIndex(0);
              foliateRef.current?.clearSearch();
            }}
            resultCount={searchResults}
            currentIndex={searchIndex}
          />
        )}

        {/* Content area — takes full remaining space */}
        <div className="relative flex flex-1 overflow-hidden">
          {/* Reading area — FoliateViewer */}
          <div className="relative flex-1 overflow-hidden" ref={containerRef}>
            {bookDoc ? (
              <FoliateViewer
                ref={foliateRef}
                bookKey={bookId}
                bookDoc={bookDoc}
                format={bookFormat}
                viewSettings={viewSettings}
                lastLocation={book?.currentCfi || undefined}
                onRelocate={handleRelocate}
                onTocReady={handleTocReady}
                onLoaded={handleLoaded}
                onSectionLoad={handleSectionLoad}
                onError={handleError}
                onSelection={handleSelection}
                onShowAnnotation={handleShowAnnotation}
                onShowNotePanel={handleShowNotePanel}
                onToggleSearch={handleToggleSearch}
                onToggleToc={handleToggleToc}
                onToggleChat={handleToggleChat}
              />
            ) : isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                  <p className="text-sm text-muted-foreground">{t("reader.loadingBook")}</p>
                </div>
              </div>
            ) : null}

            {/* Error state */}
            {error && !isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background">
                <div className="flex max-w-md flex-col items-center gap-3 px-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                    <span className="text-lg text-destructive">!</span>
                  </div>
                  <p className="text-sm font-medium text-destructive">{t("reader.loadFailed")}</p>
                  <p className="text-xs text-muted-foreground">{error}</p>
                  <button
                    type="button"
                    className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                    onClick={() => {
                      if (book?.filePath) {
                        isInitializedRef.current = false;
                        setError(null);
                        setBookDoc(null);
                        // Trigger re-init
                        setIsLoading(true);
                        loadAndParseBook(book.filePath)
                          .then(({ bookDoc, format }) => {
                            setBookDoc(bookDoc);
                            setBookFormat(format);
                            isInitializedRef.current = true;
                          })
                          .catch((err) => {
                            setError(err instanceof Error ? err.message : "Failed");
                            setIsLoading(false);
                          });
                      }
                    }}
                  >
                    {t("common.retry")}
                  </button>
                </div>
              </div>
            )}

            {/* Selection popover */}
            {selection && (
              <SelectionPopover
                position={selectionPos}
                selectedText={selection.text}
                annotated={selection.annotated}
                currentColor={selection.color as HighlightColor | undefined}
                isPdf={bookFormat === "PDF"}
                onHighlight={handleHighlight}
                onRemoveHighlight={handleRemoveHighlight}
                onNote={handleNote}
                onCopy={handleCopy}
                onTranslate={handleTranslate}
                onAskAI={handleAskAI}
                onClose={handleCloseSelection}
              />
            )}

            {/* Translation popover */}
            {showTranslation && translationText && (
              <TranslationPopover
                text={translationText}
                position={translationPos}
                onClose={() => {
                  setShowTranslation(false);
                  setTranslationText("");
                }}
              />
            )}
          </div>

          {/* Floating Toolbar — overlays content area */}
          <ReaderToolbar
            tabId={tabId}
            isVisible={controlsVisible}
            onPrev={handleNavPrev}
            onNext={handleNavNext}
            tocItems={tocItems}
            onGoToChapter={handleGoToChapter}
            onToggleSearch={handleToggleSearch}
            onToggleToc={handleToggleToc}
            onToggleSettings={handleToggleSettings}
            onToggleChat={handleToggleChat}
            isChatOpen={showChat}
            isFixedLayout={isFixedLayoutFormat(bookFormat)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />

          {/* Floating Footer bar — overlays content area */}
          <FooterBar
            tabId={tabId}
            totalPages={totalPages}
            currentPage={currentPage}
            isVisible={controlsVisible}
            onPrev={handleNavPrev}
            onNext={handleNavNext}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
        </div>

        {/* TOC overlay — floats above toolbar, content, and footer */}
        {showToc && (
          <>
            <div className="absolute inset-0 z-40 bg-black/20" onClick={() => setShowToc(false)} />
            <div className="absolute top-2 bottom-2 left-0 z-50 flex animate-in slide-in-from-left duration-200">
              <TOCPanel
                tocItems={tocItems}
                onGoToChapter={(index) => {
                  handleGoToChapter(index);
                  setShowToc(false);
                }}
                onClose={() => setShowToc(false)}
                tabId={tabId}
              />
            </div>
          </>
        )}

        {/* Settings overlay */}
        {showSettings && (
          <>
            <div
              className="absolute inset-0 z-40 bg-black/20"
              onClick={() => setShowSettings(false)}
            />
            <div className="absolute top-12 right-2 z-50 w-80 animate-in slide-in-from-top-2 duration-200 rounded-lg border border-border/60 bg-background shadow-lg">
              <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
                <span className="text-xs font-medium">{t("settings.reading_title")}</span>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setShowSettings(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <ReadSettingsPanel />
            </div>
          </>
        )}
      </div>

      {/* AI Chat sidebar — RIGHT side */}
      {showChat && (
        <div className="ml-1 flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/40 px-3">
            <span className="text-xs font-medium text-foreground">{t("chat.aiAssistant")}</span>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setShowChat(false)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ChatPanel book={book} />
          </div>
        </div>
      )}
    </div>
  );
}

// Separate component to use notebook store hook
function NotebookSidebarWrapper({
  bookId,
  onGoToCfi,
  onAddAnnotation,
  onDeleteAnnotation,
}: {
  bookId: string;
  onGoToCfi: (cfi: string) => void;
  onAddAnnotation: (cfi: string, color: string, note?: string) => void;
  onDeleteAnnotation: (cfi: string) => void;
}) {
  const isOpen = useNotebookStore((s) => s.isOpen);
  const closeNotebook = useNotebookStore((s) => s.closeNotebook);

  if (!isOpen) return null;

  return (
    <div className="mr-1 flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm">
      <NotebookPanel
        bookId={bookId}
        onClose={closeNotebook}
        onGoToCfi={onGoToCfi}
        onAddAnnotation={onAddAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
      />
    </div>
  );
}
