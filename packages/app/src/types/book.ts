/** Book and reading configuration types */

export interface BookMeta {
  title: string;
  author: string;
  publisher?: string;
  language?: string;
  isbn?: string;
  description?: string;
  coverUrl?: string;
  publishDate?: string;
  subjects?: string[];
  totalPages?: number;
  totalChapters?: number;
}

export interface Book {
  id: string;
  filePath: string;
  meta: BookMeta;
  addedAt: number;
  lastOpenedAt?: number;
  progress: number; // 0-1
  currentCfi?: string; // EPUB CFI position
  isVectorized: boolean;
  vectorizeProgress: number; // 0-1
  tags: string[];
}

export type ViewMode = "paginated" | "scroll";
export type Theme = "light" | "dark" | "sepia";
export type FontFamily = "sans" | "serif" | "mono";

export interface ViewSettings {
  fontSize: number; // 12-32
  lineHeight: number; // 1.2-2.5
  fontFamily: FontFamily;
  theme: Theme;
  viewMode: ViewMode;
  pageMargin: number; // px
  paragraphSpacing: number;
}

export interface ReadSettings extends ViewSettings {
  autoSaveInterval: number; // ms
  enableTranslation: boolean;
  translationTargetLang: string;
  showOriginalText: boolean;
}

export type SortField = "title" | "author" | "addedAt" | "lastOpenedAt" | "progress";
export type SortOrder = "asc" | "desc";

export interface LibraryFilter {
  search: string;
  tags: string[];
  sortField: SortField;
  sortOrder: SortOrder;
}
