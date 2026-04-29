/**
 * HomePage — library page
 */
import { DesktopImportActions } from "@/components/home/DesktopImportActions";
import { useLibraryStore } from "@/stores/library-store";
import { Loader2, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BookGrid } from "./BookGrid";
import { ImportDropZone } from "./ImportDropZone";

export function HomePage() {
  const { t } = useTranslation();
  const { books, filter, activeTag, isImporting } = useLibraryStore();

  const filtered = books.filter((b) => {
    // Tag filter
    if (activeTag === "__uncategorized__") {
      if (b.tags.length > 0) return false;
    } else if (activeTag && !b.tags.includes(activeTag)) {
      return false;
    }
    // Search filter
    if (filter.search) {
      const q = filter.search.toLowerCase();
      return b.meta.title.toLowerCase().includes(q) || b.meta.author?.toLowerCase().includes(q);
    }
    return true;
  });

  if (books.length === 0) {
    return <ImportDropZone />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-6 pt-5 pb-2">
        <h1 className="text-3xl font-bold text-foreground">
          {activeTag === "__uncategorized__"
            ? t("sidebar.uncategorized")
            : activeTag || t("home.library")}
        </h1>
        <DesktopImportActions align="end">
          <button
            id="tour-add-book"
            type="button"
            disabled={isImporting}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {isImporting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {isImporting ? t("library.importing", "导入中...") : t("home.addBook")}
          </button>
        </DesktopImportActions>
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
      <div id="tour-book-list" className="flex-1 overflow-y-auto px-6 pb-4">
        <BookGrid books={filtered} />
      </div>
    </div>
  );
}
