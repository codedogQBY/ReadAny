/**
 * ReaderView — main reading area (EPUB rendering)
 */
import { useReaderStore } from "@/stores/reader-store";
import { ReaderToolbar } from "./ReaderToolbar";

interface ReaderViewProps {
  bookId: string;
  tabId: string;
}

export function ReaderView({ bookId, tabId }: ReaderViewProps) {
  const tab = useReaderStore((s) => s.tabs[tabId]);
  const viewSettings = useReaderStore((s) => s.viewSettings);

  if (!tab) {
    return <div className="flex h-full items-center justify-center">Loading...</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <ReaderToolbar tabId={tabId} />
      <div
        className="flex-1 overflow-hidden"
        style={{
          fontSize: `${viewSettings.fontSize}px`,
          lineHeight: viewSettings.lineHeight,
          fontFamily: `var(--font-${viewSettings.fontFamily})`,
        }}
      >
        {/* TODO: EPUB renderer iframe/webview */}
        <div className="mx-auto h-full max-w-3xl px-10 py-8">
          <p className="text-muted-foreground">
            EPUB content for book {bookId} will render here.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Chapter: {tab.chapterTitle || "Loading..."} | Progress: {Math.round(tab.progress * 100)}%
          </p>
        </div>
      </div>
    </div>
  );
}
