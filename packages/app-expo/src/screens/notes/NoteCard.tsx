import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { CheckIcon, EditIcon, Trash2Icon, XIcon } from "@/components/ui/Icon";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { useColors } from "@/styles/theme";
import type { HighlightWithBook } from "@readany/core/db/database";
import { HIGHLIGHT_COLOR_HEX } from "@readany/core/types";
import type { TFunction } from "i18next";
import { KeyboardAvoidingView, Platform, Text, TouchableOpacity, View } from "react-native";
import { makeStyles } from "./notes-styles";

export function NoteCard({
  highlight,
  isEditing,
  editNote,
  setEditNote,
  onStartEdit,
  onSaveNote,
  onCancelEdit,
  onDeleteNote,
  onNavigate,
  t,
}: {
  highlight: HighlightWithBook;
  isEditing: boolean;
  editNote: string;
  setEditNote: (note: string) => void;
  onStartEdit: () => void;
  onSaveNote: () => void;
  onCancelEdit: () => void;
  onDeleteNote: () => void;
  onNavigate: () => void;
  t: TFunction;
}) {
  const colors = useColors();
  const s = makeStyles(colors);

  return (
    <View style={s.noteCard}>
      <TouchableOpacity style={s.noteCardTop} onPress={onNavigate}>
        <View
          style={[
            s.colorDot,
            { backgroundColor: HIGHLIGHT_COLOR_HEX[highlight.color] || colors.amber },
          ]}
        />
        <Text style={s.noteQuote} numberOfLines={2}>
          "{highlight.text}"
        </Text>
      </TouchableOpacity>

      {isEditing ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={s.editArea}
        >
          <View style={s.editorContainer}>
            <RichTextEditor
              tier="inline_note"
              initialContent={editNote}
              onChange={setEditNote}
              placeholder={t("notebook.addNote", "添加笔记...")}
              autoFocus
            />
          </View>
          <View style={s.editActions}>
            <TouchableOpacity style={s.editCancelBtn} onPress={onCancelEdit}>
              <XIcon size={14} color={colors.mutedForeground} />
              <Text style={s.editCancelText}>{t("common.cancel", "取消")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.editSaveBtn} onPress={onSaveNote}>
              <CheckIcon size={14} color={colors.primaryForeground} />
              <Text style={s.editSaveText}>{t("common.save", "保存")}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <>
          {highlight.note && (
            <TouchableOpacity style={s.noteBody} onPress={onNavigate}>
              <MarkdownRenderer content={highlight.note} />
            </TouchableOpacity>
          )}
          <View style={s.noteActions}>
            <TouchableOpacity style={s.noteActionBtn} onPress={onStartEdit}>
              <EditIcon size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity style={s.noteActionBtn} onPress={onDeleteNote}>
              <Trash2Icon size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}
