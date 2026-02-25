/**
 * Chat reader store — reading context for standalone chat page
 */
import { create } from "zustand";

export interface ChatReaderContext {
  bookId: string | null;
  bookTitle: string;
  currentChapter: string;
  selectedBooks: string[]; // multiple book context for standalone chat
}

export interface ChatReaderState extends ChatReaderContext {
  setBookContext: (bookId: string, title: string) => void;
  setCurrentChapter: (chapter: string) => void;
  addSelectedBook: (bookId: string) => void;
  removeSelectedBook: (bookId: string) => void;
  clearContext: () => void;
}

export const useChatReaderStore = create<ChatReaderState>((set) => ({
  bookId: null,
  bookTitle: "",
  currentChapter: "",
  selectedBooks: [],

  setBookContext: (bookId, title) => set({ bookId, bookTitle: title }),

  setCurrentChapter: (chapter) => set({ currentChapter: chapter }),

  addSelectedBook: (bookId) =>
    set((state) => ({
      selectedBooks: state.selectedBooks.includes(bookId)
        ? state.selectedBooks
        : [...state.selectedBooks, bookId],
    })),

  removeSelectedBook: (bookId) =>
    set((state) => ({
      selectedBooks: state.selectedBooks.filter((id) => id !== bookId),
    })),

  clearContext: () =>
    set({ bookId: null, bookTitle: "", currentChapter: "", selectedBooks: [] }),
}));
