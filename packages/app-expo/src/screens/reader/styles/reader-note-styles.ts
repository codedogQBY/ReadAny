import { type ThemeColors, fontSize, fontWeight, radius } from "@/styles/theme";
/**
 * Note view modal + tooltip + Markdown render styles for ReaderScreen.
 */
import { Dimensions, StyleSheet } from "react-native";

const SCREEN_HEIGHT = Dimensions.get("window").height;

export const TOOLTIP_FG = "#f1f5f9";
export const TOOLTIP_MUTED = "rgba(148, 163, 184, 0.5)";

/** Markdown styles used inside note tooltip */
export const noteTooltipMdStyles = {
  body: { color: TOOLTIP_FG, fontSize: 13, lineHeight: 19 },
  textgroup: { color: TOOLTIP_FG, fontSize: 13, lineHeight: 19 },
  text: { color: TOOLTIP_FG, fontSize: 13, lineHeight: 19 },
  paragraph: { color: TOOLTIP_FG, fontSize: 13, lineHeight: 19, marginBottom: 4, marginTop: 0 },
  heading1: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600" as const,
    marginBottom: 4,
    marginTop: 4,
  },
  heading2: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600" as const,
    marginBottom: 3,
    marginTop: 3,
  },
  heading3: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600" as const,
    marginBottom: 2,
    marginTop: 2,
  },
  strong: { fontWeight: "700" as const, color: "#fff" },
  em: { fontStyle: "italic" as const, color: "#e2e8f0" },
  link: { color: "#60a5fa" },
  code_inline: {
    backgroundColor: "rgba(255,255,255,0.1)",
    color: TOOLTIP_FG,
    fontSize: 14,
    fontFamily: "Menlo",
  },
  code_block: {
    backgroundColor: "rgba(0,0,0,0.3)",
    color: TOOLTIP_FG,
    fontSize: 14,
    fontFamily: "Menlo",
    padding: 8,
  },
  fence: {
    backgroundColor: "rgba(0,0,0,0.3)",
    color: TOOLTIP_FG,
    fontSize: 14,
    fontFamily: "Menlo",
    padding: 8,
  },
  blockquote: {
    borderLeftWidth: 2,
    borderLeftColor: TOOLTIP_MUTED,
    paddingLeft: 10,
    backgroundColor: "transparent",
    color: TOOLTIP_FG,
  },
  bullet_list: { marginVertical: 2 },
  ordered_list: { marginVertical: 2 },
  list_item: { marginBottom: 2, flexDirection: "row" as const },
  bullet_list_icon: { color: TOOLTIP_FG, marginLeft: 0, marginRight: 8 },
  bullet_list_content: { color: TOOLTIP_FG, flex: 1 },
  ordered_list_icon: { color: TOOLTIP_FG, marginLeft: 0, marginRight: 8 },
  ordered_list_content: { color: TOOLTIP_FG, flex: 1 },
  hardbreak: { color: TOOLTIP_FG },
  softbreak: { color: TOOLTIP_FG },
};

export const makeNoteStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // ── Note view modal ───────────────────────────────────────────────────────
    noteViewOverlay: {
      flex: 1,
      justifyContent: "flex-end",
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
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    noteViewTitle: {
      fontSize: fontSize.md,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    noteViewCloseBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.muted,
    },
    noteViewQuote: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      marginBottom: 12,
      fontStyle: "italic",
      lineHeight: 20,
      paddingHorizontal: 8,
      borderLeftWidth: 2,
      borderLeftColor: colors.primary,
    },
    noteViewBody: {
      maxHeight: SCREEN_HEIGHT * 0.35,
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    noteViewEditorContainer: {
      height: 200,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    noteViewActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
    noteViewEditBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.lg,
    },
    noteViewEditText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
    noteViewCancelBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.lg,
    },
    noteViewCancelText: { fontSize: fontSize.sm, color: colors.mutedForeground },
    noteViewSaveBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.lg,
    },
    noteViewSaveText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },

    // ── Note tooltip ──────────────────────────────────────────────────────────
    noteTooltip: {
      position: "absolute",
      width: 300,
      maxHeight: 200,
      backgroundColor: "rgba(15, 23, 42, 0.95)",
      borderRadius: radius.lg,
      padding: 12,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 12,
      borderWidth: 1,
      borderColor: "rgba(100, 116, 139, 0.3)",
      zIndex: 90,
    },
    noteTooltipContent: { maxHeight: 140, overflow: "hidden" },
  });
