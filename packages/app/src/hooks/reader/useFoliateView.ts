/**
 * FoliateView type — typed interface for the <foliate-view> Web Component.
 *
 * This mirrors the API exposed by foliate-js/view.js.
 * foliate-js is a pure JS library, so we define the types here.
 */

export interface FoliateView extends HTMLElement {
  // biome-ignore lint: foliate-js uses loosely typed objects
  book: any;
  // biome-ignore lint: foliate-js uses loosely typed objects
  renderer: any;
  // biome-ignore lint: foliate-js uses loosely typed objects
  lastLocation: any;

  // Open / close
  // biome-ignore lint: accepts File, Blob, URL, or BookDoc
  open(source: any): Promise<void>;
  close(): void;
  init(opts?: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;

  // Navigation
  goTo(target: string | number): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  goLeft(): Promise<void>;
  goRight(): Promise<void>;

  // CFI
  getCFI(index: number, range?: Range): string;

  // Annotations
  // biome-ignore lint: foliate-js annotation format
  addAnnotation(annotation: any, remove?: boolean): Promise<void>;
  // biome-ignore lint: foliate-js annotation format
  deleteAnnotation(annotation: any): Promise<void>;

  // Search (async generator)
  // biome-ignore lint: search options
  search(opts: any): AsyncGenerator;
  clearSearch(): void;

  // TTS
  initTTS(): Promise<void>;
}

/**
 * wrappedFoliateView — wraps a raw <foliate-view> element
 * to add any necessary patches or extensions.
 */
export function wrappedFoliateView(
  el: HTMLElement,
): FoliateView {
  return el as unknown as FoliateView;
}
