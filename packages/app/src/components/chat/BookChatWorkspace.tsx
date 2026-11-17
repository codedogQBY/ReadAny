import { getBook as getBookRecord } from "@/lib/db/database";
import { openDesktopBook } from "@/lib/library/open-book";
import { useAppStore } from "@/stores/app-store";
import {
  getBookChatTabId,
  showBookChatSidebar,
  useBookChatLayoutStore,
} from "@/stores/book-chat-layout-store";
import { useLibraryStore } from "@/stores/library-store";
import type { CitationPart } from "@readany/core/types";
import { ArrowLeft, PanelRight } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChatPanel } from "./ChatPanel";

/** One stable conversation instance per reader, even while its reader is hibernated. */
export function BookChatWorkspace({
  bookId,
  readerTabId,
}: { bookId: string; readerTabId: string }) {
  const { t } = useTranslation();
  const book = useLibraryStore((state) => state.books.find((item) => item.id === bookId));
  const chatTabId = getBookChatTabId(bookId);
  const detached = useAppStore((state) => state.tabs.some((tab) => tab.id === chatTabId));
  const active = useAppStore((state) => state.activeTabId === chatTabId);
  const sidebarHost = useBookChatLayoutStore((state) => state.sidebarHosts[bookId]);
  const [tabHost, setTabHost] = useState<HTMLDivElement | null>(null);
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.className = "h-full min-h-0 w-full";
    return element;
  });
  const scrollTop = useRef(0);

  // Keep the portal target stable: moving its DOM node preserves drafts and UI state.
  useLayoutEffect(() => {
    const scroller = container.querySelector<HTMLElement>("[data-chat-scroll]");
    if (scroller && scroller.clientHeight > 0) scrollTop.current = scroller.scrollTop;
    const target = detached ? tabHost : sidebarHost;
    if (target) {
      target.appendChild(container);
      if (scroller) scroller.scrollTop = scrollTop.current;
    } else {
      container.remove();
    }
  }, [container, detached, sidebarHost, tabHost]);

  useLayoutEffect(() => () => container.remove(), [container]);

  const returnToBook = useCallback(() => {
    useAppStore.getState().setActiveTab(readerTabId);
  }, [readerTabId]);

  const navigateToCitation = useCallback(
    async (citation: CitationPart) => {
      const app = useAppStore.getState();
      const reader = app.tabs.find(
        (tab) => tab.type === "reader" && tab.bookId === citation.bookId,
      );
      const navigate = useBookChatLayoutStore.getState().citationNavigators[citation.bookId];
      if (reader && navigate) {
        app.setActiveTab(reader.id);
        requestAnimationFrame(() => navigate(citation));
        return;
      }
      const citedBook =
        useLibraryStore.getState().books.find((item) => item.id === citation.bookId) ??
        (await getBookRecord(citation.bookId).catch(() => null));
      if (!citedBook) {
        toast.error(t("chat.citationBookNotFound"));
        return;
      }
      const opened = await openDesktopBook({
        book: citedBook,
        t,
        initialCfi: citation.cfi?.trim() || `chapter:${Math.max(0, citation.chapterIndex)}`,
      });
      if (!opened) toast.error(t("chat.citationOpenFailed"));
    },
    [t],
  );

  return (
    <>
      {detached && (
        <section
          aria-label={`${book?.meta.title ?? ""} · AI`}
          className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background pt-8"
          style={{ display: active ? "flex" : "none" }}
        >
          <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-3">
            <button
              type="button"
              onClick={returnToBook}
              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-4 shrink-0" />
              <span className="truncate">{t("chat.returnToBook")}</span>
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-sm font-medium">
              {book?.meta.title} · AI
            </span>
            <button
              type="button"
              onClick={() => showBookChatSidebar(bookId)}
              title={t("chat.moveToSidebar")}
              className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <PanelRight className="size-4" />
              <span>{t("chat.moveToSidebar")}</span>
            </button>
          </header>
          <div ref={setTabHost} className="min-h-0 flex-1" />
        </section>
      )}
      {book &&
        createPortal(
          <ChatPanel
            book={book}
            onNavigateToCitation={navigateToCitation}
            showOutline={detached}
          />,
          container,
        )}
    </>
  );
}
