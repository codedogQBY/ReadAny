import { CheckIcon, ClockIcon, DatabaseIcon, Loader2Icon, MoreVerticalIcon } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import { getPlatformService } from "@readany/core/services";
/**
 * BookCard — Touch-optimized book card matching Tauri mobile MobileBookCard exactly.
 * Cover (28:41), progress bar, vectorization overlay, tag badges, long-press action sheet.
 */
import type { Book } from "@readany/core/types";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Animated,
  Easing,
  Image,
  type LayoutRectangle,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BookCardActionSheet } from "./BookCardActionSheet";
import { makeStyles } from "./book-card-styles";

const AnimatedLoader = () => {
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, [spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Loader2Icon size={24} color="#fff" />
    </Animated.View>
  );
};

interface BookCardProps {
  book: Book;
  onOpen: (book: Book) => void;
  onDelete: (bookId: string, options?: { preserveData?: boolean }) => void;
  onManageTags?: (book: Book) => void;
  onVectorize?: (book: Book) => void;
  isVectorizing?: boolean;
  isQueued?: boolean;
  vectorProgress?: { status: string; processedChunks: number; totalChunks: number } | null;
  cardWidth?: number;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onSelect?: (book: Book) => void;
  onLongPress?: (book: Book) => void;
}

export const BookCard = memo(function BookCard({
  book,
  onOpen,
  onDelete,
  onManageTags,
  onVectorize,
  isVectorizing,
  isQueued,
  vectorProgress,
  cardWidth = 96,
  isSelectionMode = false,
  isSelected = false,
  onSelect,
  onLongPress,
}: BookCardProps) {
  const colors = useColors();
  const s = makeStyles(colors, cardWidth);
  const { t } = useTranslation();
  const [imageError, setImageError] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [actionAnchor, setActionAnchor] = useState<LayoutRectangle | null>(null);
  const [resolvedCoverUrl, setResolvedCoverUrl] = useState<string | undefined>(undefined);
  const coverRef = useRef<View>(null);
  const menuTriggerRef = useRef<View>(null);
  const suppressOpenUntilRef = useRef(0);

  // Resolve relative coverUrl to absolute path
  useEffect(() => {
    const raw = book.meta.coverUrl;
    if (!raw) {
      setResolvedCoverUrl(undefined);
      return;
    }
    if (raw.startsWith("http") || raw.startsWith("blob") || raw.startsWith("file")) {
      setResolvedCoverUrl(raw);
      return;
    }
    (async () => {
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, raw);
        setResolvedCoverUrl(absPath);
      } catch {
        setResolvedCoverUrl(undefined);
      }
    })();
  }, [book.meta.coverUrl]);

  const progressPct = Math.round(book.progress * 100);
  const hasCover = resolvedCoverUrl && !imageError;

  const vecPct = vectorProgress
    ? vectorProgress.totalChunks > 0
      ? Math.round((vectorProgress.processedChunks / vectorProgress.totalChunks) * 100)
      : 0
    : 0;

  const measureAnchor = useCallback(async () => {
    const measureNode = (node: View | null, fallbackToBottomRight = false) =>
      new Promise<LayoutRectangle | null>((resolve) => {
        if (!node || typeof node.measureInWindow !== "function") {
          resolve(null);
          return;
        }
        requestAnimationFrame(() => {
          node.measureInWindow((x, y, width, height) => {
            if (!width && !height) {
              resolve(null);
              return;
            }
            resolve(
              fallbackToBottomRight
                ? {
                    x: x + Math.max(0, width - 40),
                    y: y + Math.max(0, height - 40),
                    width: 40,
                    height: 40,
                  }
                : { x, y, width, height },
            );
          });
        });
      });

    return (await measureNode(menuTriggerRef.current)) ?? (await measureNode(coverRef.current, true));
  }, []);

  const openActions = useCallback(async () => {
    suppressOpenUntilRef.current = Date.now() + 700;
    const anchor = await measureAnchor();
    setActionAnchor(anchor);
    setShowActions(true);
  }, [measureAnchor]);

  return (
    <>
      <TouchableOpacity
        style={s.container}
        onPress={() => {
          if (isSelectionMode) {
            onSelect?.(book);
            return;
          }
          if (showActions || Date.now() < suppressOpenUntilRef.current) return;
          onOpen(book);
        }}
        onLongPress={() => {
          if (isSelectionMode) return;
          if (onLongPress) {
            onLongPress(book);
          } else {
            void openActions();
          }
        }}
        delayLongPress={500}
        activeOpacity={0.7}
      >
        {/* Cover — 28:41 aspect ratio */}
        <View ref={coverRef} style={s.coverWrap}>
          {/* Selection checkbox overlay */}
          {isSelectionMode && (
            <View style={{
              position: "absolute",
              top: 6,
              left: 6,
              zIndex: 20,
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: isSelected ? colors.primary : "rgba(0,0,0,0.4)",
              alignItems: "center",
              justifyContent: "center",
              borderWidth: isSelected ? 0 : 2,
              borderColor: "#fff",
            }}>
              {isSelected && <CheckIcon size={16} color="#fff" />}
            </View>
          )}
          {isSelectionMode && isSelected && (
            <View style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 10,
              backgroundColor: "rgba(0,0,0,0.15)",
              borderRadius: 8,
            }} />
          )}
          {resolvedCoverUrl && !imageError ? (
            <>
              <Image
                source={{ uri: resolvedCoverUrl }}
                style={s.coverImage}
                resizeMode="cover"
                onError={() => setImageError(true)}
              />
              {/* Book spine crease overlay — matches desktop .book-spine */}
              <View style={s.spineOverlay} pointerEvents="none">
                {/* Left edge dark line */}
                <View style={s.spineStrip1} />
                {/* Spine shadow dip */}
                <View style={s.spineStrip2} />
                {/* Highlight reflection */}
                <View style={s.spineStrip3} />
                {/* Transition bright */}
                <View style={s.spineStrip4} />
                {/* Crease dark */}
                <View style={s.spineStrip5} />
                {/* Deep fold */}
                <View style={s.spineStrip6} />
                {/* Subtle bright transition */}
                <View style={s.spineStrip7} />
                {/* Right edge subtle shadow */}
                <View style={s.spineEdgeRight} />
              </View>
              {/* Top highlight */}
              <View style={s.spineTopHighlight} pointerEvents="none" />
              {/* Bottom shadow */}
              <View style={s.spineBottomShadow} pointerEvents="none" />
            </>
          ) : (
            <View style={s.fallbackCover}>
              {/* Simulate gradient: stone-100 top half, stone-200 bottom half */}
              <View style={s.fallbackGradientTop} />
              <View style={s.fallbackGradientBottom} />
              <View style={s.fallbackContentOverlay}>
                <View style={s.fallbackTitleWrap}>
                  <Text style={s.fallbackTitle} numberOfLines={3}>
                    {book.meta.title}
                  </Text>
                </View>
                <View style={s.fallbackDivider} />
                {book.meta.author ? (
                  <View style={s.fallbackAuthorWrap}>
                    <Text style={s.fallbackAuthor} numberOfLines={1}>
                      {book.meta.author}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          )}

          {/* Progress bar */}
          {progressPct > 0 && progressPct < 100 && (
            <View style={s.progressBarBg}>
              <View style={[s.progressBarFill, { width: `${progressPct}%` }]} />
            </View>
          )}

          {/* Vectorization progress overlay */}
          {isVectorizing && (
            <View style={s.vecOverlay}>
              <AnimatedLoader />
              <Text style={s.vecOverlayText}>
                {vectorProgress?.status === "chunking"
                  ? `${vecPct}%`
                  : vectorProgress?.status === "embedding"
                    ? `${vecPct}%`
                    : vectorProgress?.status === "indexing"
                      ? t("home.vec_indexing")
                      : vectorProgress?.status === "completed"
                        ? "✓"
                        : vectorProgress?.status === "error"
                          ? "✗"
                          : t("home.vec_processing")}
              </Text>
            </View>
          )}

          {/* Queued overlay */}
          {isQueued && !isVectorizing && (
            <View style={s.queuedOverlay}>
              <ClockIcon size={20} color="#fff" />
              <Text style={s.queuedOverlayText}>{t("home.vec_queued", "排队中")}</Text>
            </View>
          )}

          {/* Remote status overlay (on-demand download) */}
          {book.syncStatus === "remote" && (
            <View style={s.remoteOverlay}>
              <Text style={s.remoteOverlayText}>{t("home.remote", "需下载")}</Text>
            </View>
          )}

          {/* Downloading status overlay */}
          {book.syncStatus === "downloading" && (
            <View style={s.downloadingOverlay}>
              <AnimatedLoader />
              <Text style={s.downloadingOverlayText}>{t("home.downloading", "下载中")}</Text>
            </View>
          )}

          {/* Vectorized badge */}
          {book.isVectorized && !isVectorizing && (
            <View style={s.vecBadge}>
              <DatabaseIcon size={8} color="#fff" />
              <Text style={s.vecBadgeText}>{t("home.vec_indexed", "已索引")}</Text>
            </View>
          )}

          <View ref={menuTriggerRef} style={s.moreButtonWrap} pointerEvents="box-none">
            <TouchableOpacity
              style={s.moreButton}
              activeOpacity={0.85}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => {
                suppressOpenUntilRef.current = Date.now() + 700;
                void openActions();
              }}
            >
              <MoreVerticalIcon size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Info below cover */}
        <View style={s.infoWrap}>
          <Text style={s.bookTitle} numberOfLines={1}>
            {book.meta.title}
          </Text>
          {book.meta.author ? (
            <Text style={s.bookAuthor} numberOfLines={1}>
              {book.meta.author}
            </Text>
          ) : null}

          {/* Tag badges */}
          {book.tags.length > 0 ? (
            <View style={s.tagsRow}>
              {book.tags.slice(0, 2).map((tag) => (
                <View key={tag} style={s.tagBadge}>
                  <Text style={s.tagText}>{tag}</Text>
                </View>
              ))}
              {book.tags.length > 2 && <Text style={s.tagOverflow}>+{book.tags.length - 2}</Text>}
            </View>
          ) : (
            <View style={s.tagsRow}>
              <View style={s.tagBadgeUncategorized}>
                <Text style={s.tagTextUncategorized}>{t("sidebar.uncategorized", "未分类")}</Text>
              </View>
            </View>
          )}

          {/* Status row */}
          <View style={s.statusRow}>
            {progressPct > 0 && progressPct < 100 ? (
              <Text style={s.progressText}>{progressPct}%</Text>
            ) : progressPct >= 100 ? (
              <Text style={s.completeText}>{t("home.complete", "已完成")}</Text>
            ) : (
              <View style={s.newBadge}>
                <Text style={s.newText}>{t("home.new", "新")}</Text>
              </View>
            )}
            <Text style={s.formatText}>{book.format || "epub"}</Text>
          </View>
        </View>
      </TouchableOpacity>

      <BookCardActionSheet
        visible={showActions}
        anchor={actionAnchor}
        book={book}
        onClose={() => {
          suppressOpenUntilRef.current = Date.now() + 300;
          setShowActions(false);
        }}
        onManageTags={onManageTags}
        onVectorize={onVectorize}
        onDelete={onDelete}
      />
    </>
  );
});
