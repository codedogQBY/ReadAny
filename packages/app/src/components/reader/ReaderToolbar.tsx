import { Button } from "@/components/ui/button";
import type { TOCItem } from "./FoliateViewer";
import { useAppStore } from "@/stores/app-store";
import { useReaderStore } from "@/stores/reader-store";
import { useNotebookStore } from "@/stores/notebook-store";
import { ArrowLeft, List, MessageSquare, Search, Settings, StickyNote, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  onToggleTTS?: () => void;
  isChatOpen?: boolean;
  isTTSActive?: boolean;
  isFixedLayout?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function ReaderToolbar({
  tabId,
  isVisible,
  onPrev: _onPrev,
  onNext: _onNext,
  tocItems: _tocItems = [],
  onGoToChapter: _onGoToChapter,
  onToggleSearch,
  onToggleToc,
  onToggleSettings,
  onToggleChat,
  onToggleTTS,
  isChatOpen,
  isTTSActive,
  isFixedLayout = false,
  onMouseEnter,
  onMouseLeave,
}: ReaderToolbarProps) {
  const { t } = useTranslation();
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const tab = useReaderStore((s) => s.tabs[tabId]);
  const { isOpen: isNotebookOpen, toggleNotebook } = useNotebookStore();

  if (!tab) return null;

  return (
    <div
      className={`absolute top-0 left-0 right-0 z-50 flex h-10 items-center justify-between bg-background/95 backdrop-blur-sm px-2 shadow-sm transition-all duration-300 ${
        isVisible
          ? "translate-y-0 opacity-100 pointer-events-auto"
          : "-translate-y-full opacity-0 pointer-events-none"
      }`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Left: back + TOC + notebook */}
      <div className="flex items-center gap-0.5">
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

        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${isNotebookOpen ? "bg-primary/10 text-primary" : ""}`}
          onClick={toggleNotebook}
          title={t("notebook.title")}
        >
          <StickyNote className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Center: chapter title */}
      <div className="absolute inset-x-0 flex justify-center pointer-events-none">
        <span className="max-w-[200px] truncate text-xs text-foreground">
          {tab.chapterTitle || t("reader.untitled")}
        </span>
      </div>

      {/* Right: TTS + search + AI chat + settings */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${isTTSActive ? "bg-primary/10 text-primary" : ""}`}
          onClick={onToggleTTS}
          title={t("tts.title")}
        >
          <Volume2 className="h-3.5 w-3.5" />
        </Button>
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
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={isFixedLayout ? undefined : onToggleSettings}
                  disabled={isFixedLayout}
                >
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              </span>
            </TooltipTrigger>
            {isFixedLayout && (
              <TooltipContent>
                <p className="text-xs">{t("settings.notAvailableForPdf", "PDF 不支持此设置")}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
