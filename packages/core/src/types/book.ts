/** Book and reading configuration types */
import type { HighlightColor } from "./annotation";

export interface BookMeta {
  title: string;
  author: string;
  publisher?: string;
  language?: string;
  isbn?: string;
  description?: string;
  coverUrl?: string;
  publishDate?: string;
  rating?: number;
  reviews?: BookReview[];
  subjects?: string[];
  totalPages?: number;
  totalChapters?: number;
}

export interface BookReview {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export type BookFormat =
  | "epub"
  | "pdf"
  | "mobi"
  | "azw"
  | "azw3"
  | "cbz"
  | "fb2"
  | "fbz"
  | "txt"
  | "umd";

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
  fontSize: number; // 12-64
  lineHeight: number; // 1.2-2.5
  fontTheme: string; // FontTheme id
  customFontFamily?: string; // custom font family (overrides fontTheme)
  customFontFaceCSS?: string; // @font-face CSS to inject (not persisted in store)
  customFontCssUrls?: string[]; // remote font stylesheet URLs to inject into renderer docs
  useBookFonts?: boolean; // default true: honor the book's own (embedded) fonts
  viewMode: ViewMode;
  paginatedLayout: PaginatedLayout;
  fixedLayoutZoom?: number; // relative zoom multiplier for PDF/CBZ fixed layouts
  pageMargin: number; // px
  paragraphSpacing: number;
  justifyBodyText?: boolean; // default true: justify eligible reflowable EPUB body paragraphs
}

export interface ReadSettings extends ViewSettings {
  showTopTitleProgress: boolean;
  showBottomTimeBattery: boolean;
  volumeButtonsPageTurn: boolean;
  /** Android-only: keep the display awake while the reader screen is focused. */
  keepScreenOnWhileReading?: boolean;
  defaultHighlightColor?: HighlightColor;
  /**
   * Mobile-only opt-in: smooth reading — enables the foliate `animated`
   * page-turn transition and the `scroll-inertia` finger-flick physics.
   * Default false so existing users keep the current (performance-first)
   * rendering path. Optional so existing persisted settings deserialize
   * cleanly.
   */
  smoothReading?: boolean;
  /**
   * Mobile-only opt-in: when true, the reader scales fontSize by the OS
   * accessibility font scale (PixelRatio.getFontScale()) before rendering.
   * Default false so existing users see no behavior change. Optional so
   * existing persisted settings deserialize cleanly.
   */
  followSystemFontScale?: boolean;
}

export type SortField = "title" | "author" | "addedAt" | "lastOpenedAt" | "progress";
export type SortOrder = "asc" | "desc";

export interface LibraryFilter {
  search: string;
  tags: string[];
  sortField: SortField;
  sortOrder: SortOrder;
}
