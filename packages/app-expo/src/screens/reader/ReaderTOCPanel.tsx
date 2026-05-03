/**
 * ReaderTOCPanel — bottom-sheet modal with two tabs: Table of Contents and Bookmarks.
 */
import {
  BookmarkFilledIcon,
  BookmarkIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useColors } from "@/styles/theme";
import { fontSize } from "@/styles/theme";
import type { TOCItem } from "@readany/core/types";
import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { ListIcon } from "./reader-icons";
import { makeStyles } from "./reader-styles";
import { TOCTreeItem } from "./TOCTreeItem";
import { SCREEN_HEIGHT } from "./reader-constants";

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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
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
              style={[
                s.tocTab,
                activeTab === "toc" && { backgroundColor: `${colors.primary}14` },
              ]}
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
                    color:
                      activeTab === "bookmarks" ? colors.primary : colors.mutedForeground,
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
          <ScrollView showsVerticalScrollIndicator={false} style={s.sheetScroll}>
            {toc.length > 0 ? (
              toc.map((item) => (
                <TOCTreeItem
                  key={item.id || item.href}
                  item={item}
                  level={0}
                  currentChapter={currentChapter}
                  onSelect={onSelectTocItem}
                />
              ))
            ) : (
              <Text style={s.sheetEmpty}>{t("reader.noToc", "暂无目录信息")}</Text>
            )}
          </ScrollView>
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
