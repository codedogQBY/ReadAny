/**
 * BookGrid — responsive grid layout with Readest-style spacing
 * Auto-generates mini reviews for books that lack them.
 */
// import { bookMiniReviewService } from "@/lib/book-mini-review";
import type { Book } from "@readany/core/types";
import { useEffect } from "react";
import { BookCard } from "./BookCard";

// const BATCH_DELAY = 2000; // ms between each auto-generation request
// const MAX_CONCURRENT = 1; // generate one at a time to avoid rate limits

export function BookGrid({ books }: { books: Book[] }) {
  // const generatedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // let cancelled = false;

    async function autoGenerateReviews() {
      // 禁用自动生成功能，因为现在每次打开都会重新生成
      // BookCard 组件会在挂载时自动调用 generateReview
      console.log('[BookGrid] Auto-generation disabled - using on-demand generation');
    }

    if (books.length > 0) {
      autoGenerateReviews();
    }

    return () => {
      // cancelled = true;
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
