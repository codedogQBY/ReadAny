import { useResolvedSrc } from "@/hooks/use-resolved-src";
/**
 * BookList — list view for books
 */
import { openDesktopBook } from "@/lib/library/open-book";
import type { Book } from "@readany/core/types";
import { getBookProgressPercent } from "@readany/core/utils";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface BookListProps {
  books: Book[];
}

interface BookListItemProps {
  book: Book;
  onOpen: (book: Book) => void;
}

function BookListItem({ book, onOpen }: BookListItemProps) {
  const { t } = useTranslation();
  const coverSrc = useResolvedSrc(book.meta.coverUrl);
  const pct = getBookProgressPercent(book.progress);
  const isRemote = book.syncStatus === "remote";
  const isDownloading = book.syncStatus === "downloading";

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-xl border bg-background p-3 shadow-sm transition-colors hover:bg-muted/50"
      onClick={() => onOpen(book)}
    >
      <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-muted to-muted/50">
        {coverSrc ? (
          <img src={coverSrc} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-sm font-bold text-muted-foreground">
            {book.meta.title.charAt(0)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-sm font-medium">{book.meta.title}</h4>
        {book.meta.author && (
          <p className="truncate text-xs text-muted-foreground">{book.meta.author}</p>
        )}
      </div>
      <div>
        {isDownloading ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("home.downloading", "下载中")}
          </span>
        ) : isRemote ? (
          <span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[10px] font-medium text-sky-700">
            {t("home.remote", "需下载")}
          </span>
        ) : pct === 0 ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            {t("home.new")}
          </span>
        ) : pct >= 100 ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
            {t("home.complete")}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{pct}%</span>
        )}
      </div>
    </div>
  );
}

export function BookList({ books }: BookListProps) {
  const { t } = useTranslation();

  const handleOpen = async (book: Book) => {
    await openDesktopBook({ book, t });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {books.map((book) => (
        <BookListItem key={book.id} book={book} onOpen={handleOpen} />
      ))}
    </div>
  );
}
