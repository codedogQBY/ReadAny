import { Button } from "@/components/ui/button";
import type { TOCItem } from "@/lib/reader/document-renderer";
import { useReaderStore } from "@/stores/reader-store";
import { ArrowLeft, ChevronLeft, ChevronRight, List, Search, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

interface ReaderToolbarProps {
  tabId: string;
  onPrev?: () => void;
  onNext?: () => void;
  tocItems?: TOCItem[];
  onGoToChapter?: (index: number) => void;
  onToggleSearch?: () => void;
  onToggleToc?: () => void;
  onToggleSettings?: () => void;
}

export function ReaderToolbar({
  tabId,
  onPrev,
  onNext,
  tocItems: _tocItems = [],
  onGoToChapter: _onGoToChapter,
  onToggleSearch,
  onToggleToc,
  onToggleSettings,
}: ReaderToolbarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tab = useReaderStore((s) => s.tabs[tabId]);
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // Auto-hide after 3s of no mouse movement in the top area
  const resetHideTimer = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 3000);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [resetHideTimer]);

  if (!tab) return null;

  return (
    <div
      className={`relative z-30 transition-all duration-300 ${visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"}`}
      onMouseEnter={() => {
        setVisible(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
      }}
      onMouseLeave={resetHideTimer}
    >
      {/* Hover trigger zone - always present */}
      <div
        className="absolute top-0 left-0 z-40 h-3 w-full"
        onMouseEnter={() => setVisible(true)}
      />

      <div className="flex h-11 items-center justify-between border-b border-border/50 bg-background/95 px-3 backdrop-blur-sm">
        {/* Left: back + TOC + nav */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate("/")}
            title={t("common.back")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="mx-1 h-4 w-px bg-border/50" />

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleToc}
            title={t("reader.toc")}
          >
            <List className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onPrev}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onNext}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Center: chapter title */}
        <div className="flex-1 text-center">
          <span className="truncate text-xs text-muted-foreground">
            {tab.chapterTitle || t("reader.untitled")}
          </span>
        </div>

        {/* Right: search + settings */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleSearch}
            title={t("reader.search")}
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleSettings}
            title={t("reader.settings")}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
