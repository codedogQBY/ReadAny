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
  const { addTab } = useAppStore();
  const { initTab } = useReaderStore();

  const tabId = bookId ? `reader-${bookId}` : "";

  useEffect(() => {
    if (!bookId) return;
    const tid = `reader-${bookId}`;
    addTab({ id: tid, type: "reader", title: bookId, bookId });
    initTab(tid, bookId);
  }, [bookId, addTab, initTab]);

  if (!bookId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t("reader.noBookSelected")}
      </div>
    );
  }

  return <ReaderView bookId={bookId} tabId={tabId} />;
}
