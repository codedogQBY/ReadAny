import { Input } from "@/components/ui/input";
/**
 * HomePage — library/bookshelf view
 */
import { useLibraryStore } from "@/stores/library-store";
import { Grid, List, Search } from "lucide-react";
import { BookGrid } from "./BookGrid";
import { BookList } from "./BookList";
import { ImportDropZone } from "./ImportDropZone";

export function HomePage() {
  const { books, filter, viewMode, setFilter, setViewMode } = useLibraryStore();

  const filteredBooks = books.filter((book) => {
    if (filter.search) {
      const q = filter.search.toLowerCase();
      return (
        book.meta.title.toLowerCase().includes(q) || book.meta.author.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Library</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search books..."
              className="w-64 pl-9"
              value={filter.search}
              onChange={(e) => setFilter({ search: e.target.value })}
            />
          </div>
          <div className="flex rounded-md border border-border">
            <button
              className={`p-1.5 ${viewMode === "grid" ? "bg-muted" : ""}`}
              onClick={() => setViewMode("grid")}
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              className={`p-1.5 ${viewMode === "list" ? "bg-muted" : ""}`}
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {filteredBooks.length === 0 ? (
        <ImportDropZone />
      ) : viewMode === "grid" ? (
        <BookGrid books={filteredBooks} />
      ) : (
        <BookList books={filteredBooks} />
      )}
    </div>
  );
}
