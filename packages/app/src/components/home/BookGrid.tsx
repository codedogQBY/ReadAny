/**
 * BookGrid — responsive grid layout for books
 */
import type { Book } from "@/types";
import { BookCard } from "./BookCard";
import { useNavigate } from "react-router";

export function BookGrid({ books }: { books: Book[] }) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 overflow-y-auto">
      {books.map((book) => (
        <BookCard
          key={book.id}
          book={book}
          onClick={() => navigate(`/reader/${book.id}`)}
        />
      ))}
    </div>
  );
}
