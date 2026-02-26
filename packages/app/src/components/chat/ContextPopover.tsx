/**
 * ContextPopover — book context selector
 */
import { useChatReaderStore } from "@/stores/chat-reader-store";
import { useLibraryStore } from "@/stores/library-store";
import { BookOpen, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function ContextPopover() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const books = useLibraryStore((s) => s.books);
  const { selectedBooks, addSelectedBook, removeSelectedBook } = useChatReaderStore();
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={popoverRef}>
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:bg-muted">
        <BookOpen className="size-3.5" />
        <span>{selectedBooks.length > 0 ? t("chat.booksCount", { count: selectedBooks.length }) : t("chat.context")}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border bg-background p-1.5 shadow-lg">
          <p className="mb-1 px-2 py-1 text-xs font-medium text-muted-foreground">{t("chat.selectBooksForContext")}</p>
          <div className="max-h-60 overflow-y-auto">
            {books.map((book) => {
              const isSelected = selectedBooks.includes(book.id);
              return (
                <button key={book.id} type="button" onClick={() => isSelected ? removeSelectedBook(book.id) : addSelectedBook(book.id)} className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted">
                  <div className={`flex size-4 shrink-0 items-center justify-center rounded border ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-neutral-300"}`}>
                    {isSelected && <Check className="size-3" />}
                  </div>
                  <span className="truncate text-neutral-700">{book.meta.title}</span>
                </button>
              );
            })}
          </div>
          {books.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("chat.noBooksInLibrary")}</p>}
        </div>
      )}
    </div>
  );
}
