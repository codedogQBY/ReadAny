import { Button } from "@/components/ui/button";
import type { TOCItem } from "./FoliateViewer";
import { useAppStore } from "@/stores/app-store";
import { useReaderStore } from "@/stores/reader-store";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  List,
  MessageSquare,
  Search,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface ReaderToolbarProps {
  tabId: string;
  isVisible: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  tocItems?: TOCItem[];
  onGoToChapter?: (index: number) => void;
  onToggleSearch?: () => void;
  onToggleToc?: () => void;
  onToggleSettings?: () => void;
  onToggleChat?: () => void;
  isChatOpen?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function ReaderToolbar({
  tabId,
  isVisible,
  onPrev,
  onNext,
  tocItems: _tocItems = [],
  onGoToChapter: _onGoToChapter,
  onToggleSearch,
  onToggleToc,
  onToggleSettings,
  onToggleChat,
  isChatOpen,
  onMouseEnter,
  onMouseLeave,
}: ReaderToolbarProps) {
  const { t } = useTranslation();
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const tab = useReaderStore((s) => s.tabs[tabId]);

  if (!tab) return null;

  return (
    <div
      className="relative z-30 flex h-10 shrink-0 items-center justify-between bg-background px-2 transition-all duration-300"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Left: back + TOC + nav */}
      <div
        className="flex items-center gap-0.5 transition-opacity duration-300"
        style={{ opacity: isVisible ? 1 : 0 }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setActiveTab("home")}
          title={t("common.back")}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>

        <div className="mx-0.5 h-3.5 w-px bg-border/40" />

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggleToc}
          title={t("reader.toc")}
        >
          <List className="h-3.5 w-3.5" />
        </Button>

        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPrev}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNext}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Center: chapter title — fades with controls */}
      <div className="absolute inset-x-0 flex justify-center pointer-events-none">
        <span
          className="max-w-[200px] truncate text-xs transition-colors duration-300"
          style={{ color: isVisible ? "var(--color-foreground)" : "var(--color-muted-foreground)" }}
        >
          {tab.chapterTitle || t("reader.untitled")}
        </span>
      </div>

      {/* Right: search + AI chat + settings */}
      <div
        className="flex items-center gap-0.5 transition-opacity duration-300"
        style={{ opacity: isVisible ? 1 : 0 }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggleSearch}
          title={t("reader.search")}
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${isChatOpen ? "bg-primary/10 text-primary" : ""}`}
          onClick={onToggleChat}
          title={t("reader.askAI")}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggleSettings}
          title={t("reader.settings")}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
