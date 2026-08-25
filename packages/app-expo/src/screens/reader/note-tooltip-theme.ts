import type { ThemeColors } from "@/styles/theme";

type NoteTooltipColors = Pick<
  ThemeColors,
  "card" | "foreground" | "muted" | "mutedForeground" | "border" | "primary"
>;

export function createNoteTooltipTheme(colors: NoteTooltipColors) {
  const text = { color: colors.foreground, fontSize: 13, lineHeight: 19 };
  const code = {
    backgroundColor: colors.muted,
    color: colors.foreground,
    fontSize: 14,
    fontFamily: "Menlo",
  };

  return {
    surface: {
      backgroundColor: colors.card,
      borderColor: colors.border,
    },
    content: {
      maxHeight: 140,
      overflow: "hidden" as const,
    },
    markdown: {
      body: text,
      textgroup: text,
      text,
      paragraph: { ...text, marginBottom: 4, marginTop: 0 },
      heading1: {
        color: colors.foreground,
        fontSize: 15,
        fontWeight: "600" as const,
        marginBottom: 4,
        marginTop: 4,
      },
      heading2: {
        color: colors.foreground,
        fontSize: 14,
        fontWeight: "600" as const,
        marginBottom: 3,
        marginTop: 3,
      },
      heading3: {
        color: colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
        marginBottom: 2,
        marginTop: 2,
      },
      strong: { fontWeight: "700" as const, color: colors.foreground },
      em: { fontStyle: "italic" as const, color: colors.mutedForeground },
      link: { color: colors.primary },
      code_inline: code,
      code_block: { ...code, padding: 8 },
      fence: { ...code, padding: 8 },
      blockquote: {
        borderLeftWidth: 2,
        borderLeftColor: colors.mutedForeground,
        paddingLeft: 10,
        backgroundColor: "transparent",
        color: colors.foreground,
      },
      bullet_list: { marginVertical: 2 },
      ordered_list: { marginVertical: 2 },
      list_item: { marginBottom: 2, flexDirection: "row" as const },
      bullet_list_icon: { color: colors.foreground, marginLeft: 0, marginRight: 8 },
      bullet_list_content: { color: colors.foreground, flex: 1 },
      ordered_list_icon: { color: colors.foreground, marginLeft: 0, marginRight: 8 },
      ordered_list_content: { color: colors.foreground, flex: 1 },
      hardbreak: { color: colors.foreground },
      softbreak: { color: colors.foreground },
    },
  };
}
