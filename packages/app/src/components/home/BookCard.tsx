/**
 * BookCard — sageread-style book card with asymmetric corners
 */
import { useAppStore } from "@/stores/app-store";
import type { Book } from "@/types";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

interface BookCardProps {
  book: Book;
}

export function BookCard({ book }: BookCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addTab = useAppStore((s) => s.addTab);
  const progressPct = Math.round(book.progress * 100);

  const handleOpen = () => {
    addTab({ id: `reader-${book.id}`, type: "reader", title: book.meta.title, bookId: book.id });
    navigate(`/reader/${book.id}`);
  };

  return (
    <div
      className="group flex cursor-pointer flex-col overflow-hidden rounded-r-2xl rounded-l-md border bg-background shadow-sm transition-all hover:shadow-md"
      onClick={handleOpen}
    >
      {/* Title area */}
      <div className="flex flex-col gap-1 p-3 pb-2">
        <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-neutral-900">
          {book.meta.title}
        </h3>
        {book.meta.author && (
          <p className="truncate text-xs text-muted-foreground">{book.meta.author}</p>
        )}
      </div>

      {/* Cover area */}
      <div className="relative mx-2 mb-2 flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-neutral-100 to-neutral-200">
        {book.coverPath ? (
          <img
            src={book.coverPath}
            alt={book.meta.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <span className="text-2xl font-bold text-neutral-400">
            {book.meta.title.charAt(0)}
          </span>
        )}
      </div>

      {/* Progress / status */}
      <div className="px-3 pb-2.5">
        {progressPct === 0 ? (
          <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            {t("home.new")}
          </span>
        ) : progressPct >= 100 ? (
          <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
            {t("home.complete")}
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[10px] font-medium text-muted-foreground">{progressPct}%</span>
          </div>
        )}

        {/* Vectorization status icon */}
        <div className="mt-1.5 flex items-center gap-1">
          <div
            className={`size-1.5 rounded-full ${book.isVectorized ? "bg-green-500" : "bg-neutral-300"}`}
            title={book.isVectorized ? t("home.vectorized") : t("home.notVectorized")}
          />
          <span className="text-[9px] text-muted-foreground">
            {book.isVectorized ? t("home.vectorized") : t("home.notVectorized")}
          </span>
        </div>
      </div>
    </div>
  );
}
