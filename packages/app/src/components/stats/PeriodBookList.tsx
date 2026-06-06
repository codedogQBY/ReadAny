import { useResolvedSrc } from "@/hooks/use-resolved-src";
import type { PeriodBookStats } from "@readany/core/stats";
import { getBookProgressPercent } from "@readany/core/utils";
/**
 * PeriodBookList — shows books read in a time period with reading time and progress
 */
import { useTranslation } from "react-i18next";

interface PeriodBookListProps {
  books: PeriodBookStats[];
}

interface PeriodBookListItemProps {
  book: PeriodBookStats;
}

function PeriodBookListItem({ book }: PeriodBookListItemProps) {
  const coverSrc = useResolvedSrc(book.coverUrl);
  const progressPct = getBookProgressPercent(book.progress);

  return (
    <div className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/40">
      {/* Cover */}
      <div className="h-12 w-9 flex-shrink-0 overflow-hidden rounded bg-muted">
        {coverSrc ? (
          <img src={coverSrc} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground/50">
            {book.title.charAt(0)}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium text-foreground">{book.title}</p>
          <span className="flex-shrink-0 text-xs text-muted-foreground">
            {formatTime(book.totalTime)}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{book.author}</p>
        {/* Progress bar */}
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{progressPct}%</span>
        </div>
      </div>
    </div>
  );
}

export function PeriodBookList({ books }: PeriodBookListProps) {
  const { t } = useTranslation();

  if (books.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        {t("stats.noBooksInPeriod")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {books.map((book) => (
        <PeriodBookListItem key={book.bookId} book={book} />
      ))}
    </div>
  );
}

function formatTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
