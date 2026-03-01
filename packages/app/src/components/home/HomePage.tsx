/**
 * HomePage — library page
 */
import { useLibraryStore } from "@/stores/library-store";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { BookGrid } from "./BookGrid";
import { ImportDropZone } from "./ImportDropZone";

export function HomePage() {
  const { t } = useTranslation();
  const { books, filter, importBooks } = useLibraryStore();

  const filtered = filter.search
    ? books.filter(
        (b) =>
          b.meta.title.toLowerCase().includes(filter.search.toLowerCase()) ||
          b.meta.author?.toLowerCase().includes(filter.search.toLowerCase()),
      )
    : books;

  const handleImportClick = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Books", extensions: ["epub", "pdf", "mobi", "azw", "azw3", "fb2", "fbz"] }],
      } as const);
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        if (paths.length > 0) {
          await importBooks(paths);
        }
      }
    } catch {
      // User cancelled
    }
  }, [importBooks]);

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
          onClick={handleImportClick}
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
        <BookGrid books={filtered} />
      </div>
    </div>
  );
}
