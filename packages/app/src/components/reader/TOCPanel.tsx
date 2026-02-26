import type { TOCItem } from "@/lib/reader/document-renderer";
import { useReaderStore } from "@/stores/reader-store";
import { BookOpen, ChevronDown, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface TOCPanelProps {
  tocItems: TOCItem[];
  onGoToChapter: (index: number) => void;
  onClose: () => void;
  tabId: string;
}

interface TOCItemRowProps {
  item: TOCItem;
  currentChapterIndex: number;
  onGoToChapter: (index: number) => void;
  idx: number;
}

function TOCItemRow({ item, currentChapterIndex, onGoToChapter, idx }: TOCItemRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = item.subitems && item.subitems.length > 0;
  const isCurrent = (item.index ?? idx) === currentChapterIndex;

  return (
    <div>
      <button
        type="button"
        data-active={isCurrent || undefined}
        className={`group flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-[13px] leading-snug transition-all ${
          isCurrent
            ? "bg-primary/8 font-medium text-primary shadow-sm ring-1 ring-primary/15"
            : "text-foreground/70 hover:bg-muted/80 hover:text-foreground"
        }`}
        style={{ paddingLeft: `${item.level * 20 + 10}px` }}
        onClick={() => onGoToChapter(item.index ?? idx)}
      >
        {hasChildren && (
          <span
            className="mr-0.5 shrink-0 cursor-pointer rounded-md p-0.5 transition-colors hover:bg-muted-foreground/10"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
        )}
        {isCurrent && !hasChildren && (
          <span className="mr-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        )}
        <span className="truncate">{item.title}</span>
      </button>

      {hasChildren && expanded && item.subitems?.map((child, childIdx) => (
        <TOCItemRow
          key={child.id}
          item={child}
          currentChapterIndex={currentChapterIndex}
          onGoToChapter={onGoToChapter}
          idx={childIdx}
        />
      ))}
    </div>
  );
}

export function TOCPanel({ tocItems, onGoToChapter, onClose, tabId }: TOCPanelProps) {
  const { t } = useTranslation();
  const tab = useReaderStore((s) => s.tabs[tabId]);
  const currentChapterIndex = tab?.chapterIndex ?? 0;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to current chapter on open
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector("[data-active='true']");
    active?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentChapterIndex]);

  const handleGoTo = useCallback(
    (index: number) => {
      onGoToChapter(index);
    },
    [onGoToChapter],
  );

  return (
    <div className="flex h-full w-72 flex-col rounded-r-xl bg-background/95 shadow-2xl backdrop-blur-sm border border-l-0 border-border/50">
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/50 px-4 rounded-tr-xl">
        <div className="flex items-center gap-2">
          <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-[13px] font-semibold text-foreground/90">{t("reader.toc")}</h3>
        </div>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* TOC list */}
      {tocItems.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-muted-foreground">{t("reader.noToc")}</p>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {tocItems.map((item, idx) => (
            <TOCItemRow
              key={item.id}
              item={item}
              currentChapterIndex={currentChapterIndex}
              onGoToChapter={handleGoTo}
              idx={idx}
            />
          ))}
        </div>
      )}
    </div>
  );
}
