/**
 * NoteList — list of notes for the current book
 */
import { useAnnotationStore } from "@/stores/annotation-store";
import { FileText } from "lucide-react";

export function NoteList() {
  const notes = useAnnotationStore((s) => s.notes);

  if (notes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center text-sm text-muted-foreground">
        <FileText className="mb-2 h-8 w-8" />
        <p>No notes yet</p>
        <p className="text-xs">Select text and create a note</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 overflow-y-auto p-2">
      {notes.map((note) => (
        <div
          key={note.id}
          className="cursor-pointer rounded-md p-2.5 transition-colors hover:bg-muted"
        >
          <h4 className="text-sm font-medium">{note.title}</h4>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {note.content}
          </p>
          {note.chapterTitle && (
            <p className="mt-1 text-xs text-muted-foreground/70">
              {note.chapterTitle}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
