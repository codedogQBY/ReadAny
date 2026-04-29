import { useAnnotationStore } from "@/stores/annotation-store";
import { useReaderStore } from "@/stores/reader-store";
import type { Bookmark } from "@readany/core/types";
import {
  BookOpen,
  Bookmark as BookmarkIcon,
  ChevronDown,
  ChevronRight,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TOCItem } from "./FoliateViewer";

type PanelTab = "toc" | "bookmarks";

interface TOCPanelProps {
  tocItems: TOCItem[];
  onGoToChapter: (href: string) => void;
  onGoToCfi?: (cfi: string) => void;
  onClose: () => void;
  tabId: string;
  bookId: string;
  coverUri?: string;
  bookTitle?: string;
  chapterTitle?: string;
}

interface TOCItemWithPath extends TOCItem {
  path: string[];
}

interface TOCItemRowProps {
  item: TOCItemWithPath;
  activeItemId?: string;
  onGoToChapter: (href: string) => void;
  expandedHrefs: Set<string>;
  onToggleExpand: (href: string) => void;
}

function normalizeHref(href: string | undefined): string {
  if (!href) return "";
  return href.split("?")[0];
}

function normalizeHrefWithoutHash(href: string | undefined): string {
  return normalizeHref(href).split("#")[0];
}

function isCurrentTOCItem(
  item: Pick<TOCItem, "href" | "title">,
  currentHref: string | undefined,
  currentChapterTitle?: string,
): boolean {
  if (currentChapterTitle && item.title === currentChapterTitle) {
    return true;
  }

  if (!currentHref || !item.href) return false;
  const normalizedCurrent = normalizeHref(currentHref);
  const normalizedItem = normalizeHref(item.href);

  if (normalizedItem === normalizedCurrent) {
    return true;
  }

  if (!currentChapterTitle) {
    return normalizeHrefWithoutHash(item.href) === normalizeHrefWithoutHash(currentHref);
  }

  return false;
}

function hasActiveChild(item: TOCItemWithPath | TOCItem, activeItemId?: string): boolean {
  if (!activeItemId || !item.subitems?.length) return false;
  for (const child of item.subitems) {
    if (child.id === activeItemId) return true;
    if (hasActiveChild(child, activeItemId)) return true;
  }
  return false;
}

