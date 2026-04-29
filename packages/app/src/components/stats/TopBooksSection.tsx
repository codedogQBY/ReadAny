/**
 * TopBooksSection.tsx — Top books ranking with expand/collapse.
 */
import { useResolvedSrc } from "@/hooks/use-resolved-src";
import type { DailyReadingFact, TopBookEntry } from "@readany/core/stats";
import { computeBookETA } from "@readany/core/stats";
import { cn } from "@readany/core/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { StatsCopy } from "./stats-copy";
import {
  formatCharacterCount,
  formatCharactersPerMinute,
  formatCompactMinutes,
} from "./stats-utils";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Top Books
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const TOP_BOOKS_COLLAPSED = 3;

export function TopBooksSection({
  books,
  copy,
  isZh,
  allFacts,
}: {
  books: TopBookEntry[];
  copy: StatsCopy;
  isZh: boolean;
  allFacts?: DailyReadingFact[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (books.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-muted-foreground/62">{copy.noTopBooks}</p>
    );
  }

  const canExpand = books.length > TOP_BOOKS_COLLAPSED;
  const visibleBooks = expanded ? books : books.slice(0, TOP_BOOKS_COLLAPSED);

  return (
    <div className="space-y-1.5">
      {visibleBooks.map((book, index) => (
        <TopBookItem
          key={book.bookId}
          book={book}
          index={index}
          isFirst={index === 0}
          copy={copy}
          isZh={isZh}
          allFacts={allFacts}
        />
      ))}

      {/* Expand / Collapse toggle */}
      {canExpand && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 rounded-lg py-2 text-[12px] font-medium text-muted-foreground/65 transition-colors hover:bg-muted/[0.1] hover:text-foreground/80"
        >
          {expanded ? (
            <>
              {copy.topBooksCollapse}
              <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              {copy.topBooksExpandCount(books.length)}
              <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

function TopBookItem({
  book,
  index,
  isFirst,
  copy,
  isZh,
  allFacts,
}: {
  book: TopBookEntry;
  index: number;
  isFirst: boolean;
  copy: StatsCopy;
  isZh: boolean;
  allFacts?: DailyReadingFact[];
}) {
  const { t } = useTranslation();
  const eta =
    allFacts && book.progress !== undefined && book.progress < 1
      ? computeBookETA(book.bookId, book.progress, book.totalPages, allFacts)
      : null;
  const readingAmountLabel =
    (book.charactersRead ?? 0) > 0 ? formatCharacterCount(book.charactersRead ?? 0, isZh) : null;
  const readingSpeedLabel =
    (book.avgCharactersPerMinute ?? 0) > 0
      ? formatCharactersPerMinute(book.avgCharactersPerMinute ?? 0, isZh)
      : null;

  return (
    <article
      className={cn(
        "group flex min-w-0 items-start gap-3.5 rounded-xl px-3 py-3 transition-colors",
        isFirst
          ? "bg-primary/[0.03] ring-1 ring-inset ring-primary/[0.06]"
          : "hover:bg-muted/[0.12]",
      )}
    >
      {/* Rank number */}
      <div
        className={cn(
          "mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums",
          isFirst ? "bg-primary/8 text-primary/60" : "bg-muted/25 text-muted-foreground/50",
        )}
      >
        {index + 1}
      </div>

      {/* Book cover — matches library style */}
      <div
        className={cn(
          "book-cover-shadow relative flex-shrink-0 overflow-hidden rounded",
          isFirst ? "w-16" : "w-11",
        )}
      >
        <div className="aspect-[28/41] w-full">
          <BookCover title={book.title} coverUrl={book.coverUrl} />
        </div>
        <div className="book-spine absolute inset-0 rounded" />
      </div>

      {/* Info — left-aligned */}
      <div className="min-w-0 flex-1 pt-0.5">
        {isFirst && (
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/40">
            {copy.topBookLead}
          </div>
        )}
        <div
          className={cn(
            "truncate font-semibold text-foreground/80 transition-colors group-hover:text-foreground",
            isFirst ? "text-[14px]" : "text-[13px]",
          )}
        >
          {book.title}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground/58">
          {book.author || copy.unknownAuthor}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span
            className={cn(
              "font-bold tabular-nums text-foreground/75",
              isFirst ? "text-lg" : "text-[14px]",
            )}
          >
            {formatCompactMinutes(book.totalTime, isZh)}
          </span>
          <span className="text-[10px] text-muted-foreground/52">
            {readingAmountLabel && <>{readingAmountLabel} · </>}
            {readingSpeedLabel && <>{readingSpeedLabel} · </>}
            {book.sessionsCount.toLocaleString()} {copy.sessionsSuffix}
          </span>
        </div>
        {eta && (
          <div className="mt-1 text-[11px] font-medium text-primary/70">
            {t("stats.desktop.etaFinishDays", { days: eta.etaDays })}
          </div>
        )}
      </div>
    </article>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  BookCover — library-style cover with spine overlay
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function BookCover({ title, coverUrl }: { title: string; coverUrl?: string }) {
  const resolved = useResolvedSrc(coverUrl);

  return resolved ? (
    <img
      src={resolved}
      alt=""
      className="absolute inset-0 h-full w-full rounded object-cover"
      loading="lazy"
    />
  ) : (
    <div className="absolute inset-0 flex items-center justify-center rounded bg-gradient-to-b from-stone-100 to-stone-200 px-1">
      <span className="line-clamp-2 text-center font-serif text-[10px] font-medium leading-tight text-stone-400">
        {title.trim().slice(0, 6)}
      </span>
    </div>
  );
}
