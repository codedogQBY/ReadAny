/**
 * Font theme presets for reading
 */
import type { FontTheme } from "../types";

// Values must be SINGLE family names: getRendererStyles builds the full
// fallback chain and quotes each name — a multi-family string here would be
// wrapped in one pair of quotes and match nothing.
export const FONT_THEMES: FontTheme[] = [
  {
    id: "system",
    name: "系统默认",
    nameEn: "System Default",
    serif: "system-ui",
    sansSerif: "system-ui",
    cjk: "system-ui",
  },
  {
    id: "literata",
    name: "文学书卷",
    nameEn: "Literata",
    serif: "Literata",
    sansSerif: "Literata",
    cjk: "Noto Serif SC",
  },
];

export const DEFAULT_FONT_THEME = "system";

export function getFontTheme(id: string): FontTheme {
  return FONT_THEMES.find((theme) => theme.id === id) || FONT_THEMES[0];
}