function TOCItemRow({
  item,
  activeItemId,
  onGoToChapter,
  expandedHrefs,
  onToggleExpand,
}: TOCItemRowProps) {
  const hasChildren = item.subitems && item.subitems.length > 0;
  const isExpanded = expandedHrefs.has(item.href || "");
  const isCurrent = !!activeItemId && item.id === activeItemId;
  const containsCurrent = hasActiveChild(item, activeItemId);

  return (
    <div>
      <button
        type="button"
        data-active={isCurrent || undefined}
        className={`group flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-[13px] leading-snug transition-colors duration-150 ${
          isCurrent
            ? "bg-primary/10 font-medium text-primary"
            : "text-foreground/70 hover:bg-muted/60 hover:text-foreground"
        }`}
        style={{ paddingLeft: `${item.level * 16 + 12}px` }}
        onClick={() => item.href && onGoToChapter(item.href)}
      >
        {hasChildren ? (
          <span
            className="mr-0.5 shrink-0 flex h-5 w-5 items-center justify-center rounded-md transition-colors duration-150 hover:bg-muted-foreground/10"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(item.href || "");
            }}
          >
            {isExpanded || containsCurrent ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
        ) : (
          <span className="mr-0.5 h-5 w-5 shrink-0" />
        )}
        <span className="truncate">{item.title}</span>
      </button>

      {hasChildren && (isExpanded || containsCurrent) && (
        <div>
          {item.subitems?.map((child) => (
            <TOCItemRow
              key={child.id}
              item={child as TOCItemWithPath}
              activeItemId={activeItemId}
              onGoToChapter={onGoToChapter}
              expandedHrefs={expandedHrefs}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BookmarkItem({
  bookmark,
  onClick,
  onDelete,
}: {
  bookmark: Bookmark;
  onClick: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const dateStr = new Date(bookmark.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] leading-snug transition-colors text-foreground/70 hover:bg-muted/60 hover:text-foreground"
      onClick={onClick}
    >
      <BookmarkIcon className="h-3.5 w-3.5 shrink-0 text-primary fill-primary" />
      <div className="flex-1 min-w-0">
        <span className="block truncate">{bookmark.chapterTitle || t("common.unnamed")}</span>
        {bookmark.label && (
          <span className="block truncate text-xs text-muted-foreground/70 mt-0.5">
            {bookmark.label}
          </span>
        )}
        <span className="block text-xs text-muted-foreground/50 mt-0.5">{dateStr}</span>
      </div>
      <span
        className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title={t("bookmarks.remove")}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function flattenTOCWithPath(items: TOCItem[], parentPath: string[] = []): TOCItemWithPath[] {
  const result: TOCItemWithPath[] = [];

  for (const item of items) {
    const path = [...parentPath, item.href || ""];
    const itemWithPath: TOCItemWithPath = {
      ...item,
      path,
      subitems: item.subitems ? flattenTOCWithPath(item.subitems, path) : undefined,
    };
    result.push(itemWithPath);
  }

  return result;
}

function findCurrentItem(
  items: TOCItemWithPath[],
  currentHref: string | undefined,
  currentChapterTitle?: string,
): TOCItemWithPath | null {
  if (!currentHref && !currentChapterTitle) return null;

  for (const item of items) {
    if (item.subitems) {
      const found = findCurrentItem(
        item.subitems as TOCItemWithPath[],
        currentHref,
        currentChapterTitle,
      );
      if (found) return found;
    }

    if (isCurrentTOCItem(item, currentHref, currentChapterTitle)) {
      return item;
    }
  }

  return null;
}

function findAncestorsToExpand(
  items: TOCItemWithPath[],
  currentHref: string | undefined,
  currentChapterTitle?: string,
): Set<string> {
  const toExpand = new Set<string>();
  if (!currentHref && !currentChapterTitle) return toExpand;

  const currentItem = findCurrentItem(items, currentHref, currentChapterTitle);
  if (!currentItem) return toExpand;

  for (let i = 0; i < currentItem.path.length - 1; i++) {
    const href = currentItem.path[i];
    if (href) {
      toExpand.add(href);
    }
  }

  return toExpand;
}

export function TOCPanel({
  tocItems,
  onGoToChapter,
  onGoToCfi,
  onClose,
  tabId,
  bookId,
  chapterTitle,
}: TOCPanelProps) {
  const { t } = useTranslation();
  const tab = useReaderStore((s) => s.tabs[tabId]);
  const currentHref = tab?.chapterHref;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>("toc");

  const bookmarks = useAnnotationStore((s) => s.bookmarks);
  const removeBookmark = useAnnotationStore((s) => s.removeBookmark);
  const bookBookmarks = bookmarks.filter((b) => b.bookId === bookId);

  const tocWithPath = useMemo(() => flattenTOCWithPath(tocItems), [tocItems]);
  const currentItem = useMemo(
    () => findCurrentItem(tocWithPath, currentHref, chapterTitle),
    [chapterTitle, currentHref, tocWithPath],
  );

  const [expandedHrefs, setExpandedHrefs] = useState<Set<string>>(() => {
    return findAncestorsToExpand(tocWithPath, currentHref, chapterTitle);
  });

  useEffect(() => {
    setExpandedHrefs((prev) => {
      const toExpand = findAncestorsToExpand(tocWithPath, currentHref, chapterTitle);
      return new Set([...prev, ...toExpand]);
    });
  }, [chapterTitle, currentHref, tocWithPath]);

  const handleToggleExpand = useCallback((href: string) => {
    setExpandedHrefs((prev) => {
      const next = new Set(prev);
      if (next.has(href)) {
        next.delete(href);
      } else {
        next.add(href);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (activeTab !== "toc") return;
    const el = scrollRef.current;
    if (!el) return;
    const timer = setTimeout(() => {
      const active = el.querySelector("[data-active='true']");
      active?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 100);
    return () => clearTimeout(timer);
  }, [currentHref, activeTab, expandedHrefs]);

  const handleGoTo = useCallback(
    (href: string) => {
      onGoToChapter(href);
    },
    [onGoToChapter],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/50 px-4">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors ${
              activeTab === "toc"
                ? "text-primary bg-primary/8"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
            onClick={() => setActiveTab("toc")}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t("reader.toc")}
          </button>
          <button
            type="button"
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors ${
              activeTab === "bookmarks"
                ? "text-primary bg-primary/8"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
            onClick={() => setActiveTab("bookmarks")}
          >
            <BookmarkIcon className="h-3.5 w-3.5" />
            {t("bookmarks.title")}
            {bookBookmarks.length > 0 && (
              <span className="text-xs text-muted-foreground">({bookBookmarks.length})</span>
            )}
          </button>
        </div>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {activeTab === "toc" ? (
        tocItems.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-muted-foreground">{t("reader.noToc")}</p>
          </div>
        ) : (
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
            {tocWithPath.map((item) => (
              <TOCItemRow
                key={item.id}
                item={item}
                activeItemId={currentItem?.id}
                onGoToChapter={handleGoTo}
                expandedHrefs={expandedHrefs}
                onToggleExpand={handleToggleExpand}
              />
            ))}
          </div>
        )
      ) : bookBookmarks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
          <BookmarkIcon className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">{t("bookmarks.empty")}</p>
          <p className="text-xs text-muted-foreground/60 text-center">{t("bookmarks.emptyHint")}</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {bookBookmarks.map((bm) => (
            <BookmarkItem
              key={bm.id}
              bookmark={bm}
              onClick={() => onGoToCfi?.(bm.cfi)}
              onDelete={() => removeBookmark(bm.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
