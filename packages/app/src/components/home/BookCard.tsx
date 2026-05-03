import { ConfigGuideDialog, type ConfigGuideType } from "@/components/shared/ConfigGuideDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GroupPickerPopover } from "@/components/home/GroupPickerPopover";
import { useResolvedSrc, useSyncVersion } from "@/hooks/use-resolved-src";
import { openDesktopBook } from "@/lib/library/open-book";
/**
 * BookCard — Readest-inspired book card with realistic cover rendering
 */
import { triggerVectorizeBook } from "@/lib/rag/vectorize-trigger";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { useVectorModelStore } from "@/stores/vector-model-store";
import type { Book, VectorizeProgress } from "@readany/core/types";
import {
  Check,
  ChevronRight,
  Database,
  FolderInput,
  FolderMinus,
  Hash,
  Loader2,
  MoreVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface BookCardProps {
  book: Book;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onSelect?: (bookId: string) => void;
}

export const BookCard = memo(function BookCard({
  book,
  isSelectionMode,
  isSelected,
  onSelect,
}: BookCardProps) {
  const { t } = useTranslation();
  const removeBook = useLibraryStore((s) => s.removeBook);
  const closeAppTab = useAppStore((s) => s.removeTab);
  const closeReaderTab = useReaderStore((s) => s.removeTab);
  const allTags = useLibraryStore((s) => s.allTags);
  const groups = useLibraryStore((s) => s.groups);
  const addGroup = useLibraryStore((s) => s.addGroup);
  const moveBookToGroup = useLibraryStore((s) => s.moveBookToGroup);
  const removeBookFromGroup = useLibraryStore((s) => s.removeBookFromGroup);
  const addTagToBook = useLibraryStore((s) => s.addTagToBook);
  const removeTagFromBook = useLibraryStore((s) => s.removeTagFromBook);
  const addTag = useLibraryStore((s) => s.addTag);
  const hasVectorCapability = useVectorModelStore((s) => s.hasVectorCapability);
  const [showMenu, setShowMenu] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [vectorizing, setVectorizing] = useState(false);
  const [vectorProgress, setVectorProgress] = useState<VectorizeProgress | null>(null);
  const [configGuide, setConfigGuide] = useState<ConfigGuideType>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [preserveDataOnDelete, setPreserveDataOnDelete] = useState(true);
  const coverRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const suppressOpenUntilRef = useRef(0);
  const progressPct = Math.round(book.progress * 100);
  const coverSrc = useResolvedSrc(book.meta.coverUrl);
  const syncVersion = useSyncVersion();
  const coverImageKey = coverSrc ? `${coverSrc}-${syncVersion}` : "";

  useEffect(() => {
    setImageError(false);
    const image = imageRef.current;
    if (coverImageKey && image?.complete) {
      setImageLoaded(image.naturalWidth > 0);
      setImageError(image.naturalWidth === 0);
      return;
    }
    setImageLoaded(false);
  }, [coverImageKey]);

  const handleOpen = async () => {
    if (isSelectionMode) {
      onSelect?.(book.id);
      return;
    }
    if (showMenu || showDeleteDialog || Date.now() < suppressOpenUntilRef.current) {
      return;
    }
    await openDesktopBook({ book, t });
  };

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    suppressOpenUntilRef.current = Date.now() + 600;
    setShowMenu(false);
    setMenuPos(null);
    setPreserveDataOnDelete(true);
    setShowDeleteDialog(true);
  }, []);

  const handleVectorize = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      suppressOpenUntilRef.current = Date.now() + 400;
      setShowMenu(false);
      setMenuPos(null);
      if (vectorizing) return;

      if (!hasVectorCapability()) {
        setConfigGuide("vectorModel");
        return;
      }

      setVectorizing(true);
      try {
        await triggerVectorizeBook(book.id, book.filePath, (progress) => {
          setVectorProgress({ ...progress });
        });
      } catch (err) {
        console.error("[BookCard] Vectorization failed:", err);
      } finally {
        setVectorizing(false);
        setVectorProgress(null);
      }
    },
    [book.id, book.filePath, hasVectorCapability, vectorizing],
  );

  const handleMoveGroup = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      suppressOpenUntilRef.current = Date.now() + 300;
      setShowMenu(false);
      setMenuPos(null);
      setShowGroupPicker(true);
    },
    [],
  );

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    setImageLoaded(event.currentTarget.naturalWidth > 0);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageLoaded(false);
    setImageError(true);
  };

  const hasVisibleCover = Boolean(coverSrc && imageLoaded && !imageError);

  // Vectorize progress percentage for display
  const vecPct = vectorProgress
    ? vectorProgress.totalChunks > 0
      ? Math.round((vectorProgress.processedChunks / vectorProgress.totalChunks) * 100)
      : 0
    : 0;

  return (
    <div
      className="group relative flex h-full cursor-pointer flex-col justify-end"
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void handleOpen();
        }
      }}
    >
      {/* Cover area — 28:41 aspect ratio (Readest standard) */}
      <div
        ref={coverRef}
        className="book-cover-shadow relative flex aspect-[28/41] w-full items-end justify-center overflow-hidden rounded transition-all duration-200 group-hover:book-cover-shadow"
      >
        {/* Selection checkbox overlay */}
        {isSelectionMode && (
          <div
            className={`absolute left-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-full border-2 ${
              isSelected ? "border-primary bg-primary" : "border-white bg-black/40"
            }`}
          >
            {isSelected && <Check className="h-3 w-3 text-white" />}
          </div>
        )}
        {isSelectionMode && isSelected && (
          <div className="absolute inset-0 z-10 rounded bg-black/15" />
        )}
        {/* Actual cover image */}
        {coverSrc && (
          <img
            ref={imageRef}
            key={coverImageKey}
            src={coverSrc}
            alt={book.meta.title}
            className={`absolute inset-0 h-full w-full rounded object-cover transition-opacity duration-300 ${
              hasVisibleCover ? "opacity-100" : "opacity-0"
            }`}
            loading="lazy"
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        )}

        {/* Book spine overlay — only when image loaded */}
        {hasVisibleCover && <div className="book-spine absolute inset-0 rounded" />}

        {/* Fallback cover — serif title + author */}
        {!hasVisibleCover && (
          <div className="absolute inset-0 flex flex-col items-center rounded bg-gradient-to-b from-stone-100 to-stone-200 p-3">
            <div className="flex flex-1 items-center justify-center">
              <span className="line-clamp-3 text-center font-serif text-base font-medium leading-snug text-stone-500">
                {book.meta.title}
              </span>
            </div>
            <div className="h-px w-8 bg-stone-300/60" />
            {book.meta.author && (
              <div className="flex h-1/4 items-center justify-center">
                <span className="line-clamp-1 text-center font-serif text-xs text-stone-400">
                  {book.meta.author}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Progress bar at bottom of cover */}
        {progressPct > 0 && progressPct < 100 && (
          <div className="absolute bottom-0 left-0 right-0 z-10 h-0.5 bg-black/10">
            <div
              className="h-full bg-primary/80 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}

        {/* Vectorization progress overlay */}
        {vectorizing && (
          <div className="absolute inset-0 z-15 flex flex-col items-center justify-center rounded bg-black/50 backdrop-blur-sm">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
            <span className="mt-1.5 text-xs font-medium text-white">
              {vectorProgress?.status === "chunking"
                ? `${vecPct}%`
                : vectorProgress?.status === "embedding"
                  ? `${vecPct}%`
                  : vectorProgress?.status === "indexing"
                    ? t("home.vec_indexing")
                    : t("home.vec_processing")}
            </span>
          </div>
        )}

        {/* Remote status overlay (on-demand download) */}
        {book.syncStatus === "remote" && !vectorizing && (
          <div
            className="absolute inset-0 z-15 flex items-center justify-center rounded"
            style={{ backgroundColor: "rgba(59, 130, 246, 0.6)" }}
          >
            <div className="rounded bg-black/40 px-2 py-1 text-xs font-medium text-white">
              {t("home.remote", "需下载")}
            </div>
          </div>
        )}

        {/* Downloading status overlay */}
        {book.syncStatus === "downloading" && !vectorizing && (
          <div className="absolute inset-0 z-15 flex flex-col items-center justify-center rounded bg-black/50">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
            <span className="mt-1.5 text-sm font-medium text-white">
              {t("home.downloading", "下载中")}
            </span>
          </div>
        )}

        {/* Vectorized badge — top-left corner */}
        {book.isVectorized && !vectorizing && (
          <div className="absolute left-1 top-1 z-10 flex items-center gap-0.5 rounded bg-green-600/80 px-1 py-0.5 backdrop-blur-sm">
            <Database className="h-2.5 w-2.5 text-white" />
            <span className="text-[9px] font-medium text-white">{t("home.vec_indexed")}</span>
          </div>
        )}

        {/* Context menu trigger — hover only */}
        <button
          ref={menuBtnRef}
          type="button"
          className="absolute right-1 bottom-1 z-20 rounded-md bg-black/30 p-0.5 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            suppressOpenUntilRef.current = Date.now() + 300;
            if (showMenu) {
              setShowMenu(false);
              setMenuPos(null);
            } else {
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuPos({ x: rect.right, y: rect.top });
              setShowMenu(true);
            }
          }}
        >
          <MoreVertical className="h-3.5 w-3.5 text-white" />
        </button>
      </div>

      {/* Context menu — fixed position to avoid any overflow clipping */}
      {showMenu && menuPos && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(false);
              setShowTagMenu(false);
              setMenuPos(null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setShowMenu(false);
                setShowTagMenu(false);
                setMenuPos(null);
              }
            }}
          />
          <div
            className="fixed z-50 min-w-36 rounded-lg border bg-popover p-1 shadow-lg"
            style={{ bottom: window.innerHeight - menuPos.y + 4, left: menuPos.x - 152 }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {/* Vectorize button */}
            <button
              id="tour-vectorize"
              type="button"
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                vectorizing || book.syncStatus !== "local"
                  ? "text-muted-foreground opacity-50 cursor-not-allowed"
                  : "text-foreground hover:bg-muted"
              }`}
              disabled={vectorizing || book.syncStatus !== "local"}
              onClick={handleVectorize}
            >
              {book.isVectorized ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-600" />
                  {t("home.vec_reindex")}
                </>
              ) : (
                <>
                  <Database className="h-3.5 w-3.5" />
                  {book.syncStatus === "local"
                    ? t("home.vec_vectorize")
                    : t("home.remote", "需下载")}
                </>
              )}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted"
              onClick={handleMoveGroup}
            >
              <FolderInput className="h-3.5 w-3.5" />
              {book.groupId
                ? t("library.changeGroup", "更换分组")
                : t("library.moveToGroup", "移入分组")}
            </button>
            {book.groupId && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  suppressOpenUntilRef.current = Date.now() + 300;
                  setShowMenu(false);
                  setMenuPos(null);
                  removeBookFromGroup(book.id);
                }}
              >
                <FolderMinus className="h-3.5 w-3.5" />
                {t("library.removeFromGroup", "移出分组")}
              </button>
            )}
            {/* Tags submenu */}
            <div className="relative">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  suppressOpenUntilRef.current = Date.now() + 300;
                  setShowTagMenu(!showTagMenu);
                }}
              >
                <Hash className="h-3.5 w-3.5" />
                {t("home.manageTags")}
                <ChevronRight className="ml-auto h-3 w-3" />
              </button>
              {showTagMenu && (
                <div
                  className="absolute right-full top-0 z-50 mr-1 min-w-36 max-h-52 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {allTags.map((tag) => {
                    const hasTag = book.tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation();
                          suppressOpenUntilRef.current = Date.now() + 300;
                          if (hasTag) removeTagFromBook(book.id, tag);
                          else addTagToBook(book.id, tag);
                        }}
                      >
                        <div
                          className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${hasTag ? "border-primary bg-primary" : "border-border"}`}
                        >
                          {hasTag && <Check className="h-2.5 w-2.5 text-white" />}
                        </div>
                        <span className="truncate">{tag}</span>
                      </button>
                    );
                  })}
                  {/* Quick add new tag */}
                  <div className="mt-1 border-t pt-1">
                    <div className="flex items-center gap-1 px-1">
                      <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <input
                        type="text"
                        className="w-full bg-transparent px-1 py-1 text-xs outline-none placeholder:text-muted-foreground"
                        placeholder={t("sidebar.tagPlaceholder")}
                        value={newTagInput}
                        onChange={(e) => setNewTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter" && newTagInput.trim()) {
                            suppressOpenUntilRef.current = Date.now() + 300;
                            addTag(newTagInput.trim());
                            addTagToBook(book.id, newTagInput.trim());
                            setNewTagInput("");
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* Delete button */}
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
              onClick={handleDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("common.remove")}
            </button>
          </div>
        </>
      )}

      {/* Info area — minimal, below cover */}
      <div className="flex w-full flex-col pt-2">
        <h4 className="truncate text-xs font-semibold leading-tight text-foreground">
          {book.meta.title}
        </h4>
        {book.meta.author && (
          <p className="truncate text-[10px] leading-tight text-muted-foreground">
            {book.meta.author}
          </p>
        )}

        {/* Tag badges */}
        {book.tags.length > 0 ? (
          <div className="mt-0.5 flex flex-wrap gap-0.5">
            {book.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {book.tags.length > 2 && (
              <span className="text-[9px] text-muted-foreground">+{book.tags.length - 2}</span>
            )}
          </div>
        ) : (
          <div className="mt-0.5 flex flex-wrap gap-0.5">
            <span className="inline-flex items-center rounded-full bg-muted/50 px-1.5 py-px text-[9px] text-muted-foreground">
              {t("sidebar.uncategorized")}
            </span>
          </div>
        )}

        {/* Status row */}
        <div className="mt-0.5 flex items-center justify-between" style={{ minHeight: "14px" }}>
          {progressPct > 0 && progressPct < 100 ? (
            <span className="text-[10px] tabular-nums text-muted-foreground">{progressPct}%</span>
          ) : progressPct >= 100 ? (
            <span className="text-[10px] font-medium text-green-600">{t("home.complete")}</span>
          ) : (
            <span className="inline-block rounded-full bg-primary/8 px-1.5 py-px text-[9px] font-medium text-primary">
              {t("home.new")}
            </span>
          )}

          {/* Format badge — subtle, right-aligned */}
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">
            {book.format || "epub"}
          </span>
        </div>
      </div>

      <ConfigGuideDialog type={configGuide} onClose={() => setConfigGuide(null)} />
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("library.deleteBookTitle", "删除这本书？")}</DialogTitle>
            <DialogDescription>
              {t(
                "library.deleteBookDescription",
                "你可以选择保留笔记和阅读统计，之后重新导入同一本书时会继续接上。",
              )}
            </DialogDescription>
          </DialogHeader>

          <label className="flex cursor-pointer items-start gap-3 px-1 py-1">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border"
              checked={preserveDataOnDelete}
              onChange={(e) => setPreserveDataOnDelete(e.target.checked)}
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                {t("library.preserveDeleteDataLabel", "保留笔记和阅读统计")}
              </div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {t(
                  "library.preserveDeleteDataHint",
                  "勾选后会从书架移除书籍文件，但保留笔记、高亮和阅读历史，重新导入时可恢复。",
                )}
              </div>
            </div>
          </label>

          <DialogFooter>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              onClick={() => setShowDeleteDialog(false)}
            >
              {t("common.cancel", "取消")}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
              onClick={async () => {
                suppressOpenUntilRef.current = Date.now() + 600;
                setShowDeleteDialog(false);
                // Close any open reader tabs BEFORE removing the book from store,
                // otherwise ReaderView will briefly render an error page.
                const matchingTabIds = useAppStore
                  .getState()
                  .tabs.filter((tab) => tab.bookId === book.id)
                  .map((tab) => tab.id);
                for (const tabId of matchingTabIds) {
                  closeAppTab(tabId);
                  closeReaderTab(tabId);
                }
                await removeBook(book.id, { preserveData: preserveDataOnDelete });
              }}
            >
              {t("common.remove", "删除")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showGroupPicker && (
        <GroupPickerPopover
          groups={groups}
          currentGroupId={book.groupId}
          onSelect={(groupId) => {
            if (groupId) {
              moveBookToGroup(book.id, groupId);
            } else {
              removeBookFromGroup(book.id);
            }
          }}
          onCreateGroup={async (name) => {
            const group = await addGroup(name);
            if (group) moveBookToGroup(book.id, group.id);
          }}
          onClose={() => setShowGroupPicker(false)}
        />
      )}
    </div>
  );
});
