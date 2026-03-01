/**
 * Font theme presets for reading
 */
import type { FontTheme } from "@/types";

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
    id: "classic",
    name: "经典衬线",
    nameEn: "Classic Serif",
    serif: "Georgia, 'Times New Roman', serif",
    sansSerif: "Arial, Helvetica, sans-serif",
    cjk: "'SimSun', 'STSong', serif",
  },
  {
    id: "modern",
    name: "现代无衬线",
    nameEn: "Modern Sans",
    serif: "'Helvetica Neue', Helvetica, sans-serif",
    sansSerif: "'Helvetica Neue', Helvetica, sans-serif",
    cjk: "'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  {
    id: "elegant",
    name: "优雅楷体",
    nameEn: "Elegant Kai",
    serif: "Georgia, serif",
    sansSerif: "Helvetica, sans-serif",
    cjk: "'STKaiti', 'KaiTi', serif",
  },
  {
    id: "literata",
    name: "文学书卷",
    nameEn: "Literata",
    serif: "Literata, Georgia, serif",
    sansSerif: "Literata, Georgia, serif",
    cjk: "'Noto Serif SC', 'Source Han Serif SC', serif",
  },
];

export const DEFAULT_FONT_THEME = "classic";

export function getFontTheme(id: string): FontTheme {
  return FONT_THEMES.find((theme) => theme.id === id) || FONT_THEMES[1]; // Default to classic
}
