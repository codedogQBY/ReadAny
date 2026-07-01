import { ExportDropdown } from "@/components/notes/ExportDropdown";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useLibraryStore } from "@/stores/library-store";
import { useNotebookStore } from "@/stores/notebook-store";
import { type ExportFormat, annotationExporter } from "@readany/core/export";
import { createSelectionNoteMutation } from "@readany/core/reader";
import type { Highlight, Note } from "@readany/core/types";
import { HIGHLIGHT_COLOR_HEX } from "@readany/core/types";
import { cn } from "@readany/core/utils";
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  Highlighter,
  NotebookPen,
  Save,
  Trash2,
  X,
} from "lucide-react";
/**
 * NotebookPanel — left sidebar for viewing and editing notes/highlights
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface NotebookPanelProps {
  bookId: string;
  onClose: () => void;
  onGoToCfi?: (cfi: string) => void;
  onAddAnnotation?: (cfi: string, color: string, note?: string) => void;
  onDeleteAnnotation?: (cfi: string) => void;
}

export function NotebookPanel({
  bookId,
  onClose,
  onGoToCfi,
  onAddAnnotation,
  onDeleteAnnotation,
}: NotebookPanelProps) {
  const { t } = useTranslation();

  const { pendingNote, editingHighlight, clearPending, saveDraft, getDraft, clearDraft } =
    useNotebookStore();

  const { highlights, addHighlight, updateHighlight, removeHighlight } = useAnnotationStore();

  const books = useLibraryStore((s) => s.books);

  // Local state for note content being edited
  const [noteContent, setNoteContent] = useState("");
  const [expandedSections, setExpandedSections] = useState({
    highlights: true,
    notes: true,
  });

  // Filter annotations for current book
  const bookHighlights = highlights.filter((h) => h.bookId === bookId);

  // Highlights with notes vs without
  const highlightsWithNotes = bookHighlights.filter((h) => h.note);
  const highlightsWithoutNotes = bookHighlights.filter((h) => !h.note);

  // Initialize note content when editing starts
  useEffect(() => {
    if (pendingNote) {
      // Check for saved draft
      const draft = getDraft(pendingNote.text);
      setNoteContent(draft || pendingNote.existingNote || "");
    } else if (editingHighlight) {
      setNoteContent(editingHighlight.note || "");
    }
  }, [pendingNote, editingHighlight, getDraft]);

  // Auto-save draft on content change
  useEffect(() => {
    if (pendingNote && noteContent) {
      saveDraft(pendingNote.text, noteContent);
    }
  }, [noteContent, pendingNote, saveDraft]);

  const handleSave = () => {
    if (pendingNote) {
      const mutation = createSelectionNoteMutation({
        bookId,
        cfi: pendingNote.cfi,
        text: pendingNote.text,
        note: noteContent,
        chapterTitle: pendingNote.chapterTitle,
        defaultColor: "yellow",
      });
      if (mutation.kind === "create") {
        addHighlight(mutation.highlight);
        onAddAnnotation?.(pendingNote.cfi, mutation.highlight.color, mutation.highlight.note);
      }
      // Clear draft
      clearDraft(pendingNote.text);
      clearPending();
    } else if (editingHighlight) {
      const mutation = createSelectionNoteMutation({
        bookId,
        cfi: editingHighlight.cfi,
        text: editingHighlight.text,
        note: noteContent,
        chapterTitle: editingHighlight.chapterTitle,
        existingHighlight: editingHighlight,
      });
      if (mutation.kind === "update") {
        updateHighlight(mutation.id, mutation.updates);
        onAddAnnotation?.(editingHighlight.cfi, editingHighlight.color, mutation.updates.note);
      }
      clearPending();
    }
    setNoteContent("");
  };

  const handleCancel = () => {
    clearPending();
    setNoteContent("");
  };

  const handleDeleteNote = () => {
    if (editingHighlight) {
      updateHighlight(editingHighlight.id, { note: undefined });
      onAddAnnotation?.(editingHighlight.cfi, editingHighlight.color, undefined);
      clearPending();
      setNoteContent("");
    }
  };

  const handleHighlightClick = (highlight: Highlight) => {
    // Navigate to the highlight location
    if (onGoToCfi && highlight.cfi) {
      onGoToCfi(highlight.cfi);
    }
  };

  const handleEditHighlightNote = (highlight: Highlight) => {
    useNotebookStore.getState().startEditNote(highlight);
  };

  const handleDeleteNoteOnly = (highlight: Highlight) => {
    updateHighlight(highlight.id, { note: undefined });
    onAddAnnotation?.(highlight.cfi, highlight.color, undefined);
    // Clear editing state if we're editing this highlight
    if (editingHighlight?.id === highlight.id) {
      clearPending();
      setNoteContent("");
    }
  };

  const handleDeleteHighlight = (highlight: Highlight) => {
    // Remove from store
    removeHighlight(highlight.id);
    // Remove from view
    if (highlight.cfi) {
      onDeleteAnnotation?.(highlight.cfi);
    }
    // Clear editing state if we're editing this highlight
    if (editingHighlight?.id === highlight.id) {
      clearPending();
      setNoteContent("");
    }
  };

  const toggleSection = (section: "highlights" | "notes") => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleExport = (format: ExportFormat) => {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    const content = annotationExporter.export(bookHighlights as Highlight[], [] as Note[], book, {
      format,
    });
    if (format === "notion") {
      annotationExporter.copyToClipboard(content);
    } else {
      const ext = format === "json" ? "json" : "md";
      annotationExporter.downloadAsFile(content, `${book.meta.title}-${format}.${ext}`, format);
    }
  };

  // Check if we're in editing mode
  const isEditing = pendingNote || editingHighlight;
  const editingText = pendingNote?.text || editingHighlight?.text || "";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/40 px-3">
        <span className="text-xs font-medium text-foreground">{t("notebook.title")}</span>
        <div className="flex items-center gap-1">
          <ExportDropdown onExport={handleExport} disabled={bookHighlights.length === 0} />
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Note Editor - shown when creating/editing */}
        {isEditing && (
          <div className="border-b border-border/40 p-3">
            {/* Selected text preview */}
            <div className="mb-3 rounded-md bg-muted/50 p-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Highlighter className="h-3 w-3" />
                <span>{t("notebook.selectedText")}</span>
              </div>
              <p className="text-sm text-foreground line-clamp-3">"{editingText}"</p>
              {(pendingNote?.chapterTitle || editingHighlight?.chapterTitle) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {pendingNote?.chapterTitle || editingHighlight?.chapterTitle}
                </p>
              )}
            </div>

            {/* Note input */}
            <MarkdownEditor
              tier="inline_note"
              value={noteContent}
              onChange={setNoteContent}
              placeholder={t("notebook.addNote")}
              className="min-h-[120px]"
              autoFocus
            />

            {/* Actions */}
            <div className="mt-3 flex items-center justify-between">
              <div>
                {editingHighlight?.note && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={handleDeleteNote}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {t("notebook.deleteNote")}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  {t("common.cancel")}
                </Button>
                <Button size="sm" onClick={handleSave}>
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {t("common.save")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Highlights with Notes section */}
        {highlightsWithNotes.length > 0 && (
          <div className="border-b border-border/40">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
              onClick={() => toggleSection("notes")}
            >
              {expandedSections.notes ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <NotebookPen className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t("notebook.notesSection")}</span>
              <span className="text-xs text-muted-foreground">({highlightsWithNotes.length})</span>
            </button>
            {expandedSections.notes && (
              <div className="px-3 pb-2">
                {highlightsWithNotes.map((highlight) => (
                  <HighlightNoteItem
                    key={highlight.id}
                    highlight={highlight}
                    onClick={() => handleHighlightClick(highlight)}
                    onEdit={() => handleEditHighlightNote(highlight)}
                    onDeleteNote={() => handleDeleteNoteOnly(highlight)}
                    isActive={editingHighlight?.id === highlight.id}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Highlights without Notes section */}
        {highlightsWithoutNotes.length > 0 && (
          <div className="border-b border-border/40">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
              onClick={() => toggleSection("highlights")}
            >
              {expandedSections.highlights ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <Highlighter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t("notebook.highlightsSection")}</span>
              <span className="text-xs text-muted-foreground">
                ({highlightsWithoutNotes.length})
              </span>
            </button>
            {expandedSections.highlights && (
              <div className="px-3 pb-2">
                {highlightsWithoutNotes.map((highlight) => (
                  <HighlightItem
                    key={highlight.id}
                    highlight={highlight}
                    onClick={() => handleHighlightClick(highlight)}
                    onAddNote={() => handleEditHighlightNote(highlight)}
                    onDelete={() => handleDeleteHighlight(highlight)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {bookHighlights.length === 0 && !isEditing && (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <img src="/note.svg" alt="" className="mb-4 h-32 w-32" />
            <p className="text-sm text-muted-foreground">{t("notebook.empty")}</p>
            <p className="mt-1 text-xs text-muted-foreground/70">{t("notebook.emptyHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Sub-component: Highlight with note
interface HighlightNoteItemProps {
  highlight: Highlight;
  onClick: () => void;
  onEdit: () => void;
  onDeleteNote: () => void;
  isActive?: boolean;
}

function HighlightNoteItem({
  highlight,
  onClick,
  onEdit,
  onDeleteNote,
  isActive,
}: HighlightNoteItemProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "group mt-2 rounded-md border border-border/40 p-2 transition-colors cursor-pointer",
        isActive ? "bg-muted" : "hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-2 border-0 bg-transparent p-0 text-left"
        onClick={onClick}
      >
        <div
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: HIGHLIGHT_COLOR_HEX[highlight.color] }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground line-clamp-2">"{highlight.text}"</p>
          {highlight.note && (
            <div className="mt-1.5 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5 prose prose-xs dark:prose-invert max-w-none break-words overflow-hidden [overflow-wrap:anywhere]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{highlight.note}</ReactMarkdown>
            </div>
          )}
          {highlight.chapterTitle && (
            <p className="mt-1 text-xs text-muted-foreground/70">{highlight.chapterTitle}</p>
          )}
        </div>
      </button>
      <div className="mt-2 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          className="p-1 text-muted-foreground hover:text-primary rounded hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title={t("notebook.editNote")}
        >
          <Edit3 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="p-1 text-muted-foreground hover:text-destructive rounded hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteNote();
          }}
          title={t("notebook.deleteNote")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// Sub-component: Highlight without note
interface HighlightItemProps {
  highlight: Highlight;
  onClick: () => void;
  onAddNote: () => void;
  onDelete: () => void;
}

function HighlightItem({ highlight, onClick, onAddNote, onDelete }: HighlightItemProps) {
  const { t } = useTranslation();
  return (
    <div className="group mt-2 flex items-start gap-2 rounded-md p-2 transition-colors hover:bg-muted/50">
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 border-0 bg-transparent p-0 text-left"
        onClick={onClick}
      >
        <div
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: HIGHLIGHT_COLOR_HEX[highlight.color] }}
        />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm text-foreground">"{highlight.text}"</p>
          {highlight.chapterTitle && (
            <p className="mt-1 text-xs text-muted-foreground/70">{highlight.chapterTitle}</p>
          )}
        </div>
      </button>
      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          className="p-1 text-muted-foreground hover:text-primary rounded hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            onAddNote();
          }}
          title={t("notebook.addNoteBtn")}
        >
          <NotebookPen className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="p-1 text-muted-foreground hover:text-destructive rounded hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title={t("notebook.deleteHighlightBtn")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
