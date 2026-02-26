/**
 * HomePage — sageread-style library page
 */
import { useLibraryStore } from "@/stores/library-store";
import { Grid, List, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookGrid } from "./BookGrid";
import { BookList } from "./BookList";
import { ImportDropZone } from "./ImportDropZone";

export function HomePage() {
  const { t } = useTranslation();
  const { books, filter } = useLibraryStore();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const filtered = filter.search
    ? books.filter(
        (b) =>
          b.meta.title.toLowerCase().includes(filter.search.toLowerCase()) ||
          b.meta.author?.toLowerCase().includes(filter.search.toLowerCase()),
      )
    : books;

  if (books.length === 0) {
    return <ImportDropZone />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-6 pt-5 pb-2">
        <h1 className="text-3xl font-bold text-neutral-900">{t("home.library")}</h1>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" />
          {t("home.addBook")}
        </button>
      </div>

      {/* Search result hint */}
      {filter.search && (
        <div className="px-6 pb-2">
          {filtered.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("home.foundBooks", { count: filtered.length, query: filter.search })}
            </p>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {t("home.noBooksFound", { query: filter.search })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t("home.tryDifferentSearch")}</p>
            </div>
          )}
        </div>
      )}

      {/* Book display */}
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {viewMode === "grid" ? <BookGrid books={filtered} /> : <BookList books={filtered} />}
      </div>

      {/* Floating status bar */}
      <div className="absolute right-4 bottom-4 flex items-center gap-2 rounded-full border bg-background/90 px-3 py-1.5 shadow-sm backdrop-blur">
        <span className="text-xs text-muted-foreground">
          {t("common.total")}: {filtered.length}
        </span>
        <div className="h-3 w-px bg-border" />
        <button
          type="button"
          className={`rounded p-0.5 ${viewMode === "grid" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
          onClick={() => setViewMode("grid")}
        >
          <Grid className="size-3.5" />
        </button>
        <button
          type="button"
          className={`rounded p-0.5 ${viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
          onClick={() => setViewMode("list")}
        >
          <List className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
