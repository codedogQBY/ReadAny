import { useAppStore } from "@/stores/app-store";
import type { Book, CitationPart } from "@readany/core/types";
import { create } from "zustand";

export const getBookChatTabId = (bookId: string) => `book-chat-${bookId}`;

/** Session-only desktop layout. Conversation state stays in the mounted ChatPanel. */
export const useBookChatLayoutStore = create<{
  openSidebars: Record<string, boolean>;
  sidebarHosts: Record<string, HTMLDivElement | null>;
  citationNavigators: Record<string, ((citation: CitationPart) => void) | undefined>;
  setSidebarOpen: (bookId: string, open: boolean | ((previous: boolean) => boolean)) => void;
  setSidebarHost: (bookId: string, host: HTMLDivElement | null) => void;
  setCitationNavigator: (bookId: string, navigate?: (citation: CitationPart) => void) => void;
  clearBook: (bookId: string) => void;
}>((set) => ({
  openSidebars: {},
  sidebarHosts: {},
  citationNavigators: {},
  setSidebarOpen: (bookId, open) =>
    set((state) => ({
      openSidebars: {
        ...state.openSidebars,
        [bookId]: typeof open === "function" ? open(state.openSidebars[bookId] ?? false) : open,
      },
    })),
  setSidebarHost: (bookId, host) =>
    set((state) => ({
      sidebarHosts: { ...state.sidebarHosts, [bookId]: host },
    })),
  setCitationNavigator: (bookId, navigate) =>
    set((state) => ({
      citationNavigators: { ...state.citationNavigators, [bookId]: navigate },
    })),
  clearBook: (bookId) =>
    set((state) => {
      const openSidebars = { ...state.openSidebars };
      const sidebarHosts = { ...state.sidebarHosts };
      const citationNavigators = { ...state.citationNavigators };
      delete openSidebars[bookId];
      delete sidebarHosts[bookId];
      delete citationNavigators[bookId];
      return { openSidebars, sidebarHosts, citationNavigators };
    }),
}));

export function openBookChatInTab(book: Book) {
  useBookChatLayoutStore.getState().setSidebarOpen(book.id, false);
  useAppStore.getState().addTab({
    id: getBookChatTabId(book.id),
    type: "chat",
    bookId: book.id,
    title: `${book.meta.title} · AI`,
  });
}

export function showBookChatSidebar(bookId: string) {
  const app = useAppStore.getState();
  app.removeTab(getBookChatTabId(bookId));
  useBookChatLayoutStore.getState().setSidebarOpen(bookId, true);
  const reader = useAppStore
    .getState()
    .tabs.find((tab) => tab.type === "reader" && tab.bookId === bookId);
  if (reader) app.setActiveTab(reader.id);
}
