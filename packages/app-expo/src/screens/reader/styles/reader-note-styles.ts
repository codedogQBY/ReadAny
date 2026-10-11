/**
 * Note view modal + tooltip + Markdown render styles for ReaderScreen.
 */
import { Dimensions, StyleSheet } from "react-native";
import { type ThemeColors, fontSize, fontWeight, radius } from "@/styles/theme";
import { createNoteTooltipTheme } from "../note-tooltip-theme";

const SCREEN_HEIGHT = Dimensions.get("window").height;

export const makeNoteStyles = (colors: ThemeColors) => {
  const tooltipTheme = createNoteTooltipTheme(colors);

  return StyleSheet.create({
    // ── Note view modal ───────────────────────────────────────────────────────
    noteViewOverlay: {
      flex: 1, justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.5)",
    },
    noteViewModal: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      padding: 16,
      maxHeight: SCREEN_HEIGHT * 0.75,
    },
    noteViewHeader: {
      flexDirection: "row", alignItems: "center",
      justifyContent: "space-between", marginBottom: 12,
    },
    noteViewTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.foreground },
    noteViewCloseBtn: {
      width: 32, height: 32, borderRadius: 16,
      alignItems: "center", justifyContent: "center",
      backgroundColor: colors.muted,
    },
    noteViewQuote: {
      fontSize: fontSize.sm, color: colors.mutedForeground,
      marginBottom: 12, fontStyle: "italic", lineHeight: 20,
      paddingHorizontal: 8, borderLeftWidth: 2, borderLeftColor: colors.primary,
    },
    noteViewBody: {
      maxHeight: SCREEN_HEIGHT * 0.35,
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      paddingHorizontal: 12, paddingVertical: 8,
    },
    noteViewEditorContainer: {
      height: 200, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.border, overflow: "hidden",
    },
    noteViewActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
    noteViewEditBtn: {
      flexDirection: "row", alignItems: "center", gap: 4,
      backgroundColor: colors.primary,
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.lg,
    },
    noteViewEditText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.primaryForeground },
    noteViewCancelBtn: {
      flexDirection: "row", alignItems: "center", gap: 4,
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.lg,
    },
    noteViewCancelText: { fontSize: fontSize.sm, color: colors.mutedForeground },
    noteViewSaveBtn: {
      flexDirection: "row", alignItems: "center", gap: 4,
      backgroundColor: colors.primary,
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.lg,
    },
    noteViewSaveText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.primaryForeground },

    // ── Note tooltip ──────────────────────────────────────────────────────────
    noteTooltip: {
      position: "absolute",
      width: 300, maxHeight: 200,
      ...tooltipTheme.surface,
      borderRadius: radius.lg,
      padding: 12,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3, shadowRadius: 16,
      elevation: 12,
      borderWidth: 1,
      zIndex: 90,
    },
    noteTooltipContent: tooltipTheme.content,
  });
};
