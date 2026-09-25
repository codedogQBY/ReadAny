/**
 * PageNoteModal — 在「当前位置」新建页级笔记。
 *
 * 对应桌面端 NotebookPanel 头部的「+」按钮（notebook.addPageNote）：
 * 固定版式（PDF/CBZ）没有可选中文本，选中→高亮→笔记那条链路用不了，
 * 所以提供这个锚定当前页的入口：落库时 text 为空（即页级笔记），页码由 CFI 反推。
 */
import { XIcon } from "@/components/ui/Icon";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { fontSize, fontWeight, radius, spacing, useColors } from "@/styles/theme";
import { pageNoteLabel } from "@readany/core/reader";
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

interface Props {
  visible: boolean;
  /** 当前位置的 CFI（页级笔记的锚点） */
  cfi: string;
  chapterTitle?: string;
  content: string;
  onContentChange: (content: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function PageNoteModal({
  visible,
  cfi,
  chapterTitle,
  content,
  onContentChange,
  onCancel,
  onSave,
}: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const s = makeStyles(colors);
  // 与桌面一致：页级笔记必须写点内容才能保存（否则只是一条空记录）
  const canSave = content.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>{t("notebook.addPageNote", "添加页级笔记")}</Text>
            <TouchableOpacity style={s.closeBtn} onPress={onCancel}>
              <XIcon size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* 位置预览：页级笔记没有引用文本，用页码标签（与列表标题同一套文案） */}
          <Text style={s.preview} numberOfLines={1}>
            {pageNoteLabel(cfi, t)}
          </Text>
          {chapterTitle ? (
            <Text style={s.chapter} numberOfLines={1}>
              {chapterTitle}
            </Text>
          ) : null}

          <View style={s.editorContainer}>
            <RichTextEditor
              initialContent={content}
              onChange={onContentChange}
              placeholder={t("reader.notePlaceholder", "写下你的想法...")}
              autoFocus
            />
          </View>

          <View style={s.actions}>
            <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
              <Text style={s.cancelText}>{t("common.cancel", "取消")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
              onPress={onSave}
              disabled={!canSave}
            >
              <Text style={s.saveText}>{t("common.save", "保存")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.md,
      paddingBottom: spacing.lg,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.sm,
    },
    title: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.foreground },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.muted,
    },
    preview: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      fontStyle: "italic",
      paddingHorizontal: 8,
    },
    chapter: { fontSize: fontSize.xs, color: colors.mutedForeground, paddingHorizontal: 8, marginTop: 2 },
    editorContainer: {
      height: 180,
      marginTop: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: spacing.md },
    cancelBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.md,
      backgroundColor: colors.muted,
    },
    cancelText: { fontSize: fontSize.sm, color: colors.foreground },
    saveBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    saveBtnDisabled: { opacity: 0.5 },
    saveText: { fontSize: fontSize.sm, color: colors.primaryForeground, fontWeight: fontWeight.medium },
  });
}
