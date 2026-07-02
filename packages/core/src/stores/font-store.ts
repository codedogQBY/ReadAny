import { create } from "zustand";
import { getPlatformService, waitForPlatformService } from "../services/platform";
/**
 * Custom font store — manages user-uploaded fonts
 */
import type { CustomFont, FontFormat, FontPreset } from "../types/font";

const FONTS_DIR = "readany-fonts";
const FONTS_INDEX_FILE = "custom-fonts.json";

// ─── Font index persistence (stored alongside font files in readany-fonts/) ───

interface FontIndex {
  fonts: CustomFont[];
  selectedFontId?: string | null;
}

async function saveFontIndex(fonts: CustomFont[], selectedFontId: string | null): Promise<void> {
  try {
    const platform = getPlatformService();
    const fontsDir = await getFontsDir();
    const filePath = await platform.joinPath(fontsDir, FONTS_INDEX_FILE);
    const data: FontIndex = { fonts, selectedFontId };
    await platform.writeTextFile(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[FontStore] Failed to save font index:", err);
  }
}

function persistFontIndex(fonts: CustomFont[], selectedFontId: string | null): void {
  void saveFontIndex(fonts, selectedFontId);
}

async function loadFontIndex(): Promise<FontIndex | null> {
  try {
    const platform = getPlatformService();
    const fontsDir = await getFontsDir();
    const filePath = await platform.joinPath(fontsDir, FONTS_INDEX_FILE);
    if (!(await platform.exists(filePath))) return null;
    const text = await platform.readTextFile(filePath);
    return JSON.parse(text) as FontIndex;
  } catch (err) {
    console.warn("[FontStore] Failed to load font index:", err);
    return null;
  }
}

export interface FontState {
  fonts: CustomFont[];
  selectedFontId: string | null; // null = use fontTheme
  _hasHydrated: boolean;

  addFont: (font: CustomFont, options?: { select?: boolean }) => void;
  removeFont: (id: string) => Promise<void>;
  setSelectedFont: (id: string | null) => void;
  getFont: (id: string) => CustomFont | undefined;
  getAllFonts: () => CustomFont[];
  getFontPresets: () => FontPreset[];
  getFontByIdOrFamily: (idOrFamily: string) => CustomFont | undefined;
}

function generateFontId(): string {
  return `font-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSourceFileName(sourcePath: string, originalFileName?: string): string {
  const sourceName = originalFileName || sourcePath.split(/[/\\]/).pop() || "font.ttf";
  const cleanName = sourceName.split(/[?#]/, 1)[0] || "font.ttf";
  try {
    return decodeURIComponent(cleanName);
  } catch {
    return cleanName;
  }
}

function getSafeFontFileBase(fontName: string): string {
  const safeName = fontName
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safeName || "font";
}

function getFontExtension(fileName: string): FontFormat {
  return getFontFormat(fileName);
}

function createCustomFontFamily(fontId: string): string {
  const safeId = fontId.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `ReadAnyCustomFont-${safeId}`;
}

function getFontFormat(fileName: string): FontFormat {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "otf":
      return "otf";
    case "woff":
      return "woff";
    case "woff2":
      return "woff2";
    default:
      return "ttf";
  }
}

function getCSSFontFormat(format: FontFormat): string {
  switch (format) {
    case "otf":
      return "opentype";
    case "woff":
      return "woff";
    case "woff2":
      return "woff2";
    default:
      return "truetype";
  }
}

export async function getFontsDir(): Promise<string> {
  const platform = getPlatformService();
  const dataDir = await platform.getDataDir();
  const fontsDir = await platform.joinPath(dataDir, FONTS_DIR);
  try {
    await platform.mkdir(fontsDir);
  } catch {
    // directory may already exist
  }
  return fontsDir;
}

export async function saveFontFile(
  sourcePath: string,
  fontName: string,
  originalFileName?: string,
): Promise<{ filePath: string; fileName: string; size: number }> {
  const platform = getPlatformService();
  const fontsDir = await getFontsDir();

  const originalName = getSourceFileName(sourcePath, originalFileName);
  const ext = getFontExtension(originalName);
  const safeName = getSafeFontFileBase(fontName);
  const fileName = `${safeName}-${Date.now()}.${ext}`;
  const filePath = await platform.joinPath(fontsDir, fileName);

  const data = await platform.readFile(sourcePath);
  await platform.writeFile(filePath, data);

  return {
    filePath,
    fileName,
    size: data.length,
  };
}

export async function deleteFontFile(filePath: string): Promise<void> {
  const platform = getPlatformService();
  try {
    await platform.deleteFile(filePath);
  } catch (err) {
    console.error("[FontStore] Failed to delete font file:", err);
  }
}

export function getCSSFontFace(font: CustomFont, baseUrl?: string): string {
  // CSS-imported fonts: @font-face is handled by the external stylesheet
  if (font.source === "remote" && font.remoteCssUrl) return "";

  if (font.source === "remote" && font.remoteUrl) {
    let src = "";
    if (font.remoteUrlWoff2) {
      src += `url('${font.remoteUrlWoff2}') format('woff2')`;
      if (font.remoteUrl) {
        src += `,\n  url('${font.remoteUrl}') format('woff')`;
      }
    } else {
      src = `url('${font.remoteUrl}') format('${getCSSFontFormat(font.format)}')`;
    }
    return `@font-face {
  font-family: ${JSON.stringify(font.fontFamily)};
  src: ${src};
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}`;
  }

  if (!baseUrl) return "";
  const cssFormat = getCSSFontFormat(font.format);
  return `@font-face {
  font-family: ${JSON.stringify(font.fontFamily)};
  src: url('${baseUrl}/${font.fileName}') format('${cssFormat}');
  font-weight: normal;
  font-style: normal;
}`;
}

/** Returns @import rules for all CSS-based remote fonts */
export function getRemoteCssImports(fonts: CustomFont[]): string {
  return fonts
    .filter((f) => f.source === "remote" && f.remoteCssUrl)
    .map((f) => `@import url('${f.remoteCssUrl}');`)
    .join("\n");
}

export function getFontFamilyCSS(font: CustomFont): string {
  return `${JSON.stringify(font.fontFamily)}, sans-serif`;
}

export const useFontStore = create<FontState>((set, get) => ({
  fonts: [],
  selectedFontId: null,
  _hasHydrated: false,

  addFont: (font, options) => {
    set((state) => {
      const nextFonts = state.fonts.filter((item) => item.id !== font.id);
      const newFonts = [...nextFonts, font];
      const selectedFontId = options?.select ? font.id : state.selectedFontId;
      persistFontIndex(newFonts, selectedFontId);
      return { fonts: newFonts, selectedFontId };
    });
  },

  removeFont: async (id) => {
    const font = get().fonts.find((f) => f.id === id);
    if (font && font.source === "local" && font.filePath) {
      await deleteFontFile(font.filePath);
    }
    set((state) => {
      const newFonts = state.fonts.filter((f) => f.id !== id);
      const newSelectedId = state.selectedFontId === id ? null : state.selectedFontId;
      persistFontIndex(newFonts, newSelectedId);
      return { fonts: newFonts, selectedFontId: newSelectedId };
    });
  },

  setSelectedFont: (id) => {
    set((state) => {
      persistFontIndex(state.fonts, id);
      return { selectedFontId: id };
    });
  },

  getFont: (id) => {
    return get().fonts.find((f) => f.id === id);
  },

  getAllFonts: () => {
    return get().fonts;
  },

  getFontPresets: () => {
    const customPresets: FontPreset[] = get().fonts.map((f) => ({
      id: f.id,
      name: f.name,
      nameEn: f.name,
      fontFamily: f.fontFamily,
      isCustom: true,
    }));
    return [
      { id: "system", name: "系统默认", nameEn: "System Default", fontFamily: "system-ui" },
      { id: "serif", name: "衬线体", nameEn: "Serif", fontFamily: "Georgia, serif" },
      { id: "sans", name: "无衬线体", nameEn: "Sans-serif", fontFamily: "Arial, sans-serif" },
      { id: "mono", name: "等宽字体", nameEn: "Monospace", fontFamily: "Menlo, monospace" },
      ...customPresets,
    ];
  },

  getFontByIdOrFamily: (idOrFamily) => {
    return get().fonts.find((f) => f.id === idOrFamily || f.fontFamily === idOrFamily);
  },
}));

async function loadFontIndexLegacy(): Promise<CustomFont[] | null> {
  // One-time migration: old versions stored custom-fonts.json in readany-store/
  try {
    const platform = getPlatformService();
    const appData = await platform.getAppDataDir();
    const legacyPath = await platform.joinPath(appData, "readany-store", "custom-fonts.json");
    if (!(await platform.exists(legacyPath))) return null;
    const text = await platform.readTextFile(legacyPath);
    const parsed = JSON.parse(text) as { fonts?: CustomFont[] };
    return parsed.fonts ?? null;
  } catch (err) {
    console.warn("[FontStore] Failed to load legacy font index:", err);
    return null;
  }
}

async function hydrateFontStore(): Promise<void> {
  try {
    await waitForPlatformService();

    const index = await loadFontIndex();
    if (index?.fonts) {
      useFontStore.setState({
        fonts: index.fonts,
        selectedFontId: index.selectedFontId ?? null,
        _hasHydrated: true,
      });
      console.log("[FontStore] hydrated from index", {
        fontCount: index.fonts.length,
        selectedFontId: index.selectedFontId ?? null,
      });
      return;
    }

    const legacyFonts = await loadFontIndexLegacy();
    if (legacyFonts && legacyFonts.length > 0) {
      useFontStore.setState({ fonts: legacyFonts, selectedFontId: null, _hasHydrated: true });
      void saveFontIndex(legacyFonts, null);
      console.log("[FontStore] hydrated from legacy index", {
        fontCount: legacyFonts.length,
      });
      return;
    }

    useFontStore.setState({ _hasHydrated: true });
    console.log("[FontStore] hydrated empty");
  } catch (err) {
    console.error("[FontStore] hydrate failed:", err);
    useFontStore.setState({ _hasHydrated: true });
  }
}

void hydrateFontStore();

export { generateFontId, getFontFormat, createCustomFontFamily };
