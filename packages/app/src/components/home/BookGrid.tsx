/**
 * BookGrid — responsive grid layout with Readest-style spacing
 */
import type { Book } from "@readany/core/types";
import { BookCard } from "./BookCard";

interface BookGridProps {
  books: Book[];
  selectionMode?: boolean;
  selectedBookIds?: Set<string>;
  onToggleSelect?: (bookId: string) => void;
}

export function BookGrid({ books, selectionMode, selectedBookIds, onToggleSelect }: BookGridProps) {
  return (
    <div className="grid grid-cols-3 gap-x-5 gap-y-6 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {books.map((book) => (
        <BookCard
          key={book.id}
          book={book}
          isSelectionMode={selectionMode}
          isSelected={selectedBookIds?.has(book.id)}
          onSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}
