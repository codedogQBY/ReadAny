/**
 * Unified Document Renderer interface
 * Supports EPUB, PDF, and future format extensions
 */

export interface TOCItem {
  id: string;
  title: string;
  level: number;
  href?: string;
  index?: number;
  subitems?: TOCItem[];
}

export interface Location {
  type: "cfi" | "page-coord";
  /** EPUB CFI string */
  cfi?: string;
  chapterIndex?: number;
  /** PDF page index (0-based) */
  pageIndex?: number;
  /** Normalized rect [x1, y1, x2, y2] in 0-1 range */
  rect?: [number, number, number, number];
}

export interface Selection {
  text: string;
  start: Location;
  end: Location;
  rects: DOMRect[];
}

export interface AnnotationMark {
  id: string;
  location: Location;
  color: string;
  text?: string;
  note?: string;
}

export type LoadingStage = "reading" | "parsing" | "rendering";

export interface RendererEvents {
  "location-change": (location: Location, progress: number) => void;
  selection: (selection: Selection | null) => void;
  load: (info: { chapterIndex: number; chapterTitle: string }) => void;
  "toc-ready": (toc: TOCItem[]) => void;
  "loading-stage": (stage: LoadingStage) => void;
  error: (error: Error) => void;
}

/** Pre-parsed book document (from foliate-js makeBook) */
// biome-ignore lint: foliate-js uses loosely typed book objects
export type BookDoc = any;

export interface DocumentRenderer {
  /** Mount the renderer into a container element */
  mount(container: HTMLElement): Promise<void>;

  /** Open and render a book file (accepts raw Blob or pre-parsed BookDoc) */
  open(file: File | Blob | BookDoc, initialLocation?: Location): Promise<void>;

  /** Destroy and clean up resources */
  destroy(): void;

  // --- Navigation ---
  goTo(location: Location): Promise<void>;
  goToIndex(index: number): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;

  // --- Info ---
  getTOC(): TOCItem[];
  getCurrentLocation(): Location;
  getProgress(): number;
  getTotalPages(): number;

  // --- Selection ---
  getSelection(): Selection | null;

  // --- Annotations ---
  addAnnotation(annotation: AnnotationMark): void;
  removeAnnotation(id: string): void;
  clearAnnotations(): void;

  // --- View Settings ---
  setFontSize(size: number): void;
  setLineHeight(height: number): void;
  setTheme(theme: "light" | "dark" | "sepia"): void;
  setViewMode(mode: "paginated" | "scroll"): void;

  // --- Events ---
  on<K extends keyof RendererEvents>(event: K, callback: RendererEvents[K]): void;
  off<K extends keyof RendererEvents>(event: K, callback: RendererEvents[K]): void;
}
