import type { TOCItem } from "@/components/reader/FoliateViewer";
/**
 * Reader store — per-tab reading state, progress, CFI
 */
import { create } from "zustand";

export interface ReaderTab {
  bookId: string;
  currentCfi: string;
  progress: number;
  chapterIndex: number;
  chapterTitle: string;
  isLoading: boolean;
  searchQuery: string;
  searchResults: string[];
  selectedText: string;
  selectionCfi: string | null;
}

export interface ReaderState {
  tabs: Record<string, ReaderTab>; // keyed by tab id
  tocItems: TOCItem[];
  goToChapterFn: ((index: number) => void) | null;

  // Actions
  initTab: (tabId: string, bookId: string) => void;
  removeTab: (tabId: string) => void;
  setProgress: (tabId: string, progress: number, cfi: string) => void;
  setChapter: (tabId: string, index: number, title: string) => void;
  setSelectedText: (tabId: string, text: string, cfi: string | null) => void;
  setSearchQuery: (tabId: string, query: string) => void;
  setSearchResults: (tabId: string, results: string[]) => void;
  setTocItems: (items: TOCItem[]) => void;
  setGoToChapterFn: (fn: ((index: number) => void) | null) => void;
}

export const useReaderStore = create<ReaderState>((set) => ({
  tabs: {},
  tocItems: [],
  goToChapterFn: null,

  initTab: (tabId, bookId) =>
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: {
          bookId,
          currentCfi: "",
          progress: 0,
          chapterIndex: 0,
          chapterTitle: "",
          isLoading: true,
          searchQuery: "",
          searchResults: [],
          selectedText: "",
          selectionCfi: null,
        },
      },
    })),

  removeTab: (tabId) =>
    set((state) => {
      const { [tabId]: _, ...rest } = state.tabs;
      void _;
      return { tabs: rest };
    }),

  setProgress: (tabId, progress, cfi) =>
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: state.tabs[tabId]
          ? { ...state.tabs[tabId], progress, currentCfi: cfi }
          : state.tabs[tabId],
      },
    })),

  setChapter: (tabId, index, title) =>
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: state.tabs[tabId]
          ? { ...state.tabs[tabId], chapterIndex: index, chapterTitle: title }
          : state.tabs[tabId],
      },
    })),

  setSelectedText: (tabId, text, cfi) =>
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: state.tabs[tabId]
          ? { ...state.tabs[tabId], selectedText: text, selectionCfi: cfi }
          : state.tabs[tabId],
      },
    })),

  setSearchQuery: (tabId, query) =>
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: state.tabs[tabId]
          ? { ...state.tabs[tabId], searchQuery: query }
          : state.tabs[tabId],
      },
    })),

  setSearchResults: (tabId, results) =>
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: state.tabs[tabId]
          ? { ...state.tabs[tabId], searchResults: results }
          : state.tabs[tabId],
      },
    })),

  setTocItems: (items) => set({ tocItems: items }),

  setGoToChapterFn: (fn) => set({ goToChapterFn: fn }),
}));
