import type {
  Selection as DocSelection,
  DocumentRenderer,
  TOCItem,
} from "@/lib/reader/document-renderer";
import { EPUBRenderer } from "@/lib/reader/epub-renderer";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { readFile } from "@tauri-apps/plugin-fs";
/**
 * ReaderView — main reading area with EPUB/PDF rendering
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ReaderToolbar } from "./ReaderToolbar";
import { SelectionPopover } from "./SelectionPopover";

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
  const book = books.find((b) => b.id === bookId);

  const highlights = useAnnotationStore((s) => s.highlights);

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<DocumentRenderer | null>(null);

  const [selection, setSelection] = useState<DocSelection | null>(null);
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [tocItems, setTocItems] = useState<TOCItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize renderer
  useEffect(() => {
    if (!containerRef.current || rendererRef.current) return;

    const renderer = new EPUBRenderer();
    rendererRef.current = renderer;

    // Set up event listeners
    renderer.on("location-change", (location, progress) => {
      setProgress(tabId, progress, location.cfi || `spine-${location.chapterIndex}`);
    });

    renderer.on("load", (info) => {
      setChapter(tabId, info.chapterIndex, info.chapterTitle);
      setIsLoading(false);
    });

    renderer.on("toc-ready", (toc) => {
      setTocItems(toc);
    });

    renderer.on("selection", (sel) => {
      setSelection(sel);
      if (sel) {
        setSelectedText(tabId, sel.text, null);
        // Position popover near the selection
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
      setError(err.message);
      setIsLoading(false);
    });

    // Mount the renderer
    renderer.mount(containerRef.current).then(() => {
      // Load the book file
      if (book?.filePath) {
        loadBookFile(renderer, book.filePath);
      }
    });

    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // Apply view settings to renderer
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    renderer.setFontSize(viewSettings.fontSize);
    renderer.setLineHeight(viewSettings.lineHeight);
    renderer.setTheme(viewSettings.theme);
    renderer.setViewMode(viewSettings.viewMode);
  }, [viewSettings]);

  // Sync highlights to renderer
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
        location: {
          type: "cfi",
          cfi: h.cfi,
          chapterIndex: undefined,
        },
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
      const fileBytes = await readFile(filePath);
      const blob = new Blob([fileBytes]);

      const initialLocation = book?.currentCfi
        ? { type: "cfi" as const, cfi: book.currentCfi }
        : undefined;

      await renderer.open(blob, initialLocation);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load book";
      setError(message);
      setIsLoading(false);
    }
  };

  const handleNavPrev = useCallback(() => {
    rendererRef.current?.prev();
  }, []);

  const handleNavNext = useCallback(() => {
    rendererRef.current?.next();
  }, []);

  const handleGoToChapter = useCallback((index: number) => {
    rendererRef.current?.goToIndex(index);
  }, []);

  const handleHighlight = useCallback(() => {
    // Handled by parent via annotation store
    setSelection(null);
  }, []);

  const handleNote = useCallback(() => {
    setSelection(null);
  }, []);

  const handleCopy = useCallback(() => {
    if (selection?.text) {
      navigator.clipboard.writeText(selection.text);
    }
    setSelection(null);
  }, [selection]);

  const handleTranslate = useCallback(() => {
    // TODO: Open translation popover
    setSelection(null);
  }, []);

  const handleAskAI = useCallback(() => {
    // TODO: Open AI dialog
    setSelection(null);
  }, []);

  const handleCloseSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const { t } = useTranslation();

  if (!tab) {
    return <div className="flex h-full items-center justify-center">{t("common.loading")}</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <ReaderToolbar
        tabId={tabId}
        onPrev={handleNavPrev}
        onNext={handleNavNext}
        tocItems={tocItems}
        onGoToChapter={handleGoToChapter}
      />

      <div className="relative flex-1 overflow-hidden">
        {/* EPUB renderer container */}
        <div ref={containerRef} className="h-full w-full" />

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <div className="flex flex-col items-center gap-2">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">{t("reader.loadingBook")}</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <div className="flex flex-col items-center gap-2 px-8 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <p className="text-xs text-muted-foreground">
                {t("reader.validEpub")}
              </p>
            </div>
          </div>
        )}

        {/* No book loaded placeholder */}
        {!isLoading && !error && !book?.filePath && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-muted-foreground">{t("reader.noBookFile", { bookId })}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("reader.importToStart")}
              </p>
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
      </div>

      {/* Progress bar at the bottom */}
      <div className="flex h-6 items-center gap-2 border-t border-border px-4">
        <div className="flex-1">
          <div className="h-1 rounded-full bg-muted">
            <div
              className="h-1 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.round(tab.progress * 100)}%` }}
            />
          </div>
        </div>
        <span className="text-xs text-muted-foreground">{Math.round(tab.progress * 100)}%</span>
      </div>
    </div>
  );
}
