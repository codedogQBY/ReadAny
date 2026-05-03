import {
  CheckIcon,
  EditIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useColors, fontSize, fontWeight, radius, withOpacity } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useCallback, useState } from "react";
import type { Book } from "@readany/core/types";

interface TagManagementSheetProps {
  visible: boolean;
  book: Book | null;
  allTags: string[];
  batchBookIds?: string[];
  onClose: () => void;
  onAddTag: (tag: string) => void;
  onAddTagToBook: (bookId: string, tag: string) => void;
  onRemoveTagFromBook: (bookId: string, tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onRenameTag: (oldTag: string, newTag: string) => void;
}

export function TagManagementSheet({
  visible,
  book,
  allTags,
  batchBookIds,
  onClose,
  onAddTag,
  onAddTagToBook,
  onRemoveTagFromBook,
  onRemoveTag,
  onRenameTag,
}: TagManagementSheetProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const s = makeStyles(colors);
  const layout = useResponsiveLayout();

  const [newTagInput, setNewTagInput] = useState("");
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const isBatch = batchBookIds && batchBookIds.length > 0;
  const targetBookIds = isBatch ? batchBookIds : book ? [book.id] : [];

  const handleCreateAndAssignTag = useCallback(() => {
    const trimmed = newTagInput.trim();
    if (!trimmed || targetBookIds.length === 0) return;
    onAddTag(trimmed);
    for (const id of targetBookIds) {
      onAddTagToBook(id, trimmed);
    }
    setNewTagInput("");
  }, [newTagInput, targetBookIds, onAddTag, onAddTagToBook]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={s.overlay} onPress={onClose} />
      <View
        style={[
          s.sheet,
          layout.isTablet && {
            width: "100%",
          },
        ]}
      >
        <View style={s.handle} />
        <Text style={s.title}>{t("home.manageTags", "管理标签")}</Text>

        <ScrollView style={s.list}>
          {allTags.length > 0 ? (
            allTags.map((tag) => {
              const hasTag = book?.tags.includes(tag) ?? false;
              const isEditing = editingTag === tag;
              return (
                <View key={tag} style={s.item}>
                  <TouchableOpacity
                    style={s.checkboxRow}
                    onPress={() => {
                      if (targetBookIds.length === 0) return;
                      if (isBatch) {
                        for (const id of targetBookIds) {
                          onAddTagToBook(id, tag);
                        }
                      } else if (book) {
                        if (hasTag) onRemoveTagFromBook(book.id, tag);
                        else onAddTagToBook(book.id, tag);
                      }
                    }}
                  >
                    <View style={[s.checkbox, hasTag && s.checkboxActive]}>
                      {hasTag && <CheckIcon size={12} color={colors.primaryForeground} />}
                    </View>
                    {isEditing ? (
                      <TextInput
                        style={s.editInput}
                        value={editingName}
                        onChangeText={setEditingName}
                        autoFocus
                        onSubmitEditing={() => {
                          const trimmed = editingName.trim();
                          if (trimmed && trimmed !== tag) {
                            onRenameTag(tag, trimmed);
                          }
                          setEditingTag(null);
                          setEditingName("");
                        }}
                        onBlur={() => {
                          setEditingTag(null);
                          setEditingName("");
                        }}
                        returnKeyType="done"
                      />
                    ) : (
                      <Text style={s.itemText}>{tag}</Text>
                    )}
                  </TouchableOpacity>
                  <View style={s.actionRow}>
                    <TouchableOpacity
                      style={s.actionBtn}
                      onPress={() => {
                        setEditingTag(tag);
                        setEditingName(tag);
                      }}
                    >
                      <EditIcon size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.actionBtn}
                      onPress={() => {
                        Alert.alert(
                          t("common.confirm", "确认"),
                          t("library.deleteTagConfirm", `确定删除标签"${tag}"？`),
                          [
                            { text: t("common.cancel", "取消"), style: "cancel" },
                            {
                              text: t("common.delete", "删除"),
                              style: "destructive",
                              onPress: () => onRemoveTag(tag),
                            },
                          ],
                        );
                      }}
                    >
                      <Trash2Icon size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          ) : (
            <Text style={s.empty}>{t("sidebar.noTags", "暂无标签")}</Text>
          )}

          {/* New tag input */}
          <View style={s.inputDivider} />
          <View style={s.inputRow}>
            <View style={s.inputWrap}>
              <PlusIcon size={16} color={colors.mutedForeground} />
              <TextInput
                style={s.input}
                placeholder={t("sidebar.tagPlaceholder", "输入标签名...")}
                placeholderTextColor={colors.mutedForeground}
                value={newTagInput}
                onChangeText={setNewTagInput}
                onSubmitEditing={handleCreateAndAssignTag}
                returnKeyType="done"
              />
              {newTagInput.length > 0 && (
                <TouchableOpacity onPress={() => setNewTagInput("")}>
                  <XIcon size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
            {newTagInput.trim().length > 0 && (
              <TouchableOpacity style={s.addBtn} onPress={handleCreateAndAssignTag}>
                <Text style={s.addText}>{t("common.add", "添加")}</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: 34,
      maxHeight: "70%",
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.muted,
      alignSelf: "center",
      marginTop: 12,
      marginBottom: 8,
    },
    title: {
      fontSize: fontSize.md,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      paddingHorizontal: 20,
      marginBottom: 8,
    },
    list: { paddingHorizontal: 8 },
    item: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radius.lg,
    },
    checkboxRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      flex: 1,
      minWidth: 0,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: withOpacity(colors.mutedForeground, 0.4),
      alignItems: "center",
      justifyContent: "center",
    },
    checkboxActive: { borderColor: colors.primary, backgroundColor: colors.primary },
    itemText: { fontSize: fontSize.sm, color: colors.foreground },
    editInput: {
      flex: 1,
      fontSize: fontSize.sm,
      color: colors.foreground,
      padding: 0,
      borderBottomWidth: 1,
      borderBottomColor: colors.primary,
    },
    actionRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    actionBtn: { padding: 6, borderRadius: radius.sm },
    empty: {
      textAlign: "center",
      paddingVertical: 16,
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    inputDivider: {
      height: 0.5,
      backgroundColor: colors.border,
      marginTop: 12,
      marginBottom: 12,
    },
    inputRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
    inputWrap: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      height: 36,
    },
    input: { flex: 1, fontSize: fontSize.sm, color: colors.foreground, padding: 0 },
    addBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    addText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
  });
