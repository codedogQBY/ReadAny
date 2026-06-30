import {
  CopyIcon,
  HighlighterIcon,
  LanguagesIcon,
  NotebookPenIcon,
  SparklesIcon,
  Trash2Icon,
  Volume2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import type { SelectionEvent } from "@/hooks/use-reader-bridge";
import { radius, spacing, useColors, withOpacity } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_HEX } from "@readany/core/types";
import type { HighlightColor } from "@readany/core/types";
import * as Clipboard from "expo-clipboard";
/**
 * SelectionPopover — floating action bar shown when text is selected in the reader.
 * Provides highlight (5 colors), note, copy, translate, AI chat, TTS, and delete actions.
 * Matches app-mobile styling with icon buttons and expandable color picker.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const POPOVER_MARGIN = 8;
const POPOVER_PADDING = 4;
const BUTTON_SIZE = 36;
const COLOR_DOT_SIZE = 28;
const COLOR_REMOVE_BUTTON_SIZE = 28;
const COLOR_ROW_GAP = 6;
const COLOR_ROW_PADDING_X = 8;
const COLOR_ROW_DIVIDER_WIDTH = 1;
const GAP = 2;
const SAFE_TOP = 14;
const SAFE_BOTTOM = 20;
const SELECTION_POPOVER_ABOVE_OFFSET = 14;
const SELECTION_POPOVER_BELOW_OFFSET = 6;

interface Props {
  selection: SelectionEvent;
  onHighlight: (color: HighlightColor) => void;
  onDismiss: () => void;
  onCopy: () => void;
  onAIChat: () => void;
  onSpeak?: (text: string, cfi: string) => void;
  onNote?: (text: string, cfi: string) => void;
  onTranslate?: (text: string) => void;
  onRemoveHighlight?: () => void;
  existingHighlight?: { id: string; color: HighlightColor; note?: string } | null;
  defaultColor?: HighlightColor;
}

export function SelectionPopover({
  selection,
  onHighlight,
  onDismiss,
  onCopy,
  onAIChat,
  onSpeak,
  onNote,
  onTranslate,
  onRemoveHighlight,
  existingHighlight,
  defaultColor = "yellow",
}: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showColors, setShowColors] = useState(true);
  const [noteContent, setNoteContent] = useState(existingHighlight?.note || "");
  const existingHighlightNote = existingHighlight?.note || "";
  const hasExistingHighlight = !!existingHighlight;
  const canRemoveHighlight = hasExistingHighlight && !!onRemoveHighlight;
  const activeHighlightColor = existingHighlight?.color ?? defaultColor;
  const previousSelectionCfiRef = useRef(selection.cfi);

  useEffect(() => {
    setNoteContent(existingHighlightNote);
  }, [existingHighlightNote]);

  useEffect(() => {
    if (previousSelectionCfiRef.current !== selection.cfi || hasExistingHighlight) {
      previousSelectionCfiRef.current = selection.cfi;
      setShowColors(true);
    }
  }, [selection.cfi, hasExistingHighlight]);

  const buttonCount =
    4 +
    (onNote ? 1 : 0) +
    (onTranslate ? 1 : 0) +
    (onSpeak ? 1 : 0);
  const colorRowItemCount = HIGHLIGHT_COLORS.length + (canRemoveHighlight ? 2 : 0);
  const colorRowWidth = showColors
    ? HIGHLIGHT_COLORS.length * COLOR_DOT_SIZE +
      (canRemoveHighlight ? COLOR_ROW_DIVIDER_WIDTH + COLOR_REMOVE_BUTTON_SIZE : 0) +
      Math.max(0, colorRowItemCount - 1) * COLOR_ROW_GAP +
      COLOR_ROW_PADDING_X * 2
    : 0;
  const actionRowWidth = buttonCount * (BUTTON_SIZE + GAP) + POPOVER_PADDING * 2;
  const colorRowHeight = showColors ? 40 : 0;
  const actionRowHeight = 44;
  const popoverHeight =
    actionRowHeight +
    colorRowHeight +
    POPOVER_PADDING * 2 +
    (showColors && actionRowHeight ? GAP : 0);
  const popoverWidth = Math.min(
    Math.max(actionRowWidth, colorRowWidth + POPOVER_PADDING * 2),
    SCREEN_WIDTH - POPOVER_MARGIN * 2,
  );

  const position = useMemo(() => {
    const selTop = selection.position.selectionTop;
    const selBottom = selection.position.selectionBottom;
    const selCenterX = selection.position.x;

    const x = Math.max(
      POPOVER_MARGIN,
      Math.min(selCenterX - popoverWidth / 2, SCREEN_WIDTH - popoverWidth - POPOVER_MARGIN),
    );

    let y: number;
    const yAbove = selTop - popoverHeight + SELECTION_POPOVER_ABOVE_OFFSET;
    const yBelow = selBottom + SELECTION_POPOVER_BELOW_OFFSET;
    const aboveValid = yAbove >= SAFE_TOP;
    const belowValid = yBelow + popoverHeight + POPOVER_MARGIN <= SCREEN_HEIGHT - SAFE_BOTTOM;

    if (aboveValid) {
      y = yAbove;
    } else if (belowValid) {
      y = yBelow;
    } else {
      y = Math.max(SAFE_TOP, Math.min(yBelow, SCREEN_HEIGHT - popoverHeight - POPOVER_MARGIN));
    }

    return { x, y };
  }, [selection.position, popoverWidth, popoverHeight]);

  const handleCopy = useCallback(() => {
    Clipboard.setStringAsync(selection.text);
    onCopy();
  }, [selection.text, onCopy]);

  const handleSpeak = useCallback(() => {
    const text = selection.text.trim();
    if (text && onSpeak) {
      onSpeak(text, selection.cfi);
    }
    onDismiss();
  }, [selection.text, selection.cfi, onSpeak, onDismiss]);

  const handleNote = useCallback(() => {
    setShowNoteModal(true);
  }, []);

  const handleSaveNote = useCallback(() => {
    if (onNote) {
      onNote(noteContent, selection.cfi);
    }
    setShowNoteModal(false);
    onDismiss();
  }, [noteContent, selection.cfi, onNote, onDismiss]);

  const handleTranslate = useCallback(() => {
    if (onTranslate) {
      onTranslate(selection.text);
    }
    onDismiss();
  }, [selection.text, onTranslate, onDismiss]);

  const handleRemove = useCallback(() => {
    if (onRemoveHighlight) {
      onRemoveHighlight();
    }
    onDismiss();
  }, [onRemoveHighlight, onDismiss]);

  const handleHighlightPress = useCallback(() => {
    if (hasExistingHighlight) {
      setShowColors((prev) => !prev);
      return;
    }

    if (showColors) {
      onHighlight(defaultColor);
      return;
    }

    setShowColors(true);
  }, [defaultColor, hasExistingHighlight, onHighlight, showColors]);

  return (
    <View style={[s.overlay]} pointerEvents="box-none">
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onDismiss} />
      <View style={[s.popover, { left: position.x, top: position.y }]}>
        {showColors && (
          <View style={[s.colorRow, !hasExistingHighlight && s.colorRowWithActions]}>
            {HIGHLIGHT_COLORS.map((color) => (
              <TouchableOpacity
                key={color}
                style={[
                  s.colorDot,
                  { backgroundColor: HIGHLIGHT_COLOR_HEX[color] },
                  activeHighlightColor === color && s.colorDotActive,
                ]}
                onPress={() => onHighlight(color)}
              />
            ))}
            {canRemoveHighlight && (
              <>
                <View style={s.colorRowDivider} />
                <TouchableOpacity
                  style={s.colorRemoveBtn}
                  onPress={handleRemove}
                  accessibilityRole="button"
                  accessibilityLabel={t("notebook.deleteHighlight", "删除高亮")}
                >
                  <Trash2Icon size={16} color={colors.destructive} />
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        <View style={s.actionRow}>
          <TouchableOpacity
            style={[s.iconBtn, showColors && s.iconBtnActive]}
            onPress={handleHighlightPress}
          >
            <HighlighterIcon size={18} color={showColors ? colors.primary : colors.foreground} />
          </TouchableOpacity>

          {onNote && (
            <TouchableOpacity style={s.iconBtn} onPress={handleNote}>
              <NotebookPenIcon size={18} color={colors.foreground} />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={s.iconBtn} onPress={handleCopy}>
            <CopyIcon size={18} color={colors.foreground} />
          </TouchableOpacity>

          {onTranslate && (
            <TouchableOpacity style={s.iconBtn} onPress={handleTranslate}>
              <LanguagesIcon size={18} color={colors.foreground} />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={s.iconBtn} onPress={onAIChat}>
            <SparklesIcon size={18} color={colors.foreground} />
          </TouchableOpacity>

          {onSpeak && (
            <TouchableOpacity style={s.iconBtn} onPress={handleSpeak}>
              <Volume2Icon size={18} color={colors.foreground} />
            </TouchableOpacity>
          )}

        </View>
      </View>

      <Modal
        visible={showNoteModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNoteModal(false)}
      >
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setShowNoteModal(false)}
          />
          <View style={s.noteModal}>
            <View style={s.noteModalHeader}>
              <Text style={s.noteModalTitle}>{t("reader.addNote", "添加笔记")}</Text>
              <TouchableOpacity style={s.noteCloseBtn} onPress={() => setShowNoteModal(false)}>
                <XIcon size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={s.noteModalPreview} numberOfLines={2}>
              {selection.text}
            </Text>
            <View style={s.editorContainer}>
              <RichTextEditor
                initialContent={noteContent}
                onChange={setNoteContent}
                placeholder={t("reader.notePlaceholder", "写下你的想法...")}
                autoFocus
              />
            </View>
            <View style={s.noteModalActions}>
              <TouchableOpacity style={s.noteCancelBtn} onPress={() => setShowNoteModal(false)}>
                <Text style={s.noteCancelText}>{t("common.cancel", "取消")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.noteSaveBtn} onPress={handleSaveNote}>
                <Text style={s.noteSaveText}>{t("common.save", "保存")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

import { fontSize as fs, fontWeight as fw } from "@/styles/theme";

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 100,
    },
    popover: {
      position: "absolute",
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      padding: POPOVER_PADDING,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    colorRow: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 8,
    },
    colorRowWithActions: {
      marginBottom: GAP,
    },
    colorDot: {
      width: COLOR_DOT_SIZE,
      height: COLOR_DOT_SIZE,
      borderRadius: COLOR_DOT_SIZE / 2,
    },
    colorDotActive: {
      borderWidth: 2,
      borderColor: colors.primary,
    },
    colorRowDivider: {
      width: COLOR_ROW_DIVIDER_WIDTH,
      height: 20,
      backgroundColor: colors.border,
    },
    colorRemoveBtn: {
      width: COLOR_REMOVE_BUTTON_SIZE,
      height: COLOR_REMOVE_BUTTON_SIZE,
      borderRadius: radius.lg,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: withOpacity(colors.destructive, 0.08),
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: GAP,
    },
    iconBtn: {
      width: BUTTON_SIZE,
      height: BUTTON_SIZE,
      borderRadius: radius.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    iconBtnActive: {
      backgroundColor: colors.muted,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.5)",
    },
    noteModal: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      padding: spacing.lg,
      maxHeight: "85%",
    },
    noteModalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.sm,
    },
    noteModalTitle: {
      fontSize: fs.lg,
      fontWeight: fw.semibold,
      color: colors.foreground,
    },
    noteCloseBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.muted,
    },
    noteModalPreview: {
      fontSize: fs.sm,
      color: colors.mutedForeground,
      marginBottom: spacing.md,
      fontStyle: "italic",
      lineHeight: 20,
      paddingHorizontal: spacing.sm,
      borderLeftWidth: 2,
      borderLeftColor: colors.primary,
    },
    editorContainer: {
      height: 200,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    noteInput: {
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      padding: spacing.md,
      fontSize: fs.base,
      color: colors.foreground,
      minHeight: 100,
      textAlignVertical: "top",
    },
    noteModalActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: spacing.md,
      marginTop: spacing.md,
    },
    noteCancelBtn: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
    },
    noteCancelText: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: colors.mutedForeground,
    },
    noteSaveBtn: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
    },
    noteSaveText: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: colors.primaryForeground,
    },
  });
