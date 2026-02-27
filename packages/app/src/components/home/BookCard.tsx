/**
 * BookCard — Readest-inspired book card with realistic cover rendering
 */
import { triggerVectorizeBook } from "@/lib/rag/vectorize-trigger";
import { useLibraryStore } from "@/stores/library-store";
import { useAppStore } from "@/stores/app-store";
import { useVectorModelStore } from "@/stores/vector-model-store";
import type { Book, VectorizeProgress } from "@/types";
import { Check, Database, Loader2, MoreVertical, Trash2 } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface BookCardProps {
  book: Book;
}

export const BookCard = memo(function BookCard({ book }: BookCardProps) {
  const { t } = useTranslation();
  const addTab = useAppStore((s) => s.addTab);
  const removeBook = useLibraryStore((s) => s.removeBook);
  const hasVectorCapability = useVectorModelStore((s) => s.hasVectorCapability);
  const [showMenu, setShowMenu] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [vectorizing, setVectorizing] = useState(false);
  const [vectorProgress, setVectorProgress] = useState<VectorizeProgress | null>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const progressPct = Math.round(book.progress * 100);

  const handleOpen = () => {
    addTab({ id: `reader-${book.id}`, type: "reader", title: book.meta.title, bookId: book.id });
  };

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowMenu(false);
      removeBook(book.id);
    },
    [book.id, removeBook],
  );

  const handleVectorize = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowMenu(false);
      if (vectorizing) return;

      setVectorizing(true);
      try {
        await triggerVectorizeBook(book.id, book.filePath, (progress) => {
          setVectorProgress({ ...progress });
        });
      } catch (err) {
        console.error("[BookCard] Vectorization failed:", err);
      } finally {
        setVectorizing(false);
        setVectorProgress(null);
      }
    },
    [book.id, book.filePath, vectorizing],
  );

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageLoaded(false);
    setImageError(true);
  };

  const hasCover = book.meta.coverUrl && !imageError;

  // Vectorize progress percentage for display
  const vecPct = vectorProgress
    ? vectorProgress.totalChunks > 0
      ? Math.round((vectorProgress.processedChunks / vectorProgress.totalChunks) * 100)
      : 0
    : 0;

  return (
    <div
      className="group flex h-full cursor-pointer flex-col justify-end"
      onClick={handleOpen}
    >
      {/* Cover area — 28:41 aspect ratio (Readest standard) */}
      <div
        ref={coverRef}
        className="book-cover-shadow relative flex aspect-[28/41] w-full items-end justify-center overflow-hidden rounded transition-all duration-200 group-hover:book-cover-shadow"
      >
        {/* Actual cover image */}
        {book.meta.coverUrl && (
          <img
            src={book.meta.coverUrl}
            alt={book.meta.title}
            className={`absolute inset-0 h-full w-full rounded object-cover transition-opacity duration-300 ${
              imageLoaded && !imageError ? "opacity-100" : "opacity-0"
            }`}
            loading="lazy"
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        )}

        {/* Book spine overlay — only when image loaded */}
        {imageLoaded && !imageError && (
          <div className="book-spine absolute inset-0 rounded" />
        )}

        {/* Fallback cover — serif title + author */}
        {!hasCover && (
          <div className="absolute inset-0 flex flex-col items-center rounded bg-gradient-to-b from-stone-100 to-stone-200 p-3">
            <div className="flex flex-1 items-center justify-center">
              <span className="line-clamp-3 text-center font-serif text-base font-medium leading-snug text-stone-500">
                {book.meta.title}
              </span>
            </div>
            <div className="h-px w-8 bg-stone-300/60" />
            {book.meta.author && (
              <div className="flex h-1/4 items-center justify-center">
                <span className="line-clamp-1 text-center font-serif text-xs text-stone-400">
                  {book.meta.author}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Progress bar at bottom of cover */}
        {progressPct > 0 && progressPct < 100 && (
          <div className="absolute bottom-0 left-0 right-0 z-10 h-0.5 bg-black/10">
            <div
              className="h-full bg-primary/80 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}

        {/* Vectorization progress overlay */}
        {vectorizing && (
          <div className="absolute inset-0 z-15 flex flex-col items-center justify-center rounded bg-black/50 backdrop-blur-sm">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
            <span className="mt-1.5 text-xs font-medium text-white">
              {vectorProgress?.status === "chunking"
                ? t("home.vec_chunking")
                : vectorProgress?.status === "embedding"
                  ? `${vecPct}%`
                  : vectorProgress?.status === "indexing"
                    ? t("home.vec_indexing")
                    : t("home.vec_processing")}
            </span>
          </div>
        )}

        {/* Vectorized badge — top-left corner */}
        {book.isVectorized && !vectorizing && (
          <div className="absolute left-1 top-1 z-10 flex items-center gap-0.5 rounded bg-green-600/80 px-1 py-0.5 backdrop-blur-sm">
            <Database className="h-2.5 w-2.5 text-white" />
            <span className="text-[9px] font-medium text-white">{t("home.vec_indexed")}</span>
          </div>
        )}

        {/* Context menu trigger — hover only */}
        <button
          type="button"
          className="absolute right-1 bottom-1 z-20 rounded-md bg-black/30 p-0.5 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
        >
          <MoreVertical className="h-3.5 w-3.5 text-white" />
        </button>

        {/* Context menu */}
        {showMenu && (
          <>
            <div className="fixed inset-0 z-50" onClick={(e) => { e.stopPropagation(); setShowMenu(false); }} />
            <div className="absolute right-1 bottom-8 z-50 min-w-36 rounded-lg border bg-popover p-1 shadow-lg">
              {/* Vectorize button */}
              <button
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  !hasVectorCapability() || vectorizing
                    ? "text-muted-foreground opacity-50 cursor-not-allowed"
                    : book.isVectorized
                      ? "text-foreground hover:bg-muted"
                      : "text-foreground hover:bg-muted"
                }`}
                disabled={!hasVectorCapability() || vectorizing}
                onClick={handleVectorize}
              >
                {book.isVectorized ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-green-600" />
                    {t("home.vec_reindex")}
                  </>
                ) : (
                  <>
                    <Database className="h-3.5 w-3.5" />
                    {t("home.vec_vectorize")}
                  </>
                )}
              </button>
              {/* Delete button */}
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("common.remove")}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Info area — minimal, below cover */}
      <div className="flex w-full flex-col pt-2">
        <h4 className="truncate text-xs font-semibold leading-tight text-foreground">
          {book.meta.title}
        </h4>

        {/* Status row */}
        <div className="mt-0.5 flex items-center justify-between" style={{ minHeight: "14px" }}>
          {progressPct > 0 && progressPct < 100 ? (
            <span className="text-[10px] tabular-nums text-muted-foreground">{progressPct}%</span>
          ) : progressPct >= 100 ? (
            <span className="text-[10px] font-medium text-green-600">{t("home.complete")}</span>
          ) : (
            <span className="inline-block rounded-full bg-primary/8 px-1.5 py-px text-[9px] font-medium text-primary">
              {t("home.new")}
            </span>
          )}

          {/* Format badge — subtle, right-aligned */}
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">
            {book.format || "epub"}
          </span>
        </div>
      </div>
    </div>
  );
});
