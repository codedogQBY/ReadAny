/** Annotation types: highlights, notes, bookmarks */

export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple";

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
