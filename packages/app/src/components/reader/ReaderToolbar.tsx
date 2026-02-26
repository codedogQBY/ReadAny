import { Button } from "@/components/ui/button";
import type { TOCItem } from "@/lib/reader/document-renderer";
/**
 * ReaderToolbar — top toolbar with navigation and settings
 */
import { useAppStore } from "@/stores/app-store";
import { useReaderStore } from "@/stores/reader-store";
import { ChevronLeft, ChevronRight, List, MessageSquare, Search, Settings } from "lucide-react";

interface ReaderToolbarProps {
  tabId: string;
  onPrev?: () => void;
  onNext?: () => void;
  tocItems?: TOCItem[];
  onGoToChapter?: (index: number) => void;
}

export function ReaderToolbar({ tabId, onPrev, onNext }: ReaderToolbarProps) {
  const tab = useReaderStore((s) => s.tabs[tabId]);
  const { setSidebarTab } = useAppStore();

  if (!tab) return null;

  return (
    <div className="flex h-10 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPrev}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNext}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground">{tab.chapterTitle || "Untitled"}</span>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setSidebarTab("toc")}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Search className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setSidebarTab("chat")}
        >
          <MessageSquare className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
