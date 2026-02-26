import type { TOCItem } from "@/lib/reader/document-renderer";
import { useReaderStore } from "@/stores/reader-store";
import { ChevronDown, ChevronRight, X } from "lucide-react";
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
        className={`group flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
          isCurrent
            ? "bg-primary/10 font-medium text-primary"
            : "text-foreground/80 hover:bg-muted"
        }`}
        style={{ paddingLeft: `${item.level * 16 + 8}px` }}
        onClick={() => onGoToChapter(item.index ?? idx)}
      >
        {hasChildren && (
          <span
            className="mr-0.5 shrink-0 cursor-pointer rounded p-0.5 hover:bg-muted-foreground/10"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </span>
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
    active?.scrollIntoView({ block: "center" });
  }, [currentChapterIndex]);

  const handleGoTo = useCallback(
    (index: number) => {
      onGoToChapter(index);
    },
    [onGoToChapter],
  );

  return (
    <div className="flex h-full w-72 flex-col border-r bg-background shadow-lg">
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <h3 className="text-sm font-semibold">{t("reader.toc")}</h3>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* TOC list */}
      {tocItems.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">{t("reader.noToc")}</p>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
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
