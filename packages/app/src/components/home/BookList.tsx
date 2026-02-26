/**
 * BookList — list view for books
 */
import { useAppStore } from "@/stores/app-store";
import type { Book } from "@/types";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

interface BookListProps {
  books: Book[];
}

export function BookList({ books }: BookListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addTab = useAppStore((s) => s.addTab);

  const handleOpen = (book: Book) => {
    addTab({ id: `reader-${book.id}`, type: "reader", title: book.meta.title, bookId: book.id });
    navigate(`/reader/${book.id}`);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {books.map((book) => {
        const pct = Math.round(book.progress * 100);
        return (
          <div
            key={book.id}
            className="flex cursor-pointer items-center gap-3 rounded-xl border bg-background p-3 shadow-sm transition-colors hover:bg-muted/50"
            onClick={() => handleOpen(book)}
          >
            <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-neutral-100 to-neutral-200">
              {book.coverPath ? (
                <img src={book.coverPath} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-sm font-bold text-neutral-400">{book.meta.title.charAt(0)}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-medium">{book.meta.title}</h4>
              {book.meta.author && (
                <p className="truncate text-xs text-muted-foreground">{book.meta.author}</p>
              )}
            </div>
            <div>
              {pct === 0 ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {t("home.new")}
                </span>
              ) : pct >= 100 ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                  {t("home.complete")}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{pct}%</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
