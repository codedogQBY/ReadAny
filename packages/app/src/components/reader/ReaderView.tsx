import { ChatPanel } from "@/components/chat/ChatPanel";
import type {
  Selection as DocSelection,
  DocumentRenderer,
  TOCItem,
} from "@/lib/reader/document-renderer";
import { createRendererForFile } from "@/lib/reader/renderer-factory";
import { throttle } from "@/lib/utils/throttle";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AskAIDialog } from "./AskAIDialog";
import { FooterBar } from "./FooterBar";
import { ReaderToolbar } from "./ReaderToolbar";
import { SearchBar } from "./SearchBar";
import { SelectionPopover } from "./SelectionPopover";
import { TOCPanel } from "./TOCPanel";
import { TranslationPopover } from "./TranslationPopover";

// --- Optimization #13: Tauri convertFileSrc ---
// Try to use convertFileSrc (asset:// protocol) for zero-serialization file loading.
// Falls back to readFile + Blob if convertFileSrc is not available.
async function loadFileAsBlob(filePath: string): Promise<Blob> {
  try {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const assetUrl = convertFileSrc(filePath);
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
    return await response.blob();
  } catch {
    // Fallback: use readFile plugin (works in all Tauri environments)
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const fileBytes = await readFile(filePath);
    return new Blob([fileBytes]);
  }
}

// In-memory file blob cache to avoid re-reading from disk on every tab switch
const fileBlobCache = new Map<string, Blob>();
const MAX_CACHE_SIZE = 5;

async function getCachedBlob(filePath: string): Promise<Blob> {
  const cached = fileBlobCache.get(filePath);
  if (cached) return cached;

  const blob = await loadFileAsBlob(filePath);

  // Evict oldest if cache is full
  if (fileBlobCache.size >= MAX_CACHE_SIZE) {
    const firstKey = fileBlobCache.keys().next().value;
    if (firstKey) fileBlobCache.delete(firstKey);
  }
  fileBlobCache.set(filePath, blob);
  return blob;
}

/**
 * Auto-hide controls hook — shows on mouse enter, hides after delay.
 * Stays visible if `keepVisible` is true (e.g., when a dropdown is open).
 */
function useAutoHideControls(delay = 5000, keepVisible = false) {
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
    if (keepVisible) return;
    clearTimer();
    timeoutRef.current = setTimeout(() => setIsVisible(false), delay);
  }, [clearTimer, delay, keepVisible]);

  const handleMouseEnter = useCallback(() => {
    isHoveringRef.current = true;
    setIsVisible(true);
    clearTimer();
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
    } else if (!isHoveringRef.current) {
      hideAfterDelay();
    }
  }, [keepVisible, hideAfterDelay]);

  return { isVisible, handleMouseEnter, handleMouseLeave };
}

interface ReaderViewProps {
  bookId: string;
  tabId: string;
}

