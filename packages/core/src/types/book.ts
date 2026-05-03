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

export type BookFormat = "epub" | "pdf" | "mobi" | "azw" | "azw3" | "cbz" | "fb2" | "fbz" | "txt";

export interface Book {
  id: string;
  filePath: string;
  format: BookFormat;
  meta: BookMeta;
  groupId?: string;
  addedAt: number;
  lastOpenedAt?: number;
  updatedAt: number;
  deletedAt?: number;
  progress: number; // 0-1
  currentCfi?: string; // EPUB CFI position or PDF page marker (e.g. "page-5")
  isVectorized: boolean;
  vectorizeProgress: number; // 0-1
  tags: string[];
  fileHash?: string;
  syncStatus: "local" | "remote" | "downloading"; // File availability status
}

export interface BookGroup {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export type ViewMode = "paginated" | "scroll";
export type PaginatedLayout = "single" | "double";

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
  customFontFamily?: string; // custom font family (overrides fontTheme)
  customFontFaceCSS?: string; // @font-face CSS to inject (not persisted in store)
  customFontCssUrls?: string[]; // remote font stylesheet URLs to inject into renderer docs
  viewMode: ViewMode;
  paginatedLayout: PaginatedLayout;
  pageMargin: number; // px
  paragraphSpacing: number;
}

export interface ReadSettings extends ViewSettings {
  showTopTitleProgress: boolean;
  showBottomTimeBattery: boolean;
  volumeButtonsPageTurn: boolean;
}

export type SortField = "title" | "author" | "addedAt" | "lastOpenedAt" | "progress";
export type SortOrder = "asc" | "desc";

export interface LibraryFilter {
  search: string;
  tags: string[];
  sortField: SortField;
  sortOrder: SortOrder;
}
