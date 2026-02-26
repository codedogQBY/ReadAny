/**
 * BookCard — book card with cover on top, info below (SageRead style)
 */
import { useLibraryStore } from "@/stores/library-store";
import { useAppStore } from "@/stores/app-store";
import type { Book } from "@/types";
import { MoreVertical, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

interface BookCardProps {
  book: Book;
}

export function BookCard({ book }: BookCardProps) {
  const { t } = useTranslation();
  const addTab = useAppStore((s) => s.addTab);
  const removeBook = useLibraryStore((s) => s.removeBook);
  const [showMenu, setShowMenu] = useState(false);
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

  return (
    <div
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-background shadow-sm transition-all hover:shadow-md"
      onClick={handleOpen}
    >
      {/* Cover area — 4:5 aspect ratio like SageRead */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-neutral-100 to-neutral-200">
        {book.meta.coverUrl ? (
          <img
            src={book.meta.coverUrl}
            alt={book.meta.title}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4">
            <span className="text-4xl font-bold text-neutral-300">
              {book.meta.title.charAt(0).toUpperCase()}
            </span>
            <span className="line-clamp-2 text-center text-xs text-neutral-400">
              {book.meta.title}
            </span>
          </div>
        )}

        {/* Format badge */}
        <span className="absolute right-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none text-white/90">
          {book.format || "epub"}
        </span>

        {/* Progress overlay bar at bottom of cover */}
        {progressPct > 0 && progressPct < 100 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/10">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}

        {/* Completed badge */}
        {progressPct >= 100 && (
          <div className="absolute bottom-1.5 left-1.5 rounded bg-green-500/90 px-1.5 py-0.5 text-[9px] font-semibold text-white">
            {t("home.complete")}
          </div>
        )}

        {/* Context menu trigger */}
        <button
          type="button"
          className="absolute right-1.5 bottom-1.5 rounded-md bg-black/30 p-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
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
            <div className="absolute right-1 bottom-8 z-50 min-w-32 rounded-lg border bg-popover p-1 shadow-lg">
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

      {/* Info area */}
      <div className="flex flex-col gap-0.5 p-2.5">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-tight text-foreground">
          {book.meta.title}
        </h3>
        {book.meta.author && (
          <p className="truncate text-[11px] text-muted-foreground">{book.meta.author}</p>
        )}

        {/* Status row */}
        <div className="mt-1 flex items-center gap-1.5">
          {progressPct === 0 ? (
            <span className="inline-block rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
              {t("home.new")}
            </span>
          ) : progressPct < 100 ? (
            <span className="text-[10px] tabular-nums text-muted-foreground">{progressPct}%</span>
          ) : null}

          <div
            className={`ml-auto size-1.5 rounded-full ${book.isVectorized ? "bg-green-500" : "bg-neutral-300"}`}
            title={book.isVectorized ? t("home.vectorized") : t("home.notVectorized")}
          />
        </div>
      </div>
    </div>
  );
}
