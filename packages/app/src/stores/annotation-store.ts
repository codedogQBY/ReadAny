import type { Bookmark, Highlight, HighlightColor, Note } from "@/types";
import * as db from "@/lib/db/database";
/**
 * Annotation store — highlights, notes, bookmarks management
 * Connected to SQLite for persistence
 */
import { create } from "zustand";

export interface AnnotationState {
  highlights: Highlight[];
  notes: Note[];
  bookmarks: Bookmark[];

  // Actions
  setHighlights: (highlights: Highlight[]) => void;
  addHighlight: (highlight: Highlight) => void;
  updateHighlight: (id: string, updates: Partial<Highlight>) => void;
  removeHighlight: (id: string) => void;
  changeHighlightColor: (id: string, color: HighlightColor) => void;

  setNotes: (notes: Note[]) => void;
  addNote: (note: Note) => void;
  updateNote: (id: string, updates: Partial<Note>) => void;
  removeNote: (id: string) => void;

  setBookmarks: (bookmarks: Bookmark[]) => void;
  addBookmark: (bookmark: Bookmark) => void;
  removeBookmark: (id: string) => void;

  loadAnnotations: (bookId: string) => Promise<void>;
}

export const useAnnotationStore = create<AnnotationState>((set) => ({
  highlights: [],
  notes: [],
  bookmarks: [],

  setHighlights: (highlights) => set({ highlights }),
  addHighlight: (highlight) => {
    set((state) => ({ highlights: [...state.highlights, highlight] }));
    db.insertHighlight(highlight).catch((err) =>
      console.error("Failed to insert highlight:", err),
    );
  },
  updateHighlight: (id, updates) => {
    set((state) => ({
      highlights: state.highlights.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    }));
    db.updateHighlight(id, updates).catch((err) =>
      console.error("Failed to update highlight:", err),
    );
  },
  removeHighlight: (id) => {
    set((state) => ({
      highlights: state.highlights.filter((h) => h.id !== id),
    }));
    db.deleteHighlight(id).catch((err) =>
      console.error("Failed to delete highlight:", err),
    );
  },
  changeHighlightColor: (id, color) => {
    set((state) => ({
      highlights: state.highlights.map((h) =>
        h.id === id ? { ...h, color, updatedAt: Date.now() } : h,
      ),
    }));
    db.updateHighlight(id, { color }).catch((err) =>
      console.error("Failed to update highlight color:", err),
    );
  },

  setNotes: (notes) => set({ notes }),
  addNote: (note) => {
    set((state) => ({ notes: [...state.notes, note] }));
    db.insertNote(note).catch((err) =>
      console.error("Failed to insert note:", err),
    );
  },
  updateNote: (id, updates) => {
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n,
      ),
    }));
    db.updateNote(id, updates).catch((err) =>
      console.error("Failed to update note:", err),
    );
  },
  removeNote: (id) => {
    set((state) => ({ notes: state.notes.filter((n) => n.id !== id) }));
    db.deleteNote(id).catch((err) =>
      console.error("Failed to delete note:", err),
    );
  },

  setBookmarks: (bookmarks) => set({ bookmarks }),
  addBookmark: (bookmark) => {
    set((state) => ({ bookmarks: [...state.bookmarks, bookmark] }));
    db.insertBookmark(bookmark).catch((err) =>
      console.error("Failed to insert bookmark:", err),
    );
  },
  removeBookmark: (id) => {
    set((state) => ({
      bookmarks: state.bookmarks.filter((b) => b.id !== id),
    }));
    db.deleteBookmark(id).catch((err) =>
      console.error("Failed to delete bookmark:", err),
    );
  },

  loadAnnotations: async (bookId) => {
    try {
      const [highlights, notes, bookmarks] = await Promise.all([
        db.getHighlights(bookId),
        db.getNotes(bookId),
        db.getBookmarks(bookId),
      ]);
      set({ highlights, notes, bookmarks });
    } catch (err) {
      console.error("Failed to load annotations:", err);
    }
  },
}));
