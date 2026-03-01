/**
 * NotesPage — Notebook-style knowledge management center
 * Layout: Left panel (book notebooks grid) + Right panel (selected book's notes & highlights)
 * Notes and highlights are displayed separately.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  StickyNote,
  Highlighter,
  BookOpen,
  Trash2,
  Search,
  Edit3,
  Check,
  X,
  MessageSquareText,
  ChevronLeft,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useLibraryStore } from "@/stores/library-store";
import { useAppStore } from "@/stores/app-store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { ExportDropdown } from "./ExportDropdown";
import { annotationExporter, type ExportFormat } from "@/lib/export/annotation-exporter";
import type { HighlightWithBook } from "@/lib/db/database";
import type { Highlight, Note } from "@/types";
import { HIGHLIGHT_COLOR_HEX } from "@/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type DetailTab = "notes" | "highlights";

export function NotesPage() {
  const { t } = useTranslation();
  const {
    highlightsWithBooks,
    loadAllHighlightsWithBooks,
    removeHighlight,
    updateHighlight,
    stats,
    loadStats,
  } = useAnnotationStore();
  const { addTab, setActiveTab, activeTabId } = useAppStore();
  const books = useLibraryStore((s) => s.books);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [detailTab, setDetailTab] = useState<DetailTab>("notes");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");

  useEffect(() => {
    if (activeTabId !== "notes") return;
    setIsLoading(true);
    Promise.all([
      loadAllHighlightsWithBooks(500),
      loadStats(),
    ]).finally(() => setIsLoading(false));
  }, [loadAllHighlightsWithBooks, loadStats, activeTabId]);

  // Group highlights by book
  const bookNotebooks = useMemo(() => {
    const grouped = new Map<string, {
      bookId: string;
      title: string;
      author: string;
      coverUrl: string | null;
      highlights: HighlightWithBook[];
      notesCount: number;
      highlightsOnlyCount: number;
      latestAt: number;
    }>();

    for (const h of highlightsWithBooks) {
      const existing = grouped.get(h.bookId);
      if (existing) {
        existing.highlights.push(h);
        if (h.note) existing.notesCount++;
        else existing.highlightsOnlyCount++;
        if (h.createdAt > existing.latestAt) existing.latestAt = h.createdAt;
      } else {
        grouped.set(h.bookId, {
          bookId: h.bookId,
          title: h.bookTitle || t("notes.unknownBook"),
          author: h.bookAuthor || t("notes.unknownAuthor"),
          coverUrl: h.bookCoverUrl || null,
          highlights: [h],
          notesCount: h.note ? 1 : 0,
          highlightsOnlyCount: h.note ? 0 : 1,
          latestAt: h.createdAt,
        });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.latestAt - a.latestAt);
  }, [highlightsWithBooks, t]);

  const selectedBook = useMemo(() => {
    if (!selectedBookId) return null;
    return bookNotebooks.find(b => b.bookId === selectedBookId) || null;
  }, [selectedBookId, bookNotebooks]);

  // Split into notes (has note text) and highlights-only
  const { notes, highlightsOnly } = useMemo(() => {
    if (!selectedBook) return { notes: [], highlightsOnly: [] };
    let all = selectedBook.highlights;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      all = all.filter(
        h => h.text.toLowerCase().includes(q) ||
          h.note?.toLowerCase().includes(q) ||
          h.chapterTitle?.toLowerCase().includes(q)
      );
    }
    const sorted = all.sort((a, b) => b.createdAt - a.createdAt);
    return {
      notes: sorted.filter(h => h.note),
      highlightsOnly: sorted.filter(h => !h.note),
    };
  }, [selectedBook, searchQuery]);

  const currentList = detailTab === "notes" ? notes : highlightsOnly;

  // Group by chapter
  const itemsByChapter = useMemo(() => {
    const chapters = new Map<string, HighlightWithBook[]>();
    for (const h of currentList) {
      const chapter = h.chapterTitle || t("notes.unknownChapter");
      const arr = chapters.get(chapter) || [];
      arr.push(h);
      chapters.set(chapter, arr);
    }
    return chapters;
  }, [currentList, t]);

  const handleOpenBook = (bookId: string, title: string, cfi?: string) => {
    const tabId = `reader-${bookId}`;
    addTab({ id: tabId, type: "reader", title, bookId, initialCfi: cfi });
    setActiveTab(tabId);
  };

  // Delete only the note text, keep the highlight
  const handleDeleteNote = (highlight: HighlightWithBook) => {
    updateHighlight(highlight.id, { note: undefined });
    loadStats();
  };

  // Delete the entire highlight record
  const handleDeleteHighlight = (highlight: HighlightWithBook) => {
    removeHighlight(highlight.id);
    loadStats();
  };

  const startEditNote = (highlight: HighlightWithBook) => {
    setEditingId(highlight.id);
    setEditNote(highlight.note || "");
  };

  const saveNote = (id: string) => {
    updateHighlight(id, { note: editNote || undefined });
    setEditingId(null);
    setEditNote("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditNote("");
  };

  const doExport = (format: ExportFormat, book: { id: string; meta: { title: string } }, highlights: Highlight[], exportNotes: Note[], content: string) => {
    if (format === "notion") {
      annotationExporter.copyToClipboard(content);
    } else {
      const ext = format === "json" ? "json" : "md";
      annotationExporter.downloadAsFile(content, `${book.meta.title}-${format}.${ext}`, format);
    }
  };

  const handleSingleBookExport = (format: ExportFormat) => {
    if (!selectedBook) return;
    const book = books.find((b) => b.id === selectedBook.bookId);
    if (!book) return;
    const content = annotationExporter.export(
      selectedBook.highlights as Highlight[],
      [] as Note[],
      book,
      { format },
    );
    doExport(format, book, selectedBook.highlights as Highlight[], [], content);
  };

  const handleMultiBookExport = (format: ExportFormat) => {
    const booksData = bookNotebooks
      .map((notebook) => {
        const book = books.find((b) => b.id === notebook.bookId);
        if (!book) return null;
        return { book, highlights: notebook.highlights as Highlight[], notes: [] as Note[] };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
    if (booksData.length === 0) return;
    const content = annotationExporter.exportMultipleBooks(booksData, { format });
    if (format === "notion") {
      annotationExporter.copyToClipboard(content);
    } else {
      const ext = format === "json" ? "json" : "md";
      annotationExporter.downloadAsFile(content, `all-annotations.${ext}`, format);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (bookNotebooks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <StickyNote className="mb-3 h-12 w-12 text-muted-foreground/50" />
        <p className="text-sm font-medium text-muted-foreground">{t("notes.empty")}</p>
        <p className="mt-1 text-xs text-muted-foreground/70">{t("notes.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left Panel — Notebooks */}
      <div className={cn(
        "shrink-0 border-r border-border/40 flex flex-col",
        selectedBookId ? "w-[260px]" : "w-full"
      )}>
        {/* Left header */}
        <div className="shrink-0 border-b border-border/40 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold">{t("notes.title")}</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("notes.stats", {
                  highlights: stats?.totalHighlights || 0,
                  notes: stats?.highlightsWithNotes || 0,
                  books: stats?.totalBooks || 0,
                })}
              </p>
            </div>
            {!selectedBookId && (
              <ExportDropdown onExport={handleMultiBookExport} />
            )}
          </div>
        </div>

        {/* Notebook list */}
        <div className="flex-1 overflow-y-auto p-3">
          {selectedBookId ? (
            <div className="space-y-1">
              {bookNotebooks.map((book) => (
                <button
                  key={book.bookId}
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    book.bookId === selectedBookId
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted/60 text-foreground"
                  )}
                  onClick={() => {
                    setSelectedBookId(book.bookId);
                    setSearchQuery("");
                    setEditingId(null);
                  }}
                >
                  {book.coverUrl ? (
                    <img src={book.coverUrl} alt="" className="h-9 w-6 shrink-0 rounded object-cover" />
                  ) : (
                    <div className="flex h-9 w-6 shrink-0 items-center justify-center rounded bg-muted">
                      <BookOpen className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{book.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {book.highlights.length} {t("notes.highlightsCount")}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            /* Grid view — BookCard-inspired style */
            <div className="grid grid-cols-3 gap-x-5 gap-y-6 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {bookNotebooks.map((book) => (
                <NotebookCard
                  key={book.bookId}
                  book={book}
                  onClick={() => {
                    setSelectedBookId(book.bookId);
                    setSearchQuery("");
                    setEditingId(null);
                    setDetailTab("notes");
                  }}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel — Book Notes / Highlights Detail */}
      {selectedBookId && selectedBook && (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Right header */}
          <div className="shrink-0 border-b border-border/40 px-5 py-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-md p-1 hover:bg-muted transition-colors"
                onClick={() => setSelectedBookId(null)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              {selectedBook.coverUrl ? (
                <img src={selectedBook.coverUrl} alt="" className="h-10 w-7 shrink-0 rounded object-cover shadow-sm" />
              ) : (
                <div className="flex h-10 w-7 shrink-0 items-center justify-center rounded bg-muted">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold truncate">{selectedBook.title}</h2>
                <p className="text-xs text-muted-foreground">{selectedBook.author}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenBook(selectedBook.bookId, selectedBook.title)}
                  className="gap-1.5 h-7 text-xs"
                >
                  <BookOpen className="h-3 w-3" />
                  {t("notes.openBook")}
                </Button>
                <ExportDropdown onExport={handleSingleBookExport} variant="outline" size="sm" />
              </div>
            </div>

            {/* Tab switcher + search */}
            <div className="mt-3 flex items-center gap-3">
              <div className="flex rounded-lg border border-border/60 p-0.5">
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    detailTab === "notes"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setDetailTab("notes")}
                >
                  <MessageSquareText className="h-3 w-3" />
                  {t("notebook.notesSection")} ({selectedBook.notesCount})
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    detailTab === "highlights"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setDetailTab("highlights")}
                >
                  <Highlighter className="h-3 w-3" />
                  {t("notebook.highlightsSection")} ({selectedBook.highlightsOnlyCount})
                </button>
              </div>

              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t("notes.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-8 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {currentList.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <FileText className="mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? t("notes.noSearchResults") : (detailTab === "notes" ? t("notes.noNotes") : t("highlights.noHighlights"))}
                </p>
              </div>
            ) : (
              <div className="p-5 space-y-6">
                {Array.from(itemsByChapter.entries()).map(([chapter, items]) => (
                  <div key={chapter}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-px flex-1 bg-border/50" />
                      <span className="shrink-0 text-xs font-medium text-muted-foreground px-2">{chapter}</span>
                      <div className="h-px flex-1 bg-border/50" />
                    </div>

                    <div className="space-y-3">
                      {items.map((item) => (
                        detailTab === "notes" ? (
                          <NoteDetailCard
                            key={item.id}
                            highlight={item}
                            isEditing={editingId === item.id}
                            editNote={editNote}
                            setEditNote={setEditNote}
                            onStartEdit={() => startEditNote(item)}
                            onSaveNote={() => saveNote(item.id)}
                            onCancelEdit={cancelEdit}
                            onDeleteNote={() => handleDeleteNote(item)}
                            onNavigate={() => handleOpenBook(selectedBook.bookId, selectedBook.title, item.cfi)}
                            t={t}
                          />
                        ) : (
                          <HighlightDetailCard
                            key={item.id}
                            highlight={item}
                            onDelete={() => handleDeleteHighlight(item)}
                            onNavigate={() => handleOpenBook(selectedBook.bookId, selectedBook.title, item.cfi)}
                            t={t}
                          />
                        )
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Notebook card (BookCard-inspired style) ---

interface NotebookCardProps {
  book: {
    bookId: string;
    title: string;
    author: string;
    coverUrl: string | null;
    highlights: HighlightWithBook[];
    notesCount: number;
    highlightsOnlyCount: number;
  };
  onClick: () => void;
  t: (key: string) => string;
}

function NotebookCard({ book, onClick, t }: NotebookCardProps) {
  return (
    <div
      className="group flex h-full cursor-pointer flex-col justify-end"
      onClick={onClick}
    >
      {/* Cover — same aspect ratio and shadow as BookCard */}
      <div className="book-cover-shadow relative flex aspect-[28/41] w-full items-end justify-center overflow-hidden rounded transition-all duration-200">
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt=""
            className="absolute inset-0 h-full w-full rounded object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center rounded bg-gradient-to-b from-stone-100 to-stone-200 p-3">
            <div className="flex flex-1 items-center justify-center">
              <span className="line-clamp-3 text-center font-serif text-base font-medium leading-snug text-stone-500">
                {book.title}
              </span>
            </div>
            <div className="h-px w-8 bg-stone-300/60" />
            {book.author && (
              <div className="flex h-1/4 items-center justify-center">
                <span className="line-clamp-1 text-center font-serif text-xs text-stone-400">
                  {book.author}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Spine overlay */}
        {book.coverUrl && <div className="book-spine absolute inset-0 rounded" />}

        {/* Count badge — top right, shows total highlights + notes */}
        <div className="absolute right-1 top-1 z-10 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
          <Highlighter className="h-2.5 w-2.5 text-white/80" />
          <span className="text-[9px] font-medium text-white">{book.highlightsOnlyCount}</span>
          {book.notesCount > 0 && (
            <>
              <MessageSquareText className="ml-0.5 h-2.5 w-2.5 text-white/80" />
              <span className="text-[9px] font-medium text-white">{book.notesCount}</span>
            </>
          )}
        </div>
      </div>

      {/* Info area — only book title, no counts */}
      <div className="flex w-full flex-col pt-2">
        <h4 className="truncate text-xs font-semibold leading-tight text-foreground">
          {book.title}
        </h4>
      </div>
    </div>
  );
}

// --- Note detail card (for "Notes" tab) ---

interface NoteDetailCardProps {
  highlight: HighlightWithBook;
  isEditing: boolean;
  editNote: string;
  setEditNote: (note: string) => void;
  onStartEdit: () => void;
  onSaveNote: () => void;
  onCancelEdit: () => void;
  onDeleteNote: () => void;
  onNavigate: () => void;
  t: (key: string) => string;
}

function NoteDetailCard({
  highlight,
  isEditing,
  editNote,
  setEditNote,
  onStartEdit,
  onSaveNote,
  onCancelEdit,
  onDeleteNote,
  onNavigate,
  t,
}: NoteDetailCardProps) {
  return (
    <div className="group rounded-lg border border-border/40 bg-card transition-colors hover:border-border/70">
      <div className="p-3">
        {/* Quoted highlight text */}
        <p
          className="text-xs text-muted-foreground/80 leading-relaxed cursor-pointer hover:text-primary transition-colors line-clamp-2"
          onClick={onNavigate}
        >
          "{highlight.text}"
        </p>

        {/* Note content */}
        {isEditing ? (
          <div className="mt-2 flex items-start gap-2">
            <MarkdownEditor
              value={editNote}
              onChange={setEditNote}
              placeholder={t("notebook.addNote")}
              className="flex-1"
              autoFocus
            />
            <div className="flex flex-col gap-1">
              <button type="button" className="rounded p-1.5 text-primary hover:bg-primary/10" onClick={onSaveNote}>
                <Check className="h-4 w-4" />
              </button>
              <button type="button" className="rounded p-1.5 text-muted-foreground hover:bg-muted" onClick={onCancelEdit}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div
            className="mt-2 cursor-pointer"
            onClick={onStartEdit}
          >
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {highlight.note || ""}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/60">
            {new Date(highlight.createdAt).toLocaleDateString()}
          </span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:text-primary hover:bg-primary/10"
              onClick={onStartEdit}
              title={t("notebook.editNote")}
            >
              <Edit3 className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => { e.stopPropagation(); onDeleteNote(); }}
              title={t("notebook.deleteNote")}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Highlight detail card (for "Highlights" tab) ---

interface HighlightDetailCardProps {
  highlight: HighlightWithBook;
  onDelete: () => void;
  onNavigate: () => void;
  t: (key: string) => string;
}

function HighlightDetailCard({ highlight, onDelete, onNavigate, t }: HighlightDetailCardProps) {
  const hexColor = HIGHLIGHT_COLOR_HEX[highlight.color as keyof typeof HIGHLIGHT_COLOR_HEX] || HIGHLIGHT_COLOR_HEX.yellow;

  return (
    <div className="group relative rounded-lg border border-border/40 bg-card transition-colors hover:border-border/70">
      {/* Color bar */}
      <div
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
        style={{ backgroundColor: hexColor }}
      />

      <div className="pl-4 pr-3 py-3">
        <p
          className="text-sm text-foreground/90 leading-relaxed cursor-pointer hover:text-primary transition-colors"
          onClick={onNavigate}
        >
          "{highlight.text}"
        </p>

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/60">
            {new Date(highlight.createdAt).toLocaleDateString()}
          </span>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title={t("notebook.deleteHighlight")}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
