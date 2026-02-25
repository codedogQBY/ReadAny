/**
 * BookCard — book thumbnail with progress ring and vectorize status
 */
import type { Book } from "@/types";

interface BookCardProps {
  book: Book;
  onClick?: () => void;
}

export function BookCard({ book, onClick }: BookCardProps) {
  return (
    <div
      className="group relative cursor-pointer rounded-lg border border-border bg-background p-3 transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      {/* Cover */}
      <div className="mb-3 aspect-[2/3] overflow-hidden rounded-md bg-muted">
        {book.meta.coverUrl ? (
          <img
            src={book.meta.coverUrl}
            alt={book.meta.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            {book.meta.title}
          </div>
        )}
      </div>

      {/* Info */}
      <h3 className="truncate text-sm font-medium">{book.meta.title}</h3>
      <p className="truncate text-xs text-muted-foreground">{book.meta.author}</p>

      {/* Progress bar */}
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${book.progress * 100}%` }}
        />
      </div>

      {/* Vectorize indicator */}
      {book.isVectorized && (
        <div className="absolute right-2 top-2 h-2 w-2 rounded-full bg-green-500" title="Vectorized" />
      )}
      {!book.isVectorized && book.vectorizeProgress > 0 && (
        <VectorizeRing progress={book.vectorizeProgress} />
      )}
    </div>
  );
}

function VectorizeRing({ progress }: { progress: number }) {
  const circumference = 2 * Math.PI * 8;
  const offset = circumference * (1 - progress);

  return (
    <svg className="absolute right-2 top-2 h-5 w-5" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted" />
      <circle
        cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2"
        className="text-primary"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}
