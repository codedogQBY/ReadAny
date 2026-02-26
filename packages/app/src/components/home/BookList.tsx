/**
 * BookList — list view for books
 */
import type { Book } from "@/types";
import { useNavigate } from "react-router";

export function BookList({ books }: { books: Book[] }) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-1 overflow-y-auto">
      {books.map((book) => (
        <div
          key={book.id}
          className="flex cursor-pointer items-center gap-4 rounded-md px-3 py-2 transition-colors hover:bg-muted"
          onClick={() => navigate(`/reader/${book.id}`)}
        >
          <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-muted">
            {book.meta.coverUrl && (
              <img src={book.meta.coverUrl} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{book.meta.title}</p>
            <p className="truncate text-xs text-muted-foreground">{book.meta.author}</p>
          </div>
          <div className="text-xs text-muted-foreground">{Math.round(book.progress * 100)}%</div>
        </div>
      ))}
    </div>
  );
}
