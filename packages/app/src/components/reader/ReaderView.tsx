import { ChatPanel } from "@/components/chat/ChatPanel";
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
import { useReadingSession } from "@/hooks/use-reading-session";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useResolvedSrc } from "@/hooks/use-resolved-src";
import { hasSeenReaderTour, startReaderTour } from "@/lib/reader-tour";
import { DocumentLoader } from "@/lib/reader/document-loader";
import type { BookDoc, BookFormat } from "@/lib/reader/document-loader";
import { isFixedLayoutBook } from "@/lib/reader/document-loader";
import { resolveDesktopDataPath } from "@/lib/storage/desktop-library-root";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useMissingBookPromptStore } from "@/stores/missing-book-prompt-store";
import { useNotebookStore } from "@/stores/notebook-store";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTTSStore } from "@/stores/tts-store";
import { useChapterTranslation } from "@readany/core/hooks";
import { getPlatformService } from "@readany/core/services";
import { getCSSFontFace, useFontStore, useReadingSessionStore } from "@readany/core/stores";
import { useRubyStore } from "@readany/core/stores/ruby-store";
import { splitNarrationText } from "@readany/core/tts";
import type { CitationPart, HighlightColor } from "@readany/core/types";
import { eventBus } from "@readany/core/utils/event-bus";
import { throttle } from "@readany/core/utils/throttle";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BookmarkRibbon } from "./BookmarkRibbon";
import type { BookSelection, FoliateViewerHandle, RelocateDetail, TOCItem } from "./FoliateViewer";
import { FoliateViewer } from "./FoliateViewer";
import { FooterBar } from "./FooterBar";
import { NotebookPanel } from "./NotebookPanel";
import { ReaderToolbar } from "./ReaderToolbar";
import { ResizeHandle } from "./ResizeHandle";
import { SearchBar } from "./SearchBar";
import { SelectionPopover } from "./SelectionPopover";
import { TOCPanel } from "./TOCPanel";
import { TTSPage } from "./TTSPage";
import { TranslationPopover } from "./TranslationPopover";

const REFLOWABLE_CHARACTERS_PER_LOCATION = 1500;
const MAX_TRACKED_LOCATION_DELTA = 20;
const MAX_TRACKED_PAGE_DELTA = 20;
const MAX_TRACKED_FRACTION_DELTA = 0.08;
const INITIAL_PROGRESS_RESTORE_GUARD_MS = 1800;
const PROGRAMMATIC_NAV_GUARD_MS = 1200;
const BOOK_IMPORT_FILTERS = [
  {
    name: "Books",
    extensions: ["epub", "pdf", "mobi", "azw", "azw3", "cbz", "fb2", "fbz", "txt", "umd"],
  },
];

function countReadableCharacters(doc: Document): number {
  const rawText = doc.body?.textContent ?? "";
  const normalizedText = rawText.replace(/\s+/g, "");
  return normalizedText.length;
}

async function measureReflowableBookCharacters(bookDoc: BookDoc): Promise<number | null> {
  const sections = bookDoc.sections ?? [];
  if (sections.length === 0) return null;

  let totalCharacters = 0;

  for (const section of sections) {
    try {
      const doc = await section.createDocument();
      const sectionCharacters = countReadableCharacters(doc);
      if (sectionCharacters > 0) {
        totalCharacters += sectionCharacters;
      }
    } catch (error) {
      console.warn("[ReaderView] Failed to measure section characters", {
        href: section.href,
        error,
      });
    }
  }

  return totalCharacters > 0 ? totalCharacters : null;
}

// --- Tauri file loading ---
async function loadFileAsBlob(filePath: string): Promise<Blob> {
  // Resolve managed relative paths (e.g., "books/{id}.epub") to the active desktop library root.
  const resolvedPath = await resolveDesktopDataPath(filePath);

  try {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const assetUrl =
      resolvedPath.startsWith("asset://") || resolvedPath.startsWith("http")
        ? resolvedPath
        : convertFileSrc(resolvedPath);
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
    return await response.blob();
  } catch {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const fileBytes = await readFile(resolvedPath);
    return new Blob([fileBytes]);
  }
}

// --- Blob cache ---
const fileBlobCache = new Map<string, Blob>();
const MAX_CACHE_SIZE = 5;

/** Remove a specific file from the blob cache (called on tab close / hibernate) */
export function evictBlobCache(filePath: string): void {
  fileBlobCache.delete(filePath);
}

/** Clear all entries from the blob cache */
export function clearBlobCache(): void {
  fileBlobCache.clear();
}

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

function getTTSSegmentIdentity(
  segment: { text?: string | null; cfi?: string | null } | null | undefined,
) {
  return `${segment?.cfi || ""}::${String(segment?.text || "")
    .replace(/\s+/g, " ")
    .trim()}`;
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
  bookKey: string,
  onPrev?: () => void,
  onNext?: () => void,
  delay = 2000,
  keepVisible = false,
  isDoublePage = false,
  isScrollMode = false,
  isFixedLayout = false,
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
      void (async () => {
        const data = event.data;
        if (!containerRef.current) return;
        if (data?.type !== "iframe-single-click" && data?.type !== "viewer-single-click") return;
        if (data.bookKey !== bookKey) return;

        const viewWidth = containerRef.current.getBoundingClientRect().width;

        // Use xFraction from iframe (accounts for CSS columns scroll offset).
        // For viewer-single-click (outside iframe), compute from clientX / viewWidth.
        let fraction: number;
        if (typeof data.xFraction === "number" && data.xFraction >= 0 && data.xFraction <= 1) {
          fraction = data.xFraction;
        } else {
          fraction = Number(data.clientX ?? 0) / viewWidth;
        }

        // Double-page: left 33% = prev, right 33% = next, middle 34% = toggle
        // Single-page: left/right 40% = nav, middle 20% = toggle
        const leftNavEnd = isDoublePage ? 0.33 : 0.4;
        const rightNavStart = isDoublePage ? 0.67 : 0.6;
        const source = data.type === "iframe-single-click" ? "iframe" : "shell";

        const toggleControls = () => {
          console.log("[ReaderTap][reader:action]", {
            bookKey,
            source,
            action: "toggle-controls",
            fraction,
            isDoublePage,
            isScrollMode,
            leftNavEnd,
            rightNavStart,
          });
          setIsVisible((prev) => {
            if (prev) {
              clearTimer();
              return false;
            }
            showAndScheduleHide();
            return true;
          });
        };

        console.log("[ReaderTap][reader:message]", {
          bookKey,
          source,
          rawType: data.type,
          clientX: data.clientX,
          xFraction: data.xFraction,
          computedFraction: fraction,
          viewWidth,
          isDoublePage,
          isScrollMode,
          isFixedLayout,
          leftNavEnd,
          rightNavStart,
        });

        if (isFixedLayout && !isVisible) {
          console.log("[ReaderTap][reader:action]", {
            bookKey,
            source,
            action: "show-controls",
            fraction,
            isDoublePage,
          });
          showAndScheduleHide();
          return;
        }

        if (isScrollMode) {
          toggleControls();
          return;
        }

        if (fraction > leftNavEnd && fraction < rightNavStart) {
          // Middle zone: toggle toolbar
          toggleControls();
          return;
        }

        clearTimer();
        setIsVisible(false);

        if (fraction <= leftNavEnd) {
          console.log("[ReaderTap][reader:action]", {
            bookKey,
            source,
            action: "prev",
            fraction,
            isDoublePage,
            leftNavEnd,
            rightNavStart,
          });
          onPrev?.();
        } else {
          console.log("[ReaderTap][reader:action]", {
            bookKey,
            source,
            action: "next",
            fraction,
            isDoublePage,
            leftNavEnd,
            rightNavStart,
          });
          onNext?.();
        }
      })();
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    bookKey,
    clearTimer,
    containerRef,
    onNext,
    onPrev,
    showAndScheduleHide,
    isDoublePage,
    isScrollMode,
    isFixedLayout,
    isVisible,
  ]);

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

type TTSSegment = {
  text: string;
  cfi: string | null;
};

