/**
 * ReaderNoteViewModal — modal for viewing and editing an existing highlight's note.
 */
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { CheckIcon, EditIcon, XIcon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { useAnnotationStore } from "@/stores";
import { useColors } from "@/styles/theme";
import { createSelectionNoteMutation } from "@readany/core/reader";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { makeStyles } from "./reader-styles";

export type NoteViewHighlight = {
  id: string;
  text: string;
  note?: string;
  cfi: string;
  color: string;
};

interface Props {
  highlight: NoteViewHighlight | null;
  editing: boolean;
  editContent: string;
  bookId: string;
  onClose: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onContentChange: (content: string) => void;
  onSave: (highlight: NoteViewHighlight, newNote: string | undefined) => void;
}

export function ReaderNoteViewModal({
  highlight,
  editing,
  editContent,
  bookId,
  onClose,
  onStartEdit,
  onCancelEdit,
  onContentChange,
  onSave,
}: Props) {
  const colors = useColors();
  const s = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const { t } = useTranslation();

  return (
    <Modal
      visible={!!highlight}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={s.noteViewOverlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <View
          style={[
            s.noteViewModal,
            { paddingBottom: insets.bottom || 16 },
            layout.isTablet && {
              width: "100%",
            },
          ]}
        >
          <View style={s.noteViewHeader}>
            <Text style={s.noteViewTitle}>{t("reader.viewNote", "查看笔记")}</Text>
            <TouchableOpacity style={s.noteViewCloseBtn} onPress={onClose}>
              <XIcon size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          {highlight && (
            <>
              <Text style={s.noteViewQuote} numberOfLines={3}>
                "{highlight.text}"
              </Text>
              {editing ? (
                <>
                  <View style={s.noteViewEditorContainer}>
                    <RichTextEditor
                      initialContent={editContent}
                      onChange={onContentChange}
                      placeholder={t("reader.notePlaceholder", "写下你的想法...")}
                      autoFocus
                    />
                  </View>
                  <View style={s.noteViewActions}>
                    <TouchableOpacity style={s.noteViewCancelBtn} onPress={onCancelEdit}>
                      <XIcon size={14} color={colors.mutedForeground} />
                      <Text style={s.noteViewCancelText}>{t("common.cancel", "取消")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.noteViewSaveBtn}
                      onPress={() => {
                        const mutation = createSelectionNoteMutation({
                          bookId,
                          cfi: highlight.cfi,
                          text: highlight.text,
                          note: editContent,
                          existingHighlight: highlight,
                        });
                        if (mutation.kind !== "update") {
                          onCancelEdit();
                          return;
                        }
                        const { updateHighlight } = useAnnotationStore.getState();
                        updateHighlight(mutation.id, mutation.updates);
                        onSave(highlight, mutation.updates.note);
                      }}
                    >
                      <CheckIcon size={14} color={colors.primaryForeground} />
                      <Text style={s.noteViewSaveText}>{t("common.save", "保存")}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <ScrollView style={s.noteViewBody} showsVerticalScrollIndicator={false}>
                    <MarkdownRenderer content={highlight.note || ""} />
                  </ScrollView>
                  <View style={s.noteViewActions}>
                    <TouchableOpacity style={s.noteViewEditBtn} onPress={onStartEdit}>
                      <EditIcon size={14} color={colors.primaryForeground} />
                      <Text style={s.noteViewEditText}>{t("common.edit", "编辑")}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
