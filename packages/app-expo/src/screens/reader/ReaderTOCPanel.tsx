/**
 * ReaderTOCPanel — bottom-sheet modal with two tabs: Table of Contents and Bookmarks.
 */
import {
  BookmarkFilledIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { type ThemeColors, fontSize, fontWeight, radius, useColors } from "@/styles/theme";
import { getFirstTocHref } from "@readany/core/reader";
import type { TOCItem } from "@readany/core/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  type ListRenderItemInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SCREEN_HEIGHT } from "./reader-constants";
import { ListIcon } from "./reader-icons";
import { makeStyles } from "./reader-styles";

export type Bookmark = {
  id: string;
  bookId: string;
  cfi: string;
  label?: string;
  chapterTitle?: string;
  createdAt: number;
};

interface Props {
  visible: boolean;
  activeTab: "toc" | "bookmarks";
  toc: TOCItem[];
  bookmarks: Bookmark[];
  currentChapter: string;
  currentHref?: string;
  onClose: () => void;
  onTabChange: (tab: "toc" | "bookmarks") => void;
  onSelectTocItem: (href: string) => void;
  onGoToBookmark: (cfi: string) => void;
  onDeleteBookmark: (id: string) => void;
}

export function ReaderTOCPanel({
  visible,
  activeTab,
  toc,
  bookmarks,
  currentChapter,
  currentHref,
  onClose,
  onTabChange,
  onSelectTocItem,
  onGoToBookmark,
  onDeleteBookmark,
}: Props) {
  const colors = useColors();
  const s = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const { t, i18n } = useTranslation();
  const listRef = useRef<FlatList<FlatTocItem>>(null);
  const tocS = useMemo(() => makeTocListStyles(colors), [colors]);
  const activeKeys = useMemo(
    () => findActiveTocKeys(toc, currentChapter, currentHref),
    [toc, currentChapter, currentHref],
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(activeKeys.ancestors));
  const rows = useMemo(
    () => flattenVisibleToc(toc, expandedIds, activeKeys.key),
    [toc, expandedIds, activeKeys.key],
  );
  const currentIndex = useMemo(
    () => rows.findIndex((item) => item.key === activeKeys.key),
    [rows, activeKeys.key],
  );

  useEffect(() => {
    if (!visible || activeTab !== "toc") return;
    setExpandedIds((current) => {
      let changed = false;
      const next = new Set(current);
      for (const key of activeKeys.ancestors) {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [activeKeys.ancestors, activeTab, visible]);

  useEffect(() => {
    if (!visible || activeTab !== "toc" || currentIndex < 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: currentIndex,
        animated: false,
        viewPosition: currentIndex > 2 ? 0.25 : 0,
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [activeTab, currentIndex, visible]);

  const toggleExpanded = useCallback((key: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const renderTocItem = useCallback(
    ({ item: row }: ListRenderItemInfo<FlatTocItem>) => {
      const targetHref = getFirstTocHref(row.item);
      const isCurrent = row.key === activeKeys.key;
      const handlePress = () => {
        if (targetHref) {
          onSelectTocItem(targetHref);
          return;
        }
        if (row.hasChildren) toggleExpanded(row.key);
      };

      return (
        <TouchableOpacity
          style={[tocS.item, { paddingLeft: 12 + row.level * 16 }, isCurrent && tocS.itemActive]}
          onPress={handlePress}
          activeOpacity={0.7}
        >
          {row.hasChildren ? (
            <TouchableOpacity
              style={tocS.expandBtn}
              onPress={() => toggleExpanded(row.key)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {row.expanded ? (
                <ChevronDownIcon size={14} color={colors.mutedForeground} />
              ) : (
                <ChevronRightIcon size={14} color={colors.mutedForeground} />
              )}
            </TouchableOpacity>
          ) : (
            <View style={tocS.expandPlaceholder} />
          )}
          <Text style={[tocS.itemText, isCurrent && tocS.itemTextActive]} numberOfLines={1}>
            {row.item.title}
          </Text>
        </TouchableOpacity>
      );
    },
    [
      activeKeys.key,
      colors.mutedForeground,
      onSelectTocItem,
      tocS.expandBtn,
      tocS.expandPlaceholder,
      tocS.item,
      tocS.itemActive,
      tocS.itemText,
      tocS.itemTextActive,
      toggleExpanded,
    ],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.modalBackdrop} onPress={onClose} />
      <View
        style={[
          s.bottomSheet,
          { maxHeight: SCREEN_HEIGHT * 0.7, paddingBottom: insets.bottom || 16 },
          layout.isTablet && {
            width: "100%",
          },
        ]}
      >
        <View style={s.sheetHeader}>
          <View style={s.tocTabBar}>
            <TouchableOpacity
              style={[s.tocTab, activeTab === "toc" && { backgroundColor: `${colors.primary}14` }]}
              onPress={() => onTabChange("toc")}
            >
              <ListIcon
                size={14}
                color={activeTab === "toc" ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[
                  s.tocTabText,
                  { color: activeTab === "toc" ? colors.primary : colors.mutedForeground },
                ]}
              >
                {t("reader.toc", "目录")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                s.tocTab,
                activeTab === "bookmarks" && { backgroundColor: `${colors.primary}14` },
              ]}
              onPress={() => onTabChange("bookmarks")}
            >
              {activeTab === "bookmarks" ? (
                <BookmarkFilledIcon size={14} color={colors.primary} />
              ) : (
                <BookmarkIcon size={14} color={colors.mutedForeground} />
              )}
              <Text
                style={[
                  s.tocTabText,
                  {
                    color: activeTab === "bookmarks" ? colors.primary : colors.mutedForeground,
                  },
                ]}
              >
                {t("bookmarks.title", "书签")}
                {bookmarks.length > 0 ? ` (${bookmarks.length})` : ""}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={onClose}>
            <XIcon size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {activeTab === "toc" ? (
          rows.length > 0 ? (
            <FlatList
              ref={listRef}
              data={rows}
              keyExtractor={(item) => item.key}
              renderItem={renderTocItem}
              style={s.sheetScroll}
              showsVerticalScrollIndicator={false}
              initialNumToRender={24}
              maxToRenderPerBatch={24}
              windowSize={9}
              removeClippedSubviews
              getItemLayout={(_, index) => ({
                length: TOC_ROW_HEIGHT,
                offset: TOC_ROW_HEIGHT * index,
                index,
              })}
              onScrollToIndexFailed={(info) => {
                listRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: false,
                });
                setTimeout(() => {
                  listRef.current?.scrollToIndex({
                    index: info.index,
                    animated: false,
                    viewPosition: info.index > 2 ? 0.25 : 0,
                  });
                }, 80);
              }}
            />
          ) : (
            <Text style={s.sheetEmpty}>{t("reader.noToc", "暂无目录信息")}</Text>
          )
        ) : bookmarks.length > 0 ? (
          <ScrollView showsVerticalScrollIndicator={false} style={s.sheetScroll}>
            {bookmarks.map((bm) => (
              <TouchableOpacity
                key={bm.id}
                style={s.bookmarkItem}
                onPress={() => onGoToBookmark(bm.cfi)}
                activeOpacity={0.6}
              >
                <BookmarkFilledIcon size={14} color={colors.primary} />
                <View style={s.bookmarkContent}>
                  <Text style={[s.bookmarkLabel, { color: colors.foreground }]} numberOfLines={1}>
                    {bm.chapterTitle || t("common.unnamed")}
                  </Text>
                  {bm.label ? (
                    <Text
                      style={[s.bookmarkSnippet, { color: colors.mutedForeground }]}
                      numberOfLines={2}
                    >
                      {bm.label}
                    </Text>
                  ) : null}
                  <Text style={[s.bookmarkDate, { color: colors.mutedForeground }]}>
                    {new Date(bm.createdAt).toLocaleDateString(i18n.language, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
                <TouchableOpacity
                  style={s.bookmarkDeleteBtn}
                  onPress={() => onDeleteBookmark(bm.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Trash2Icon size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : (
          <View style={s.notebookPlaceholder}>
            <BookmarkIcon size={32} color={`${colors.mutedForeground}60`} />
            <Text style={s.notebookPlaceholderText}>{t("bookmarks.empty", "暂无书签")}</Text>
            <Text style={[s.notebookPlaceholderText, { fontSize: fontSize.xs, opacity: 0.6 }]}>
              {t("bookmarks.emptyHint", "使用工具栏的书签按钮来标记页面")}
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const TOC_ROW_HEIGHT = 44;

type FlatTocItem = {
  key: string;
  item: TOCItem;
  level: number;
  hasChildren: boolean;
  expanded: boolean;
};

function normalizeHref(value?: string): string {
  const raw = value || "";
  try {
    return decodeURIComponent(raw).replace(/^\.\//, "").replace(/#.*$/, "").trim();
  } catch {
    return raw.replace(/^\.\//, "").replace(/#.*$/, "").trim();
  }
}

function tocItemKey(item: TOCItem, path: string): string {
  return item.id || item.href || `${path}:${item.title}`;
}

function tocMatches(item: TOCItem, currentChapter: string, currentHref?: string): boolean {
  const targetHref = normalizeHref(getFirstTocHref(item) || item.href);
  const activeHref = normalizeHref(currentHref);
  if (targetHref && activeHref && targetHref === activeHref) return true;
  return !!currentChapter && item.title === currentChapter;
}

function findActiveTocKeys(
  items: TOCItem[],
  currentChapter: string,
  currentHref?: string,
): { key: string | null; ancestors: string[] } {
  type ActiveTocKeys = { key: string | null; ancestors: string[] };
  const walk = (nodes: TOCItem[], ancestors: string[], pathPrefix: string): ActiveTocKeys => {
    for (let index = 0; index < nodes.length; index += 1) {
      const item = nodes[index];
      const path = `${pathPrefix}.${index}`;
      const key = tocItemKey(item, path);
      if (tocMatches(item, currentChapter, currentHref)) {
        return { key, ancestors };
      }
      const childMatch = walk(item.subitems ?? [], [...ancestors, key], path);
      if (childMatch.key) return childMatch;
    }
    return { key: null, ancestors: [] };
  };

  return walk(items, [], "toc");
}

function flattenVisibleToc(
  items: TOCItem[],
  expandedIds: Set<string>,
  activeKey: string | null,
): FlatTocItem[] {
  const rows: FlatTocItem[] = [];
  const walk = (nodes: TOCItem[], level: number, pathPrefix: string) => {
    for (let index = 0; index < nodes.length; index += 1) {
      const item = nodes[index];
      const path = `${pathPrefix}.${index}`;
      const key = tocItemKey(item, path);
      const hasChildren = (item.subitems?.length ?? 0) > 0;
      const expanded = hasChildren && (expandedIds.has(key) || key === activeKey);
      rows.push({ key, item, level, hasChildren, expanded });
      if (expanded && item.subitems) walk(item.subitems, level + 1, path);
    }
  };
  walk(items, 0, "toc");
  return rows;
}

const makeTocListStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    item: {
      height: TOC_ROW_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 8,
      paddingRight: 12,
      borderRadius: radius.lg,
    },
    itemActive: { backgroundColor: `${colors.primary}18` },
    expandBtn: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
    expandPlaceholder: { width: 20 },
    itemText: { fontSize: fontSize.sm, color: colors.foreground, flex: 1 },
    itemTextActive: { color: colors.primary, fontWeight: fontWeight.medium },
  });