export function ReaderView({ bookId, tabId }: ReaderViewProps) {
  const tab = useReaderStore((s) => s.tabs[tabId]);
  const viewSettings = useReaderStore((s) => s.viewSettings);
  const setProgress = useReaderStore((s) => s.setProgress);
  const setChapter = useReaderStore((s) => s.setChapter);
  const setSelectedText = useReaderStore((s) => s.setSelectedText);

  const books = useLibraryStore((s) => s.books);
  const updateBook = useLibraryStore((s) => s.updateBook);
  const book = books.find((b) => b.id === bookId);

  const highlights = useAnnotationStore((s) => s.highlights);
  const loadAnnotations = useAnnotationStore((s) => s.loadAnnotations);

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<DocumentRenderer | null>(null);
  // Optimization #9: Ref lock to prevent React StrictMode double init
  const isInitializedRef = useRef(false);

  const [selection, setSelection] = useState<DocSelection | null>(null);
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [tocItems, setTocItems] = useState<TOCItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationText, setTranslationText] = useState("");
  const [translationPos, setTranslationPos] = useState({ x: 0, y: 0 });
  const [showAskAI, setShowAskAI] = useState(false);
  const [askAIText, setAskAIText] = useState("");
  const [searchResults, setSearchResults] = useState<number>(0);
  const [searchIndex, setSearchIndex] = useState<number>(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [showChat, setShowChat] = useState(false);

  const { t } = useTranslation();

  // SageReader-style auto-hide controls
  const keepControlsVisible = showSearch || showToc;
  const {
    isVisible: controlsVisible,
    handleMouseEnter: onControlsEnter,
    handleMouseLeave: onControlsLeave,
  } = useAutoHideControls(5000, keepControlsVisible);

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

  // Initialize renderer — with Ref lock (#9)
  useEffect(() => {
    if (!containerRef.current || !book?.filePath) return;
    // Ref lock: prevent double init from React StrictMode (#9)
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    let cancelled = false;

    // Throttled progress save to DB — 5000ms (#8)
    const throttledSaveProgress = throttle((bId: string, prog: number, cfi: string) => {
      updateBook(bId, { progress: prog, currentCfi: cfi, lastOpenedAt: Date.now() });
    }, 5000);

    const initRenderer = async () => {
      const renderer = await createRendererForFile(book.filePath!);
      if (cancelled) { renderer.destroy(); return; }
      rendererRef.current = renderer;

      renderer.on("location-change", (location, progress) => {
        const positionKey =
          location.cfi ||
          (location.pageIndex !== undefined
            ? `page-${location.pageIndex + 1}`
            : `spine-${location.chapterIndex}`);

        // Immediate update to reader store (UI responsiveness)
        setProgress(tabId, progress, positionKey);
        // Throttled save to persistent storage (#8 — 5000ms)
        throttledSaveProgress(bookId, progress, positionKey);

        if (location.pageIndex !== undefined) {
          setCurrentPage(location.pageIndex + 1);
        }
      });

      renderer.on("load", (info) => {
        setChapter(tabId, info.chapterIndex, info.chapterTitle);
        setIsLoading(false);

        const pages = renderer.getTotalPages?.();
        if (pages) setTotalPages(pages);
      });

      renderer.on("toc-ready", (toc) => {
        setTocItems(toc);
      });

      renderer.on("selection", (sel) => {
        setSelection(sel);
        if (sel) {
          setSelectedText(tabId, sel.text, null);
          if (sel.rects.length > 0) {
            const firstRect = sel.rects[0];
            setSelectionPos({
              x: firstRect.left + firstRect.width / 2,
              y: firstRect.top - 40,
            });
          }
        } else {
          setSelectedText(tabId, "", null);
        }
      });

      renderer.on("error", (err) => {
        console.error("Reader error:", err);
        setError(err.message);
        setIsLoading(false);
      });

      await renderer.mount(containerRef.current!);
      if (cancelled) { renderer.destroy(); rendererRef.current = null; return; }

      if (book?.filePath) {
        loadBookFile(renderer, book.filePath);
      }
    };

    initRenderer().catch((err) => {
      console.error("Failed to init renderer:", err);
      setError(err.message);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
      isInitializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // Load annotations
  useEffect(() => {
    loadAnnotations(bookId);
  }, [bookId, loadAnnotations]);

  // Apply view settings — lightweight path (#10)
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setFontSize(viewSettings.fontSize);
    renderer.setLineHeight(viewSettings.lineHeight);
    renderer.setTheme(viewSettings.theme);
    renderer.setViewMode(viewSettings.viewMode);
  }, [viewSettings]);

  // Sync highlights
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.clearAnnotations();
    const bookHighlights = highlights.filter((h) => h.bookId === bookId);
    for (const h of bookHighlights) {
      const colorMap: Record<string, string> = {
        yellow: "rgba(250, 204, 21, 0.35)",
        green: "rgba(74, 222, 128, 0.35)",
        blue: "rgba(96, 165, 250, 0.35)",
        pink: "rgba(244, 114, 182, 0.35)",
        purple: "rgba(192, 132, 252, 0.35)",
      };
      renderer.addAnnotation({
        id: h.id,
        location: { type: "cfi", cfi: h.cfi, chapterIndex: undefined },
        color: colorMap[h.color] || "rgba(250, 204, 21, 0.35)",
        text: h.text,
        note: h.note,
      });
    }
  }, [highlights, bookId]);

  const loadBookFile = async (renderer: DocumentRenderer, filePath: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const blob = await getCachedBlob(filePath);

      const initialLocation = book?.currentCfi
        ? book.currentCfi.startsWith("page-")
          ? {
              type: "page-coord" as const,
              pageIndex: Number.parseInt(book.currentCfi.replace("page-", ""), 10) - 1,
              cfi: book.currentCfi,
            }
          : { type: "cfi" as const, cfi: book.currentCfi }
        : undefined;

      await renderer.open(blob, initialLocation);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load book";
      console.error("loadBookFile failed:", err);
      setError(message);
      setIsLoading(false);
    }
  };

  // Navigation handlers
  const handleNavPrev = useCallback(() => rendererRef.current?.prev(), []);
  const handleNavNext = useCallback(() => rendererRef.current?.next(), []);
  const handleGoToChapter = useCallback((index: number) => {
    rendererRef.current?.goToIndex(index);
  }, []);

  // Selection actions
  const handleHighlight = useCallback(() => {
    if (selection) {
      useAnnotationStore.getState().addHighlight({
        id: crypto.randomUUID(),
        bookId,
        text: selection.text,
        cfi: selection.start.cfi || "",
        color: "yellow" as const,
        chapterTitle: tab?.chapterTitle || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    setSelection(null);
  }, [selection, bookId, tab?.chapterTitle]);

  const handleNote = useCallback(() => {
    if (selection) {
      useAnnotationStore.getState().addNote({
        id: crypto.randomUUID(),
        bookId,
        title: selection.text.slice(0, 50),
        content: "",
        cfi: selection.start.cfi || "",
        chapterTitle: tab?.chapterTitle || undefined,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    setSelection(null);
  }, [selection, bookId, tab?.chapterTitle]);

  const handleCopy = useCallback(() => {
    if (selection?.text) navigator.clipboard.writeText(selection.text);
    setSelection(null);
  }, [selection]);

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
      setAskAIText(selection.text);
      setShowAskAI(true);
    }
    setSelection(null);
  }, [selection]);

  const handleCloseSelection = useCallback(() => setSelection(null), []);
  const handleToggleSearch = useCallback(() => setShowSearch((p) => !p), []);
  const handleToggleToc = useCallback(() => setShowToc((p) => !p), []);
  const handleToggleChat = useCallback(() => setShowChat((p) => !p), []);

  // Search logic
  const handleSearch = useCallback((query: string) => {
    const renderer = rendererRef.current;
    if (!renderer || !query.trim()) {
      setSearchResults(0);
      setSearchIndex(0);
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    const existingMarks = container.querySelectorAll("mark[data-search]");
    for (const mark of existingMarks) {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
        parent.normalize();
      }
    }

    const iframe = container.querySelector("iframe");
    const searchDoc = iframe?.contentDocument || container.ownerDocument;
    const body = iframe?.contentDocument?.body || container;
    const treeWalker = searchDoc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const matches: Range[] = [];
    const lowerQuery = query.toLowerCase();

    let textNode: Text | null;
    while ((textNode = treeWalker.nextNode() as Text | null)) {
      const text = textNode.textContent?.toLowerCase() || "";
      let startPos = 0;
      let idx: number;
      while ((idx = text.indexOf(lowerQuery, startPos)) !== -1) {
        const range = searchDoc.createRange();
        range.setStart(textNode, idx);
        range.setEnd(textNode, idx + query.length);
        matches.push(range);
        startPos = idx + 1;
      }
    }

    for (const range of matches) {
      try {
        const mark = searchDoc.createElement("mark");
        mark.setAttribute("data-search", "true");
        mark.style.backgroundColor = "rgba(250, 204, 21, 0.5)";
        range.surroundContents(mark);
      } catch {
        // Range may cross element boundaries
      }
    }

    setSearchResults(matches.length);
    setSearchIndex(matches.length > 0 ? 0 : -1);

    if (matches.length > 0) {
      const firstMark = (iframe?.contentDocument?.body || container).querySelector(
        "mark[data-search]",
      );
      firstMark?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const navigateSearchResult = useCallback(
    (direction: "next" | "prev") => {
      const container = containerRef.current;
      if (!container) return;
      const iframe = container.querySelector("iframe");
      const body = iframe?.contentDocument?.body || container;
      const marks = body.querySelectorAll("mark[data-search]");
      if (marks.length === 0) return;

      for (const m of marks) {
        (m as HTMLElement).style.backgroundColor = "rgba(250, 204, 21, 0.5)";
      }

      let newIndex = searchIndex;
      if (direction === "next") {
        newIndex = (searchIndex + 1) % marks.length;
      } else {
        newIndex = (searchIndex - 1 + marks.length) % marks.length;
      }

      setSearchIndex(newIndex);
      const target = marks[newIndex] as HTMLElement;
      target.style.backgroundColor = "rgba(249, 115, 22, 0.7)";
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [searchIndex],
  );

  if (!tab) {
    return (
      <div className="flex h-full items-center justify-center">{t("common.loading")}</div>
    );
  }

  return (
    <div className="flex h-full bg-muted/30 p-1">
      {/* Main reading area — center, with border and shadow like SageRead */}
      <div className="relative flex flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm">
        {/* Toolbar — auto-hide like SageReader */}
        <ReaderToolbar
          tabId={tabId}
          isVisible={controlsVisible}
          onPrev={handleNavPrev}
          onNext={handleNavNext}
          tocItems={tocItems}
          onGoToChapter={handleGoToChapter}
          onToggleSearch={handleToggleSearch}
          onToggleToc={handleToggleToc}
          onToggleChat={handleToggleChat}
          isChatOpen={showChat}
          onMouseEnter={onControlsEnter}
          onMouseLeave={onControlsLeave}
        />

        {/* Search bar */}
        {showSearch && (
          <SearchBar
            onSearch={handleSearch}
            onNext={() => navigateSearchResult("next")}
            onPrev={() => navigateSearchResult("prev")}
            onClose={() => {
              setShowSearch(false);
              const container = containerRef.current;
              if (container) {
                const iframe = container.querySelector("iframe");
                const body = iframe?.contentDocument?.body || container;
                const marks = body.querySelectorAll("mark[data-search]");
                for (const mark of marks) {
                  const parent = mark.parentNode;
                  if (parent) {
                    parent.replaceChild(
                      document.createTextNode(mark.textContent || ""),
                      mark,
                    );
                    parent.normalize();
                  }
                }
              }
              setSearchResults(0);
              setSearchIndex(0);
            }}
            resultCount={searchResults}
            currentIndex={searchIndex}
          />
        )}

        {/* Content area with optional TOC */}
        <div className="relative flex flex-1 overflow-hidden">
          {/* TOC sidebar */}
          {showToc && (
            <>
              <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setShowToc(false)} />
              <div className="relative z-40 animate-in slide-in-from-left duration-200">
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

          {/* Reading area */}
          <div className="relative flex-1 overflow-hidden">
            <div ref={containerRef} className="h-full w-full" />

            {/* Loading overlay */}
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                  <p className="text-sm text-muted-foreground">{t("reader.loadingBook")}</p>
                </div>
              </div>
            )}

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
                      const renderer = rendererRef.current;
                      if (renderer && book?.filePath) {
                        setError(null);
                        loadBookFile(renderer, book.filePath);
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
                onHighlight={handleHighlight}
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

            {/* Ask AI dialog */}
            {showAskAI && askAIText && (
              <div className="absolute left-1/2 top-1/4 z-50 -translate-x-1/2">
                <AskAIDialog
                  selectedText={askAIText}
                  onSubmit={() => {
                    setShowAskAI(false);
                    setAskAIText("");
                  }}
                  onClose={() => {
                    setShowAskAI(false);
                    setAskAIText("");
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer bar — auto-hide like SageReader */}
        <FooterBar
          tabId={tabId}
          totalPages={totalPages}
          currentPage={currentPage}
          isVisible={controlsVisible}
          onPrev={handleNavPrev}
          onNext={handleNavNext}
          onMouseEnter={onControlsEnter}
          onMouseLeave={onControlsLeave}
        />
      </div>

      {/* AI Chat sidebar — right side, separate panel */}
      {showChat && (
        <div className="ml-1 flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm">
          {/* Chat header */}
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
          {/* Chat content */}
          <div className="flex-1 overflow-hidden">
            <ChatPanel />
          </div>
        </div>
      )}
    </div>
  );
}
