import { Button } from "@/components/ui/button";
import { useChatReaderStore } from "@/stores/chat-reader-store";
/**
 * ContextPopover — book context selector for standalone chat
 */
import { useLibraryStore } from "@/stores/library-store";
import { BookOpen } from "lucide-react";
import { useState } from "react";

export function ContextPopover() {
  const [open, setOpen] = useState(false);
  const books = useLibraryStore((s) => s.books);
  const { selectedBooks, addSelectedBook, removeSelectedBook } = useChatReaderStore();

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
        <BookOpen className="mr-1.5 h-3.5 w-3.5" />
        Context ({selectedBooks.length})
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-background p-2 shadow-lg">
          <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">
            Select books for context
          </p>
          {books.map((book) => (
            <label
              key={book.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selectedBooks.includes(book.id)}
                onChange={(e) =>
                  e.target.checked ? addSelectedBook(book.id) : removeSelectedBook(book.id)
                }
              />
              <span className="truncate">{book.meta.title}</span>
            </label>
          ))}
          {books.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No books in library
            </p>
          )}
        </div>
      )}
    </div>
  );
}
