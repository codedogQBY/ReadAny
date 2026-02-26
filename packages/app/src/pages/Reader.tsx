import { ReaderView } from "@/components/reader/ReaderView";
import { useAppStore } from "@/stores/app-store";
import { useReaderStore } from "@/stores/reader-store";
import { useEffect } from "react";
/**
 * Reader page — EPUB reader for a specific book
 */
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

export default function Reader() {
  const { t } = useTranslation();
  const { bookId } = useParams<{ bookId: string }>();
  const { addTab, activeTabId } = useAppStore();
  const { initTab } = useReaderStore();

  useEffect(() => {
    if (!bookId) return;
    const tabId = `reader-${bookId}`;
    addTab({ id: tabId, type: "reader", title: bookId, bookId });
    initTab(tabId, bookId);
  }, [bookId, addTab, initTab]);

  if (!bookId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t("reader.noBookSelected")}
      </div>
    );
  }

  const tabId = activeTabId ?? `reader-${bookId}`;

  return <ReaderView bookId={bookId} tabId={tabId} />;
}
