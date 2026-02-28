/** Annotation types: highlights, notes, bookmarks */

// Predefined highlight colors (matching readest)
export type HighlightColor = "red" | "yellow" | "green" | "blue" | "violet";

// Hex color values for each highlight color
export const HIGHLIGHT_COLOR_HEX: Record<HighlightColor, string> = {
  red: "#f87171",      // red-400
  yellow: "#facc15",   // yellow-400
  green: "#4ade80",    // green-400
  blue: "#60a5fa",     // blue-400
  violet: "#a78bfa",   // violet-400
};

// All available highlight colors in display order
export const HIGHLIGHT_COLORS: HighlightColor[] = ["red", "violet", "blue", "green", "yellow"];

export interface Highlight {
  id: string;
  bookId: string;
  cfi: string; // EPUB CFI range
  text: string;
  color: HighlightColor;
  note?: string;
  chapterTitle?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  bookId: string;
  highlightId?: string; // optional link to highlight
  cfi?: string;
  title: string;
  content: string; // markdown
  chapterTitle?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  cfi: string;
  label?: string;
  chapterTitle?: string;
  createdAt: number;
}

export type Annotation = Highlight | Note | Bookmark;