export function ReaderView({ bookId, tabId }: ReaderViewProps) {
  const TOOLBAR_PIN_STORAGE_KEY = "readany-reader-toolbar-pinned";
  const readerTab = useReaderStore((s) => s.tabs[tabId]);
  const removeReaderTab = useReaderStore((s) => s.removeTab);
  const appTab = useAppStore((s) => s.tabs.find((t) => t.id === tabId));
  const closeAppTab = useAppStore((s) => s.removeTab);
  const viewSettings = useSettingsStore((s) => s.readSettings);
  const updateReadSettings = useSettingsStore((s) => s.updateReadSettings);
  const setProgress = useReaderStore((s) => s.setProgress);
  const setChapter = useReaderStore((s) => s.setChapter);
  const setSelectedText = useReaderStore((s) => s.setSelectedText);
  const pushHistory = useReaderStore((s) => s.pushHistory);
  const setGoToCfiFn = useReaderStore((s) => s.setGoToCfiFn);

  // Custom fonts — read local files as blob: URLs to work inside foliate-js iframes (same-origin blob: sandbox)
  const customFonts = useFontStore((s) => s.fonts);
  const [fontBlobUrls, setFontBlobUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const newBlobUrls = new Map<string, string>();

    Promise.all(
      customFonts.map(async (f) => {
        if (f.source === "remote") return;
        if (!f.filePath) return;
        try {
          const { readFile } = await import("@tauri-apps/plugin-fs");
          const data = await readFile(f.filePath);
          const mimeType =
            f.format === "woff2"
              ? "font/woff2"
              : f.format === "woff"
                ? "font/woff"
                : f.format === "otf"
                  ? "font/otf"
                  : "font/ttf";
          const blob = new Blob([data], { type: mimeType });
          const url = URL.createObjectURL(blob);
          newBlobUrls.set(f.id, url);
        } catch (err) {
          console.error("[FontStore] readFile error for", f.name, err);
        }
      }),
    ).then(() => {
      if (!cancelled) {
        setFontBlobUrls((prev) => {
          for (const [id, url] of prev) {
            if (!newBlobUrls.has(id)) URL.revokeObjectURL(url);
          }
          return newBlobUrls;
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [customFonts]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      setFontBlobUrls((prev) => {
        for (const url of prev.values()) URL.revokeObjectURL(url);
        return new Map();
      });
    };
  }, []);

  const selectedFontId = useFontStore((s) => s.selectedFontId);

  const viewSettingsWithFonts = useMemo(() => {
    const selectedFont = selectedFontId ? customFonts.find((f) => f.id === selectedFontId) : null;
    const customFontFamily = selectedFont?.fontFamily ?? null;
    const customFontCssUrls =
      selectedFont?.source === "remote" && selectedFont.remoteCssUrl
        ? [selectedFont.remoteCssUrl]
        : [];

    const fontCSS = selectedFont
      ? (() => {
          if (selectedFont.source === "remote" && selectedFont.remoteCssUrl) {
            return "";
          }
          if (selectedFont.source === "remote") return getCSSFontFace(selectedFont);
          const blobUrl = fontBlobUrls.get(selectedFont.id);
          if (!blobUrl) return "";
          const cssFormat =
            selectedFont.format === "otf"
              ? "opentype"
              : selectedFont.format === "woff"
                ? "woff"
                : selectedFont.format === "woff2"
                  ? "woff2"
                  : "truetype";
          return `@font-face {\n  font-family: '${selectedFont.fontFamily}';\n  src: url('${blobUrl}') format('${cssFormat}');\n  font-weight: normal;\n  font-style: normal;\n}`;
        })()
      : "";
    return {
      ...viewSettings,
      ...(fontCSS ? { customFontFaceCSS: fontCSS } : {}),
      ...(customFontCssUrls.length > 0 ? { customFontCssUrls } : {}),
      ...(customFontFamily ? { customFontFamily } : {}),
    };
  }, [viewSettings, customFonts, fontBlobUrls, selectedFontId]);

  useEffect(() => {
    const selectedFont = selectedFontId
      ? (customFonts.find((font) => font.id === selectedFontId) ?? null)
      : null;
    console.log("[ReaderView][Font] selection", {
      selectedFontId,
      selectedFontName: selectedFont?.name ?? null,
      selectedFontFamily: selectedFont?.fontFamily ?? null,
      selectedFontSource: selectedFont?.source ?? null,
      remoteCssUrl: selectedFont?.remoteCssUrl ?? null,
      fontTheme: viewSettings.fontTheme,
      resolvedCustomFontFamily: viewSettingsWithFonts.customFontFamily ?? null,
      customFontCssUrls: viewSettingsWithFonts.customFontCssUrls ?? [],
      customFontFaceCSSLength: viewSettingsWithFonts.customFontFaceCSS?.length ?? 0,
    });
  }, [
    customFonts,
    selectedFontId,
    viewSettings.fontTheme,
    viewSettingsWithFonts.customFontCssUrls,
    viewSettingsWithFonts.customFontFaceCSS,
    viewSettingsWithFonts.customFontFamily,
  ]);

  const books = useLibraryStore((s) => s.books);
  const updateBook = useLibraryStore((s) => s.updateBook);
  const book = books.find((b) => b.id === bookId);

  const highlights = useAnnotationStore((s) => s.highlights);
  const bookmarks = useAnnotationStore((s) => s.bookmarks);
  const loadAnnotations = useAnnotationStore((s) => s.loadAnnotations);

  const isBookmarked = bookmarks.some(
    (b) => b.bookId === bookId && b.cfi === readerTab?.currentCfi,
  );

  // Track reading session for statistics
  useReadingSession(bookId, tabId);

  // Ref to FoliateViewer imperative handle
  const foliateRef = useRef<FoliateViewerHandle>(null);

  // Current section index for chapter translation
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);

  // Track when foliate is ready to receive annotations
  const [foliateReady, setFoliateReady] = useState(false);
  // Separate delayed ready for chapter translation (avoids DOM conflict with CFI navigation)
  const [translationReady, setTranslationReady] = useState(false);

  // Chapter translation hook
  const chapterTranslation = useChapterTranslation({
    bookId,
    sectionIndex: currentSectionIndex,
    ready: translationReady,
    getParagraphs: () => foliateRef.current?.getChapterParagraphs() ?? [],
    injectTranslations: (results, visibility) =>
      foliateRef.current?.injectChapterTranslations(results, visibility),
    removeTranslations: () => foliateRef.current?.removeChapterTranslations(),
    applyVisibility: (originalVisible, translationVisible) =>
      foliateRef.current?.applyChapterTranslationVisibility(originalVisible, translationVisible),
    getCurrentCfi: () => readerTab?.currentCfi,
    goToCfi: (cfi) => foliateRef.current?.goToCFI(cfi),
  });

  // Track which highlights have been rendered (id -> {cfi, note, color}) to detect changes
  const renderedHighlightsRef = useRef<
    Map<string, { cfi: string; hasNote: boolean; color?: HighlightColor }>
  >(new Map());

  // Reset rendered highlights tracking when book changes
  useEffect(() => {
    renderedHighlightsRef.current.clear();
    setFoliateReady(false);
    setTranslationReady(false);
  }, [bookId]);

  // Ref to track if we've already handled the initialCfi for this mount
  const handledInitialCfiRef = useRef<string | null>(null);

  useEffect(() => {
    if (!appTab?.initialCfi) {
      handledInitialCfiRef.current = null;
    }
  }, [appTab?.initialCfi]);

  // Unified navigation function that records history
  const navigateToCfi = useCallback(
    (cfi: string) => {
      if (!foliateRef.current || !readerTab) {
        console.warn("[ReaderView] navigateToCfi aborted:", {
          hasFoliate: !!foliateRef.current,
          hasReaderTab: !!readerTab,
          tabId,
        });
        return;
      }

      // Push CURRENT location to history before jumping
      if (readerTab.currentCfi) {
        console.log("[ReaderView] Pushing current location to history:", readerTab.currentCfi);
        pushHistory(tabId, {
          cfi: readerTab.currentCfi,
          chapterIndex: readerTab.chapterIndex,
          chapterTitle: readerTab.chapterTitle,
        });
      }

      console.log("[ReaderView] Navigating to CFI:", cfi);
      progressTrackingGuardUntilRef.current = Math.max(
        progressTrackingGuardUntilRef.current,
        Date.now() + PROGRAMMATIC_NAV_GUARD_MS,
      );
      foliateRef.current.goToCFI(cfi);
    },
    [tabId, readerTab, pushHistory],
  );

  useEffect(() => {
    setGoToCfiFn(() => navigateToCfi);
    return () => setGoToCfiFn(null);
  }, [navigateToCfi, setGoToCfiFn]);

  useEffect(() => {
    return eventBus.on("tts:jump-to-current", ({ bookId: targetBookId, cfi, respond }) => {
      if (targetBookId !== bookId || !cfi) return;
      setShowTTS(false);
      navigateToCfi(cfi);
      foliateRef.current?.highlightCFITemporarily(cfi, 1200);
      respond?.();
    });
  }, [bookId, navigateToCfi]);

  useEffect(() => {
    return eventBus.on("tts:open-lyrics-page", ({ bookId: targetBookId, respond }) => {
      if (targetBookId !== bookId) return;
      setShowTTS(true);
      respond?.();
    });
  }, [bookId]);

  // Navigate to initialCfi when foliate is ready (from NotesPage navigation)
  useEffect(() => {
    if (!foliateReady || !appTab?.initialCfi) return;

    // Only handle each unique initialCfi once
    if (handledInitialCfiRef.current === appTab.initialCfi) return;

    const targetCfi = appTab.initialCfi;
    handledInitialCfiRef.current = targetCfi;

    const timer = setTimeout(() => {
      if (foliateRef.current) {
        navigateToCfi(targetCfi);
        // Clear the initialCfi in the store after a slight delay to avoid the "stickiness"
        // caused by immediate re-render during navigation.
        setTimeout(() => {
          useAppStore.getState().addTab({ ...appTab, initialCfi: undefined });
        }, 500);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [foliateReady, appTab, navigateToCfi]);

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

      // Add new highlights or update existing ones if note status or color changed
      for (const h of bookHighlights) {
        if (!h.cfi) continue;

        const existing = renderedHighlightsRef.current.get(h.id);
        const hasNote = !!h.note;
        const color = h.color || "yellow";

        // Check if we need to re-render (new highlight, note status changed, or color changed)
        const needsRender = !existing || existing.hasNote !== hasNote || existing.color !== color;

        if (needsRender) {
          // Remove old annotation if exists
          if (existing) {
            foliateRef.current.deleteAnnotation({ value: existing.cfi });
          }

          // Add new/updated annotation
          foliateRef.current.addAnnotation({
            value: h.cfi,
            type: "highlight",
            color,
            note: h.note, // Pass note for wavy underline + tooltip
          });
          renderedHighlightsRef.current.set(h.id, { cfi: h.cfi, hasNote, color });
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [highlights, foliateReady, bookId]);

  // Book document state
  const [bookDoc, setBookDoc] = useState<BookDoc | null>(null);
  const [bookFormat, setBookFormat] = useState<BookFormat>("EPUB");
  const isFixedLayout = isFixedLayoutBook(bookFormat, bookDoc);
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
  const [showTTS, setShowTTS] = useState(false);
  const [isReimporting, setIsReimporting] = useState(false);
  const [ttsSourceKind, setTtsSourceKind] = useState<"page" | "selection">("page");
  const [ttsContinuousEnabled, setTtsContinuousEnabled] = useState(true);
  const [ttsLastText, setTtsLastText] = useState("");
  const [ttsSegments, setTtsSegments] = useState<TTSSegment[]>([]);
  const [ttsPrevPageSegments, setTtsPrevPageSegments] = useState<TTSSegment[]>([]);
  const [ttsFutureSegments, setTtsFutureSegments] = useState<TTSSegment[]>([]);
  const [isToolbarPinned, setIsToolbarPinned] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(TOOLBAR_PIN_STORAGE_KEY) === "true";
  });

  // Resizable panel widths
  const chatPanel = useResizablePanel({
    storageKey: "reader-chat-panel-width",
    defaultWidth: 320,
    minWidth: 200,
    maxWidth: 600,
  });
  const tocPanel = useResizablePanel({
    storageKey: "reader-toc-panel-width",
    defaultWidth: 300,
    minWidth: 220,
    maxWidth: 620,
  });
  const notebookPanel = useResizablePanel({
    storageKey: "reader-notebook-panel-width",
    defaultWidth: 320,
    minWidth: 200,
    maxWidth: 600,
  });

  const ttsPlayState = useTTSStore((s) => s.playState);
  const ttsPlay = useTTSStore((s) => s.play);
  const ttsPause = useTTSStore((s) => s.pause);
  const ttsResume = useTTSStore((s) => s.resume);
  const ttsStop = useTTSStore((s) => s.stop);
  const ttsCurrentText = useTTSStore((s) => s.currentText);
  const ttsConfig = useTTSStore((s) => s.config);
  const ttsUpdateConfig = useTTSStore((s) => s.updateConfig);
  const ttsSetOnEnd = useTTSStore((s) => s.setOnEnd);
  const ttsCurrentChunkIndex = useTTSStore((s) => s.currentChunkIndex);
  const ttsTotalChunks = useTTSStore((s) => s.totalChunks);
  const ttsJumpToChunk = useTTSStore((s) => s.jumpToChunk);
  const ttsSetCurrentBook = useTTSStore((s) => s.setCurrentBook);
  const ttsSetCurrentLocation = useTTSStore((s) => s.setCurrentLocation);
  const ttsCurrentLocationCfi = useTTSStore((s) => s.currentLocationCfi);
  const ttsCurrentBookId = useTTSStore((s) => s.currentBookId);
  const ttsNarrationSegments = useMemo(() => {
    if (ttsSegments.length > 0) {
      return ttsSegments.filter((segment) => segment.text.trim().length > 0);
    }
    const source = (ttsCurrentText || ttsLastText || "").trim();
    return source
      ? splitNarrationText(source)
          .filter(Boolean)
          .map((text) => ({ text, cfi: null }))
      : [];
  }, [ttsCurrentText, ttsLastText, ttsSegments]);
  const currentTTSSegment = useMemo(() => {
    if (ttsCurrentBookId !== bookId) return null;
    if (!ttsSegments.length) return null;
    const index = Math.max(0, Math.min(ttsCurrentChunkIndex, ttsSegments.length - 1));
    return ttsSegments[index] ?? null;
  }, [bookId, ttsCurrentBookId, ttsCurrentChunkIndex, ttsSegments]);
  const ttsSegmentsRef = useRef<TTSSegment[]>([]);
  const ttsLastTextRef = useRef("");
  const ttsFutureSegmentsRef = useRef<TTSSegment[]>([]);
  const ttsLoadMoreAboveRef = useRef<string | null>(null);
  const ttsLoadMoreBelowRef = useRef<string | null>(null);

  useEffect(() => {
    ttsSegmentsRef.current = ttsSegments;
    ttsLastTextRef.current = ttsLastText;
    ttsFutureSegmentsRef.current = ttsFutureSegments;
  }, [ttsFutureSegments, ttsLastText, ttsSegments]);

  /** Whether TTS is in continuous reading mode (auto page-turn) */
  const ttsContinuousRef = useRef(false);
  /** Stores the callback to resume TTS after a page turn; triggered by handleRelocate */
  const pendingTTSContinueCallbackRef = useRef<(() => void) | null>(null);
  const pendingTTSContinueSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPageTTSFromCfiRef = useRef<
    ((targetCfi: string, targetText?: string) => Promise<void>) | null
  >(null);
  const previousReaderBookIdRef = useRef<string | null>(null);

  const resetReaderTTSState = useCallback(
    ({
      stopPlayback = false,
      clearSessionBinding = false,
    }: { stopPlayback?: boolean; clearSessionBinding?: boolean } = {}) => {
      ttsContinuousRef.current = false;
      pendingTTSContinueCallbackRef.current = null;
      if (pendingTTSContinueSafetyTimerRef.current) {
        clearTimeout(pendingTTSContinueSafetyTimerRef.current);
        pendingTTSContinueSafetyTimerRef.current = null;
      }
      ttsLoadMoreAboveRef.current = null;
      ttsLoadMoreBelowRef.current = null;
      ttsSegmentsRef.current = [];
      ttsLastTextRef.current = "";
      ttsFutureSegmentsRef.current = [];
      setTtsSourceKind("page");
      setTtsLastText("");
      setTtsSegments([]);
      setTtsPrevPageSegments([]);
      setTtsFutureSegments([]);
      if (clearSessionBinding) {
        ttsSetOnEnd(null);
      }
      void foliateRef.current?.setTTSHighlight(null);
      if (stopPlayback) {
        ttsStop();
      }
    },
    [ttsSetOnEnd, ttsStop],
  );

  useEffect(() => {
    const previousBookId = previousReaderBookIdRef.current;
    previousReaderBookIdRef.current = bookId;
    const switchedBook = !!previousBookId && previousBookId !== bookId;
    resetReaderTTSState({ stopPlayback: false, clearSessionBinding: false });
    if (switchedBook) {
      setShowTTS(false);
    }
  }, [bookId, resetReaderTTSState]);

  const { t } = useTranslation();
  const isInitializedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const ttsCoverSrc = useResolvedSrc(book?.meta.coverUrl);

  // Auto-hide controls
  const keepControlsVisible = showSearch || showToc || showSettings;
  const {
    isVisible: controlsVisible,
    handleMouseEnter,
    handleMouseLeave,
  } = useAutoHideControls(
    containerRef,
    bookId,
    () => foliateRef.current?.goPrev(),
    () => foliateRef.current?.goNext(),
    2000,
    keepControlsVisible,
    (viewSettings.paginatedLayout ?? "double") === "double",
    viewSettings.viewMode === "scroll",
    isFixedLayout,
  );
  const isDoublePage = (viewSettings.paginatedLayout ?? "double") === "double";
  const toolbarVisible = controlsVisible || isToolbarPinned;
  const readingHeaderTitle = (readerTab?.chapterTitle || book?.meta.title || "").trim();
  const contentTopPadding = isToolbarPinned ? 78 : 56;
  const incrementPagesRead = useReadingSessionStore((s) => s.incrementPagesRead);
  const incrementCharactersRead = useReadingSessionStore((s) => s.incrementCharactersRead);
  const sessionProgressRef = useRef<{
    mode: "location" | "page" | "characters";
    current: number;
    fraction?: number;
    section?: number;
    page?: number;
  } | null>(null);
  const totalBookCharactersRef = useRef<number | null>(null);
  const progressTrackingGuardUntilRef = useRef(0);

  const suppressProgressTracking = useCallback((duration = PROGRAMMATIC_NAV_GUARD_MS) => {
    progressTrackingGuardUntilRef.current = Math.max(
      progressTrackingGuardUntilRef.current,
      Date.now() + duration,
    );
  }, []);

  const goToCFISafely = useCallback(
    (targetCfi: string) => {
      if (!targetCfi) return;
      suppressProgressTracking();
      foliateRef.current?.goToCFI(targetCfi);
    },
    [suppressProgressTracking],
  );

  const goToHrefSafely = useCallback(
    (href: string) => {
      if (!href) return;
      suppressProgressTracking();
      foliateRef.current?.goToHref(href);
    },
    [suppressProgressTracking],
  );

  useEffect(() => {
    window.localStorage.setItem(TOOLBAR_PIN_STORAGE_KEY, String(isToolbarPinned));
  }, [isToolbarPinned]);

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

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      void loadAnnotations(bookId);
    });
  }, [bookId, loadAnnotations]);

  useEffect(() => {
    sessionProgressRef.current = null;
    suppressProgressTracking(INITIAL_PROGRESS_RESTORE_GUARD_MS);
  }, [bookId, tabId, bookFormat, suppressProgressTracking]);

  useEffect(() => {
    let cancelled = false;

    if (!bookDoc || isFixedLayout) {
      totalBookCharactersRef.current = null;
      return;
    }

    totalBookCharactersRef.current = null;

    void measureReflowableBookCharacters(bookDoc).then((totalCharacters) => {
      if (!cancelled) {
        totalBookCharactersRef.current = totalCharacters;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bookDoc, isFixedLayout]);

  // Load annotations
  useEffect(() => {
    loadAnnotations(bookId);
  }, [bookId, loadAnnotations]);

  // Watch ruby mode changes and inject/remove annotations
  const rubyMode = useRubyStore((s) => s.bookRubySettings[bookId] ?? null);
  useEffect(() => {
    if (!foliateRef.current) return;
    if (rubyMode) {
      foliateRef.current.injectRuby(rubyMode);
    } else {
      foliateRef.current.removeRuby();
    }
  }, [rubyMode]);

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

  const handleReimportMissingBook = useCallback(async () => {
    if (isReimporting) return;
    setIsReimporting(true);

    try {
      const platform = getPlatformService();
      const { reimportDeletedBook, inspectDeletedBookCandidate } = useLibraryStore.getState();
      const picked = await platform.pickFile({
        multiple: false,
        filters: BOOK_IMPORT_FILTERS,
      });
      const selectedPath = Array.isArray(picked) ? picked[0] : picked;
      if (!selectedPath) return;

      if (book) {
        const candidate = await inspectDeletedBookCandidate(bookId, selectedPath);
        if (candidate) {
          const normalize = (value?: string) =>
            (value || "").toLowerCase().replace(/[\s\p{P}\p{S}_-]+/gu, "");
          const authorsMatch = (() => {
            const left = normalize(book.meta.author);
            const right = normalize(candidate.author);
            if (!left || !right) return true;
            return left === right || left.includes(right) || right.includes(left);
          })();
          const titleMismatch = (() => {
            const originalTitle = normalize(book.meta.title);
            const candidateTitle = normalize(candidate.title);
            return (
              !!originalTitle &&
              !!candidateTitle &&
              originalTitle !== candidateTitle &&
              !originalTitle.includes(candidateTitle) &&
              !candidateTitle.includes(originalTitle)
            );
          })();
          const formatMismatch = book.format !== candidate.format;
          if (
            !(candidate.fileHash && book.fileHash && candidate.fileHash === book.fileHash) &&
            (titleMismatch || (formatMismatch && !authorsMatch))
          ) {
            const shouldContinue = await useMissingBookPromptStore.getState().showPrompt({
              title: t("reader.reimportMismatchTitle", "这份文件看起来和原书不太一致"),
              description: t(
                "reader.reimportMismatchDescription",
                "原书《{{originalTitle}}》与当前文件《{{candidateTitle}}》信息差异较大。仍要把它接回原来的笔记和阅读统计吗？",
                {
                  originalTitle: book.meta.title,
                  candidateTitle: candidate.title || t("reader.unknownBook", "未命名书籍"),
                },
              ),
              confirmLabel: t("reader.reimportContinue", "继续接回"),
              cancelLabel: t("reader.reimportPickAnotherFile", "重新选择"),
            });
            if (!shouldContinue) return;
          }
        }
      }

      const restoredBook = await reimportDeletedBook(bookId, selectedPath);
      if (!restoredBook) {
        setError(t("reader.reimportFailed", "重新导入失败，请稍后再试。"));
        return;
      }

      isInitializedRef.current = false;
      setBookDoc(null);
      setError(null);
      setIsLoading(true);
    } catch (err) {
      console.error("[ReaderView] Failed to re-import missing book:", err);
      setError(
        err instanceof Error
          ? err.message
          : t("reader.reimportFailed", "重新导入失败，请稍后再试。"),
      );
    } finally {
      setIsReimporting(false);
    }
  }, [bookId, isReimporting, t]);

  const handleCloseMissingBookTab = useCallback(() => {
    closeAppTab(tabId);
    removeReaderTab(tabId);
  }, [closeAppTab, removeReaderTab, tabId]);

  // --- Event handlers from FoliateViewer ---
  const handleRelocate = useCallback(
    (detail: RelocateDetail) => {
      const progress = detail.fraction ?? 0;
      const cfi = detail.cfi || `section-${detail.section?.current ?? 0}`;

      // Update reader store (immediate)
      setProgress(tabId, progress, cfi);

      // Update chapter info
      if (detail.tocItem?.label) {
        setChapter(tabId, detail.section?.current ?? 0, detail.tocItem.label, detail.tocItem.href);
      }

      // Display true pages only when the renderer exposes them.
      if (detail.page) {
        setTotalPages(detail.page.total);
        setCurrentPage(detail.page.current);
      } else if (isFixedLayout && detail.section) {
        setTotalPages(detail.section.total);
        setCurrentPage(detail.section.current + 1);
      } else {
        // Reflowable documents without renderer-backed pagination should use percent instead.
        setTotalPages(0);
        setCurrentPage(0);
      }

      const trackingSuppressed = Date.now() < progressTrackingGuardUntilRef.current;

      // Track reading progress.
      // For fixed layout (PDF/CBZ): use section index (stable real pages)
      // For reflowable (EPUB/TXT): use logical locations for character accumulation
      if (isFixedLayout && detail.section) {
        const previous = sessionProgressRef.current;
        const currentSection = detail.section.current;
        if (!trackingSuppressed && previous?.mode === "page" && currentSection > previous.current) {
          const delta = currentSection - previous.current;
          if (delta <= MAX_TRACKED_PAGE_DELTA) {
            incrementPagesRead(delta);
          }
        }
        sessionProgressRef.current = { mode: "page", current: currentSection };
      } else if (detail.location) {
        const { current } = detail.location;
        const fraction = detail.fraction ?? 0;
        const totalBookCharacters = totalBookCharactersRef.current;

        if (totalBookCharacters && totalBookCharacters > 0) {
          const currentCharacters = Math.round(totalBookCharacters * fraction);
          const previous = sessionProgressRef.current;
          const currentSection = detail.section?.current ?? 0;
          const currentRendererPage = detail.page?.current ?? null;

          if (
            !trackingSuppressed &&
            previous?.mode === "characters" &&
            currentCharacters > previous.current
          ) {
            if (currentRendererPage != null && previous.page != null && previous.section != null) {
              const samePage =
                previous.section === currentSection && previous.page === currentRendererPage;
              const movedForwardWithinSection =
                previous.section === currentSection &&
                currentRendererPage > previous.page &&
                currentRendererPage - previous.page <= MAX_TRACKED_PAGE_DELTA;
              const movedForwardAcrossSection =
                currentSection > previous.section && currentSection - previous.section <= 1;

              if (!samePage && (movedForwardWithinSection || movedForwardAcrossSection)) {
                incrementCharactersRead(currentCharacters - previous.current);
              }
            } else if (
              Math.abs(fraction - (previous.fraction ?? 0)) <= MAX_TRACKED_FRACTION_DELTA
            ) {
              incrementCharactersRead(currentCharacters - previous.current);
            }
          }
          sessionProgressRef.current = {
            mode: "characters",
            current: currentCharacters,
            fraction,
            section: currentSection,
            page: currentRendererPage ?? undefined,
          };
        } else {
          const previous = sessionProgressRef.current;
          if (!trackingSuppressed && previous?.mode === "location" && current > previous.current) {
            const delta = current - previous.current;
            if (delta <= MAX_TRACKED_LOCATION_DELTA) {
              incrementCharactersRead(delta * REFLOWABLE_CHARACTERS_PER_LOCATION);
            }
          }
          sessionProgressRef.current = { mode: "location", current, fraction };
        }
      }

      // Throttled save to DB
      throttledSaveProgress(bookId, progress, cfi);

      // Mark translation ready after first successful relocate (CFI navigation done)
      if (!translationReady) setTranslationReady(true);

      // If TTS is waiting for a page turn to complete, fire the continuation callback now
      // that the renderer has fully updated its position (renderer.start reflects new page).
      if (pendingTTSContinueCallbackRef.current) {
        const cb = pendingTTSContinueCallbackRef.current;
        pendingTTSContinueCallbackRef.current = null;
        if (pendingTTSContinueSafetyTimerRef.current) {
          clearTimeout(pendingTTSContinueSafetyTimerRef.current);
          pendingTTSContinueSafetyTimerRef.current = null;
        }
        void cb();
      }
    },
    [
      tabId,
      bookId,
      isFixedLayout,
      setProgress,
      setChapter,
      throttledSaveProgress,
      translationReady,
    ],
  );

  const handleTocReady = useCallback((toc: TOCItem[]) => {
    setTocItems(toc);
  }, []);

  const handleLoaded = useCallback(() => {
    setIsLoading(false);
    // Mark foliate as ready to receive annotations
    setFoliateReady(true);
  }, []);

  // Show reader tour on first visit (after book loads)
  const tourTriggered = useRef(false);
  useEffect(() => {
    if (!isLoading && !tourTriggered.current && !hasSeenReaderTour()) {
      tourTriggered.current = true;
      // Delay slightly so the reader UI is fully rendered
      setTimeout(() => startReaderTour(), 600);
    }
  }, [isLoading]);

  // Handle section load (chapter change) - re-render all highlights
  // This is critical: when foliate-js loads a new section (chapter),
  // it replaces the iframe content and all previously added annotations are lost.
  // We need to re-add all highlights for the current book.
  const handleSectionLoad = useCallback(
    (sectionIndex: number) => {
      // Reset chapter translation on section change
      setCurrentSectionIndex(sectionIndex);
      setTranslationReady(false);
      chapterTranslation.reset();

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
            renderedHighlightsRef.current.set(h.id, {
              cfi: h.cfi,
              hasNote: !!h.note,
              color: h.color || "yellow",
            });
          }
        }

        console.log(
          `[ReaderView] Section ${sectionIndex} loaded, re-rendered ${bookHighlights.length} highlights`,
        );
      }, 100);
    },
    [highlights, bookId, chapterTranslation.reset],
  );

  const handleError = useCallback((err: Error) => {
    setError(err.message);
    setIsLoading(false);
  }, []);

  // Sync chapter translation visibility with DOM
  useEffect(() => {
    if (chapterTranslation.state.status !== "complete") return;
    try {
      const renderer = foliateRef.current?.getView()?.renderer;
      const contents = renderer?.getContents?.();
      if (!contents?.[0]?.doc) return;
      const doc = contents[0].doc as Document;
      const { originalVisible, translationVisible } = chapterTranslation.state;
      // Translation elements
      const translationEls = doc.querySelectorAll(".readany-translation");
      translationEls.forEach((el) => {
        (el as HTMLElement).setAttribute("data-hidden", String(!translationVisible));
        // When original is hidden, show translation in original style
        (el as HTMLElement).setAttribute(
          "data-solo",
          String(!originalVisible && translationVisible),
        );
      });
      // Original text elements
      const originalEls = doc.querySelectorAll("[data-translate-id]");
      originalEls.forEach((el) => {
        (el as HTMLElement).setAttribute("data-original-hidden", String(!originalVisible));
      });
    } catch {
      // Ignore
    }
  }, [chapterTranslation.state]);

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
            r.top < min.top ? r : min,
          );
          // Find the bottommost rect (largest bottom value)
          const bottommostRect = containerRelativeRects.reduce((max, r) =>
            r.bottom > max.bottom ? r : max,
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
          const toolbarHeight = toolbarVisible ? 44 : 0;

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
    [tabId, setSelectedText, toolbarVisible],
  );

  // --- Navigation (for toolbar buttons) ---
  const handleNavPrev = useCallback(() => {
    foliateRef.current?.goPrev();
  }, []);
  const handleNavNext = useCallback(() => {
    foliateRef.current?.goNext();
  }, []);

  const handleGoToChapter = useCallback(
    (href: string) => {
      goToHrefSafely(href);
    },
    [goToHrefSafely],
  );

  // --- Selection actions ---
  const handleHighlight = useCallback(
    (color: HighlightColor = viewSettings.defaultHighlightColor ?? "yellow") => {
      if (selection && selection.cfi) {
        updateReadSettings({ defaultHighlightColor: color });
        const existingHighlight = selection.highlightId
          ? highlights.find((h) => h.id === selection.highlightId)
          : highlights.find((h) => h.bookId === bookId && h.cfi === selection.cfi);

        if (existingHighlight) {
          useAnnotationStore.getState().updateHighlight(existingHighlight.id, {
            color,
            updatedAt: Date.now(),
          });
          foliateRef.current?.deleteAnnotation({ value: existingHighlight.cfi });
          foliateRef.current?.addAnnotation({
            value: existingHighlight.cfi,
            type: "highlight",
            color,
            note: existingHighlight.note,
          });
          setSelection(null);
          return;
        }

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
        renderedHighlightsRef.current.set(highlightId, {
          cfi: selection.cfi,
          hasNote: false,
          color,
        });
      }
      setSelection(null);
    },
    [
      selection,
      bookId,
      readerTab?.chapterTitle,
      highlights,
      updateReadSettings,
      viewSettings.defaultHighlightColor,
    ],
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
      const rangeDoc = range.startContainer.ownerDocument;
      const iframe = rangeDoc?.defaultView?.frameElement as HTMLIFrameElement | null | undefined;

      let offsetRects: DOMRect[] = rects;
      if (iframe) {
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
      if (containerRect && offsetRects.length > 0) {
        const visibleRects = offsetRects.filter(
          (r) =>
            r.width > 0 &&
            r.height > 0 &&
            r.right >= containerRect.left &&
            r.left <= containerRect.right &&
            r.bottom >= containerRect.top &&
            r.top <= containerRect.bottom,
        );
        const rectsForPosition = visibleRects.length > 0 ? visibleRects : offsetRects;
        const containerRelativeRects = rectsForPosition.map((r) => ({
          top: r.top - containerRect.top,
          bottom: r.bottom - containerRect.top,
          left: r.left - containerRect.left,
          right: r.right - containerRect.left,
        }));

        const topmostRect = containerRelativeRects.reduce((min, r) =>
          r.top < min.top ? r : min,
        );
        const bottommostRect = containerRelativeRects.reduce((max, r) =>
          r.bottom > max.bottom ? r : max,
        );
        const centerX = (topmostRect.left + topmostRect.right) / 2;

        const containerW = containerRect.width;
        const containerH = containerRect.height;
        const popoverW = 200;
        const popoverH = 44;
        const gap = 8;
        const padding = 8;
        const toolbarHeight = toolbarVisible ? 44 : 0;

        let x = centerX - popoverW / 2;
        x = Math.max(padding, Math.min(x, containerW - popoverW - padding));

        const yAbove = topmostRect.top - popoverH - gap;
        const yBelow = bottommostRect.bottom + gap;
        const aboveValid = yAbove >= toolbarHeight + padding;
        const belowValid = yBelow + popoverH + padding <= containerH;

        let y: number;
        if (aboveValid && belowValid) {
          const spaceAbove = topmostRect.top - toolbarHeight;
          const spaceBelow = containerH - bottommostRect.bottom;
          y = spaceAbove > spaceBelow ? yAbove : yBelow;
        } else if (aboveValid) {
          y = yAbove;
        } else if (belowValid) {
          y = yBelow;
        } else {
          y = Math.max(toolbarHeight + padding, Math.min(yAbove, yBelow));
        }

        setSelectionPos({ x, y });
      }
    },
    [highlights, bookId, toolbarVisible],
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

  useEffect(() => {
    if (ttsCurrentBookId !== bookId) {
      void foliateRef.current?.setTTSHighlight(null);
      return;
    }
    if (ttsPlayState !== "playing" && ttsPlayState !== "paused" && ttsPlayState !== "loading") {
      void foliateRef.current?.setTTSHighlight(null);
      return;
    }
    if (ttsSourceKind !== "page") {
      void foliateRef.current?.setTTSHighlight(null);
      return;
    }
    void foliateRef.current?.setTTSHighlight(
      currentTTSSegment?.cfi || null,
      "rgba(96, 165, 250, 0.35)",
    );
  }, [bookId, currentTTSSegment?.cfi, ttsCurrentBookId, ttsPlayState, ttsSourceKind]);

  useEffect(() => {
    if (ttsCurrentBookId !== bookId) return;
    const targetCfi =
      ttsSourceKind === "page" &&
      (ttsPlayState === "playing" || ttsPlayState === "paused" || ttsPlayState === "loading")
        ? currentTTSSegment?.cfi || ttsCurrentLocationCfi || null
        : readerTab?.currentCfi;
    if (targetCfi && targetCfi !== ttsCurrentLocationCfi) {
      ttsSetCurrentLocation(targetCfi);
    }
  }, [
    bookId,
    currentTTSSegment?.cfi,
    readerTab?.currentCfi,
    ttsCurrentBookId,
    ttsCurrentLocationCfi,
    ttsPlayState,
    ttsSetCurrentLocation,
    ttsSourceKind,
  ]);

  const dedupeTTSSegments = useCallback((segments: TTSSegment[]) => {
    const seen = new Set<string>();
    const result: TTSSegment[] = [];
    for (const segment of segments) {
      const key = getTTSSegmentIdentity(segment);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(segment);
    }
    return result;
  }, []);

  const filterDistinctTTSSegments = useCallback(
    (incoming: TTSSegment[], ...existingGroups: TTSSegment[][]) => {
      const blocked = new Set(
        existingGroups
          .flat()
          .map((segment) => getTTSSegmentIdentity(segment))
          .filter(Boolean),
      );
      const result: TTSSegment[] = [];
      for (const segment of dedupeTTSSegments(incoming)) {
        const key = getTTSSegmentIdentity(segment);
        if (!key || blocked.has(key)) continue;
        blocked.add(key);
        result.push(segment);
      }
      return result;
    },
    [dedupeTTSSegments],
  );

  const mergeUniqueTTSSegments: (
    base: TTSSegment[],
    incoming: TTSSegment[],
    direction?: "prepend" | "append",
  ) => TTSSegment[] = useCallback(
    (base: TTSSegment[], incoming: TTSSegment[], direction: "prepend" | "append" = "append") => {
      const ordered = direction === "prepend" ? [...incoming, ...base] : [...base, ...incoming];
      return dedupeTTSSegments(ordered);
    },
    [dedupeTTSSegments],
  );

  const primeDesktopTTSLyricContext = useCallback(
    async (cfi: string | null | undefined) => {
      if (!cfi) return;
      const context = await foliateRef.current?.getTTSSegmentContext(cfi, 10, 10);
      const previous = filterDistinctTTSSegments(context?.before || [], ttsSegmentsRef.current);
      const future = filterDistinctTTSSegments(
        context?.after || [],
        previous,
        ttsSegmentsRef.current,
      );
      setTtsPrevPageSegments(previous);
      setTtsFutureSegments(future);
      ttsFutureSegmentsRef.current = future;
    },
    [filterDistinctTTSSegments],
  );

  const queueDesktopTTSChapterTransition = useCallback(
    (targetIndex: number, options?: { autoResume?: boolean }) => {
      const target = tocItems[targetIndex];
      if (!target?.href) return false;

      const autoResume = options?.autoResume !== false;
      const nextChapterTitle = target.title || readerTab?.chapterTitle || "";

      if (pendingTTSContinueSafetyTimerRef.current) {
        clearTimeout(pendingTTSContinueSafetyTimerRef.current);
        pendingTTSContinueSafetyTimerRef.current = null;
      }

      pendingTTSContinueCallbackRef.current = () => {
        pendingTTSContinueCallbackRef.current = null;
        if (pendingTTSContinueSafetyTimerRef.current) {
          clearTimeout(pendingTTSContinueSafetyTimerRef.current);
          pendingTTSContinueSafetyTimerRef.current = null;
        }

        void (async () => {
          const segments =
            (await foliateRef.current?.getVisibleTTSSegments())?.map((segment) => ({
              text: segment.text.trim(),
              cfi: segment.cfi,
            })) ?? [];
          const normalizedSegments = segments.filter((segment) => segment.text.length > 0);
          if (!normalizedSegments.length) {
            ttsContinuousRef.current = false;
            ttsSetOnEnd(null);
            ttsStop();
            return;
          }

          const nextText = normalizedSegments
            .map((segment) => segment.text)
            .join(" ")
            .trim();
          const firstVisibleCfi = normalizedSegments[0]?.cfi || "";
          const lastVisibleCfi =
            normalizedSegments[normalizedSegments.length - 1]?.cfi || firstVisibleCfi;

          setTtsSourceKind("page");
          setTtsContinuousEnabled(autoResume);
          setTtsLastText(nextText);
          setTtsSegments(normalizedSegments);
          setTtsFutureSegments([]);
          ttsLastTextRef.current = nextText;
          ttsSegmentsRef.current = normalizedSegments;
          ttsFutureSegmentsRef.current = [];
          ttsStartChapterRef.current = nextChapterTitle;
          ttsContinuousRef.current = autoResume;
          ttsSetCurrentBook(book?.meta.title ?? "", nextChapterTitle, bookId);
          ttsSetCurrentLocation(firstVisibleCfi);

          void primeDesktopTTSLyricContext(lastVisibleCfi);

          if (autoResume) {
            ttsPlay(normalizedSegments.map((segment) => segment.text));
          }
        })();
      };

      pendingTTSContinueSafetyTimerRef.current = setTimeout(() => {
        const cb = pendingTTSContinueCallbackRef.current;
        pendingTTSContinueCallbackRef.current = null;
        if (cb) void cb();
      }, 1200);

      void foliateRef.current?.setTTSHighlight(null);
      handleGoToChapter(target.href);
      return true;
    },
    [
      book?.meta.title,
      bookId,
      handleGoToChapter,
      primeDesktopTTSLyricContext,
      readerTab?.chapterTitle,
      tocItems,
      ttsPlay,
      ttsSetCurrentBook,
      ttsSetCurrentLocation,
      ttsSetOnEnd,
      ttsStop,
    ],
  );

  const handleTTSPageEnd = useCallback(() => {
    if (!ttsContinuousRef.current) return;
    const previousSegments = ttsSegmentsRef.current;
    const previousFirstCfi =
      previousSegments[0]?.cfi || currentTTSSegment?.cfi || readerTab?.currentCfi || null;
    const previousLastCfi =
      previousSegments[previousSegments.length - 1]?.cfi ||
      currentTTSSegment?.cfi ||
      previousFirstCfi;
    const previousText = ttsLastTextRef.current;

    if (previousSegments.length > 0) {
      setTtsPrevPageSegments((prev) => mergeUniqueTTSSegments(prev, previousSegments, "append"));
    }

    // Clear any lingering safety timer from a previous page turn
    if (pendingTTSContinueSafetyTimerRef.current) {
      clearTimeout(pendingTTSContinueSafetyTimerRef.current);
      pendingTTSContinueSafetyTimerRef.current = null;
    }
    pendingTTSContinueCallbackRef.current = null;

    // Clear TTS highlight BEFORE navigating — otherwise addAnnotation for the
    // old segment's CFI will navigate the renderer back to the previous page
    void foliateRef.current?.setTTSHighlight(null);

    void (async () => {
      if (!ttsContinuousRef.current) return;
      const restartFromCfi = startPageTTSFromCfiRef.current;
      const context = await foliateRef.current?.getTTSSegmentContext(previousLastCfi || "", 0, 20);
      const nextSegment =
        (context?.after || []).find((segment) => segment.text.trim().length > 0) || null;
      console.log("[ReaderView][TTS] continue from context", {
        previousFirstCfi,
        previousLastCfi,
        previousTextLength: previousText.length,
        nextCfi: nextSegment?.cfi || null,
        nextTextLength: nextSegment?.text?.length || 0,
        afterCount: context?.after?.length || 0,
      });

      if (nextSegment?.cfi && restartFromCfi) {
        await restartFromCfi(nextSegment.cfi, nextSegment.text);
        return;
      }

      const nextChapterIndex =
        (readerTab?.chapterIndex ?? -1) >= 0 &&
        (readerTab?.chapterIndex ?? -1) < tocItems.length - 1
          ? (readerTab?.chapterIndex ?? -1) + 1
          : -1;
      if (
        nextChapterIndex >= 0 &&
        queueDesktopTTSChapterTransition(nextChapterIndex, { autoResume: true })
      ) {
        return;
      }

      // No more text (end of book) — stop TTS
      ttsContinuousRef.current = false;
      ttsSetOnEnd(null);
      ttsStop();
    })();
  }, [
    currentTTSSegment?.cfi,
    mergeUniqueTTSSegments,
    queueDesktopTTSChapterTransition,
    readerTab?.chapterIndex,
    readerTab?.currentCfi,
    tocItems.length,
    ttsSetOnEnd,
    ttsStop,
  ]);

  useEffect(() => {
    const shouldContinue = ttsContinuousRef.current && ttsSourceKind === "page";
    ttsSetOnEnd(shouldContinue ? handleTTSPageEnd : null);
  }, [handleTTSPageEnd, ttsSetOnEnd, ttsSourceKind]);

  const handleTTSPrevChapter = useCallback(() => {
    const currentIdx = readerTab?.chapterIndex ?? -1;
    const idx = currentIdx > 0 ? currentIdx - 1 : 0;
    if (ttsSourceKind === "page" && ttsPlayState !== "stopped") {
      queueDesktopTTSChapterTransition(idx, { autoResume: true });
      return;
    }
    const prevHref = tocItems[idx]?.href;
    if (prevHref) {
      handleGoToChapter(prevHref);
    }
  }, [
    handleGoToChapter,
    queueDesktopTTSChapterTransition,
    readerTab?.chapterIndex,
    tocItems,
    ttsPlayState,
    ttsSourceKind,
  ]);

  const handleTTSNextChapter = useCallback(() => {
    const currentIdx = readerTab?.chapterIndex ?? -1;
    const idx =
      currentIdx >= 0 && currentIdx < tocItems.length - 1 ? currentIdx + 1 : tocItems.length - 1;
    if (ttsSourceKind === "page" && ttsPlayState !== "stopped") {
      queueDesktopTTSChapterTransition(idx, { autoResume: true });
      return;
    }
    const nextHref = tocItems[idx]?.href;
    if (nextHref) {
      handleGoToChapter(nextHref);
    }
  }, [
    handleGoToChapter,
    queueDesktopTTSChapterTransition,
    readerTab?.chapterIndex,
    tocItems,
    ttsPlayState,
    ttsSourceKind,
  ]);

  const startSelectionTTS = useCallback(
    (text: string) => {
      const normalized = text.trim();
      if (!normalized) return;
      const segments = splitNarrationText(normalized)
        .filter(Boolean)
        .map((segmentText) => ({ text: segmentText, cfi: null }));
      setTtsSourceKind("selection");
      setTtsContinuousEnabled(false);
      setTtsLastText(normalized);
      setTtsSegments(segments);
      setTtsPrevPageSegments([]);
      setTtsFutureSegments([]);
      ttsLastTextRef.current = normalized;
      ttsSegmentsRef.current = segments;
      ttsFutureSegmentsRef.current = [];
      ttsContinuousRef.current = false;
      ttsSetOnEnd(null);
      ttsSetCurrentBook(book?.meta.title ?? "", readerTab?.chapterTitle ?? "", bookId);
      ttsSetCurrentLocation(readerTab?.selectionCfi || readerTab?.currentCfi || "");
      ttsPlay(segments.length > 0 ? segments.map((segment) => segment.text) : normalized);
    },
    [
      ttsPlay,
      ttsSetOnEnd,
      ttsSetCurrentBook,
      ttsSetCurrentLocation,
      book?.meta.title,
      readerTab?.chapterTitle,
      readerTab?.selectionCfi,
      readerTab?.currentCfi,
      bookId,
    ],
  );

  const startPageTTS = useCallback(
    async (continuous = ttsContinuousEnabled) => {
      const segments =
        (await foliateRef.current?.getVisibleTTSSegments())?.map((segment) => ({
          text: segment.text.trim(),
          cfi: segment.cfi,
        })) ?? [];
      const normalizedSegments = segments.filter((segment) => segment.text.length > 0);
      const normalized = normalizedSegments
        .map((segment) => segment.text)
        .join(" ")
        .trim();
      if (!normalized) {
        toast.error(t("tts.noTextFound", "No readable text found on this page"));
        return;
      }
      ttsStartChapterRef.current = readerTab?.chapterTitle ?? "";
      setTtsSourceKind("page");
      setTtsContinuousEnabled(continuous);
      setTtsLastText(normalized);
      setTtsSegments(normalizedSegments);
      setTtsPrevPageSegments([]);
      setTtsFutureSegments([]);
      ttsLastTextRef.current = normalized;
      ttsSegmentsRef.current = normalizedSegments;
      ttsFutureSegmentsRef.current = [];
      ttsContinuousRef.current = continuous;
      ttsSetOnEnd(continuous ? handleTTSPageEnd : null);
      ttsSetCurrentBook(book?.meta.title ?? "", readerTab?.chapterTitle ?? "", bookId);
      ttsSetCurrentLocation(normalizedSegments[0]?.cfi || readerTab?.currentCfi || "");
      setShowTTS(true);
      void primeDesktopTTSLyricContext(
        normalizedSegments[normalizedSegments.length - 1]?.cfi ||
          normalizedSegments[0]?.cfi ||
          readerTab?.currentCfi ||
          "",
      );
      ttsPlay(
        normalizedSegments.length > 0
          ? normalizedSegments.map((segment) => segment.text)
          : normalized,
      );
    },
    [
      handleTTSPageEnd,
      ttsContinuousEnabled,
      ttsPlay,
      ttsSetOnEnd,
      ttsSetCurrentBook,
      ttsSetCurrentLocation,
      book?.meta.title,
      readerTab?.chapterTitle,
      readerTab?.currentCfi,
      bookId,
      primeDesktopTTSLyricContext,
    ],
  );

  const startPageTTSFromCfi = useCallback(
    async (targetCfi: string, targetText?: string) => {
      if (!targetCfi) return;
      pendingTTSContinueCallbackRef.current = null;
      if (pendingTTSContinueSafetyTimerRef.current) {
        clearTimeout(pendingTTSContinueSafetyTimerRef.current);
        pendingTTSContinueSafetyTimerRef.current = null;
      }
      goToCFISafely(targetCfi);
      await new Promise((resolve) => setTimeout(resolve, 280));
      const segments =
        (await foliateRef.current?.getVisibleTTSSegments(targetCfi))?.map((segment) => ({
          text: segment.text.trim(),
          cfi: segment.cfi,
        })) ?? [];
      const visibleSegments = segments.filter((segment) => segment.text.length > 0);
      const playbackSegments = visibleSegments.length
        ? visibleSegments
        : [{ text: (targetText || "").trim(), cfi: targetCfi }].filter(
            (segment) => segment.text.length > 0,
          );
      if (!playbackSegments.length) return;
      const context = await foliateRef.current?.getTTSSegmentContext(targetCfi, 10, 10);
      const previous = filterDistinctTTSSegments(context?.before || [], playbackSegments);
      const future = filterDistinctTTSSegments(context?.after || [], previous, playbackSegments);
      const nextText = playbackSegments
        .map((segment) => segment.text)
        .join(" ")
        .trim();
      setTtsSegments(playbackSegments);
      setTtsPrevPageSegments(previous);
      setTtsFutureSegments(future);
      setTtsLastText(nextText);
      ttsSegmentsRef.current = playbackSegments;
      ttsLastTextRef.current = nextText;
      ttsFutureSegmentsRef.current = future;
      ttsSetCurrentLocation(playbackSegments[0]?.cfi || targetCfi);
      ttsContinuousRef.current = ttsSourceKind === "page" && ttsContinuousEnabled;
      ttsSetOnEnd(ttsContinuousRef.current ? handleTTSPageEnd : null);
      ttsPlay(playbackSegments.map((segment) => segment.text));
    },
    [
      filterDistinctTTSSegments,
      handleTTSPageEnd,
      ttsContinuousEnabled,
      ttsPlay,
      ttsSetCurrentLocation,
      ttsSetOnEnd,
      ttsSourceKind,
    ],
  );

  useEffect(() => {
    startPageTTSFromCfiRef.current = startPageTTSFromCfi;
  }, [startPageTTSFromCfi]);

  // Track the chapter that was active when TTS was last started
  const ttsStartChapterRef = useRef<string>("");

  // TTS: toggle reading from current page with auto page-turn
  const handleToggleTTS = useCallback(async () => {
    if (showTTS) {
      setShowTTS(false);
      return;
    }

    const hasActiveSession =
      ttsCurrentBookId === bookId &&
      (ttsPlayState !== "stopped" || !!(ttsCurrentText || ttsLastText).trim());
    const isPlaying = ttsPlayState === "playing" || ttsPlayState === "loading";
    const chapterChanged =
      ttsStartChapterRef.current !== "" && ttsStartChapterRef.current !== readerTab?.chapterTitle;
    // Selection sessions only cover the snippet the user picked. When they
    // open the full listen page, promote to a page-level session so the
    // queue isn't just a single sentence.
    const isSelectionSession = ttsSourceKind === "selection";

    // If playing, always just re-show (don't interrupt playback)
    // If stopped/paused with active session and same chapter, also just re-show
    if (hasActiveSession && (isPlaying || !chapterChanged) && !isSelectionSession) {
      setShowTTS(true);
      return;
    }

    // Otherwise refresh: either first time, or chapter changed while not playing
    ttsStartChapterRef.current = readerTab?.chapterTitle ?? "";
    await startPageTTS(ttsContinuousEnabled);
  }, [
    bookId,
    showTTS,
    startPageTTS,
    ttsContinuousEnabled,
    ttsCurrentBookId,
    ttsCurrentText,
    ttsLastText,
    ttsPlayState,
    ttsSourceKind,
    readerTab?.chapterTitle,
  ]);

  // TTS: speak selected text (no auto page-turn)
  const handleSpeakSelection = useCallback(() => {
    if (selection?.text) {
      startSelectionTTS(selection.text);
    }
    setSelection(null);
  }, [selection, startSelectionTTS]);

  const handleTTSReplay = useCallback(async () => {
    if (ttsSourceKind === "selection") {
      const text = (ttsCurrentText || ttsLastText).trim();
      if (text) {
        startSelectionTTS(text);
      }
      return;
    }

    await startPageTTS(ttsContinuousEnabled);
  }, [
    startPageTTS,
    startSelectionTTS,
    ttsContinuousEnabled,
    ttsCurrentText,
    ttsLastText,
    ttsSourceKind,
  ]);

  const handleReturnToReadingFromTTS = useCallback(() => {
    const targetCfi = currentTTSSegment?.cfi || ttsCurrentLocationCfi || readerTab?.currentCfi;
    setShowTTS(false);
    if (!targetCfi) return;
    navigateToCfi(targetCfi);
    window.setTimeout(() => {
      foliateRef.current?.highlightCFITemporarily(targetCfi, 1200);
    }, 120);
  }, [currentTTSSegment?.cfi, navigateToCfi, readerTab?.currentCfi, ttsCurrentLocationCfi]);

  const handleTTSPlayPause = useCallback(async () => {
    if (ttsPlayState === "loading") return;
    if (ttsPlayState === "playing") {
      ttsPause();
      return;
    }
    if (ttsPlayState === "paused") {
      ttsResume();
      return;
    }

    if (ttsSourceKind === "selection") {
      const text = (ttsCurrentText || ttsLastText).trim();
      if (text) {
        startSelectionTTS(text);
      }
      return;
    }

    await startPageTTS(ttsContinuousEnabled);
  }, [
    startPageTTS,
    startSelectionTTS,
    ttsContinuousEnabled,
    ttsCurrentText,
    ttsLastText,
    ttsPause,
    ttsPlayState,
    ttsResume,
    ttsSourceKind,
  ]);

  const handleAdjustTTSRate = useCallback(
    (delta: number) => {
      const nextRate = Math.max(0.5, Math.min(2, Math.round((ttsConfig.rate + delta) * 10) / 10));
      ttsUpdateConfig({ rate: nextRate });
    },
    [ttsConfig.rate, ttsUpdateConfig],
  );

  const handleAdjustTTSPitch = useCallback(
    (delta: number) => {
      const nextPitch = Math.max(0.5, Math.min(2, Math.round((ttsConfig.pitch + delta) * 10) / 10));
      ttsUpdateConfig({ pitch: nextPitch });
    },
    [ttsConfig.pitch, ttsUpdateConfig],
  );

  const handleToggleTTSContinuous = useCallback(() => {
    setTtsContinuousEnabled((prev) => {
      const next = !prev;
      const shouldContinue = next && ttsSourceKind === "page";
      ttsContinuousRef.current = shouldContinue;
      ttsSetOnEnd(shouldContinue ? handleTTSPageEnd : null);
      return next;
    });
  }, [handleTTSPageEnd, ttsSetOnEnd, ttsSourceKind]);

  const handleJumpToTTSSegment = useCallback(
    (offsetFromCurrent = 0) => {
      if (offsetFromCurrent < 0) {
        const prevIndex = ttsPrevPageSegments.length + offsetFromCurrent;
        const safeIdx = Math.max(0, prevIndex);
        const fromPrev = ttsPrevPageSegments.slice(safeIdx);
        const allSegments = [...fromPrev, ...ttsSegments];
        if (allSegments.length === 0) return;
        const newPrev = ttsPrevPageSegments.slice(0, safeIdx);
        const nextText = allSegments
          .map((segment) => segment.text)
          .join(" ")
          .trim();
        const nextCfi = allSegments[0]?.cfi;
        setTtsPrevPageSegments(newPrev);
        setTtsSegments(allSegments);
        setTtsLastText(nextText);
        ttsSegmentsRef.current = allSegments;
        ttsLastTextRef.current = nextText;
        if (nextCfi) {
          ttsSetCurrentLocation(nextCfi);
          goToCFISafely(nextCfi);
          foliateRef.current?.highlightCFITemporarily(nextCfi, 1200);
        }
        setTimeout(() => ttsPlay(allSegments.map((segment) => segment.text)), 0);
        return;
      }

      const safeIdx = Math.max(0, Math.min(offsetFromCurrent, ttsSegments.length - 1));
      const sliced = ttsSegments.slice(safeIdx);
      if (sliced.length === 0) return;
      const newPrev = [...ttsPrevPageSegments, ...ttsSegments.slice(0, safeIdx)];
      const nextText = sliced
        .map((segment) => segment.text)
        .join(" ")
        .trim();
      const nextCfi = sliced[0]?.cfi;
      setTtsPrevPageSegments(newPrev);
      setTtsSegments(sliced);
      setTtsLastText(nextText);
      ttsSegmentsRef.current = sliced;
      ttsLastTextRef.current = nextText;
      if (nextCfi) {
        ttsSetCurrentLocation(nextCfi);
        goToCFISafely(nextCfi);
        foliateRef.current?.highlightCFITemporarily(nextCfi, 1200);
      }
      setTimeout(() => ttsPlay(sliced.map((segment) => segment.text)), 0);
    },
    [ttsPrevPageSegments, ttsSegments, ttsSetCurrentLocation, ttsPlay, goToCFISafely],
  );

  const handleJumpToTTSLyricSegment = useCallback(
    (segment: { text: string; cfi?: string | null }, offsetFromCurrent: number) => {
      // offsetFromCurrent = lyricIndex - prevCount
      // lyricSegments = [...ttsPrevPageSegments, ...ttsSegments, ...ttsFutureSegments]

      // ── Within current TTS session: instant jump ──
      if (offsetFromCurrent >= 0 && offsetFromCurrent < ttsSegments.length) {
        ttsJumpToChunk(offsetFromCurrent);
        if (segment.cfi) {
          void foliateRef.current?.setTTSHighlight(segment.cfi);
        }
        return;
      }

      // ── Jumping to a prev-page segment (data already in memory) ──
      if (offsetFromCurrent < 0) {
        const prevIndex = ttsPrevPageSegments.length + offsetFromCurrent;
        const safeIdx = Math.max(0, prevIndex);
        const fromPrev = ttsPrevPageSegments.slice(safeIdx);
        const allSegments = [...fromPrev, ...ttsSegments, ...ttsFutureSegments];
        if (allSegments.length === 0) return;
        const newPrev = ttsPrevPageSegments.slice(0, safeIdx);
        const nextText = allSegments
          .map((s) => s.text)
          .join(" ")
          .trim();
        const nextCfi = allSegments[0]?.cfi;
        setTtsPrevPageSegments(newPrev);
        setTtsSegments(allSegments);
        setTtsFutureSegments([]);
        setTtsLastText(nextText);
        ttsSegmentsRef.current = allSegments;
        ttsLastTextRef.current = nextText;
        ttsFutureSegmentsRef.current = [];
        if (nextCfi) {
          ttsSetCurrentLocation(nextCfi);
          goToCFISafely(nextCfi);
        }
        ttsPlay(allSegments.map((s) => s.text));
        return;
      }

      // ── Jumping to a future segment (data already in memory) ──
      const futureOffset = offsetFromCurrent - ttsSegments.length;
      if (futureOffset >= 0 && futureOffset < ttsFutureSegments.length) {
        const consumedCurrent = ttsSegments;
        const skippedFuture = ttsFutureSegments.slice(0, futureOffset);
        const remainingFuture = ttsFutureSegments.slice(futureOffset);
        const newPrev = [...ttsPrevPageSegments, ...consumedCurrent, ...skippedFuture];
        const nextText = remainingFuture
          .map((s) => s.text)
          .join(" ")
          .trim();
        const nextCfi = remainingFuture[0]?.cfi;
        setTtsPrevPageSegments(newPrev);
        setTtsSegments(remainingFuture);
        setTtsFutureSegments([]);
        setTtsLastText(nextText);
        ttsSegmentsRef.current = remainingFuture;
        ttsLastTextRef.current = nextText;
        ttsFutureSegmentsRef.current = [];
        if (nextCfi) {
          ttsSetCurrentLocation(nextCfi);
          goToCFISafely(nextCfi);
        }
        ttsPlay(remainingFuture.map((s) => s.text));
        void primeDesktopTTSLyricContext(
          remainingFuture[remainingFuture.length - 1]?.cfi || remainingFuture[0]?.cfi || nextCfi,
        );
        return;
      }

      // ── Data not loaded yet — fall back ──
      if (segment.cfi) {
        void startPageTTSFromCfi(segment.cfi, segment.text);
      }
    },
    [
      primeDesktopTTSLyricContext,
      startPageTTSFromCfi,
      ttsJumpToChunk,
      ttsPlay,
      ttsPrevPageSegments,
      ttsSegments,
      ttsFutureSegments,
      ttsSetCurrentLocation,
      goToCFISafely,
    ],
  );

  const handleLoadMoreAboveTTSLyrics = useCallback(async () => {
    const anchorCfi = ttsPrevPageSegments[0]?.cfi || ttsSegments[0]?.cfi || null;
    if (!anchorCfi || ttsLoadMoreAboveRef.current === anchorCfi) return;
    ttsLoadMoreAboveRef.current = anchorCfi;
    try {
      const context = await foliateRef.current?.getTTSSegmentContext(anchorCfi, 10, 0);
      if (context?.before?.length) {
        const incoming = filterDistinctTTSSegments(
          context.before,
          ttsPrevPageSegments,
          ttsSegments,
        );
        if (incoming.length > 0) {
          setTtsPrevPageSegments((prev) => mergeUniqueTTSSegments(prev, incoming, "prepend"));
        }
      }
    } finally {
      ttsLoadMoreAboveRef.current = null;
    }
  }, [filterDistinctTTSSegments, mergeUniqueTTSSegments, ttsPrevPageSegments, ttsSegments]);

  const handleLoadMoreBelowTTSLyrics = useCallback(async () => {
    const anchorCfi =
      ttsFutureSegments[ttsFutureSegments.length - 1]?.cfi ||
      ttsSegments[ttsSegments.length - 1]?.cfi ||
      null;
    if (!anchorCfi || ttsLoadMoreBelowRef.current === anchorCfi) return;
    ttsLoadMoreBelowRef.current = anchorCfi;
    try {
      const context = await foliateRef.current?.getTTSSegmentContext(anchorCfi, 0, 10);
      if (context?.after?.length) {
        const incoming = filterDistinctTTSSegments(
          context.after,
          ttsPrevPageSegments,
          ttsSegments,
          ttsFutureSegments,
        );
        if (incoming.length > 0) {
          setTtsFutureSegments((prev) => {
            const next = mergeUniqueTTSSegments(prev, incoming, "append");
            ttsFutureSegmentsRef.current = next;
            return next;
          });
        }
      }
    } finally {
      ttsLoadMoreBelowRef.current = null;
    }
  }, [
    filterDistinctTTSSegments,
    mergeUniqueTTSSegments,
    ttsFutureSegments,
    ttsPrevPageSegments,
    ttsSegments,
  ]);

  // Stop TTS when leaving the reader
  useEffect(() => {
    return () => {
      const currentTTSState = useTTSStore.getState();
      const ownsCurrentSession = currentTTSState.currentBookId === bookId;
      resetReaderTTSState({
        stopPlayback: ownsCurrentSession,
        clearSessionBinding: ownsCurrentSession,
      });
    };
  }, [bookId, resetReaderTTSState]);

  // --- Search logic ---
  const searchGeneratorRef = useRef<AsyncGenerator | null>(null);
  const searchResultsListRef = useRef<Array<{ cfi: string; excerpt: string }>>([]);

  const handleSearch = useCallback(
    async (query: string) => {
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
          const r = result as
            | {
                cfi?: string;
                excerpt?: string;
                progress?: number;
                subitems?: Array<{ cfi: string; excerpt: string }>;
              }
            | undefined;
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
              navigateToCfi(results[0].cfi);
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
        navigateToCfi(results[0].cfi);
      }
    },
    [navigateToCfi, setSearchResults, setSearchIndex],
  );

  const navigateSearchResult = useCallback(
    (direction: "next" | "prev") => {
      const results = searchResultsListRef.current;
      if (results.length === 0) return;

      setSearchIndex((prev) => {
        const next =
          direction === "next"
            ? (prev + 1) % results.length
            : (prev - 1 + results.length) % results.length;
        navigateToCfi(results[next].cfi);
        return next;
      });
    },
    [navigateToCfi],
  );

  const handleNavigateToCitation = useCallback(
    (citation: CitationPart) => {
      if (!citation.cfi || citation.cfi.trim() === "") {
        console.warn("Citation has no valid CFI, falling back to chapter index:", {
          chapterTitle: citation.chapterTitle,
          chapterIndex: citation.chapterIndex,
          text: citation.text.slice(0, 50),
        });
        try {
          foliateRef.current?.goToIndex(citation.chapterIndex);
        } catch (error) {
          console.error("Failed to navigate to chapter:", error, citation);
        }
        return;
      }

      if (citation.cfi.startsWith("page:")) {
        const pageNum = Number.parseInt(citation.cfi.split(":")[1], 10);
        if (!isNaN(pageNum)) {
          try {
            foliateRef.current?.goToIndex(pageNum - 1);
          } catch (error) {
            console.error("Failed to navigate to page:", error, citation);
          }
          return;
        }
      }

      console.log("[handleNavigateToCitation] Citation clicked:", citation);

      try {
        navigateToCfi(citation.cfi);

        const flashHighlight = () => {
          let flashCount = 0;
          const maxFlashes = 3;
          const flashInterval = 500;

          const doFlash = () => {
            if (flashCount >= maxFlashes) return;

            foliateRef.current?.addAnnotation({
              value: citation.cfi,
              type: "highlight",
              color: "orange",
            });

            setTimeout(() => {
              foliateRef.current?.deleteAnnotation({ value: citation.cfi });
              flashCount++;

              if (flashCount < maxFlashes) {
                setTimeout(doFlash, flashInterval);
              }
            }, flashInterval);
          };

          setTimeout(doFlash, 100);
        };

        flashHighlight();
      } catch (error) {
        console.error(
          "[handleNavigateToCitation] Failed to navigate to citation:",
          error,
          citation,
        );
      }
    },
    [navigateToCfi],
  );

  if (!readerTab) {
    return <div className="flex h-full items-center justify-center">{t("common.loading")}</div>;
  }

  return (
    <div className="flex h-full bg-muted/30 p-1">
      {/* TOC sidebar — LEFT side */}
      {showToc && (
        <div
          className="relative mr-1 flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm"
          style={{ width: tocPanel.width }}
        >
          <ResizeHandle
            side="right"
            onResizeStart={tocPanel.handleResizeStart}
            onResize={(delta) => tocPanel.handleResize(delta, "right")}
            onResizeEnd={tocPanel.handleResizeEnd}
          />
          <TOCPanel
            tocItems={tocItems}
            onGoToChapter={(href) => {
              handleGoToChapter(href);
            }}
            onGoToCfi={(cfi) => {
              navigateToCfi(cfi);
            }}
            onClose={() => setShowToc(false)}
            tabId={tabId}
            bookId={bookId}
            chapterTitle={readerTab?.chapterTitle}
          />
        </div>
      )}

      {/* Notebook sidebar — LEFT side */}
      <NotebookSidebarWrapper
        bookId={bookId}
        onGoToCfi={navigateToCfi}
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
        panelWidth={notebookPanel.width}
        onResize={notebookPanel.handleResize}
        onResizeStart={notebookPanel.handleResizeStart}
        onResizeEnd={notebookPanel.handleResizeEnd}
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
        <div
          className="relative flex flex-1 overflow-hidden transition-[padding] duration-300"
          style={{ paddingTop: contentTopPadding }}
        >
          {readingHeaderTitle && (
            <div className="pointer-events-none absolute left-5 top-3 z-[4] max-w-[70%] select-none truncate text-[20px] font-semibold tracking-tight text-foreground/86">
              {readingHeaderTitle}
            </div>
          )}

          {/* Reading area — FoliateViewer */}
          <div className="relative flex-1 overflow-hidden" ref={containerRef}>
            {/* Click zone indicators — visible only during reader tour (driver.js highlights them) */}
            <div
              id="reader-zone-prev"
              className="pointer-events-none absolute left-0 top-0 bottom-0 z-[100]"
              style={{ width: isDoublePage ? "33%" : "40%" }}
            />
            <div
              id="reader-zone-toolbar"
              className="pointer-events-none absolute top-0 bottom-0 z-[100]"
              style={{ left: isDoublePage ? "33%" : "40%", width: isDoublePage ? "34%" : "20%" }}
            />
            <div
              id="reader-zone-next"
              className="pointer-events-none absolute right-0 top-0 bottom-0 z-[100]"
              style={{ width: isDoublePage ? "33%" : "40%" }}
            />
            {bookDoc ? (
              <FoliateViewer
                ref={foliateRef}
                bookKey={bookId}
                bookDoc={bookDoc}
                format={bookFormat}
                viewSettings={viewSettingsWithFonts}
                lastLocation={book?.currentCfi || undefined}
                onRelocate={handleRelocate}
                onTocReady={handleTocReady}
                onLoaded={handleLoaded}
                onSectionLoad={handleSectionLoad}
                onError={handleError}
                onSelection={handleSelection}
                onShowAnnotation={handleShowAnnotation}
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
                  {book?.filePath ? (
                    <button
                      type="button"
                      className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                      onClick={() => {
                        isInitializedRef.current = false;
                        setError(null);
                        setBookDoc(null);
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
                      }}
                    >
                      {t("common.retry")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                      onClick={handleCloseMissingBookTab}
                    >
                      {t("common.back", "返回")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void handleReimportMissingBook()}
                    disabled={isReimporting}
                  >
                    {isReimporting
                      ? t("reader.reimporting", "正在重新导入...")
                      : t("reader.reimport", "重新导入")}
                  </button>
                </div>
              </div>
            )}

            {/* Bookmark ribbon */}
            <BookmarkRibbon visible={isBookmarked} />

            {/* Selection popover */}
            {selection && (
              <SelectionPopover
                position={selectionPos}
                selectedText={selection.text}
                annotated={selection.annotated}
                currentColor={selection.color as HighlightColor | undefined}
                defaultColor={viewSettings.defaultHighlightColor ?? "yellow"}
                isPdf={bookFormat === "PDF"}
                onHighlight={handleHighlight}
                onRemoveHighlight={handleRemoveHighlight}
                onNote={handleNote}
                onCopy={handleCopy}
                onTranslate={handleTranslate}
                onAskAI={handleAskAI}
                onSpeak={handleSpeakSelection}
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
            isVisible={toolbarVisible}
            onPrev={handleNavPrev}
            onNext={handleNavNext}
            tocItems={tocItems}
            onGoToChapter={handleGoToChapter}
            onToggleSearch={handleToggleSearch}
            onToggleToc={handleToggleToc}
            onToggleSettings={handleToggleSettings}
            onToggleChat={handleToggleChat}
            onToggleTTS={handleToggleTTS}
            chapterTranslationState={chapterTranslation.state}
            onChapterTranslationStart={chapterTranslation.startTranslation}
            onChapterTranslationCancel={chapterTranslation.cancelTranslation}
            onToggleOriginalVisible={chapterTranslation.toggleOriginalVisible}
            onToggleTranslationVisible={chapterTranslation.toggleTranslationVisible}
            onChapterTranslationReset={chapterTranslation.reset}
            isChatOpen={showChat}
            isTTSActive={showTTS || ttsPlayState !== "stopped"}
            isFixedLayout={isFixedLayout}
            isPinned={isToolbarPinned}
            onTogglePinned={() => setIsToolbarPinned((prev) => !prev)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            getPageSnippet={() => foliateRef.current?.getVisibleText() || ""}
          />

          {/* Floating Footer bar — overlays content area */}
          <FooterBar
            tabId={tabId}
            totalPages={totalPages}
            currentPage={currentPage}
            isVisible={controlsVisible}
            onPrev={handleNavPrev}
            onNext={handleNavNext}
            onSeek={(fraction) => {
              suppressProgressTracking(3000);
              foliateRef.current?.goToFraction(fraction);
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />

          <TTSPage
            visible={showTTS}
            bookTitle={book?.meta.title || ""}
            chapterTitle={readerTab?.chapterTitle || ""}
            coverSrc={ttsCoverSrc}
            playState={ttsPlayState}
            currentText={ttsCurrentText || ttsLastText}
            config={ttsConfig}
            readingProgress={readerTab?.progress ?? 0}
            currentPage={currentPage}
            totalPages={totalPages}
            sourceLabel={
              ttsSourceKind === "selection" ? t("tts.fromSelection") : t("tts.fromCurrentPage")
            }
            continuousEnabled={ttsContinuousEnabled}
            narrationSegments={[...ttsNarrationSegments, ...ttsFutureSegments]}
            prevNarrationSegments={ttsPrevPageSegments}
            currentChunkIndex={ttsCurrentChunkIndex}
            totalChunks={ttsTotalChunks}
            onClose={() => setShowTTS(false)}
            onReturnToReading={handleReturnToReadingFromTTS}
            onReplay={handleTTSReplay}
            onPlayPause={handleTTSPlayPause}
            onStop={() => {
              ttsContinuousRef.current = false;
              ttsSetOnEnd(null);
              setTtsFutureSegments([]);
              ttsFutureSegmentsRef.current = [];
              ttsStop();
            }}
            onAdjustRate={handleAdjustTTSRate}
            onAdjustPitch={handleAdjustTTSPitch}
            onToggleContinuous={handleToggleTTSContinuous}
            onJumpToSegment={handleJumpToTTSSegment}
            onJumpToLyricSegment={handleJumpToTTSLyricSegment}
            onLoadMoreAbove={handleLoadMoreAboveTTSLyrics}
            onLoadMoreBelow={handleLoadMoreBelowTTSLyrics}
            onUpdateConfig={ttsUpdateConfig}
            onPrevChapter={tocItems.length > 0 ? handleTTSPrevChapter : undefined}
            onNextChapter={tocItems.length > 0 ? handleTTSNextChapter : undefined}
          />

          {/* Always-visible thin progress bar at the very bottom */}
          <div className="absolute bottom-0 left-0 right-0 z-20 h-[2px] bg-foreground/5">
            <div
              className="h-full bg-primary/30 transition-all duration-300 ease-out"
              style={{ width: `${Math.round((readerTab?.progress ?? 0) * 100)}%` }}
            />
          </div>
        </div>

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

      {/* AI Chat sidebar — RIGHT side, resizable */}
      {showChat && (
        <div
          className="relative ml-1 flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm"
          style={{ width: chatPanel.width }}
        >
          <ResizeHandle
            side="left"
            onResizeStart={chatPanel.handleResizeStart}
            onResize={(delta) => chatPanel.handleResize(delta, "left")}
            onResizeEnd={chatPanel.handleResizeEnd}
          />
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
            <ChatPanel book={book} onNavigateToCitation={handleNavigateToCitation} />
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
  panelWidth,
  onResize,
  onResizeStart,
  onResizeEnd,
}: {
  bookId: string;
  onGoToCfi: (cfi: string) => void;
  onAddAnnotation: (cfi: string, color: string, note?: string) => void;
  onDeleteAnnotation: (cfi: string) => void;
  panelWidth: number;
  onResize: (delta: number, side: "left" | "right") => void;
  onResizeStart: () => void;
  onResizeEnd: () => void;
}) {
  const isOpen = useNotebookStore((s) => s.isOpen);
  const closeNotebook = useNotebookStore((s) => s.closeNotebook);

  if (!isOpen) return null;

  return (
    <div
      className="relative mr-1 flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm"
      style={{ width: panelWidth }}
    >
      <ResizeHandle
        side="right"
        onResizeStart={onResizeStart}
        onResize={(delta) => onResize(delta, "right")}
        onResizeEnd={onResizeEnd}
      />
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
