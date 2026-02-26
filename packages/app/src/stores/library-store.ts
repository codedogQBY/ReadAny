import type { Book, LibraryFilter, SortField, SortOrder } from "@/types";
/**
 * Library store — book collection CRUD, import, filtering
 */
import { create } from "zustand";

export type LibraryViewMode = "grid" | "list";

export interface LibraryState {
  books: Book[];
  filter: LibraryFilter;
  viewMode: LibraryViewMode;
  isImporting: boolean;

  // Actions
  setBooks: (books: Book[]) => void;
  addBook: (book: Book) => void;
  removeBook: (bookId: string) => void;
  updateBook: (bookId: string, updates: Partial<Book>) => void;
  setFilter: (filter: Partial<LibraryFilter>) => void;
  setViewMode: (mode: LibraryViewMode) => void;
  setSortField: (field: SortField) => void;
  setSortOrder: (order: SortOrder) => void;
  importBooks: (filePaths: string[]) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  books: [],
  filter: {
    search: "",
    tags: [],
    sortField: "lastOpenedAt",
    sortOrder: "desc",
  },
  viewMode: "grid",
  isImporting: false,

  setBooks: (books) => set({ books }),

  addBook: (book) => set((state) => ({ books: [...state.books, book] })),

  removeBook: (bookId) => set((state) => ({ books: state.books.filter((b) => b.id !== bookId) })),

  updateBook: (bookId, updates) =>
    set((state) => ({
      books: state.books.map((b) => (b.id === bookId ? { ...b, ...updates } : b)),
    })),

  setFilter: (filter) => set((state) => ({ filter: { ...state.filter, ...filter } })),

  setViewMode: (mode) => set({ viewMode: mode }),

  setSortField: (field) => set((state) => ({ filter: { ...state.filter, sortField: field } })),

  setSortOrder: (order) => set((state) => ({ filter: { ...state.filter, sortOrder: order } })),

  importBooks: async (_filePaths) => {
    set({ isImporting: true });
    // TODO: Parse EPUB files, extract metadata, add to library
    set({ isImporting: false });
  },
}));
