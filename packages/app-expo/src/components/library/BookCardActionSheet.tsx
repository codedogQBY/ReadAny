import {
  CheckIcon,
  DatabaseIcon,
  FolderInputIcon,
  HashIcon,
  Trash2Icon,
} from "@/components/ui/Icon";
import { GroupPickerSheet } from "@/components/library/GroupPickerSheet";
import { useLibraryStore } from "@/stores/library-store";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useColors } from "@/styles/theme";
import type { Book } from "@readany/core/types";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type LayoutRectangle,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";

interface BookCardActionSheetProps {
  visible: boolean;
  anchor: LayoutRectangle | null;
  book: Book;
  onClose: () => void;
  onManageTags?: (book: Book) => void;
  onVectorize?: (book: Book) => void;
  onDelete: (bookId: string, options?: { preserveData?: boolean }) => void;
}

export function BookCardActionSheet({
  visible,
  anchor,
  book,
  onClose,
  onManageTags,
  onVectorize,
  onDelete,
}: BookCardActionSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { t } = useTranslation();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [preserveDataOnDelete, setPreserveDataOnDelete] = useState(true);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const groups = useLibraryStore((state) => state.groups);
  const moveBookToGroup = useLibraryStore((state) => state.moveBookToGroup);
  const removeBookFromGroup = useLibraryStore((state) => state.removeBookFromGroup);
  const addGroup = useLibraryStore((state) => state.addGroup);

  const handleMoveGroup = () => {
    onClose();
    setShowGroupPicker(true);
  };

  const items = [
    {
      key: "group",
      icon: <FolderInputIcon size={18} color={colors.foreground} />,
      label: book.groupId
        ? t("library.changeGroup", "更换分组")
        : t("library.moveToGroup", "移入分组"),
      onPress: handleMoveGroup,
    },
    onManageTags
      ? {
          key: "tags",
          icon: <HashIcon size={18} color={colors.foreground} />,
          label: t("home.manageTags", "管理标签"),
          onPress: () => {
            onClose();
            onManageTags(book);
          },
        }
      : null,
    onVectorize
      ? {
          key: "vectorize",
          icon: <DatabaseIcon size={18} color={colors.foreground} />,
          label: book.isVectorized
            ? t("home.vec_reindex", "重新索引")
            : t("home.vec_vectorize", "向量化"),
          onPress: () => {
            onClose();
            onVectorize(book);
          },
        }
      : null,
    {
      key: "delete",
      icon: <Trash2Icon size={18} color={colors.destructive} />,
      label: t("common.remove", "删除"),
      destructive: true,
      onPress: () => {
        onClose();
        setPreserveDataOnDelete(true);
        setShowDeleteConfirm(true);
      },
    },
  ].filter(Boolean) as Array<{
    key: string;
    icon: ReactNode;
    label: string;
    destructive?: boolean;
    onPress: () => void;
  }>;

  const menuWidth = 188;
  const rowHeight = 48;
  const menuHeight = items.length * rowHeight + 12;
  const safePadding = 12;
  const fallbackX = Math.max(safePadding, screenWidth - menuWidth - safePadding);
  const fallbackY = Math.max(
    80,
    Math.min(screenHeight / 2 - menuHeight / 2, screenHeight - menuHeight - 80),
  );

  const menuLeft = anchor
    ? Math.min(
        Math.max(anchor.x + anchor.width - menuWidth, safePadding),
        screenWidth - menuWidth - safePadding,
      )
    : fallbackX;
  const preferredTop = anchor ? anchor.y + anchor.height + 8 : fallbackY;
  const menuTop = anchor
    ? preferredTop + menuHeight <= screenHeight - safePadding
      ? preferredTop
      : Math.max(safePadding, anchor.y - menuHeight - 8)
    : fallbackY;

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable
            style={[styles.menu, { left: menuLeft, top: menuTop, width: menuWidth }]}
            onPress={() => {}}
          >
            {items.map((item, index) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.item, index < items.length - 1 && styles.itemDivider]}
                activeOpacity={0.85}
                onPress={item.onPress}
              >
                <View style={styles.itemIcon}>{item.icon}</View>
                <Text style={item.destructive ? styles.itemTextDestructive : styles.itemText}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteConfirm(false)}
      >
        <Pressable style={styles.confirmOverlay} onPress={() => setShowDeleteConfirm(false)}>
          <Pressable style={styles.confirmCard} onPress={() => {}}>
            <Text style={styles.confirmTitle}>{t("library.deleteBookTitle", "删除这本书？")}</Text>
            <Text style={styles.confirmDescription}>
              {t(
                "library.deleteBookDescription",
                "你可以选择保留笔记和阅读统计，之后重新导入同一本书时会继续接上。",
              )}
            </Text>

            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.checkboxRow}
              onPress={() => setPreserveDataOnDelete((value) => !value)}
            >
              <View style={[styles.checkbox, preserveDataOnDelete && styles.checkboxActive]}>
                {preserveDataOnDelete ? (
                  <CheckIcon size={12} color={colors.primaryForeground} />
                ) : null}
              </View>
              <View style={styles.checkboxContent}>
                <Text style={styles.checkboxLabel}>
                  {t("library.preserveDeleteDataLabel", "保留笔记和阅读统计")}
                </Text>
                <Text style={styles.checkboxHint}>
                  {t(
                    "library.preserveDeleteDataHint",
                    "勾选后会从书架移除书籍文件，但保留笔记、高亮和阅读历史，重新导入时可恢复。",
                  )}
                </Text>
              </View>
            </TouchableOpacity>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={styles.confirmSecondary}
                onPress={() => setShowDeleteConfirm(false)}
              >
                <Text style={styles.confirmSecondaryText}>{t("common.cancel", "取消")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmDanger}
                onPress={() => {
                  setShowDeleteConfirm(false);
                  onDelete(book.id, { preserveData: preserveDataOnDelete });
                }}
              >
                <Text style={styles.confirmDangerText}>{t("common.remove", "删除")}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <GroupPickerSheet
        visible={showGroupPicker}
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
    </>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.12)",
    },
    menu: {
      position: "absolute",
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.18,
      shadowRadius: 18,
      elevation: 14,
      overflow: "hidden",
      paddingVertical: 6,
    },
    item: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
    },
    itemDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    itemIcon: {
      width: 22,
      alignItems: "center",
      justifyContent: "center",
    },
    itemText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    itemTextDestructive: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.destructive,
    },
    confirmOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.32)",
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
    },
    confirmCard: {
      width: "100%",
      maxWidth: 360,
      backgroundColor: colors.card,
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xl,
      gap: spacing.md,
    },
    confirmTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    confirmDescription: {
      fontSize: fontSize.sm,
      lineHeight: 20,
      color: colors.mutedForeground,
    },
    checkboxRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      paddingVertical: 4,
      paddingHorizontal: 2,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: colors.mutedForeground,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    checkboxActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    checkboxContent: {
      flex: 1,
      gap: 4,
    },
    checkboxLabel: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    checkboxHint: {
      fontSize: fontSize.xs,
      lineHeight: 18,
      color: colors.mutedForeground,
    },
    confirmActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 10,
    },
    confirmSecondary: {
      minWidth: 92,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 11,
      backgroundColor: colors.background,
    },
    confirmSecondaryText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    confirmDanger: {
      minWidth: 92,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      paddingHorizontal: 16,
      paddingVertical: 11,
      backgroundColor: colors.destructive,
    },
    confirmDangerText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.destructiveForeground,
    },
  });
