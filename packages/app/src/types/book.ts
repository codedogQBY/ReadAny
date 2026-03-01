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

export type BookFormat = "epub" | "pdf" | "mobi" | "azw" | "azw3" | "cbz" | "fb2" | "fbz";

export interface Book {
  id: string;
  filePath: string;
  format: BookFormat;
  meta: BookMeta;
  addedAt: number;
  lastOpenedAt?: number;
  progress: number; // 0-1
  currentCfi?: string; // EPUB CFI position or PDF page marker (e.g. "page-5")
  isVectorized: boolean;
  vectorizeProgress: number; // 0-1
  tags: string[];
}

export type ViewMode = "paginated" | "scroll";

/** Font theme preset */
export interface FontTheme {
  id: string;
  name: string;
  nameEn: string;
  serif: string;
  sansSerif: string;
  cjk: string;
}

export interface ViewSettings {
  fontSize: number; // 12-32
  lineHeight: number; // 1.2-2.5
  fontTheme: string; // FontTheme id
  viewMode: ViewMode;
  pageMargin: number; // px
  paragraphSpacing: number;
}

export interface ReadSettings extends ViewSettings {
  // Add any additional settings here if needed
}

export type SortField = "title" | "author" | "addedAt" | "lastOpenedAt" | "progress";
export type SortOrder = "asc" | "desc";

export interface LibraryFilter {
  search: string;
  tags: string[];
  sortField: SortField;
  sortOrder: SortOrder;
}
