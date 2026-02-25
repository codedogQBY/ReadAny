/**
 * Annotation store — highlights, notes, bookmarks management
 */
import { create } from "zustand";
import type { Highlight, Note, Bookmark, HighlightColor } from "@/types";

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
  addHighlight: (highlight) =>
    set((state) => ({ highlights: [...state.highlights, highlight] })),
  updateHighlight: (id, updates) =>
    set((state) => ({
      highlights: state.highlights.map((h) =>
        h.id === id ? { ...h, ...updates } : h,
      ),
    })),
  removeHighlight: (id) =>
    set((state) => ({
      highlights: state.highlights.filter((h) => h.id !== id),
    })),
  changeHighlightColor: (id, color) =>
    set((state) => ({
      highlights: state.highlights.map((h) =>
        h.id === id ? { ...h, color, updatedAt: Date.now() } : h,
      ),
    })),

  setNotes: (notes) => set({ notes }),
  addNote: (note) => set((state) => ({ notes: [...state.notes, note] })),
  updateNote: (id, updates) =>
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n,
      ),
    })),
  removeNote: (id) =>
    set((state) => ({ notes: state.notes.filter((n) => n.id !== id) })),

  setBookmarks: (bookmarks) => set({ bookmarks }),
  addBookmark: (bookmark) =>
    set((state) => ({ bookmarks: [...state.bookmarks, bookmark] })),
  removeBookmark: (id) =>
    set((state) => ({
      bookmarks: state.bookmarks.filter((b) => b.id !== id),
    })),

  loadAnnotations: async (_bookId) => {
    // TODO: Load highlights, notes, bookmarks from database
  },
}));
