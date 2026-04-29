import { type ThemeColors, fontSize, fontWeight, radius, withOpacity } from "@/styles/theme";
/**
 * Bottom sheet + TOC/Bookmark/Settings panel styles for ReaderScreen.
 */
import { Dimensions, StyleSheet } from "react-native";

const SCREEN_HEIGHT = Dimensions.get("window").height;

export const makeSheetStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // ── Generic bottom sheet ──────────────────────────────────────────────────
    modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
    bottomSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      padding: 16,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    sheetTitle: {
      fontSize: fontSize.md,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    sheetScroll: { maxHeight: SCREEN_HEIGHT * 0.5 },
    sheetEmpty: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      textAlign: "center",
      paddingVertical: 32,
    },

    // ── TOC tabs ──────────────────────────────────────────────────────────────
    tocTabBar: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
    tocTab: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.md,
    },
    tocTabText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },

    // ── Settings rows ─────────────────────────────────────────────────────────
    settingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    settingRowMultiline: { alignItems: "flex-start", gap: 12 },
    settingLabelBlock: { flex: 1, minWidth: 0, paddingRight: 12, gap: 4 },
    settingLabel: { fontSize: fontSize.sm, color: colors.mutedForeground },
    settingHint: {
      fontSize: fontSize.xs,
      lineHeight: 16,
      color: withOpacity(colors.mutedForeground, 0.82),
    },
    settingControl: { flexDirection: "row", alignItems: "center", gap: 12 },
    stepBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    stepBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },
    settingValue: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
      minWidth: 32,
      textAlign: "center",
    },
    settingToggleBtn: {
      minWidth: 68,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    settingToggleBtnActive: { backgroundColor: `${colors.primary}18` },
    settingToggleText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      fontWeight: fontWeight.medium,
    },
    settingToggleTextActive: { color: colors.primary },
    themeScroll: { maxWidth: 220 },
    themeRow: { flexDirection: "row", gap: 6 },
    themeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
    },
    themeBtnActive: { backgroundColor: colors.primary },
    themeBtnText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    themeBtnTextActive: { color: colors.primaryForeground },
    viewModeRow: { flexDirection: "row", gap: 8 },
    viewModeBtn: {
      paddingHorizontal: 16,
      paddingVertical: 6,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
    },
    viewModeBtnActive: { backgroundColor: colors.primary },
    viewModeBtnText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    viewModeBtnTextActive: { color: colors.primaryForeground },

    // ── Highlights & bookmarks ────────────────────────────────────────────────
    notebookPlaceholder: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 48,
      gap: 12,
    },
    notebookPlaceholderText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      textAlign: "center",
      paddingHorizontal: 32,
    },
    highlightItem: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      paddingVertical: 8,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    highlightColorDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
    highlightContent: { flex: 1 },
    highlightText: { fontSize: fontSize.sm, color: colors.foreground, lineHeight: 18 },
    highlightNote: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 4 },
    bookmarkItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    bookmarkContent: { flex: 1, minWidth: 0 },
    bookmarkLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, lineHeight: 20 },
    bookmarkSnippet: { fontSize: fontSize.xs, lineHeight: 16, marginTop: 2, opacity: 0.7 },
    bookmarkDate: { fontSize: fontSize.xs, marginTop: 3, opacity: 0.6 },
    bookmarkDeleteBtn: { padding: 6, borderRadius: radius.md, opacity: 0.5 },
  });
