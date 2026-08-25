import { describe, expect, it } from "vitest";
import { createNoteTooltipTheme } from "./note-tooltip-theme";

describe("reader note tooltip theme", () => {
  it("uses the active sepia surface and readable foreground colors", () => {
    const colors = {
      card: "#f5ebd7",
      foreground: "#3d2b1f",
      muted: "#e6d9c3",
      mutedForeground: "#7a6652",
      border: "#d4c4a8",
      primary: "#6b4c2a",
    };

    const theme = createNoteTooltipTheme(colors);

    expect(theme.surface.backgroundColor).toBe(colors.card);
    expect(theme.surface.borderColor).toBe(colors.border);
    expect(theme.markdown.body.color).toBe(colors.foreground);
    expect(theme.markdown.text.color).toBe(colors.foreground);
    expect(theme.markdown.link.color).toBe(colors.primary);
    expect(JSON.stringify(theme)).not.toContain("rgba(15, 23, 42, 0.95)");
  });
});
