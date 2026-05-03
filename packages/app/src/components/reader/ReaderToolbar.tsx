import { SyncButton } from "@/components/ui/SyncButton";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useAppStore } from "@/stores/app-store";
import { useNotebookStore } from "@/stores/notebook-store";
import { useReaderStore } from "@/stores/reader-store";
import { generateId } from "@readany/core/utils";
import type { ChapterTranslationState } from "@readany/core/hooks";
import {
  ArrowLeft,
  Bookmark,
  Headphones,
  List,
  Maximize,
  MessageSquare,
  NotebookPen,
  Pin,
  Search,
  Settings,
  Undo,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChapterTranslationMenu } from "./ChapterTranslationBar";
import type { TOCItem } from "./FoliateViewer";

interface ReaderToolbarProps {
  tabId: string;
  isVisible: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  tocItems?: TOCItem[];
  onGoToChapter?: (href: string) => void;
  onToggleSearch?: () => void;
  onToggleToc?: () => void;
  onToggleSettings?: () => void;
  onToggleChat?: () => void;
  onToggleTTS?: () => void;
  chapterTranslationState: ChapterTranslationState;
  onChapterTranslationStart: (targetLang?: string) => void;
  onChapterTranslationCancel: () => void;
  onToggleOriginalVisible: () => void;
  onToggleTranslationVisible: () => void;
  onChapterTranslationReset: () => void;
  isChatOpen?: boolean;
  isTTSActive?: boolean;
  isFixedLayout?: boolean;
  isPinned?: boolean;
  onTogglePinned?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  getPageSnippet?: () => string;
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
  chapterTranslationState,
  onChapterTranslationStart,
  onChapterTranslationCancel,
  onToggleOriginalVisible,
  onToggleTranslationVisible,
  onChapterTranslationReset,
  isChatOpen,
  isTTSActive,
  isFixedLayout: _isFixedLayout = false,
  isPinned = false,
  onTogglePinned,
  onMouseEnter,
  onMouseLeave,
  getPageSnippet,
}: ReaderToolbarProps) {
  const { t } = useTranslation();
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const tab = useReaderStore((s) => s.tabs[tabId]);
  const canGoBack = useReaderStore((s) => s.canGoBack(tabId));
  const goBack = useReaderStore((s) => s.goBack);
  const { isOpen: isNotebookOpen, toggleNotebook } = useNotebookStore();

  const bookmarks = useAnnotationStore((s) => s.bookmarks);
  const addBookmark = useAnnotationStore((s) => s.addBookmark);
  const removeBookmark = useAnnotationStore((s) => s.removeBookmark);

  const currentCfi = tab?.currentCfi || "";
  const bookId = tab?.bookId || "";
  const existingBookmark = bookmarks.find((b) => b.bookId === bookId && b.cfi === currentCfi);
  const isBookmarked = !!existingBookmark;

  const handleToggleBookmark = () => {
    if (!currentCfi || !bookId) return;
    if (isBookmarked && existingBookmark) {
      removeBookmark(existingBookmark.id);
      toast.success(t("bookmarks.removed"));
    } else {
      const snippet = getPageSnippet?.() || "";
      const label = snippet ? snippet.slice(0, 80) : undefined;
      addBookmark({
        id: generateId(),
        bookId,
        cfi: currentCfi,
        label,
        chapterTitle: tab?.chapterTitle || undefined,
        createdAt: Date.now(),
      });
      toast.success(t("bookmarks.added"));
    }
  };

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
      {/* Left: back + history back + TOC + notebook */}
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

        {canGoBack && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => goBack(tabId)}
                >
                  <Undo className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("reader.goBackToPreviousLocation")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

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
          <NotebookPen className="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${isBookmarked ? "text-primary" : ""}`}
          onClick={handleToggleBookmark}
          title={isBookmarked ? t("bookmarks.remove") : t("bookmarks.add")}
        >
          <Bookmark className={`h-3.5 w-3.5 ${isBookmarked ? "fill-current" : ""}`} />
        </Button>
      </div>

      {/* Center: chapter title */}
      <div className="absolute inset-x-0 flex justify-center pointer-events-none">
        <span className="max-w-[200px] truncate text-xs text-foreground">
          {tab.chapterTitle || t("reader.untitled")}
        </span>
      </div>

      {/* Right: translate + TTS + search + AI chat + settings */}
      <div className="flex items-center gap-0.5">
        <ChapterTranslationMenu
          state={chapterTranslationState}
          onStart={onChapterTranslationStart}
          onCancel={onChapterTranslationCancel}
          onToggleOriginalVisible={onToggleOriginalVisible}
          onToggleTranslationVisible={onToggleTranslationVisible}
          onReset={onChapterTranslationReset}
        />
        <SyncButton iconSize={14} className="h-7 w-7" />
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${isTTSActive ? "bg-primary/10 text-primary" : ""}`}
          onClick={onToggleTTS}
          title={t("tts.title")}
        >
          <Headphones className="h-3.5 w-3.5" />
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
          className={`h-7 w-7 ${isPinned ? "bg-primary/10 text-primary" : ""}`}
          onClick={onTogglePinned}
          title={isPinned ? t("reader.unpinToolbar") : t("reader.pinToolbar")}
        >
          <Pin className="h-3.5 w-3.5" />
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
          onClick={async () => {
            try {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              const win = getCurrentWindow();
              const fs = await win.isFullscreen();
              await win.setFullscreen(!fs);
            } catch {}
          }}
        >
          <Maximize className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleSettings}>
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
