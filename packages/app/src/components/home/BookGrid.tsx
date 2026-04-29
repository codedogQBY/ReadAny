/**
 * BookGrid — responsive grid layout with Readest-style spacing
 * Auto-generates mini reviews for books that lack them.
 */
import { bookMiniReviewService } from "@/lib/book-mini-review";
import type { Book } from "@readany/core/types";
import { useEffect, useRef } from "react";
import { BookCard } from "./BookCard";

const BATCH_DELAY = 2000; // ms between each auto-generation request
const MAX_CONCURRENT = 1; // generate one at a time to avoid rate limits

export function BookGrid({ books }: { books: Book[] }) {
  const generatedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function autoGenerateReviews() {
      const booksWithoutReview = books.filter((book) => {
        if (generatedRef.current.has(book.id)) return false;
        const existing = bookMiniReviewService.getReview(book.id);
        return !existing;
      });

      // Generate reviews one by one with delay
      for (let i = 0; i < booksWithoutReview.length && !cancelled; i++) {
        const book = booksWithoutReview[i];
        generatedRef.current.add(book.id);

        try {
          await bookMiniReviewService.generateReview(book, {
            timeout: 15000,
            useCache: true,
          });
        } catch {
          // Silently fail — user can still manually generate
        }

        // Wait between requests to avoid rate limiting
        if (i < booksWithoutReview.length - 1 && !cancelled) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
        }
      }
    }

    if (books.length > 0) {
      autoGenerateReviews();
    }

    return () => {
      cancelled = true;
    };
  }, [books]);

  return (
    <div className="grid grid-cols-3 gap-x-5 gap-y-6 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {books.map((book) => (
        <BookCard key={book.id} book={book} />
      ))}
    </div>
  );
}
