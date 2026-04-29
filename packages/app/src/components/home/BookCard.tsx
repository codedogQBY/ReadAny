import { ConfigGuideDialog, type ConfigGuideType } from "@/components/shared/ConfigGuideDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useResolvedSrc } from "@/hooks/use-resolved-src";
import { bookMiniReviewService, type MiniReviewType } from "@/lib/book-mini-review";
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
  Hash,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface BookCardProps {
  book: Book;
}

export const BookCard = memo(function BookCard({ book }: BookCardProps) {
  const { t } = useTranslation();
  const removeBook = useLibraryStore((s) => s.removeBook);
  const closeAppTab = useAppStore((s) => s.removeTab);
  const closeReaderTab = useReaderStore((s) => s.removeTab);
  const allTags = useLibraryStore((s) => s.allTags);
  const addTagToBook = useLibraryStore((s) => s.addTagToBook);
  const removeTagFromBook = useLibraryStore((s) => s.removeTagFromBook);
  const addTag = useLibraryStore((s) => s.addTag);
  const hasVectorCapability = useVectorModelStore((s) => s.hasVectorCapability);
  const [showMenu, setShowMenu] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [currentReviewType, setCurrentReviewType] = useState<MiniReviewType>(() => {
    // 初始化时从服务获取默认类型
    return bookMiniReviewService.getDefaultType();
  });
  const [newTagInput, setNewTagInput] = useState("");
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [vectorizing, setVectorizing] = useState(false);
  const [vectorProgress, setVectorProgress] = useState<VectorizeProgress | null>(null);
  const [configGuide, setConfigGuide] = useState<ConfigGuideType>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [preserveDataOnDelete, setPreserveDataOnDelete] = useState(true);
  const [miniReview, setMiniReview] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const coverRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const suppressOpenUntilRef = useRef(0);
  const progressPct = Math.round(book.progress * 100);
  const coverSrc = useResolvedSrc(book.meta.coverUrl);

  const handleOpen = async () => {
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
    [book.id, book.filePath, vectorizing],
  );

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageLoaded(false);
    setImageError(true);
  };

  // Load cached mini review on mount, and poll for auto-generated updates
  useEffect(() => {
    console.log('[BookCard] Loading review for book:', book.id, 'type:', currentReviewType);
    
    // 先尝试从缓存加载
    const cached = bookMiniReviewService.getReview(book.id, currentReviewType);
    if (cached) {
      console.log('[BookCard] Found cached review:', cached.content.substring(0, 50));
      setMiniReview(cached.content);
      return;
    }
    
    // 如果已经有微评或正在加载，不重复生成
    if (miniReview || reviewLoading) {
      console.log('[BookCard] Skip generation - already has review or loading');
      return;
    }
    
    // 禁用缓存，直接生成微评
    let cancelled = false;
    
    const generateIfNeeded = async () => {
      console.log('[BookCard] Generating review (no cache)');
      setReviewLoading(true);
      
      // 最多重试2次，减少等待时间
      let retries = 0;
      const maxRetries = 2;
      
      while (retries <= maxRetries && !cancelled) {
        try {
          const review = await bookMiniReviewService.generateReview(book, { 
            type: currentReviewType,
            timeout: 15000, // 增加到15秒，给AI更多响应时间
          });
          if (review && !cancelled) {
            setMiniReview(review.content);
            console.log('[BookCard] Review generated:', review.content.substring(0, 50));
            setReviewLoading(false);
            return; // 成功则退出
          } else if (!review && !cancelled) {
            // 返回null表示字数不符合或超时，需要重新生成
            console.log('[BookCard] Review length invalid or timeout, retrying...');
          }
        } catch (err) {
          if (!cancelled) {
            console.error(`[BookCard] Failed to generate review (attempt ${retries + 1}):`, err);
          }
        }
        
        retries++;
        if (retries <= maxRetries && !cancelled) {
          console.log(`[BookCard] Retrying... (${retries}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // 增加到1秒后重试
        }
      }
      
      // 所有重试都失败
      if (!cancelled) {
        console.error('[BookCard] All retry attempts failed');
        setReviewLoading(false);
        setMiniReview('微评生成失败，请点击刷新重试');
      }
    };

    generateIfNeeded();
    
    return () => {
      cancelled = true;
      console.log('[BookCard] Cleanup - cancelled generation');
    };
  }, [book.id, currentReviewType]);

  const handleGenerateReview = useCallback(async (e: React.MouseEvent, type?: MiniReviewType) => {
    e.stopPropagation();
    suppressOpenUntilRef.current = Date.now() + 400;
    setReviewLoading(true);
    const reviewType = type || currentReviewType;
    
    // 最多重试2次
    let retries = 0;
    const maxRetries = 2;
    
    while (retries <= maxRetries) {
      try {
        const review = await bookMiniReviewService.generateReview(book, { 
          type: reviewType,
          timeout: 15000, // 增加到15秒
          forceRefresh: true, // 强制刷新，不使用缓存
        });
        if (review) {
          setMiniReview(review.content);
          setCurrentReviewType(reviewType);
          setReviewLoading(false);
          return; // 成功则退出
        }
      } catch {
        console.error(`[BookCard] Failed to generate review (attempt ${retries + 1})`);
      }
      
      retries++;
      if (retries <= maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 增加到1秒
      }
    }
    
    // 所有重试都失败
    setReviewLoading(false);
    setMiniReview('微评生成失败，请再次点击重试');
  }, [book, currentReviewType]);

  const handleRefreshReview = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    suppressOpenUntilRef.current = Date.now() + 400;
    setReviewLoading(true);
    
    // 最多重试2次
    let retries = 0;
    const maxRetries = 2;
    
    while (retries <= maxRetries) {
      try {
        const review = await bookMiniReviewService.refreshReview(book, { 
          type: currentReviewType,
          forceRefresh: true, // 强制刷新
        });
        if (review) {
          setMiniReview(review.content);
          setReviewLoading(false);
          return; // 成功则退出
        }
      } catch {
        console.error(`[BookCard] Failed to refresh review (attempt ${retries + 1})`);
      }
      
      retries++;
      if (retries <= maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 增加到1秒
      }
    }
    
    // 所有重试都失败
    setReviewLoading(false);
    setMiniReview('微评刷新失败，请再次点击重试');
  }, [book, currentReviewType]);

  const handleTypeChange = useCallback(async (e: React.MouseEvent, type: MiniReviewType) => {
    e.stopPropagation();
    suppressOpenUntilRef.current = Date.now() + 300;
    setCurrentReviewType(type);
    setShowTypeSelector(false);
    
    // 加载新类型的微评,如果没有则自动生成
    const review = bookMiniReviewService.getReview(book.id, type);
    if (review) {
      setMiniReview(review.content);
    } else {
      // 自动生成新类型的微评
      setReviewLoading(true);
      
      // 最多重试2次
      let retries = 0;
      const maxRetries = 2;
      
      while (retries <= maxRetries) {
        try {
          const newReview = await bookMiniReviewService.generateReview(book, { type });
          if (newReview) {
            setMiniReview(newReview.content);
            setReviewLoading(false);
            return; // 成功则退出
          }
        } catch {
          console.error(`[BookCard] Failed to generate review for type ${type} (attempt ${retries + 1})`);
        }
        
        retries++;
        if (retries <= maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 增加到1秒
        }
      }
      
      // 所有重试都失败
      setReviewLoading(false);
      setMiniReview('微评生成失败，请再次点击重试');
    }
  }, [book.id]);

  const hasCover = coverSrc && !imageError;

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
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {/* Cover area — 28:41 aspect ratio (Readest standard) */}
      <div
        ref={coverRef}
        className="book-cover-shadow relative flex aspect-[28/41] w-full items-end justify-center overflow-hidden rounded transition-all duration-200 group-hover:book-cover-shadow"
      >
        {/* Actual cover image */}
        {coverSrc && (
          <img
            src={coverSrc}
            alt={book.meta.title}
            className={`absolute inset-0 h-full w-full rounded object-cover transition-opacity duration-300 ${
              imageLoaded && !imageError ? "opacity-100" : "opacity-0"
            }`}
            loading="lazy"
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        )}

        {/* Book spine overlay — only when image loaded */}
        {imageLoaded && !imageError && <div className="book-spine absolute inset-0 rounded" />}

        {/* Fallback cover — serif title + author */}
        {!hasCover && (
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
              if (e.key === "Escape") {
                e.stopPropagation();
                setShowMenu(false);
                setShowTagMenu(false);
                setMenuPos(null);
              }
            }}
            role="button"
            tabIndex={0}
          />
          <div
            className="fixed z-50 min-w-36 rounded-lg border bg-popover p-1 shadow-lg"
            style={{ bottom: window.innerHeight - menuPos.y + 4, left: menuPos.x - 152 }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="menu"
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
            {/* Mini review button */}
            <button
              type="button"
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                reviewLoading
                  ? "text-muted-foreground opacity-50 cursor-not-allowed"
                  : "text-foreground hover:bg-muted"
              }`}
              disabled={reviewLoading}
              onClick={miniReview ? handleRefreshReview : handleGenerateReview}
            >
              {reviewLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : miniReview ? (
                <RefreshCw className="h-3.5 w-3.5" />
              ) : (
                <span className="h-3.5 w-3.5 flex items-center justify-center text-[10px]">✨</span>
              )}
              {miniReview ? t("home.refreshReview", "刷新微评") : t("home.generateReview", "生成微评")}
            </button>
            {/* Mini review type selector */}
            <div className="relative">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  suppressOpenUntilRef.current = Date.now() + 300;
                  setShowTypeSelector(!showTypeSelector);
                }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t("home.reviewType", "微评类型")}
                <ChevronRight className="ml-auto h-3 w-3" />
              </button>
              {showTypeSelector && (
                <div
                  className="absolute right-full top-0 z-50 mr-1 min-w-40 rounded-lg border bg-popover p-1 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="menu"
                >
                  {[
                    { type: "hook" as const, label: "钩子式", desc: "颠覆认知" },
                    { type: "question" as const, label: "问题式", desc: "引发思考" },
                    { type: "resonance" as const, label: "共鸣式", desc: "情感共鸣" },
                    { type: "anecdote" as const, label: "作者轶事", desc: "有趣背景" },
                  ].map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-xs hover:bg-muted ${
                        currentReviewType === item.type ? "bg-muted" : ""
                      }`}
                      onClick={(e) => handleTypeChange(e, item.type)}
                    >
                      <div className="font-medium">{item.label}</div>
                      <div className="text-[10px] text-muted-foreground">{item.desc}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
                  role="menu"
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

      {/* Info area — fixed height to keep cards aligned */}
      <div className="flex w-full flex-col pt-2" style={{ minHeight: "72px" }}>
        <h4 className="truncate text-xs font-semibold leading-tight text-foreground">
          {book.meta.title}
        </h4>
        {book.meta.author && (
          <p className="truncate text-[10px] leading-tight text-muted-foreground">
            {book.meta.author}
          </p>
        )}

        {/* Mini review — fixed 4-line area, always reserves space */}
        <div className="mt-0.5 relative" style={{ minHeight: "36px", maxHeight: "4.5em", overflow: "hidden" }}>
          {miniReview ? (
            <div
              className="flex w-full items-start gap-0.5 text-left text-[9px] leading-tight text-muted-foreground/70"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: '1.125',
              }}
            >
              <span className="shrink-0">✨</span>
              <span>{miniReview}</span>
            </div>
          ) : reviewLoading ? (
            <div className="flex items-center gap-1 text-[9px] text-muted-foreground/50">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              <span>{t("home.generatingReview", "生成微评中…")}</span>
            </div>
          ) : null}
        </div>

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
    </div>
  );
});
