/**
 * BookGrid — responsive grid layout (sageread breakpoints)
 */
import type { Book } from "@/types";
import { BookCard } from "./BookCard";

export function BookGrid({ books }: { books: Book[] }) {
  return (
    <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {books.map((book) => (
        <BookCard key={book.id} book={book} />
      ))}
    </div>
  );
}
