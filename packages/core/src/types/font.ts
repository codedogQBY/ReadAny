/**
 * Custom font types for user-uploaded fonts
 */

export type FontFormat = "ttf" | "otf" | "woff" | "woff2";

export type FontSource = "local" | "remote";

export interface CustomFont {
  id: string;
  name: string;
  fileName: string;
  filePath?: string;
  fontFamily: string;
  format: FontFormat;
  size?: number;
  addedAt: number;
  source: FontSource;
  remoteUrl?: string;
  remoteUrlWoff2?: string;
  /** CSS stylesheet URL (e.g. webfont CDN CSS). When set, the CSS is imported directly
   *  instead of generating an @font-face rule. fontFamily must match the CSS's font-family. */
  remoteCssUrl?: string;
}

export interface FontPreset {
  id: string;
  name: string;
  nameEn: string;
  fontFamily: string;
  isCustom?: boolean;
}

export const SYSTEM_FONTS: FontPreset[] = [
  { id: "system", name: "系统默认", nameEn: "System Default", fontFamily: "system-ui" },
  { id: "serif", name: "衬线体", nameEn: "Serif", fontFamily: "Georgia, serif" },
  { id: "sans", name: "无衬线体", nameEn: "Sans-serif", fontFamily: "Arial, sans-serif" },
  { id: "mono", name: "等宽字体", nameEn: "Monospace", fontFamily: "Menlo, monospace" },
];

/** Built-in preset fonts users can add with one click */
export interface PresetFontDef {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  fontFamily: string;
  /** CSS stylesheet URL for CDN webfonts (preferred) */
  remoteCssUrl?: string;
  /** Direct woff2 URL fallback */
  remoteUrlWoff2?: string;
  remoteUrl?: string;
  format: FontFormat;
  license: string;
}

export const PRESET_FONTS: PresetFontDef[] = [
  {
    id: "preset-lxgw-wenkai-screen",
    name: "霞鹜文楷 屏幕版",
    nameEn: "LXGW WenKai Screen",
    description: "专为屏幕阅读优化的楷体，兼有仿宋特点，中文阅读体验极佳",
    descriptionEn: "Screen-optimized Kai typeface, excellent for Chinese reading",
    fontFamily: "LXGW WenKai Screen",
    remoteCssUrl:
      "https://cdn.bootcdn.net/ajax/libs/lxgw-wenkai-screen-webfont/1.7.0/style.min.css",
    format: "woff2",
    license: "OFL-1.1",
  },
  {
    id: "preset-lxgw-wenkai",
    name: "霞鹜文楷",
    nameEn: "LXGW WenKai",
    description: "开源楷体，基于 Klee One 衍生，简繁日韩均支持",
    descriptionEn: "Open-source Kai typeface derived from Klee One, supports CJK",
    fontFamily: "LXGW WenKai",
    remoteCssUrl: "https://cdn.bootcdn.net/ajax/libs/lxgw-wenkai-webfont/1.6.0/style.min.css",
    format: "woff2",
    license: "OFL-1.1",
  },
  {
    id: "preset-noto-serif-sc",
    name: "思源宋体",
    nameEn: "Noto Serif SC",
    description: "Google 出品开源宋体，正式感强，适合严肃阅读场景",
    descriptionEn: "Google's open-source Song typeface, formal and readable",
    fontFamily: "Noto Serif SC",
    remoteCssUrl:
      "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&display=swap",
    format: "woff2",
    license: "OFL-1.1",
  },
  {
    id: "preset-literata",
    name: "Literata",
    nameEn: "Literata",
    description: "专为长文阅读设计的英文字体，Google Play Books 御用字体",
    descriptionEn: "Designed for long-form reading, used by Google Play Books",
    fontFamily: "Literata",
    remoteCssUrl:
      "https://fonts.googleapis.com/css2?family=Literata:ital,wght@0,400;0,700;1,400&display=swap",
    format: "woff2",
    license: "OFL-1.1",
  },
];
