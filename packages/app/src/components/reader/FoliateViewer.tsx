import { useBookShortcuts } from "@/hooks/reader/useBookShortcuts";
import { useFoliateEvents } from "@/hooks/reader/useFoliateEvents";
import type { FoliateView } from "@/hooks/reader/useFoliateView";
import { wrappedFoliateView } from "@/hooks/reader/useFoliateView";
import { usePagination } from "@/hooks/reader/usePagination";
import { readingContextService } from "@/lib/ai/reading-context-service";
import type { BookDoc, BookFormat } from "@/lib/reader/document-loader";
import { getDirection, isFixedLayoutBook } from "@/lib/reader/document-loader";
import { getFontTheme } from "@/lib/reader/font-themes";
import { registerIframeEventHandlers } from "@/lib/reader/iframe-event-handlers";
import type {
  ChapterParagraph,
  ChapterTranslationResult,
} from "@readany/core/translation/chapter-translator";
import { cleanText, isTTSFootnoteMarker, shouldSkipTTSNode } from "@readany/core/tts";
import type { ViewSettings } from "@readany/core/types";
import { Overlayer } from "foliate-js/overlayer.js";
import { marked } from "marked";
/**
 * FoliateViewer — core book rendering component using foliate-js <foliate-view>.
 *
 * Reference: readest FoliateViewer.tsx
 *
 * This component is responsible for:
 * 1. Creating and managing the <foliate-view> Web Component
 * 2. Opening the BookDoc and navigating to initial position
 * 3. Handling section load events (inject styles, register iframe events)
 * 4. Tracking relocate events (progress, location)
 * 5. Applying view settings (font, theme, layout)
 *
 * It receives a pre-parsed BookDoc from the parent (ReaderView),
 * which is created by DocumentLoader.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

type AppTheme = "light" | "dark" | "sepia";

const THEME_COLORS: Record<AppTheme, { bg: string; fg: string; link: string }> = {
  light: { bg: "#ffffff", fg: "#1a1a1a", link: "#2563eb" },
  dark: { bg: "#121212", fg: "#f5f5f5", link: "#60a5fa" },
  sepia: { bg: "#f0e6d2", fg: "#3d2b1f", link: "#6b4c2a" },
};

function getAppTheme(): AppTheme {
  if (typeof document === "undefined") return "dark";
  const theme = document.documentElement.getAttribute("data-theme") as AppTheme | null;
  return theme && THEME_COLORS[theme] ? theme : "dark";
}

function getThemeColors(theme: AppTheme) {
  return THEME_COLORS[theme];
}

function getActiveContentDocument(view: FoliateView | null): Document | null {
  const contents = view?.renderer?.getContents?.();
  return (contents?.[0]?.doc as Document | undefined) ?? null;
}

function getLayoutSignature(view: FoliateView | null, doc: Document | null): string {
  const root = doc?.documentElement;
  const body = doc?.body;
  const renderer = view?.renderer;
  return [
    root?.scrollWidth ?? 0,
    root?.scrollHeight ?? 0,
    body?.scrollWidth ?? 0,
    body?.scrollHeight ?? 0,
    renderer?.page ?? "",
    renderer?.pages ?? "",
  ].join(":");
}

function waitForReaderLayoutStable(view: FoliateView | null): Promise<void> {
  const doc = getActiveContentDocument(view);
  const win = doc?.defaultView ?? window;
  const requestFrame =
    typeof win.requestAnimationFrame === "function"
      ? win.requestAnimationFrame.bind(win)
      : (callback: FrameRequestCallback) =>
          window.setTimeout(() => callback(performance.now()), 16);

  return new Promise((resolve) => {
    let previous = getLayoutSignature(view, doc);
    let stableFrames = 0;
    let frames = 0;

    const tick = () => {
      frames += 1;
      const next = getLayoutSignature(view, doc);
      if (next === previous) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        previous = next;
      }

      if (stableFrames >= 2 || frames >= 12) {
        resolve();
        return;
      }

      requestFrame(tick);
    };

    requestFrame(tick);
  });
}

function getSelectionRange(selection?: Selection | null): Range | null {
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return range.collapsed ? null : range;
}

function getRangeTextWithoutRuby(range: Range, fallback = ""): string {
  try {
    const fragment = range.cloneContents();
    for (const node of fragment.querySelectorAll("rt, rp")) {
      node.remove();
    }
    const text = fragment.textContent?.trim();
    if (text) return text;
  } catch {
    // Fall back to the browser selection text if cloning fails.
  }
  return fallback.trim();
}

function getSelectionEndRect(range: Range | null): DOMRect | null {
  if (!range) return null;

  try {
    const caretRange = range.cloneRange();
    caretRange.collapse(false);
    const caretRects = Array.from(caretRange.getClientRects()).filter(
      (rect) => rect.width >= 0 && rect.height > 0,
    );
    if (caretRects.length) {
      return caretRects[caretRects.length - 1];
    }
  } catch {
    // Fall through to the last client rect.
  }

  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  return rects[rects.length - 1] || range.getBoundingClientRect();
}

type SelectionDragPoint = {
  x: number;
  y: number;
  updatedAt: number;
};

function getSelectionAdvanceIntent(
  view: FoliateView | null,
  selectionRange: Range | null,
  lastLocationRange?: Range,
  dragPoint?: SelectionDragPoint | null,
) {
  if (!view || !selectionRange || !lastLocationRange) return null;

  try {
    if (selectionRange.compareBoundaryPoints(Range.END_TO_END, lastLocationRange) >= 0) {
      return "next";
    }
    if (selectionRange.compareBoundaryPoints(Range.START_TO_START, lastLocationRange) <= 0) {
      return "prev";
    }
  } catch {
    // Fall through to edge-proximity heuristics.
  }

  try {
    const edgeRect = getSelectionEndRect(selectionRange);
    const doc = selectionRange.endContainer.ownerDocument;
    if (!doc) return null;
    const win = doc.defaultView;
    const viewportWidth = Math.max(win?.innerWidth || 0, doc.documentElement?.clientWidth || 0);
    const viewportHeight = Math.max(win?.innerHeight || 0, doc.documentElement?.clientHeight || 0);
    if (viewportWidth <= 0 || viewportHeight <= 0) return null;

    const point =
      dragPoint && Date.now() - dragPoint.updatedAt < 1000
        ? dragPoint
        : edgeRect
          ? { x: edgeRect.right, y: edgeRect.bottom, updatedAt: Date.now() }
          : null;
    if (!point) return null;

    const isRtl = !!(view.book && view.book.dir === "rtl");
    const horizontalInset = Math.max(132, Math.min(420, viewportWidth * 0.3));
    const verticalInset = Math.max(140, Math.min(360, viewportHeight * 0.28));
    const inBottomBand = point.y >= viewportHeight - verticalInset;

    if (isRtl) {
      if (point.x <= horizontalInset) return "next";
      if (dragPoint && point.x >= viewportWidth - horizontalInset) return "prev";
      if (inBottomBand && point.x <= viewportWidth * 0.74) return "next";
      if (dragPoint && inBottomBand && point.x >= viewportWidth * 0.88) return "prev";
    } else {
      if (point.x >= viewportWidth - horizontalInset) return "next";
      if (dragPoint && point.x <= horizontalInset) return "prev";
      if (inBottomBand && point.x >= viewportWidth * 0.26) return "next";
      if (dragPoint && inBottomBand && point.x <= viewportWidth * 0.12) return "prev";
    }

    return null;
  } catch {
    return null;
  }
}

const REMOTE_FONT_LINK_ATTR = "data-readany-remote-font-link";

function normalizeTTSSegmentText(text?: string | null) {
  return cleanText(String(text || ""));
}

function acceptTTSNode(node: Node) {
  if (!node.nodeValue?.trim()) return NodeFilter.FILTER_SKIP;
  if (isTTSFootnoteMarker(node.nodeValue)) return NodeFilter.FILTER_REJECT;
  const parent = (node as Text).parentElement;
  return shouldSkipTTSNode(parent) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
}

function getTTSSegmentIdentity(cfi?: string | null, text?: string | null) {
  return `${cfi || ""}::${normalizeTTSSegmentText(text)}`;
}

type PaginatedVisibleRange = {
  left: number;
  right: number;
  source: "renderer" | "legacy-offset" | "size-fallback";
};

type RendererContent = {
  doc?: Document | null;
  index?: number | null;
  overlayer?: {
    add: (key: string, range: Range, draw: unknown, options?: unknown) => void;
    remove: (key: string) => void;
  } | null;
};

function getRendererContents(view: FoliateView | null): RendererContent[] {
  return (view?.renderer?.getContents?.() ?? []) as RendererContent[];
}

function getPaginatedVisibleRangeCandidates(renderer: {
  start?: unknown;
  end?: unknown;
  size?: unknown;
}): PaginatedVisibleRange[] {
  const start = Number(renderer.start ?? 0);
  const end = Number(renderer.end ?? 0);
  const size = Number(renderer.size ?? 0);
  const candidates: PaginatedVisibleRange[] = [];

  if (Number.isFinite(start) && Number.isFinite(size) && size > 0) {
    candidates.push({ left: start - size, right: start, source: "legacy-offset" });
    candidates.push({ left: start, right: start + size, source: "size-fallback" });
  }

  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    candidates.push({ left: start, right: end, source: "renderer" });
  }

  return candidates.filter(
    (candidate, index, list) =>
      candidate.right > candidate.left &&
      list.findIndex((item) => item.left === candidate.left && item.right === candidate.right) ===
        index,
  );
}

function rectIntersectsPaginatedRange(rect: DOMRect, range: PaginatedVisibleRange) {
  return rect.right > range.left && rect.left < range.right;
}

function scorePaginatedVisibleRange(doc: Document, range: PaginatedVisibleRange) {
  if (!doc.body) return 0;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: acceptTTSNode,
  });
  let score = 0;
  let visited = 0;
  for (
    let textNode = walker.nextNode() as Text | null;
    textNode && visited < 500;
    textNode = walker.nextNode() as Text | null
  ) {
    visited += 1;
    const text = normalizeTTSSegmentText(textNode.nodeValue);
    if (!text) continue;
    try {
      const textRange = doc.createRange();
      textRange.selectNodeContents(textNode);
      const rects = Array.from(textRange.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      if (rects.some((rect) => rectIntersectsPaginatedRange(rect, range))) {
        score += Math.min(text.length, 120);
      }
    } catch {
      // Ignore nodes that cannot be measured.
    }
  }
  return score;
}

function pickPaginatedVisibleRange(
  doc: Document,
  renderer: { start?: unknown; end?: unknown; size?: unknown },
) {
  const candidates = getPaginatedVisibleRangeCandidates(renderer);
  if (candidates.length <= 1) return candidates[0] ?? null;

  const legacyRange = candidates.find((range) => range.source === "legacy-offset") ?? null;
  if (legacyRange && scorePaginatedVisibleRange(doc, legacyRange) > 0) {
    return legacyRange;
  }

  const rendererRange = candidates.find((range) => range.source === "renderer") ?? null;
  if (rendererRange && scorePaginatedVisibleRange(doc, rendererRange) > 0) {
    return rendererRange;
  }

  const fallbackRange = candidates.find((range) => range.source === "size-fallback") ?? null;
  if (fallbackRange && scorePaginatedVisibleRange(doc, fallbackRange) > 0) {
    return fallbackRange;
  }

  return legacyRange ?? rendererRange ?? fallbackRange ?? candidates[0];
}

function getIframeClickMetrics(doc: Document, container: HTMLElement | null, clientX: number) {
  const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null;
  if (!iframe || !container) return null;

  const iframeRect = iframe.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const scaleX = iframe.clientWidth > 0 ? iframeRect.width / iframe.clientWidth : 1;
  const x = iframeRect.left + clientX * scaleX - containerRect.left;
  if (containerRect.width <= 0) return null;
  return {
    fraction: Math.max(0, Math.min(1, x / containerRect.width)),
    x,
    scaleX,
    iframeClientWidth: iframe.clientWidth,
    iframeRect: {
      left: iframeRect.left,
      width: iframeRect.width,
    },
    containerRect: {
      left: containerRect.left,
      width: containerRect.width,
    },
  };
}

function isFootnoteMarkerText(text: string): boolean {
  const value = text.replace(/\s+/g, "").trim();
  if (!value) return false;
  if (value === "注" || value === "註") return true;
  return /^[\[\(（【〔［]?(?:\d{1,4}|[一二三四五六七八九十百千万零〇两]{1,8}|[ivxlcdmIVXLCDM]{1,10})[\]\)）】〕］]?$/.test(
    value,
  );
}

function getHrefFragmentId(href?: string | null): string | null {
  if (!href) return null;
  const hashIndex = href.indexOf("#");
  if (hashIndex < 0 || hashIndex === href.length - 1) return null;
  try {
    return decodeURIComponent(href.slice(hashIndex + 1));
  } catch {
    return href.slice(hashIndex + 1);
  }
}

function findElementByFragmentId(doc: Document, fragmentId: string | null): Element | null {
  if (!fragmentId) return null;
  const byId = doc.getElementById(fragmentId);
  if (byId) return byId;
  return doc.getElementsByName(fragmentId)[0] ?? null;
}

function isFootnoteLikeElement(element: Element | null): boolean {
  if (!element) return false;
  const haystack = [
    element.id,
    element.getAttribute("role"),
    element.getAttribute("type"),
    element.getAttribute("epub:type"),
    element.className,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return /\b(doc-)?(noteref|footnote|endnote|rearnote|note)\b|fn(ref)?|duokan-footnote|calibre-footnote/.test(
    haystack,
  );
}

function isLikelyFootnoteLink(anchor: HTMLAnchorElement, href?: string | null): boolean {
  const rawHref = anchor.getAttribute("href") || href || "";
  const hrefLower = rawHref.toLowerCase();
  const markerText = isFootnoteMarkerText(anchor.textContent || "");
  if (
    isFootnoteLikeElement(anchor) ||
    isFootnoteLikeElement(anchor.closest("sup, span, a, [role], [type], [epub\\:type]"))
  ) {
    return true;
  }
  if (
    /(^|[#/_-])(fn|footnote|endnote|note|noteref|duokan-footnote|calibre-footnote)/i.test(hrefLower)
  ) {
    return true;
  }
  return markerText && Boolean(getHrefFragmentId(rawHref));
}

function getElementPreviewText(element: Element | Range | null): string {
  if (!element) return "";
  const cloned =
    element instanceof Range
      ? element.cloneContents()
      : element.cloneNode(true) instanceof DocumentFragment
        ? (element.cloneNode(true) as DocumentFragment)
        : (() => {
            const fragment = document.createDocumentFragment();
            fragment.appendChild(element.cloneNode(true));
            return fragment;
          })();

  for (const node of Array.from(cloned.querySelectorAll("script, style, rt, rp, a[href]"))) {
    const text = node.textContent || "";
    if (node.matches("a[href]") && !isFootnoteMarkerText(text)) continue;
    node.remove();
  }

  return cleanText(cloned.textContent || "").slice(0, 600);
}

async function resolveFootnotePreviewText(
  view: FoliateView | null,
  anchor: HTMLAnchorElement,
  href?: string | null,
): Promise<string> {
  const rawHref = anchor.getAttribute("href") || href || "";
  const sourceDoc = anchor.ownerDocument;
  const localTarget = findElementByFragmentId(sourceDoc, getHrefFragmentId(rawHref));
  if (localTarget && (isFootnoteLikeElement(localTarget) || isLikelyFootnoteLink(anchor, href))) {
    return getElementPreviewText(localTarget);
  }

  if (!view?.resolveNavigation || !href) return "";
  try {
    const resolved = await Promise.resolve(view.resolveNavigation(href));
    const targetIndex = resolved?.index;
    if (typeof targetIndex !== "number") return "";
    const currentContent = view.renderer
      ?.getContents?.()
      ?.find((item: { index?: number }) => item.index === targetIndex);
    const targetDoc =
      (currentContent?.doc as Document | undefined) ??
      (await view.book?.sections?.[targetIndex]?.createDocument?.());
    if (!targetDoc) return "";
    const target = typeof resolved.anchor === "function" ? resolved.anchor(targetDoc) : null;
    return getElementPreviewText(target);
  } catch {
    return "";
  }
}

function getFootnotePreviewKey(anchor: HTMLAnchorElement, href?: string | null): string {
  return [
    anchor.ownerDocument.location?.href || "",
    anchor.getAttribute("href") || href || "",
    anchor.textContent?.trim() || "",
  ].join("::");
}

function getAnchorPreviewPosition(
  anchor: HTMLAnchorElement,
  container: HTMLElement | null,
): Omit<FootnotePreview, "key" | "text"> | null {
  if (!container) return null;
  const rect = anchor.getBoundingClientRect();
  const iframe = anchor.ownerDocument.defaultView?.frameElement as HTMLIFrameElement | null;
  const iframeRect = iframe?.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const scaleX =
    iframe && iframe.clientWidth > 0 && iframeRect ? iframeRect.width / iframe.clientWidth : 1;
  const scaleY =
    iframe && iframe.clientHeight > 0 && iframeRect ? iframeRect.height / iframe.clientHeight : 1;
  const anchorX =
    (iframeRect?.left ?? 0) + rect.left * scaleX + (rect.width * scaleX) / 2 - containerRect.left;
  const anchorTop = (iframeRect?.top ?? 0) + rect.top * scaleY - containerRect.top;
  const anchorBottom = anchorTop + rect.height * scaleY;
  const width = Math.max(180, Math.min(360, containerRect.width - 32));
  const maxLeft = Math.max(16, containerRect.width - width - 16);
  const left = Math.max(16, Math.min(maxLeft, anchorX - width / 2));
  const belowTop = anchorBottom + 12;
  const belowSpace = containerRect.height - belowTop - 16;
  const aboveSpace = anchorTop - 16;
  const placement = belowSpace < 120 && aboveSpace > belowSpace ? "above" : "below";
  const maxHeight =
    placement === "above"
      ? Math.max(96, Math.min(260, aboveSpace - 10))
      : Math.max(96, Math.min(260, belowSpace));
  const top = Math.max(16, Math.min(containerRect.height - maxHeight - 16, belowTop));
  return {
    left,
    width,
    maxHeight,
    placement,
    ...(placement === "above"
      ? { bottom: Math.max(16, containerRect.height - anchorTop + 10) }
      : { top }),
  };
}

// Polyfills required by foliate-js
// biome-ignore lint: polyfill for foliate-js
(Object as any).groupBy ??= (
  iterable: Iterable<unknown>,
  callbackfn: (value: unknown, index: number) => string,
) => {
  const obj = Object.create(null);
  let i = 0;
  for (const value of iterable) {
    const key = callbackfn(value, i++);
    if (key in obj) obj[key].push(value);
    else obj[key] = [value];
  }
  return obj;
};

// biome-ignore lint: polyfill for foliate-js
(Map as any).groupBy ??= (
  iterable: Iterable<unknown>,
  callbackfn: (value: unknown, index: number) => unknown,
) => {
  const map = new Map();
  let i = 0;
  for (const value of iterable) {
    const key = callbackfn(value, i++);
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  }
  return map;
};

/** Relocate event detail from foliate-view */
export interface RelocateDetail {
  fraction?: number;
  section?: { current: number; total: number };
  location?: { current: number; next: number; total: number };
  page?: { current: number; total: number };
  tocItem?: { label?: string; href?: string; id?: number };
  cfi?: string;
  time?: { section: number; total: number };
  range?: Range;
}

/** Section load event detail */
export interface SectionLoadDetail {
  doc?: Document;
  index?: number;
}

/** Converted TOC item for UI consumption */
export interface TOCItem {
  id: string;
  title: string;
  level: number;
  href?: string;
  index?: number;
  subitems?: TOCItem[];
}

/** Selection from book content */
export interface BookSelection {
  text: string;
  cfi?: string;
  chapterIndex?: number;
  rects: DOMRect[];
  range?: Range; // Original range for re-selection
  annotated?: boolean; // true if this is an existing annotation
  highlightId?: string; // the existing highlight's id
  color?: string; // the existing highlight's color
}

export interface TTSSegmentDetail {
  text: string;
  cfi: string;
}

/** Imperative handle exposed to parent via ref */
export interface FoliateViewerHandle {
  goNext: () => void;
  goPrev: () => void;
  goToHref: (href: string) => void;
  goToFraction: (fraction: number) => void;
  goToCFI: (cfi: string) => Promise<void>;
  goToIndex: (index: number) => void;
  highlightCFITemporarily: (cfi: string, duration?: number) => void;
  // biome-ignore lint: foliate-js annotation format
  addAnnotation: (annotation: any, remove?: boolean) => void;
  // biome-ignore lint: foliate-js annotation format
  deleteAnnotation: (annotation: any) => void;
  search: (opts: {
    query: string;
    matchCase?: boolean;
    wholeWords?: boolean;
  }) => AsyncGenerator | null;
  clearSearch: () => void;
  getView: () => FoliateView | null;
  /** Get visible text on the current page for TTS */
  getVisibleText: () => string;
  getVisibleTTSSegments: (alignCfi?: string | null) => Promise<TTSSegmentDetail[]>;
  getTTSSegmentContext: (
    cfi: string,
    before?: number,
    after?: number,
  ) => Promise<{ before: TTSSegmentDetail[]; after: TTSSegmentDetail[] }>;
  setTTSHighlight: (cfi: string | null, color?: string) => Promise<void>;
  /** Extract all paragraphs from current section for chapter translation */
  getChapterParagraphs: () => ChapterParagraph[];
  /** Inject translated paragraphs below each original paragraph */
  injectChapterTranslations: (
    results: ChapterTranslationResult[],
    visibility?: { originalVisible: boolean; translationVisible: boolean },
  ) => Promise<void>;
  /** Remove all injected chapter translation elements */
  removeChapterTranslations: () => void;
  /** Apply visibility settings to original and translation elements */
  applyChapterTranslationVisibility: (
    originalVisible: boolean,
    translationVisible: boolean,
  ) => void;
  /** Inject ruby (pinyin/furigana) annotations into current document */
  injectRuby: (mode: "zh-pinyin" | "zh-zhuyin" | "ja") => Promise<void>;
  /** Remove all ruby annotations from current document */
  removeRuby: () => Promise<void>;
}

interface FoliateViewerProps {
  bookKey: string;
  bookDoc: BookDoc;
  format: BookFormat;
  viewSettings: ViewSettings;
  lastLocation?: string;
  onRelocate?: (detail: RelocateDetail) => void;
  onTocReady?: (toc: TOCItem[]) => void;
  onLoaded?: () => void;
  onSectionLoad?: (index: number) => void;
  onError?: (error: Error) => void;
  onSelection?: (selection: BookSelection | null) => void;
  onShowAnnotation?: (cfi: string, range: Range, index: number) => void;
  onToggleSearch?: () => void;
  onToggleToc?: () => void;
  onToggleChat?: () => void;
}

interface LinkEventDetail {
  a?: HTMLAnchorElement;
  href?: string;
}

interface FootnotePreview {
  key: string;
  text: string;
  left: number;
  width: number;
  maxHeight: number;
  placement: "above" | "below";
  top?: number;
  bottom?: number;
}

export const FoliateViewer = forwardRef<FoliateViewerHandle, FoliateViewerProps>(
  function FoliateViewer(
    {
      bookKey,
      bookDoc,
      format,
      viewSettings,
      lastLocation,
      onRelocate,
      onTocReady,
      onLoaded,
      onSectionLoad,
      onError,
      onSelection,
      onShowAnnotation,
      onToggleSearch,
      onToggleToc,
      onToggleChat,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<FoliateView | null>(null);
    const isViewCreated = useRef(false);
    const [loading, setLoading] = useState(true);
    const [footnotePreview, setFootnotePreview] = useState<FootnotePreview | null>(null);
    const activeFootnoteKeyRef = useRef<string | null>(null);

    const isFixedLayout = isFixedLayoutBook(format, bookDoc);
    // Track when view is ready so hooks/events re-bind
    const [viewReady, setViewReady] = useState(false);

    // Track app theme for reader styling
    const [appTheme, setAppTheme] = useState<AppTheme>(() => getAppTheme());
    const pendingStyleUpdateRef = useRef(false);
    const ttsHighlightStateRef = useRef<{ cfi: string | null; color: string }>({
      cfi: null,
      color: "rgba(96, 165, 250, 0.35)",
    });

    // Listen for theme changes
    useEffect(() => {
      const observer = new MutationObserver(() => {
        const newTheme = getAppTheme();
        setAppTheme((prev) => {
          if (prev !== newTheme) {
            // Theme changed, re-apply styles
            const view = viewRef.current;
            if (view && viewReady) {
              applyRendererStyles(view, viewSettings, isFixedLayout, newTheme);
            }
            return newTheme;
          }
          return prev;
        });
      });

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });

      return () => observer.disconnect();
    }, [viewSettings, isFixedLayout, viewReady]);

    const ttsHighlightKeyRef = useRef<string | null>(null);

    const clearTTSHighlight = useCallback(() => {
      ttsHighlightStateRef.current.cfi = null;
      const prev = ttsHighlightKeyRef.current;
      ttsHighlightKeyRef.current = null;
      if (prev && viewRef.current) {
        try {
          viewRef.current.deleteAnnotation({ value: prev });
        } catch {
          // no-op
        }
      }
    }, []);

    const getScrollNavigationDistance = useCallback(() => {
      const renderer = viewRef.current?.renderer;
      const size = Number(renderer?.size ?? 0);
      const fallbackSize =
        containerRef.current?.clientHeight && containerRef.current.clientHeight > 0
          ? containerRef.current.clientHeight
          : window.innerHeight;
      return Math.max(1, (Number.isFinite(size) && size > 0 ? size : fallbackSize) - 96);
    }, []);

    const goNextByMode = useCallback(() => {
      const view = viewRef.current;
      if (!view) return;
      console.log("[ReaderTap][viewer:navigate]", {
        action: "next",
        scrolled: !!view.renderer?.scrolled,
        rendererStart: view.renderer?.start,
        rendererEnd: view.renderer?.end,
        rendererPage: view.renderer?.page,
        rendererPages: view.renderer?.pages,
      });
      if (view.renderer?.scrolled) {
        void view.next(getScrollNavigationDistance());
        return;
      }
      void view.next();
    }, [getScrollNavigationDistance]);

    const goPrevByMode = useCallback(() => {
      const view = viewRef.current;
      if (!view) return;
      console.log("[ReaderTap][viewer:navigate]", {
        action: "prev",
        scrolled: !!view.renderer?.scrolled,
        rendererStart: view.renderer?.start,
        rendererEnd: view.renderer?.end,
        rendererPage: view.renderer?.page,
        rendererPages: view.renderer?.pages,
      });
      if (view.renderer?.scrolled) {
        void view.prev(getScrollNavigationDistance());
        return;
      }
      void view.prev();
    }, [getScrollNavigationDistance]);

    const ensureDesktopTTS = useCallback(async () => {
      const view = viewRef.current;
      const getPrimaryContent = () => {
        const contents = getRendererContents(view);
        const primaryIndex = view?.renderer?.primaryIndex;
        return (
          contents.find((content) => content?.doc && content.index === primaryIndex) ??
          contents.find((content) => content?.doc) ??
          null
        );
      };
      const current = getPrimaryContent();
      if (!view || !current?.doc) return null;

      await view.initTTS("sentence", (range) => {
        const contents = getRendererContents(view);
        const sourceDoc =
          range.commonAncestorContainer.nodeType === Node.DOCUMENT_NODE
            ? (range.commonAncestorContainer as Document)
            : range.commonAncestorContainer.ownerDocument;
        const active =
          contents.find((content) => content?.doc === sourceDoc) ??
          contents.find(
            (content) => content?.doc && content.index === view.renderer?.primaryIndex,
          ) ??
          contents.find((content) => content?.doc) ??
          null;
        if (!active?.doc || active.index == null || !active.overlayer) return null;

        let cfi: string | null = null;
        try {
          cfi = view.getCFI(active.index, range.cloneRange());
        } catch {
          cfi = null;
        }

        // Use overlayer directly for the TTS engine's internal highlight callback
        // (this runs synchronously during TTS engine cursor movement)
        let renderRange: Range = range;
        let renderTarget = active;
        if (cfi) {
          try {
            const resolved = view.resolveCFI(cfi);
            const target =
              resolved?.index != null
                ? contents.find((content) => content?.doc && content.index === resolved.index)
                : active;
            if (target?.overlayer) renderTarget = target;
            const anchoredRange = resolved?.anchor?.((target ?? active).doc);
            if (anchoredRange) renderRange = anchoredRange;
          } catch {
            renderRange = range;
          }
        }

        for (const content of contents) {
          if (!content?.overlayer) continue;
          try {
            content.overlayer.remove("readany-tts-engine-hl");
          } catch {
            // no-op
          }
        }

        try {
          const overlayer = renderTarget.overlayer;
          if (!overlayer) return cfi;
          overlayer.add("readany-tts-engine-hl", renderRange, Overlayer.highlight, {
            color: ttsHighlightStateRef.current.color || "rgba(96, 165, 250, 0.35)",
          });
        } catch {
          // no-op
        }

        return cfi;
      });

      return view.tts ?? null;
    }, []);

    const getVisibleTTSSegments = useCallback(
      async (alignCfi?: string | null): Promise<TTSSegmentDetail[]> => {
        const view = viewRef.current;
        const renderer = view?.renderer;
        const contents = getRendererContents(view);
        if (!view || !renderer || !contents.length) return [];
        const primaryContent =
          contents.find((content) => content?.doc && content.index === renderer.primaryIndex) ??
          contents.find((content) => content?.doc) ??
          null;

        await ensureDesktopTTS();

        const rangeByDoc = new WeakMap<Document, PaginatedVisibleRange | null>();
        const getVisibleRangeForDoc = (doc: Document) => {
          if (rangeByDoc.has(doc)) return rangeByDoc.get(doc) ?? null;
          const range = pickPaginatedVisibleRange(doc, renderer);
          rangeByDoc.set(doc, range);
          return range;
        };

        const getReaderViewportRect = () => {
          const containerRect = containerRef.current?.getBoundingClientRect();
          const viewportRect = {
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
          };
          if (!containerRect || containerRect.width <= 0 || containerRect.height <= 0) {
            return viewportRect;
          }
          return {
            left: Math.max(containerRect.left, viewportRect.left),
            top: Math.max(containerRect.top, viewportRect.top),
            right: Math.min(containerRect.right, viewportRect.right),
            bottom: Math.min(containerRect.bottom, viewportRect.bottom),
          };
        };

        const mapIframeRectToHost = (rect: DOMRect, doc?: Document | null) => {
          const iframe = doc?.defaultView?.frameElement as HTMLIFrameElement | null;
          if (!iframe) return rect;
          const iframeRect = iframe.getBoundingClientRect();
          const scaleX = iframe.clientWidth > 0 ? iframeRect.width / iframe.clientWidth : 1;
          const scaleY = iframe.clientHeight > 0 ? iframeRect.height / iframe.clientHeight : 1;
          return {
            left: iframeRect.left + rect.left * scaleX,
            top: iframeRect.top + rect.top * scaleY,
            right: iframeRect.left + rect.right * scaleX,
            bottom: iframeRect.top + rect.bottom * scaleY,
            width: rect.width * scaleX,
            height: rect.height * scaleY,
          };
        };

        const isHostRectVisible = (rect: {
          left: number;
          top: number;
          right: number;
          bottom: number;
          width: number;
          height: number;
        }) => {
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const viewport = getReaderViewportRect();
          return (
            rect.right > viewport.left &&
            rect.left < viewport.right &&
            rect.bottom > viewport.top &&
            rect.top < viewport.bottom
          );
        };

        const getContentHostRect = (content: RendererContent) => {
          const doc = content?.doc ?? null;
          const iframe = doc?.defaultView?.frameElement as HTMLIFrameElement | null;
          if (iframe) {
            const rect = iframe.getBoundingClientRect();
            return {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            };
          }
          if (doc?.body) {
            return mapIframeRectToHost(doc.body.getBoundingClientRect(), doc);
          }
          return null;
        };

        const scanContents = renderer.scrolled
          ? contents
              .filter((content) => !!content?.doc)
              .map((content) => ({ content, rect: getContentHostRect(content) }))
              .filter((item) => item.rect && isHostRectVisible(item.rect))
              .sort((a, b) => {
                const topDelta = (a.rect?.top ?? 0) - (b.rect?.top ?? 0);
                return Math.abs(topDelta) > 1
                  ? topDelta
                  : (a.rect?.left ?? 0) - (b.rect?.left ?? 0);
              })
              .map((item) => item.content)
          : contents;

        const isRectVisibleInReader = (rect: DOMRect, doc?: Document | null) => {
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const isPaginated = !renderer.scrolled;
          if (isPaginated) {
            const visibleRange = doc ? getVisibleRangeForDoc(doc) : null;
            return visibleRange ? rectIntersectsPaginatedRange(rect, visibleRange) : false;
          }
          return isHostRectVisible(mapIframeRectToHost(rect, doc));
        };

        // Require the START of the sentence range to be visible on the current page,
        // preventing sentences that began on the previous page from appearing as the
        // first TTS segment.
        const isRangeStartVisibleInReader = (range: Range) => {
          try {
            const doc =
              range.commonAncestorContainer.nodeType === Node.DOCUMENT_NODE
                ? (range.commonAncestorContainer as Document)
                : range.commonAncestorContainer.ownerDocument;
            const rects = Array.from(range.getClientRects());
            if (!rects.length) {
              return isRectVisibleInReader(range.getBoundingClientRect(), doc);
            }
            return isRectVisibleInReader(rects[0], doc);
          } catch {
            return false;
          }
        };

        const blockSelector =
          "p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, figcaption, pre, td, th";
        const lang =
          (primaryContent?.doc as Document | undefined)?.documentElement.lang ||
          (primaryContent?.doc as Document | undefined)?.documentElement.getAttribute("xml:lang") ||
          (primaryContent?.doc as Document | undefined)?.body.lang ||
          navigator.language ||
          "en";
        const SegmenterCtor = (
          Intl as typeof Intl & {
            Segmenter?: new (
              locales?: string | string[],
              options?: { granularity?: "grapheme" | "word" | "sentence" },
            ) => {
              segment(input: string): Iterable<{ index: number; segment: string }>;
            };
          }
        ).Segmenter;
        const segmenter = SegmenterCtor
          ? new SegmenterCtor(lang, { granularity: "sentence" })
          : null;

        const segments: TTSSegmentDetail[] = [];
        const seenVisibleIdentities = new Set<string>();
        for (const current of scanContents) {
          const doc = current?.doc as Document | undefined;
          const sectionIndex = current?.index ?? 0;
          if (!doc) continue;

          let visibleBlocks = Array.from(doc.querySelectorAll(blockSelector)).filter((block) => {
            if (!block.textContent?.trim()) return false;
            if (shouldSkipTTSNode(block)) return false;
            return isRectVisibleInReader(block.getBoundingClientRect(), doc);
          });

          // Fallback: if no standard block elements found (e.g., epub uses only
          // <div>/<span> for text), try broader selectors
          if (visibleBlocks.length === 0) {
            visibleBlocks = Array.from(doc.querySelectorAll("div, section, article, span")).filter(
              (el) => {
                if (!el.textContent?.trim()) return false;
                if (shouldSkipTTSNode(el)) return false;
                // Only leaf-level elements with direct text content
                if (el.querySelector("div, section, article, p")) return false;
                return isRectVisibleInReader(el.getBoundingClientRect(), doc);
              },
            );
          }

          // Last resort for unusual books. In scrolled mode this is only safe
          // when the document belongs to a real iframe, because visibility must
          // be measured against the outer reader viewport rather than the
          // iframe's full document height.
          if (
            visibleBlocks.length === 0 &&
            doc.body?.textContent?.trim() &&
            (!renderer.scrolled || doc.defaultView?.frameElement) &&
            isRectVisibleInReader(doc.body.getBoundingClientRect(), doc)
          ) {
            visibleBlocks = [doc.body];
          }

          for (const block of visibleBlocks) {
            const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
              acceptNode: acceptTTSNode,
            });

            const positionedNodes: Array<{ node: Text; start: number; end: number }> = [];
            let absoluteText = "";
            for (
              let textNode = walker.nextNode() as Text | null;
              textNode;
              textNode = walker.nextNode() as Text | null
            ) {
              const text = textNode.nodeValue || "";
              const start = absoluteText.length;
              absoluteText += text;
              positionedNodes.push({ node: textNode, start, end: absoluteText.length });
            }
            if (!absoluteText.trim() || positionedNodes.length === 0) continue;

            const rawSegments = segmenter
              ? Array.from(segmenter.segment(absoluteText)).map(
                  (item: { index: number; segment: string }) => ({
                    start: item.index,
                    end: item.index + item.segment.length,
                  }),
                )
              : (absoluteText.match(/[^。！？!?；;\n]+[。！？!?；;…]?/gu) || [absoluteText]).reduce<
                  Array<{ start: number; end: number }>
                >((acc, sentence) => {
                  const last = acc.length > 0 ? acc[acc.length - 1] : null;
                  const start = absoluteText.indexOf(sentence, last?.end ?? 0);
                  if (start >= 0) acc.push({ start, end: start + sentence.length });
                  return acc;
                }, []);

            const resolvePosition = (absoluteOffset: number, isEnd: boolean) => {
              for (const item of positionedNodes) {
                if (absoluteOffset < item.end || (isEnd && absoluteOffset <= item.end)) {
                  return {
                    node: item.node,
                    offset: Math.max(
                      0,
                      Math.min(item.node.nodeValue?.length ?? 0, absoluteOffset - item.start),
                    ),
                  };
                }
              }
              const last = positionedNodes[positionedNodes.length - 1];
              return { node: last.node, offset: last.node.nodeValue?.length ?? 0 };
            };

            for (const rawSegment of rawSegments.length
              ? rawSegments
              : [{ start: 0, end: absoluteText.length }]) {
              let start = rawSegment.start;
              let end = rawSegment.end;
              while (start < end && /\s/u.test(absoluteText[start] ?? "")) start++;
              while (end > start && /\s/u.test(absoluteText[end - 1] ?? "")) end--;
              if (end - start < 2) continue;

              const startPos = resolvePosition(start, false);
              const endPos = resolvePosition(end, true);
              if (!startPos || !endPos) continue;

              const range = doc.createRange();
              range.setStart(startPos.node, startPos.offset);
              range.setEnd(endPos.node, endPos.offset);
              if (!isRangeStartVisibleInReader(range)) continue;

              const text = normalizeTTSSegmentText(absoluteText.slice(start, end));
              if (!text) continue;

              try {
                const cfi = view.getCFI(sectionIndex, range);
                const identity = getTTSSegmentIdentity(cfi, text);
                if (cfi && !seenVisibleIdentities.has(identity)) {
                  seenVisibleIdentities.add(identity);
                  segments.push({ text, cfi });
                }
              } catch {
                // skip segment if CFI resolution fails
              }
            }
          }
        }

        const tts = view.tts as null | {
          alignCfi?: (cfi: string) => { text?: string; cfi?: string } | null;
          currentDetail?: () => { text?: string; cfi?: string } | null;
          collectDetails?: (
            count?: number,
            options?: { includeCurrent?: boolean; offset?: number },
          ) => Array<{ text?: string; cfi?: string }>;
        };

        if (segments.length > 0 && tts) {
          try {
            const alignTargetCfi = alignCfi || segments[0]?.cfi;
            if (!alignTargetCfi) return segments;
            if (typeof tts.alignCfi === "function") {
              tts.alignCfi(alignTargetCfi);
            } else if (
              typeof (tts as { highlightCfi?: (cfi: string) => unknown }).highlightCfi ===
              "function"
            ) {
              (tts as { highlightCfi: (cfi: string) => unknown }).highlightCfi(alignTargetCfi);
            }
            const currentDetail =
              typeof tts.currentDetail === "function" ? tts.currentDetail() : null;
            const followingDetails =
              typeof tts.collectDetails === "function"
                ? tts.collectDetails(
                    Math.max(
                      0,
                      Math.max(segments.length, alignCfi ? 12 : segments.length) -
                        (currentDetail ? 1 : 0),
                    ),
                    {
                      includeCurrent: false,
                      offset: 1,
                    },
                  )
                : [];
            const seenAlignedIdentities = new Set<string>();
            const alignedSegments = [currentDetail, ...(followingDetails || [])]
              .filter(
                (detail): detail is { text: string; cfi: string } =>
                  !!detail?.text && !!detail?.cfi,
              )
              .map((detail) => ({
                text: normalizeTTSSegmentText(detail.text),
                cfi: detail.cfi,
              }))
              .filter((detail) => {
                const identity = getTTSSegmentIdentity(detail.cfi, detail.text);
                if (!detail.text || seenAlignedIdentities.has(identity)) {
                  return false;
                }
                seenAlignedIdentities.add(identity);
                return true;
              });
            if (alignedSegments.length > 0) {
              let returnedSegments = segments;
              let returnSource = "direct-visible";
              if (segments.length > 0) {
                const visibleIdentities = new Set(
                  segments.map((segment) => getTTSSegmentIdentity(segment.cfi, segment.text)),
                );
                const filtered = alignedSegments.filter((segment) =>
                  visibleIdentities.has(getTTSSegmentIdentity(segment.cfi, segment.text)),
                );
                if (filtered.length === segments.length) {
                  returnedSegments = filtered;
                  returnSource = "aligned-filtered";
                } else if (filtered.length > 0) {
                  returnedSegments = segments;
                  returnSource = "direct-partial-filtered-fallback";
                } else if (alignCfi) {
                  const alignedStart = alignedSegments[0] || null;
                  const alignedStartIdentity = alignedStart
                    ? getTTSSegmentIdentity(alignedStart.cfi, alignedStart.text)
                    : null;
                  const visibleStartIndex = alignedStartIdentity
                    ? segments.findIndex(
                        (segment) =>
                          getTTSSegmentIdentity(segment.cfi, segment.text) === alignedStartIdentity,
                      )
                    : -1;
                  if (visibleStartIndex >= 0) {
                    returnedSegments = segments.slice(visibleStartIndex);
                    returnSource = "direct-aligned-slice";
                  } else {
                    returnedSegments = segments;
                    returnSource = "direct-fallback";
                  }
                } else {
                  returnedSegments = segments;
                  returnSource = "direct-visible";
                }
              }
              console.log("[FoliateViewer][TTS] visibleTTSSegments", {
                alignCfi: alignCfi || null,
                contentsCount: contents.length,
                scannedContentsCount: scanContents.length,
                directCount: segments.length,
                alignedCount: alignedSegments.length,
                returnedCount: returnedSegments.length,
                returnSource,
                firstVisibleText: segments[0]?.text || null,
              });
              return returnedSegments;
            }
          } catch {
            // fall through to manual segments
          }
        }

        console.log("[FoliateViewer][TTS] visibleTTSSegments", {
          alignCfi: alignCfi || null,
          contentsCount: contents.length,
          scannedContentsCount: scanContents.length,
          directCount: segments.length,
          alignedCount: 0,
          returnedCount: segments.length,
          returnSource: "direct",
          firstVisibleText: segments[0]?.text || null,
        });
        return segments;
      },
      [ensureDesktopTTS],
    );

    const getTTSSegmentContext = useCallback(
      async (
        cfi: string,
        before = 10,
        after = 10,
      ): Promise<{ before: TTSSegmentDetail[]; after: TTSSegmentDetail[] }> => {
        const tts = await ensureDesktopTTS();
        if (!tts || !cfi) return { before: [], after: [] };

        try {
          if (typeof tts.alignCfi === "function") {
            tts.alignCfi(cfi);
          } else if (
            typeof (tts as { highlightCfi?: (value: string) => unknown }).highlightCfi ===
            "function"
          ) {
            (tts as { highlightCfi: (value: string) => unknown }).highlightCfi(cfi);
          }
        } catch {
          return { before: [], after: [] };
        }

        const currentDetail = typeof tts.currentDetail === "function" ? tts.currentDetail() : null;
        const currentIdentity =
          currentDetail?.text && currentDetail?.cfi
            ? getTTSSegmentIdentity(currentDetail.cfi, currentDetail.text)
            : null;

        const normalize = (details: Array<{ text?: string; cfi?: string }>) => {
          const seen = new Set<string>();
          const result: TTSSegmentDetail[] = [];
          for (const detail of details) {
            if (!detail?.text || !detail?.cfi) continue;
            const text = normalizeTTSSegmentText(detail.text);
            const identity = getTTSSegmentIdentity(detail.cfi, text);
            if (!text || (currentIdentity && identity === currentIdentity) || seen.has(identity)) {
              continue;
            }
            seen.add(identity);
            result.push({ text, cfi: detail.cfi });
          }
          return result;
        };

        const beforeDetails =
          typeof tts.collectDetails === "function"
            ? tts.collectDetails(Math.max(0, before), {
                includeCurrent: false,
                offset: -Math.max(0, before),
              })
            : [];
        const afterDetails =
          typeof tts.collectDetails === "function"
            ? tts.collectDetails(Math.max(0, after), {
                includeCurrent: false,
                offset: 1,
              })
            : [];

        return {
          before: normalize(beforeDetails),
          after: normalize(afterDetails),
        };
      },
      [ensureDesktopTTS],
    );

    // --- Imperative handle for parent ---
    useImperativeHandle(
      ref,
      () => ({
        goNext: () => {
          goNextByMode();
        },
        goPrev: () => {
          goPrevByMode();
        },
        goToHref: (href: string) => {
          viewRef.current?.goTo(href);
        },
        goToFraction: (fraction: number) => {
          viewRef.current?.goToFraction(fraction);
        },
        goToCFI: async (cfi: string) => {
          await viewRef.current?.goTo(cfi);
        },
        goToIndex: (index: number) => {
          viewRef.current?.goTo(index);
        },
        highlightCFITemporarily: (cfi: string, duration = 1000) => {
          const view = viewRef.current;
          console.log("[highlightCFITemporarily] Called with CFI:", cfi);

          if (!view) {
            console.warn("[highlightCFITemporarily] View is null, cannot highlight");
            return;
          }

          const tempKey = `readany-temp-tts:${cfi}`;
          const paintTemporaryHighlight = (attempt = 0) => {
            try {
              const resolved = view.resolveCFI?.(cfi);
              const targetIndex = resolved?.index ?? null;
              const content =
                targetIndex == null
                  ? null
                  : view.renderer
                      ?.getContents?.()
                      ?.find((item: { index?: number }) => item.index === targetIndex);
              const doc = content?.doc ?? null;
              const overlayer = content?.overlayer ?? null;
              const anchoredRange =
                doc && typeof resolved?.anchor === "function" ? resolved.anchor(doc) : null;

              if (!overlayer || !anchoredRange) {
                if (attempt < 4) {
                  window.setTimeout(() => paintTemporaryHighlight(attempt + 1), 120);
                }
                return;
              }

              try {
                overlayer.remove(tempKey);
              } catch {
                // no-op
              }

              overlayer.add(tempKey, anchoredRange, Overlayer.highlight, {
                color: "rgba(96, 165, 250, 0.4)",
              });

              console.log(
                "[highlightCFITemporarily] Annotation added, will remove in",
                duration,
                "ms",
              );

              window.setTimeout(() => {
                console.log("[highlightCFITemporarily] Removing annotation for CFI:", cfi);
                try {
                  overlayer.remove(tempKey);
                  console.log("[highlightCFITemporarily] Annotation removed successfully");
                } catch (deleteError) {
                  console.error(
                    "[highlightCFITemporarily] Error removing annotation:",
                    deleteError,
                  );
                }
              }, duration);
            } catch (error) {
              console.error("[highlightCFITemporarily] Error adding temporary highlight:", error);
            }
          };

          paintTemporaryHighlight(0);
        },
        addAnnotation: (annotation: unknown, remove?: boolean) => {
          viewRef.current?.addAnnotation(annotation, remove);
        },
        deleteAnnotation: (annotation: unknown) => {
          viewRef.current?.deleteAnnotation(annotation);
        },
        search: (opts: { query: string; matchCase?: boolean; wholeWords?: boolean }) => {
          if (!viewRef.current) return null;
          return viewRef.current.search(opts);
        },
        clearSearch: () => {
          viewRef.current?.clearSearch();
        },
        getView: () => viewRef.current,
        getVisibleText: () => {
          try {
            const renderer = viewRef.current?.renderer;
            const contents = renderer?.getContents?.();
            if (!contents?.[0]?.doc) return "";
            const doc = contents[0].doc as Document;

            // In paginated mode (CSS columns), the iframe is expanded to the
            // full content width. The outer container scrolls to show the
            // current "page". We must use the paginator's scroll position to
            // determine which text nodes are actually visible.
            const isPaginated = !renderer.scrolled;
            const pSize = renderer.size; // container visible width (one page)
            const pStart = renderer.start; // abs(scrollLeft)

            if (isPaginated && pSize > 0) {
              // In paginated mode, first page starts at scroll offset = pSize
              // (page 0 is padding). So visible range in iframe coords is
              // [start - size, end - size].
              const visibleLeft = pStart - pSize;
              const visibleRight = pStart; // end - size = (start + size) - size = start

              const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
                acceptNode: acceptTTSNode,
              });

              const visibleTexts: string[] = [];
              let textNode = walker.nextNode();
              while (textNode) {
                const range = doc.createRange();
                range.selectNodeContents(textNode);
                const rect = range.getBoundingClientRect();
                if (rect.right > visibleLeft && rect.left < visibleRight && rect.width > 0) {
                  const text = normalizeTTSSegmentText(textNode.nodeValue);
                  if (text) visibleTexts.push(text);
                }
                textNode = walker.nextNode();
              }
              const result = visibleTexts.join(" ").trim();
              if (result) return result;
            } else {
              // Scrolled mode: use iframe viewport dimensions
              const win = doc.defaultView;
              if (win) {
                const vw = win.innerWidth;
                const vh = win.innerHeight;

                const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
                  acceptNode: acceptTTSNode,
                });

                const visibleTexts: string[] = [];
                let textNode = walker.nextNode();
                while (textNode) {
                  const range = doc.createRange();
                  range.selectNodeContents(textNode);
                  const rect = range.getBoundingClientRect();
                  if (
                    rect.right > 0 &&
                    rect.left < vw &&
                    rect.bottom > 0 &&
                    rect.top < vh &&
                    rect.width > 0
                  ) {
                    const text = normalizeTTSSegmentText(textNode.nodeValue);
                    if (text) visibleTexts.push(text);
                  }
                  textNode = walker.nextNode();
                }
                const result = visibleTexts.join(" ").trim();
                if (result) return result;
              }
            }

            // Fallback: return full section text
            return normalizeTTSSegmentText(doc.body?.innerText);
          } catch {
            return "";
          }
        },
        getVisibleTTSSegments,
        getTTSSegmentContext,
        setTTSHighlight: async (cfi: string | null, color?: string) => {
          ttsHighlightStateRef.current = {
            cfi,
            color: color || "rgba(96, 165, 250, 0.35)",
          };
          if (!cfi) {
            clearTTSHighlight();
            return;
          }

          const view = viewRef.current;
          if (!view) return;

          // Use foliate-tts: prefix so the key never collides with user annotation CFIs
          const key = `foliate-tts:${cfi}`;
          const prev = ttsHighlightKeyRef.current;
          ttsHighlightKeyRef.current = key;

          if (prev && prev !== key) {
            try {
              await view.deleteAnnotation({ value: prev });
            } catch {
              // no-op
            }
          }

          try {
            await view.addAnnotation({
              value: key,
              type: "tts-highlight",
              color: color || "rgba(96, 165, 250, 0.35)",
            });
          } catch {
            // no-op
          }
        },
        getChapterParagraphs: () => {
          try {
            const renderer = viewRef.current?.renderer;
            const contents = renderer?.getContents?.();
            if (!contents?.[0]?.doc) return [];
            const doc = contents[0].doc as Document;

            const blockSelector =
              "p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, figcaption, pre, td, th";
            const blocks = doc.querySelectorAll(blockSelector);
            const paragraphs: ChapterParagraph[] = [];

            blocks.forEach((el, i) => {
              const text = (el as HTMLElement).innerText?.trim() || el.textContent?.trim() || "";
              if (text.length < 2) return;
              const id = `para_${i}`;
              (el as HTMLElement).setAttribute("data-translate-id", id);
              paragraphs.push({
                id,
                text,
                tagName: el.tagName.toLowerCase(),
              });
            });

            return paragraphs;
          } catch {
            return [];
          }
        },
        injectChapterTranslations: async (
          results: ChapterTranslationResult[],
          visibility = { originalVisible: true, translationVisible: true },
        ) => {
          try {
            const view = viewRef.current;
            const renderer = view?.renderer;
            const contents = renderer?.getContents?.();
            if (!contents?.[0]?.doc) return;
            const doc = contents[0].doc as Document;

            // Inject translation CSS once
            if (!doc.getElementById("readany-chapter-translation-style")) {
              const style = doc.createElement("style");
              style.id = "readany-chapter-translation-style";
              style.textContent = `
                .readany-translation {
                  color: #6b7280;
                  font-size: 0.9em;
                  line-height: 1.5;
                  margin-top: 4px;
                  margin-bottom: 8px;
                  padding-left: 8px;
                  border-left: 2px solid #d1d5db;
                  opacity: 0.85;
                }
                .readany-translation[data-hidden="true"] { display: none; }
                .readany-translation[data-solo="true"] {
                  color: inherit;
                  font-size: inherit;
                  line-height: inherit;
                  margin-top: 0;
                  margin-bottom: 0.8em;
                  padding-left: 0;
                  border-left: none;
                  opacity: 1;
                }
                [data-translate-id][data-original-hidden="true"] { display: none; }
                @media (prefers-color-scheme: dark) {
                  .readany-translation { color: #9ca3af; border-left-color: #4b5563; }
                }
              `;
              doc.head.appendChild(style);
            }

            for (const result of results) {
              if (!result.translatedText) continue;
              const el = doc.querySelector(
                `[data-translate-id="${result.paragraphId}"]`,
              ) as HTMLElement | null;
              if (!el) continue;
              el.setAttribute("data-original-hidden", String(!visibility.originalVisible));
              // Skip if already injected
              if (el.nextElementSibling?.classList?.contains("readany-translation")) {
                const existing = el.nextElementSibling as HTMLElement;
                existing.setAttribute("data-hidden", String(!visibility.translationVisible));
                existing.setAttribute(
                  "data-solo",
                  String(!visibility.originalVisible && visibility.translationVisible),
                );
                continue;
              }

              const div = doc.createElement("div");
              div.className = "readany-translation";
              div.setAttribute("data-para-id", result.paragraphId);
              div.setAttribute("data-hidden", String(!visibility.translationVisible));
              div.setAttribute(
                "data-solo",
                String(!visibility.originalVisible && visibility.translationVisible),
              );
              div.textContent = result.translatedText;
              el.parentNode?.insertBefore(div, el.nextSibling);
            }

            await waitForReaderLayoutStable(view);
          } catch (err) {
            console.error("[injectChapterTranslations] Error:", err);
          }
        },
        removeChapterTranslations: () => {
          try {
            const renderer = viewRef.current?.renderer;
            const contents = renderer?.getContents?.();
            if (!contents?.[0]?.doc) return;
            const doc = contents[0].doc as Document;

            const elements = doc.querySelectorAll(".readany-translation");
            elements.forEach((el) => el.remove());

            const style = doc.getElementById("readany-chapter-translation-style");
            style?.remove();
          } catch (err) {
            console.error("[removeChapterTranslations] Error:", err);
          }
        },
        applyChapterTranslationVisibility: (
          originalVisible: boolean,
          translationVisible: boolean,
        ) => {
          try {
            const renderer = viewRef.current?.renderer;
            const contents = renderer?.getContents?.();
            if (!contents?.[0]?.doc) return;
            const doc = contents[0].doc as Document;

            // Update original paragraphs visibility
            const originalParagraphs = doc.querySelectorAll("[data-translate-id]");
            originalParagraphs.forEach((el) => {
              (el as HTMLElement).setAttribute("data-original-hidden", String(!originalVisible));
            });

            // Update translation visibility
            const translations = doc.querySelectorAll(".readany-translation");
            translations.forEach((el) => {
              const translationEl = el as HTMLElement;
              translationEl.setAttribute("data-hidden", String(!translationVisible));
              // If only translation is visible (no original), apply solo style
              translationEl.setAttribute(
                "data-solo",
                String(!originalVisible && translationVisible),
              );
            });
          } catch (err) {
            console.error("[applyChapterTranslationVisibility] Error:", err);
          }
        },
        injectRuby: async (mode: "zh-pinyin" | "zh-zhuyin" | "ja") => {
          try {
            const renderer = viewRef.current?.renderer;
            const contents = renderer?.getContents?.();
            if (!contents?.[0]?.doc) return;
            const doc = contents[0].doc as Document;
            // Ensure dict is loaded
            if (mode.startsWith("zh")) {
              const { isPinyinDictLoaded } = await import("@/lib/ruby/pinyin-processor");
              if (!isPinyinDictLoaded()) {
                const { tryLoadExistingDict } = await import("@/lib/ruby/dict-service");
                await tryLoadExistingDict("zh");
              }
            }
            const { injectRubyAnnotations } = await import("@/lib/ruby/ruby-injector");
            injectRubyAnnotations(doc, mode);
          } catch (err) {
            console.warn("[injectRuby] Error:", err);
          }
        },
        removeRuby: async () => {
          try {
            const renderer = viewRef.current?.renderer;
            const contents = renderer?.getContents?.();
            if (!contents?.[0]?.doc) return;
            const doc = contents[0].doc as Document;
            const { removeRubyAnnotations } = await import("@/lib/ruby/ruby-injector");
            removeRubyAnnotations(doc);
          } catch (err) {
            console.warn("[removeRuby] Error:", err);
          }
        },
      }),
      [viewReady],
    );

    // --- Hooks ---
    usePagination({ bookKey, viewRef, containerRef, isFixedLayout });
    useBookShortcuts({
      bookKey,
      viewRef,
      onToggleSearch,
      onToggleToc,
      onToggleChat,
    });

    // --- Convert TOC ---
    const convertTOC = useCallback(
      (
        foliaToc: Array<{
          id?: number;
          label?: string;
          href?: string;
          subitems?: unknown[];
        }>,
        level = 0,
      ): TOCItem[] => {
        if (!foliaToc) return [];
        return foliaToc.map((item, i) => ({
          id: String(item.id ?? `toc-${level}-${i}`),
          title: item.label || `Chapter ${i + 1}`,
          level,
          href: item.href,
          index: i,
          subitems:
            item.subitems && Array.isArray(item.subitems) && item.subitems.length > 0
              ? convertTOC(
                  item.subitems as Array<{
                    id?: number;
                    label?: string;
                    href?: string;
                    subitems?: unknown[];
                  }>,
                  level + 1,
                )
              : undefined,
        }));
      },
      [clearTTSHighlight, ensureDesktopTTS, getVisibleTTSSegments],
    );

    // --- Section load handler ---
    // Use stable ref-based handler so openBook can register it once and it always
    // dispatches to the latest callback, avoiding stale closures and duplicate listeners.
    const docLoadHandlerImpl = useCallback(
      (event: Event) => {
        const detail = (event as CustomEvent).detail as SectionLoadDetail;
        if (!detail.doc) return;

        // Detect writing direction
        getDirection(detail.doc);

        // Apply theme styles to loaded document
        applyDocumentStyles(detail.doc, viewSettings, isFixedLayout);

        // Register iframe event handlers for this section
        registerIframeEventHandlers(bookKey, detail.doc);

        // Attach selection listener
        attachSelectionListener(detail.doc);

        setLoading(false);
        onLoaded?.();

        // Notify parent that a section has loaded (for re-rendering annotations)
        // This is critical: when switching chapters, foliate-js reloads the content
        // and all annotations need to be re-added
        if (detail.index !== undefined) {
          onSectionLoad?.(detail.index);
        }

        // Inject ruby annotations if enabled for this book
        void (async () => {
          try {
            const { useRubyStore } = await import("@readany/core/stores/ruby-store");
            const rubyMode = useRubyStore.getState().getBookRuby(bookKey);
            if (rubyMode && rubyMode.startsWith("zh")) {
              const { isPinyinDictLoaded } = await import("@/lib/ruby/pinyin-processor");
              // Ensure dict is loaded into memory (may have been downloaded in a previous session)
              if (!isPinyinDictLoaded()) {
                const { tryLoadExistingDict } = await import("@/lib/ruby/dict-service");
                await tryLoadExistingDict("zh");
              }
              if (isPinyinDictLoaded()) {
                const { injectRubyAnnotations } = await import("@/lib/ruby/ruby-injector");
                injectRubyAnnotations(detail.doc as Document, rubyMode);
              }
            }
          } catch (err) {
            console.warn("[FoliateViewer] Ruby injection failed:", err);
          }
        })();
      },
      [bookKey, viewSettings, onLoaded, onSectionLoad, isFixedLayout],
    );
    const docLoadHandlerRef = useRef(docLoadHandlerImpl);
    docLoadHandlerRef.current = docLoadHandlerImpl;

    // --- Relocate handler ---
    const relocateHandlerImpl = useCallback(
      (event: Event) => {
        const rawDetail = (event as CustomEvent).detail as RelocateDetail;
        const rendererPage =
          viewRef.current?.renderer && typeof viewRef.current.renderer.page === "number"
            ? viewRef.current.renderer.page
            : null;
        const rendererPages =
          viewRef.current?.renderer && typeof viewRef.current.renderer.pages === "number"
            ? viewRef.current.renderer.pages
            : null;
        const detail: RelocateDetail =
          rendererPage != null && rendererPages != null && rendererPages > 2
            ? {
                ...rawDetail,
                page: {
                  current: Math.max(1, Math.min(rendererPage, rendererPages - 2)),
                  total: Math.max(1, rendererPages - 2),
                },
              }
            : rawDetail;
        activeFootnoteKeyRef.current = null;
        setFootnotePreview(null);
        onRelocate?.(detail);

        // Update reading context service
        if (detail.tocItem?.label && detail.fraction !== undefined) {
          // Extract visible text from the current page using precise viewport detection
          let surroundingText = "";
          try {
            const renderer = viewRef.current?.renderer;
            const contents = renderer?.getContents?.();
            if (contents?.[0]?.doc) {
              const doc = contents[0].doc as Document;
              const isPaginated = !renderer.scrolled;
              const pSize = renderer.size;
              const pStart = renderer.start;

              if (isPaginated && pSize > 0) {
                const visibleLeft = pStart - pSize;
                const visibleRight = pStart;
                const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
                  acceptNode: acceptTTSNode,
                });
                const visibleTexts: string[] = [];
                let textNode = walker.nextNode();
                while (textNode) {
                  const range = doc.createRange();
                  range.selectNodeContents(textNode);
                  const rect = range.getBoundingClientRect();
                  if (rect.right > visibleLeft && rect.left < visibleRight && rect.width > 0) {
                    const text = normalizeTTSSegmentText(textNode.nodeValue);
                    if (text) visibleTexts.push(text);
                  }
                  textNode = walker.nextNode();
                }
                surroundingText = visibleTexts.join(" ").trim().slice(0, 2000);
              } else {
                const win = doc.defaultView;
                if (win) {
                  const vw = win.innerWidth;
                  const vh = win.innerHeight;
                  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
                    acceptNode: acceptTTSNode,
                  });
                  const visibleTexts: string[] = [];
                  let textNode = walker.nextNode();
                  while (textNode) {
                    const range = doc.createRange();
                    range.selectNodeContents(textNode);
                    const rect = range.getBoundingClientRect();
                    if (
                      rect.right > 0 &&
                      rect.left < vw &&
                      rect.bottom > 0 &&
                      rect.top < vh &&
                      rect.width > 0
                    ) {
                      const text = normalizeTTSSegmentText(textNode.nodeValue);
                      if (text) visibleTexts.push(text);
                    }
                    textNode = walker.nextNode();
                  }
                  surroundingText = visibleTexts.join(" ").trim().slice(0, 2000);
                }
              }

              // Fallback: if no visible text detected, use section text
              if (!surroundingText) {
                const rawText = doc.body?.textContent || "";
                surroundingText = normalizeTTSSegmentText(rawText).slice(0, 2000);
              }
            }
          } catch {
            // Ignore extraction errors
          }

          readingContextService.updateContext({
            bookId: bookKey,
            currentChapter: {
              index: detail.section?.current ?? 0,
              title: detail.tocItem.label,
              href: detail.tocItem.href || "",
            },
            currentPosition: {
              cfi: detail.cfi || "",
              percentage: detail.fraction * 100,
            },
            surroundingText,
          });
        }
      },
      [onRelocate, bookKey],
    );
    const relocateHandlerRef = useRef(relocateHandlerImpl);
    relocateHandlerRef.current = relocateHandlerImpl;

    // Stable wrapper functions that delegate to latest impl via ref
    const docLoadHandler = useCallback((event: Event) => docLoadHandlerRef.current(event), []);
    const relocateHandler = useCallback((event: Event) => relocateHandlerRef.current(event), []);

    const linkHandler = useCallback((event: Event) => {
      const customEvent = event as CustomEvent<LinkEventDetail>;
      const anchor = customEvent.detail?.a;
      const href = customEvent.detail?.href;
      if (!anchor || !isLikelyFootnoteLink(anchor, href)) return;

      event.preventDefault();
      annotationClickedRef.current = true;
      const key = getFootnotePreviewKey(anchor, href);
      if (activeFootnoteKeyRef.current === key) {
        activeFootnoteKeyRef.current = null;
        setFootnotePreview(null);
        return;
      }
      void (async () => {
        const text = await resolveFootnotePreviewText(viewRef.current, anchor, href);
        const position = getAnchorPreviewPosition(anchor, containerRef.current);
        if (!text || !position) {
          activeFootnoteKeyRef.current = null;
          setFootnotePreview(null);
          return;
        }
        activeFootnoteKeyRef.current = key;
        setFootnotePreview({ key, text, ...position });
      })();
    }, []);

    // --- Draw annotation handler ---
    // This is called by foliate-js when an annotation needs to be rendered
    const drawAnnotationHandler = useCallback((event: Event) => {
      const detail = (event as CustomEvent).detail;
      const { draw, annotation, doc, range } = detail;

      if (!draw || !annotation) {
        return;
      }

      // Get color from annotation, default to yellow
      const color = annotation.color || "yellow";

      // Map color names to rgba values for highlight rendering
      // Match readest's HIGHLIGHT_COLOR_HEX with alpha for background highlight
      const colorMap: Record<string, string> = {
        red: "rgba(248, 113, 113, 0.4)", // red-400
        yellow: "rgba(250, 204, 21, 0.4)", // yellow-400
        green: "rgba(74, 222, 128, 0.4)", // green-400
        blue: "rgba(96, 165, 250, 0.4)", // blue-400
        pink: "rgba(236, 72, 153, 0.4)", // pink-400 - ADDED
        purple: "rgba(192, 132, 252, 0.4)", // purple-400
        violet: "rgba(167, 139, 250, 0.4)", // violet-400
      };

      const normalizedColor = typeof color === "string" ? color.trim() : "";
      const isCssColor = /^(#|rgb\(|rgba\(|hsl\(|hsla\()/i.test(normalizedColor);
      const resolvedColor =
        colorMap[normalizedColor] || (isCssColor ? normalizedColor : colorMap.yellow);

      // Check writing mode for vertical text support
      let writingMode = "horizontal-tb";
      let vertical = false;
      if (doc && range) {
        try {
          const node = range.startContainer;
          const el = node.nodeType === 1 ? node : node.parentElement;
          if (el && doc.defaultView) {
            const style = doc.defaultView.getComputedStyle(el);
            writingMode = style.writingMode || "horizontal-tb";
            vertical = writingMode?.includes("vertical") || false;
          }
        } catch {
          // Ignore errors in getting writing mode
        }
      }

      // If annotation has a note, only draw wavy underline (no highlight background)
      if (annotation.note) {
        console.log("[drawAnnotationHandler] Drawing wavy underline (has note)");
        // Track that this CFI has a note
        cfisWithNotes.add(annotation.value);
        // Black wavy underline to indicate note presence — no highlight color
        draw(Overlayer.squiggly, { color: "#000000", width: 1.5, writingMode });
        // Hover tooltip
        if (doc && range) {
          try {
            createNoteTooltip(doc, range, annotation.note, annotation.value);
          } catch {
            // Ignore tooltip creation errors
          }
        }
      } else {
        console.log("[drawAnnotationHandler] Drawing regular highlight (no note)");
        // No note - remove from tracking set if present
        cfisWithNotes.delete(annotation.value);
        // Draw regular highlight
        console.log("[drawAnnotationHandler] Calling draw(Overlayer.highlight) with:", {
          resolvedColor,
          vertical,
        });
        draw(Overlayer.highlight, { color: resolvedColor, vertical });
        console.log("[drawAnnotationHandler] draw() call completed");
      }
    }, []);

    // --- Delete annotation handler ---
    // Clean up tooltip registry when an annotation is removed
    const deleteAnnotationHandler = useCallback((event: Event) => {
      const { value, doc } = (event as CustomEvent).detail;
      if (value) {
        cfisWithNotes.delete(value);
        if (doc) removeNoteTooltip(doc, value);
      }
    }, []);

    // --- Show annotation handler ---
    // This is called when user clicks on an existing annotation
    const onShowAnnotationRef = useRef(onShowAnnotation);
    onShowAnnotationRef.current = onShowAnnotation;

    const showAnnotationHandler = useCallback((event: Event) => {
      const detail = (event as CustomEvent).detail;
      const { value, index, range } = detail;

      if (!value || !range) return;

      // Suppress the pointerup handler from sending iframe-single-click
      // show-annotation fires synchronously before the setTimeout(10ms) in pointerup
      annotationClickedRef.current = true;

      // Always show the same annotation popover for existing highlights, including
      // highlights with notes, so actions like copy remain available.
      onShowAnnotationRef.current?.(value, range, index);
    }, []);

    // --- Selection listener ---
    // Use ref so the pointerup handler always calls the latest onSelection callback,
    // even if the React prop has been updated since the listener was attached.
    const onSelectionRef = useRef(onSelection);
    onSelectionRef.current = onSelection;

    // Track current selection range (for re-selecting when clicking inside selection)
    const currentSelectionRange = useRef<Range | null>(null);
    const currentSelectionIndex = useRef<number | undefined>(undefined);
    // Track if there was a selection before pointerdown (for toolbar toggle prevention)
    const hadSelectionOnPointerDown = useRef(false);
    // Track if show-annotation handler fired (suppress pointerup side effects)
    const annotationClickedRef = useRef(false);

    const attachSelectionListener = useCallback(
      (doc: Document) => {
        // Avoid double-registering
        // biome-ignore lint: runtime flag on Document
        if ((doc as any).__readany_selection_registered) return;
        // biome-ignore lint: runtime flag on Document
        (doc as any).__readany_selection_registered = true;

        let originalScrollLeft = 0;
        let pageDebounceTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingAdvanceDirection: "next" | "prev" | null = null;
        let selectionMonitorTimer: ReturnType<typeof setInterval> | null = null;
        let preventScroll: (() => void) | null = null;
        let pointerUpCleanup: (() => void) | null = null;
        let selectionDragPoint: SelectionDragPoint | null = null;
        let pageAdvanceLockUntil = 0;
        let lockedContainer: HTMLElement | null = null;
        let lockedContainerStyles: {
          scrollSnapType: string;
          scrollBehavior: string;
          overscrollBehaviorX: string;
          overflowX: string;
        } | null = null;

        const getPaginatedContainer = () => {
          try {
            const view = viewRef.current;
            if (!view?.shadowRoot) return null;
            const paginator = view.shadowRoot.querySelector("foliate-paginator");
            if (!(paginator instanceof HTMLElement) || !paginator.shadowRoot) return null;
            const container = paginator.shadowRoot.querySelector("#container");
            return container instanceof HTMLElement ? container : null;
          } catch {
            return null;
          }
        };

        const setSelectionDragPoint = (x: number, y: number) => {
          selectionDragPoint = {
            x,
            y,
            updatedAt: Date.now(),
          };
        };

        const clearSelectionDragPoint = () => {
          selectionDragPoint = null;
        };

        const cancelPendingPageAdvance = () => {
          if (pageDebounceTimer) {
            clearTimeout(pageDebounceTimer);
            pageDebounceTimer = null;
          }
          pendingAdvanceDirection = null;
        };

        const startSelectionMonitor = () => {
          if (selectionMonitorTimer || !supportsCrossPageSelection()) return;
          selectionMonitorTimer = setInterval(() => {
            try {
              handleSelectionChange();
            } catch {
              // Ignore monitor errors during cross-page selection.
            }
          }, 120);
        };

        const stopSelectionMonitor = () => {
          if (!selectionMonitorTimer) return;
          clearInterval(selectionMonitorTimer);
          selectionMonitorTimer = null;
        };

        const releasePreventScroll = () => {
          const container = getPaginatedContainer();
          if (container && preventScroll) {
            container.removeEventListener("scroll", preventScroll);
          }
          preventScroll = null;

          if (pointerUpCleanup) {
            doc.removeEventListener("pointerup", pointerUpCleanup);
          }
          pointerUpCleanup = null;
        };

        const applySelectionContainerLock = (container: HTMLElement | null) => {
          if (!container || lockedContainer === container) return;

          if (lockedContainer && lockedContainerStyles) {
            lockedContainer.style.scrollSnapType = lockedContainerStyles.scrollSnapType;
            lockedContainer.style.scrollBehavior = lockedContainerStyles.scrollBehavior;
            lockedContainer.style.overscrollBehaviorX = lockedContainerStyles.overscrollBehaviorX;
          }

          lockedContainer = container;
          lockedContainerStyles = {
            scrollSnapType: container.style.scrollSnapType,
            scrollBehavior: container.style.scrollBehavior,
            overscrollBehaviorX: container.style.overscrollBehaviorX,
            overflowX: container.style.overflowX,
          };

          container.style.scrollSnapType = "none";
          container.style.scrollBehavior = "auto";
          container.style.overscrollBehaviorX = "contain";
          container.style.overflowX = "hidden";
        };

        const releaseSelectionContainerLock = () => {
          if (!lockedContainer || !lockedContainerStyles) return;
          lockedContainer.style.scrollSnapType = lockedContainerStyles.scrollSnapType;
          lockedContainer.style.scrollBehavior = lockedContainerStyles.scrollBehavior;
          lockedContainer.style.overscrollBehaviorX = lockedContainerStyles.overscrollBehaviorX;
          lockedContainer.style.overflowX = lockedContainerStyles.overflowX;
          lockedContainer = null;
          lockedContainerStyles = null;
        };

        const clearCrossPageSelectionState = () => {
          cancelPendingPageAdvance();
          stopSelectionMonitor();
          releasePreventScroll();
          releaseSelectionContainerLock();
          clearSelectionDragPoint();
        };

        const supportsCrossPageSelection = () => {
          const view = viewRef.current;
          return !!(
            view &&
            !isFixedLayout &&
            view.renderer &&
            view.renderer.getAttribute &&
            view.renderer.getAttribute("flow") === "paginated"
          );
        };

        const handlePointerDown = () => {
          // Reset annotation click flag
          annotationClickedRef.current = false;
          // Record if there's a selection when pointer goes down
          const sel = doc.getSelection();
          hadSelectionOnPointerDown.current = !!(
            sel &&
            !sel.isCollapsed &&
            sel.toString().trim().length > 0
          );
        };

        const handlePointerUp = (ev: PointerEvent) => {
          // Capture coordinates immediately (before setTimeout)
          const clientX = ev.clientX;
          const clientY = ev.clientY;
          const screenX = ev.screenX;
          const screenY = ev.screenY;

          // Use the iframe's actual screen rect instead of deriving the visible
          // page from paginator internals. The latter changed with continuous
          // scrolled-mode support and can classify tap zones incorrectly.
          const view = viewRef.current;
          const renderer = view?.renderer;
          const pageWidth = renderer?.size || 0;
          const scrollStart = renderer?.start || 0;
          const clickMetrics = getIframeClickMetrics(doc, containerRef.current, clientX);
          const xFraction = clickMetrics?.fraction ?? null;

          console.log("[ReaderTap][iframe:pointerup]", {
            bookKey,
            clientX,
            clientY,
            pageWidth,
            scrollStart,
            rendererStart: renderer?.start,
            rendererEnd: renderer?.end,
            rendererPage: renderer?.page,
            rendererPages: renderer?.pages,
            rendererScrolled: !!renderer?.scrolled,
            xFraction,
            clickMetrics,
          });

          setTimeout(() => {
            // If show-annotation handler already handled this click, skip
            if (annotationClickedRef.current) {
              annotationClickedRef.current = false;
              return;
            }

            const sel = doc.getSelection();
            const hasSelectionNow = sel && !sel.isCollapsed && sel.toString().trim().length > 0;

            // Check if there's a new selection being made
            const newSel = getSelectionFromView(doc);

            if (newSel) {
              // New selection made - update stored range and notify parent
              currentSelectionRange.current = newSel.range ?? null;
              currentSelectionIndex.current = newSel.chapterIndex;
              onSelectionRef.current?.(newSel);
            } else if (currentSelectionRange.current) {
              // No new selection, but we had a previous selection
              // Selection was cleared (either by clicking inside to dismiss, or outside)
              // Always notify parent to hide the popover
              currentSelectionRange.current = null;
              onSelectionRef.current?.(null);
            } else {
              // No previous selection and no new selection
              // This is a simple click - toggle toolbar if there was no selection before
              if (!hadSelectionOnPointerDown.current && !hasSelectionNow) {
                // Send message to toggle toolbar
                console.log("[ReaderTap][iframe:post]", {
                  bookKey,
                  clientX,
                  clientY,
                  xFraction,
                });
                window.postMessage(
                  {
                    type: "iframe-single-click",
                    bookKey,
                    clientX,
                    clientY,
                    screenX,
                    screenY,
                    ...(typeof xFraction === "number" ? { xFraction } : {}),
                  },
                  "*",
                );
              }
            }
          }, 10);
        };

        const handleSelectStart = () => {
          if (!supportsCrossPageSelection()) return;
          const container = getPaginatedContainer();
          if (!container) return;
          originalScrollLeft = container.scrollLeft;
          clearCrossPageSelectionState();
          applySelectionContainerLock(container);
          startSelectionMonitor();
        };

        const scheduleSelectionPageAdvance = (direction: "next" | "prev") => {
          const view = viewRef.current;
          if (!view || !supportsCrossPageSelection()) return;
          if (Date.now() < pageAdvanceLockUntil) return;
          if (pendingAdvanceDirection === direction && pageDebounceTimer) return;

          cancelPendingPageAdvance();
          pendingAdvanceDirection = direction;
          pageDebounceTimer = setTimeout(async () => {
            const advanceDirection = pendingAdvanceDirection;
            cancelPendingPageAdvance();
            pageAdvanceLockUntil = Date.now() + 420;
            releasePreventScroll();
            try {
              if (advanceDirection === "prev") await view.prev();
              else await view.next();
              await new Promise((resolve) => setTimeout(resolve, 180));
              const nextContainer = getPaginatedContainer();
              if (nextContainer) {
                originalScrollLeft = nextContainer.scrollLeft;
              }
            } catch {
              // Ignore selection paging failures and keep the current selection intact.
            } finally {
              const activeSelectionRange = getSelectionRange(doc.getSelection());
              if (!activeSelectionRange) {
                clearCrossPageSelectionState();
              } else {
                clearSelectionDragPoint();
                releaseSelectionContainerLock();
              }
            }
          }, 260);
        };

        const handleSelectionChange = () => {
          if (!supportsCrossPageSelection()) return;

          const view = viewRef.current;
          const container = getPaginatedContainer();
          const selectionRange = getSelectionRange(doc.getSelection());
          const lastLocationRange = view?.lastLocation?.range as Range | undefined;
          if (!container) {
            clearCrossPageSelectionState();
            return;
          }
          if (!view || !lastLocationRange) return;
          if (!selectionRange) {
            if (!pendingAdvanceDirection && Date.now() >= pageAdvanceLockUntil) {
              clearCrossPageSelectionState();
            }
            return;
          }

          applySelectionContainerLock(container);

          if (Date.now() < pageAdvanceLockUntil) return;

          const advanceDirection = getSelectionAdvanceIntent(
            view,
            selectionRange,
            lastLocationRange,
            selectionDragPoint,
          );

          if (advanceDirection) {
            scheduleSelectionPageAdvance(advanceDirection);
            return;
          }

          cancelPendingPageAdvance();
          releasePreventScroll();
          preventScroll = () => {
            const activeSelectionRange = getSelectionRange(doc.getSelection());
            if (!activeSelectionRange) return;
            container.scrollLeft = originalScrollLeft;
          };

          container.addEventListener("scroll", preventScroll);
          pointerUpCleanup = () => {
            clearCrossPageSelectionState();
          };
          doc.addEventListener("pointerup", pointerUpCleanup);
        };

        const handlePointerMove = (ev: PointerEvent) => {
          if (!supportsCrossPageSelection()) return;
          if (!getSelectionRange(doc.getSelection())) return;
          setSelectionDragPoint(ev.clientX, ev.clientY);
          handleSelectionChange();
        };

        doc.addEventListener("pointerdown", handlePointerDown);
        doc.addEventListener("pointerup", handlePointerUp);
        doc.addEventListener("pointermove", handlePointerMove, { passive: true });
        doc.addEventListener("selectstart", handleSelectStart);
        doc.addEventListener("selectionchange", handleSelectionChange);
      },
      [bookKey],
    );

    const getSelectionFromView = useCallback(
      (targetDoc?: Document | null): BookSelection | null => {
        const view = viewRef.current;
        if (!view) return null;

        const contents = getRendererContents(view);
        const selectedContent =
          (targetDoc ? contents.find((content) => content.doc === targetDoc) : null) ??
          contents.find((content) => {
            const sel = content.doc?.getSelection?.();
            return !!(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
          }) ??
          null;
        if (!selectedContent?.doc) return null;

        const doc = selectedContent.doc;
        const sel = doc.getSelection();
        const range = getSelectionRange(sel);
        if (!range) return null;
        const text = getRangeTextWithoutRuby(range, sel?.toString() || "");
        if (!text) return null;

        // Get CFI for the selection
        let cfi: string | undefined;
        let chapterIndex: number | undefined;
        try {
          const index = selectedContent.index;
          if (typeof index === "number") {
            cfi = view.getCFI(index, range);
            chapterIndex = index;
          }
        } catch {
          // CFI generation may fail for some selections
        }

        const rects = Array.from(range.getClientRects());

        // Convert iframe-local coordinates to main window coordinates.
        // For fixed-layout (PDF), iframes may have CSS transform: scale(),
        // so we need to account for both the iframe position and the scale factor.
        const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null;
        let offsetRects: DOMRect[];

        if (iframe) {
          const iframeRect = iframe.getBoundingClientRect();
          // Compute scale: iframeRect is the scaled size in main window,
          // iframe.clientWidth is the unscaled content width
          const scaleX = iframe.clientWidth > 0 ? iframeRect.width / iframe.clientWidth : 1;
          const scaleY = iframe.clientHeight > 0 ? iframeRect.height / iframe.clientHeight : 1;

          offsetRects = rects.map(
            (r) =>
              new DOMRect(
                iframeRect.left + r.x * scaleX,
                iframeRect.top + r.y * scaleY,
                r.width * scaleX,
                r.height * scaleY,
              ),
          );
        } else {
          // Fallback: use container offset (for non-iframe renderers)
          const containerRect = containerRef.current?.getBoundingClientRect();
          offsetRects = containerRect
            ? rects.map(
                (r) => new DOMRect(r.x + containerRect.x, r.y + containerRect.y, r.width, r.height),
              )
            : rects;
        }

        // Update reading context service with selection
        if (cfi && chapterIndex !== undefined) {
          readingContextService.updateSelection({
            text,
            cfi,
            chapterIndex,
            chapterTitle: "", // Will be filled by relocate handler
          });
        }

        return { text, cfi, chapterIndex, rects: offsetRects, range };
      },
      [],
    );

    // Bind foliate events (use viewReady state to ensure re-bind after view creation)
    useFoliateEvents(viewReady ? viewRef.current : null, {
      onLoad: docLoadHandler,
      onRelocate: relocateHandler,
      onDrawAnnotation: drawAnnotationHandler,
      onShowAnnotation: showAnnotationHandler,
      onLink: linkHandler,
    });

    // --- Open book ---
    useEffect(() => {
      if (isViewCreated.current) return;
      isViewCreated.current = true;

      const openBook = async () => {
        try {
          await import("foliate-js/view.js");

          const view = wrappedFoliateView(document.createElement("foliate-view"));
          view.id = `foliate-view-${bookKey}`;
          view.style.width = "100%";
          view.style.height = "100%";
          containerRef.current?.appendChild(view);

          // Pre-configure fixed layout (PDF/CBZ) rendition before opening
          // This is critical: foliate-js FixedLayout.#spread() reads rendition.spread
          // during open(), so it must be set before view.open()
          if (isFixedLayout && bookDoc.rendition) {
            const fixedLayoutSpread =
              (viewSettings.paginatedLayout ?? "double") === "single" ? "none" : "auto";
            bookDoc.rendition.spread = fixedLayoutSpread;
            // Set first section as cover page (single page, not part of spread)
            const sections = bookDoc.sections as
              | Array<{ id?: string; pageSpread?: string }>
              | undefined;
            if (sections?.[0]) {
              const firstSectionId = String(sections[0].id || "");
              if (/cover/i.test(firstSectionId)) {
                sections[0].pageSpread = "center";
              } else {
                const coverSide = bookDoc.dir === "rtl" ? "right" : "left";
                sections[0].pageSpread = coverSide;
              }
            }
          }

          // Open the pre-parsed BookDoc
          await view.open(bookDoc);
          viewRef.current = view;

          // Set search indicator color (use primary theme color instead of red)
          const primaryColor =
            getComputedStyle(document.documentElement).getPropertyValue("--primary")?.trim() ||
            "#3b82f6";
          if ((view as any).setSearchIndicator) {
            (view as any).setSearchIndicator("outline", { color: primaryColor });
          }

          console.log("[FoliateViewer] Book opened:", {
            format,
            isFixedLayout,
            sectionsCount: bookDoc.sections?.length,
            renditionLayout: bookDoc.rendition?.layout,
            renditionSpread: bookDoc.rendition?.spread,
          });

          // Extract and emit TOC
          if (view.book?.toc) {
            const toc = convertTOC(view.book.toc);
            onTocReady?.(toc);
          }

          // Apply renderer settings
          applyRendererSettings(view, viewSettings, isFixedLayout, appTheme);

          // IMPORTANT: Register event listeners BEFORE navigation to avoid race condition.
          // React's useFoliateEvents relies on viewReady state, but setState + re-render
          // won't complete before the synchronous navigation below fires the first "load"
          // event. We attach listeners directly here so the first section load is captured.
          // useFoliateEvents will also bind them once viewReady is committed, but
          // addEventListener de-duplicates identical function references, so no double-fire.
          view.addEventListener("load", docLoadHandler);
          view.addEventListener("relocate", relocateHandler);
          view.addEventListener("draw-annotation", drawAnnotationHandler);
          view.addEventListener("delete-annotation", deleteAnnotationHandler);
          view.addEventListener("show-annotation", showAnnotationHandler);
          view.addEventListener("link", linkHandler);
          setViewReady(true);

          // Navigate to last location or start
          if (isFixedLayout) {
            await view.init({});
          } else if (lastLocation) {
            try {
              await view.init({ lastLocation });
            } catch (initErr) {
              console.warn(
                "[FoliateViewer] Failed to init with lastLocation, falling back to start:",
                initErr,
              );
              await view.goToFraction(0);
            }
          } else {
            await view.goToFraction(0);

            // If the first section is empty (e.g., blank title page with linear="no"),
            // auto-advance to the first section with actual content
            try {
              const sections = bookDoc.sections ?? [];
              if (sections.length > 1) {
                const firstDoc = await sections[0].createDocument?.();
                const textContent = firstDoc?.body?.textContent?.trim() ?? "";
                if (textContent.length < 10) {
                  // First section is effectively empty, go to next
                  console.log("[FoliateViewer] First section is empty, advancing to next section");
                  await view.next();
                }
              }
            } catch (skipErr) {
              // Ignore — not critical, user can still navigate manually
              console.warn("[FoliateViewer] Failed to skip empty first section:", skipErr);
            }
          }
        } catch (err) {
          console.error("[FoliateViewer] Failed to open book:", err);
          onError?.(err instanceof Error ? err : new Error("Failed to open book"));
          setLoading(false);
        }
      };

      openBook();

      return () => {
        const view = viewRef.current;
        if (view) {
          try {
            view.close();
          } catch {
            /* ignore */
          }
          view.remove();
          viewRef.current = null;
          setViewReady(false);
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- Apply view settings changes ---
    useEffect(() => {
      const view = viewRef.current;
      if (!view?.renderer) return;
      // Fixed layout (PDF/CBZ): don't override font/size/lineHeight
      if (isFixedLayout) return;
      // Skip if container is hidden (inactive tab) to avoid blocking main thread
      // with expensive iframe re-layout. Styles will be applied when tab becomes visible.
      if (containerRef.current && containerRef.current.offsetParent === null) {
        pendingStyleUpdateRef.current = true;
        return;
      }
      applyRendererStyles(view, viewSettings, false, appTheme);
    }, [
      viewSettings.fontSize,
      viewSettings.lineHeight,
      viewSettings.fontTheme,
      viewSettings.customFontFamily,
      viewSettings.customFontFaceCSS,
      viewSettings.customFontCssUrls,
      viewSettings.paragraphSpacing,
      isFixedLayout,
      appTheme,
    ]);

    // --- Apply pending style updates when tab becomes visible ---
    useEffect(() => {
      if (!containerRef.current) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && pendingStyleUpdateRef.current) {
            pendingStyleUpdateRef.current = false;
            const view = viewRef.current;
            if (view?.renderer && !isFixedLayout) {
              applyRendererStyles(view, viewSettings, false, appTheme);
            }
          }
        },
        { threshold: 0.1 },
      );
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, [viewSettings, isFixedLayout, appTheme]);

    // --- Apply reflow layout changes ---
    useEffect(() => {
      const view = viewRef.current;
      if (!view?.renderer) return;
      if (isFixedLayout) {
        applyRendererSettings(view, viewSettings, true, appTheme);
        return;
      }

      applyReflowLayoutSettings(view, viewSettings);
    }, [viewSettings.viewMode, viewSettings.paginatedLayout, isFixedLayout, appTheme]);

    const handleViewerShellClick = useCallback(
      (event: {
        target: EventTarget | null;
        clientX: number;
        clientY: number;
        screenX: number;
        screenY: number;
      }) => {
        const target = event.target as EventTarget | null;
        const container = containerRef.current;
        const view = viewRef.current;
        if (!container) return;
        if (target !== container && target !== view) return;
        activeFootnoteKeyRef.current = null;
        setFootnotePreview(null);

        const rect = container.getBoundingClientRect();
        console.log("[ReaderTap][shell:post]", {
          bookKey,
          clientX: event.clientX,
          clientY: event.clientY,
          containerLeft: rect.left,
          containerWidth: rect.width,
          xFraction: rect.width > 0 ? (event.clientX - rect.left) / rect.width : null,
        });
        window.postMessage(
          {
            type: "viewer-single-click",
            bookKey,
            clientX: event.clientX,
            clientY: event.clientY,
            screenX: event.screenX,
            screenY: event.screenY,
          },
          "*",
        );
      },
      [bookKey],
    );

    return (
      <div
        ref={containerRef}
        className="foliate-viewer h-full w-full focus:outline-none"
        tabIndex={-1}
        onClick={handleViewerShellClick}
      >
        {footnotePreview && (
          <button
            type="button"
            className="absolute z-40 max-w-[min(360px,calc(100%-32px))] overflow-y-auto rounded-md border border-border bg-popover px-3.5 py-3 text-left text-sm leading-relaxed text-popover-foreground shadow-lg"
            style={{
              left: footnotePreview.left,
              top: footnotePreview.top,
              bottom: footnotePreview.bottom,
              width: footnotePreview.width,
              maxHeight: footnotePreview.maxHeight,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="block whitespace-pre-wrap">{footnotePreview.text}</span>
          </button>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              <p className="text-sm text-muted-foreground">Loading book...</p>
            </div>
          </div>
        )}
      </div>
    );
  },
);

// --- Helper functions ---

function syncRemoteFontStylesInDocument(doc: Document, urls: string[] | undefined) {
  const head = doc.head || doc.documentElement;
  if (!head) return;
  const nextUrls = Array.from(new Set((urls || []).filter(Boolean)));

  Array.from(doc.querySelectorAll(`link[${REMOTE_FONT_LINK_ATTR}]`)).forEach((node) => {
    const href = (node as HTMLLinkElement).href;
    if (!nextUrls.some((url) => href.includes(url))) {
      node.remove();
    }
  });

  for (const url of nextUrls) {
    const existing = Array.from(doc.querySelectorAll(`link[${REMOTE_FONT_LINK_ATTR}]`)).find(
      (node) => (node as HTMLLinkElement).href.includes(url),
    );
    if (existing) continue;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.setAttribute(REMOTE_FONT_LINK_ATTR, "true");
    head.appendChild(link);
  }
}

function syncRemoteFontStyles(view: FoliateView, settings: ViewSettings) {
  const contents = view.renderer?.getContents?.();
  if (!Array.isArray(contents)) return;
  for (const content of contents) {
    const doc = content?.doc as Document | undefined;
    if (doc) {
      syncRemoteFontStylesInDocument(doc, settings.customFontCssUrls);
    }
  }
}

/** Apply CSS styles to a loaded section document */
function applyDocumentStyles(doc: Document, settings: ViewSettings, isFixedLayout: boolean) {
  if (isFixedLayout) {
    // PDF/CBZ: don't inject styles that would break layout
    return;
  }

  normalizeBrOnlyParagraphs(doc);
  syncRemoteFontStylesInDocument(doc, settings.customFontCssUrls);

  // Basic styles for images
  const images = doc.querySelectorAll("img");
  for (const img of images) {
    img.style.maxWidth = "100%";
    img.style.height = "auto";
  }
}

function normalizeBrOnlyParagraphs(doc: Document) {
  const docWithMarker = doc as Document & { __readanyBrParagraphsNormalized?: boolean };
  if (docWithMarker.__readanyBrParagraphsNormalized) return;
  docWithMarker.__readanyBrParagraphsNormalized = true;

  const body = doc.body;
  if (!body || body.querySelectorAll("p").length > 2) return;

  const containers: Element[] = Array.from(body.querySelectorAll("div, section, article, main")).filter(
    shouldNormalizeBrParagraphContainer,
  );
  if (shouldNormalizeBrParagraphContainer(body)) containers.push(body);

  for (const container of containers) {
    if (normalizeBrParagraphContainer(doc, container)) return;
  }
}

function shouldNormalizeBrParagraphContainer(container: Element) {
  if (container.querySelector("p")) return false;

  const inlineTags = new Set([
    "a",
    "abbr",
    "b",
    "bdi",
    "bdo",
    "br",
    "cite",
    "code",
    "em",
    "font",
    "i",
    "img",
    "kbd",
    "mark",
    "q",
    "ruby",
    "rb",
    "rp",
    "rt",
    "s",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "time",
    "u",
    "var",
  ]);
  let brCount = 0;
  let textLength = 0;

  for (const node of Array.from(container.childNodes)) {
    if (isBrNode(node)) {
      brCount += 1;
    } else if (node.nodeType === Node.TEXT_NODE) {
      textLength += node.nodeValue?.trim().length ?? 0;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).localName.toLowerCase();
      if (!inlineTags.has(tag) && (node.textContent || "").trim()) return false;
    }
  }

  return brCount >= 4 && textLength >= 80;
}

function normalizeBrParagraphContainer(doc: Document, container: Element) {
  const originalNodes = Array.from(container.childNodes);
  const fragment = doc.createDocumentFragment();
  let pending: Node[] = [];
  let breakNodes: Node[] = [];
  let breakCount = 0;
  let paragraphCount = 0;

  const flushPending = () => {
    while (pending.length && isBlankTextNode(pending[0])) pending.shift();
    while (pending.length && isBlankTextNode(pending[pending.length - 1])) pending.pop();
    if (!pending.some(hasParagraphContent)) {
      pending = [];
      return;
    }

    const paragraph = doc.createElement("p");
    paragraph.className = "__readany_br_paragraph";
    for (const node of pending) paragraph.appendChild(node);
    fragment.appendChild(paragraph);
    pending = [];
    paragraphCount += 1;
  };

  const commitBreak = () => {
    if (!breakNodes.length) return;
    if (breakCount >= 2) flushPending();
    else pending.push(...breakNodes);
    breakNodes = [];
    breakCount = 0;
  };

  for (const node of Array.from(container.childNodes)) {
    if (isBrNode(node)) {
      breakNodes.push(node);
      breakCount += 1;
    } else if (isBlankTextNode(node) && breakCount > 0) {
      breakNodes.push(node);
    } else {
      commitBreak();
      pending.push(node);
    }
  }

  commitBreak();
  flushPending();

  if (paragraphCount < 2) {
    container.replaceChildren(...originalNodes);
    return false;
  }
  container.replaceChildren(fragment);
  container.setAttribute("data-readany-br-paragraphs", "");
  return true;
}

function isBrNode(node: Node) {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).localName.toLowerCase() === "br";
}

function isBlankTextNode(node: Node) {
  return node.nodeType === Node.TEXT_NODE && !node.nodeValue?.trim();
}

function hasParagraphContent(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) return Boolean(node.nodeValue?.trim());
  if (node.nodeType === Node.ELEMENT_NODE) {
    return !isBrNode(node) && Boolean(node.textContent?.trim());
  }
  return false;
}

/** Apply renderer-level settings (layout, columns, margins) */
function applyRendererSettings(
  view: FoliateView,
  settings: ViewSettings,
  isFixedLayout: boolean,
  theme: AppTheme,
) {
  const renderer = view.renderer;
  if (!renderer) return;

  if (isFixedLayout) {
    const isSinglePage = (settings.paginatedLayout ?? "double") === "single";
    const spreadMode = isSinglePage ? "none" : "auto";
    // Fixed layout: single-page mode should scale to the page width so image-only
    // EPUBs do not look "shrunk inside a spread". Double-page mode still uses
    // fit-page to keep both pages fully visible inside the viewport.
    renderer.setAttribute("zoom", isSinglePage ? "fit-width" : "fit-page");
    if (view.book?.rendition) {
      view.book.rendition.spread = spreadMode;
    }
    renderer.setAttribute("spread", spreadMode);
  } else {
    // Reflowable: columns, sizes, margins
    const isSinglePage = (settings.paginatedLayout ?? "double") === "single";
    const rendererWidth = Number(renderer.size || 0);
    const singlePageInlineSize =
      rendererWidth > 0 ? Math.round(Math.max(980, Math.min(rendererWidth * 0.94, 1600))) : 1280;
    renderer.setAttribute("max-inline-size", isSinglePage ? `${singlePageInlineSize}px` : "760px");
    renderer.setAttribute("max-block-size", "1440px");
    renderer.setAttribute("gap", isSinglePage ? "1.2%" : "4.5%");
    applyReflowLayoutSettings(view, settings);
  }

  // Apply CSS styles (skip font overrides for fixed layout)
  applyRendererStyles(view, settings, isFixedLayout, theme);
}

function applyReflowLayoutSettings(view: FoliateView, settings: ViewSettings) {
  const renderer = view.renderer;
  if (!renderer) return;

  renderer.setAttribute(
    "max-column-count",
    (settings.paginatedLayout ?? "double") === "single" ? "1" : "2",
  );

  if (settings.viewMode === "scroll") {
    renderer.setAttribute("flow", "scrolled");
  } else {
    renderer.removeAttribute("flow");
  }

  // Force re-render to ensure layout mode change takes effect immediately
  if (typeof renderer.render === "function") {
    renderer.render();
  }
}

/** Generate CSS string for renderer styles */
function getRendererStyles(settings: ViewSettings, theme: AppTheme): string {
  const colors = getThemeColors(theme);
  const bgColor = colors.bg;
  const fgColor = colors.fg;
  const linkColor = colors.link;

  // Get font theme
  const fontTheme = getFontTheme(settings.fontTheme);

  // Custom font takes precedence over font theme
  const fontFamily = settings.customFontFamily
    ? JSON.stringify(settings.customFontFamily)
    : `'${fontTheme.cjk}', '${fontTheme.serif}', serif`;

  // paragraphSpacing is stored as px tuned at the default 16px font size.
  // Scale it with the actual font size so paragraph gaps stay proportional
  // at the new 12-64 fontSize range — without this, 16px spacing looks
  // cramped at fontSize 64. BASELINE matches defaultReadSettings.fontSize
  // in core/stores/settings-store.ts.
  const BASELINE_FONT_SIZE = 16;
  const layoutScale = settings.fontSize / BASELINE_FONT_SIZE;
  const scaledParagraphSpacing = Math.round(settings.paragraphSpacing * layoutScale);

  return `${settings.customFontFaceCSS ? `/* Custom font faces */\n${settings.customFontFaceCSS}\n\n` : ""}/* Font styles */
html {
  --theme-bg-color: ${bgColor};
  --readany-font-family: ${fontFamily};
  --serif-font: "${fontTheme.serif}";
  --sans-serif-font: "${fontTheme.sansSerif}";
  --cjk-font: "${fontTheme.cjk}";
}

html, body {
  background-color: ${bgColor} !important;
  color: ${fgColor} !important;
  font-family: var(--readany-font-family) !important;
  font-size: ${settings.fontSize}px !important;
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
}

body *:not(svg):not(svg *):not(math):not(math *):not(pre):not(pre *):not(code):not(code *):not(kbd):not(kbd *):not(samp):not(samp *) {
  font-family: var(--readany-font-family) !important;
}

pre, code, kbd, samp {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
}

/* Line height for text blocks */
p, div, blockquote, dd, li, span {
  line-height: ${settings.lineHeight} !important;
}

/* Paragraph spacing */
p {
  margin-top: ${scaledParagraphSpacing}px !important;
  margin-bottom: ${scaledParagraphSpacing}px !important;
}

/* Links */
a, a:any-link {
  color: ${linkColor} !important;
  text-decoration: none !important;
}

/* Images */
img, svg {
  max-width: 100% !important;
  height: auto !important;
}

/* Selection */
::selection {
  background: rgba(59, 130, 246, 0.3) !important;
}

/* Override font[size] attributes */
font[size="1"] { font-size: 0.6rem !important; }
font[size="2"] { font-size: 0.75rem !important; }
font[size="3"] { font-size: 1rem !important; }
font[size="4"] { font-size: 1.2rem !important; }
font[size="5"] { font-size: 1.5rem !important; }
font[size="6"] { font-size: 2rem !important; }
font[size="7"] { font-size: 3rem !important; }

/* Override hardcoded black text */
*[style*="color: rgb(0,0,0)"],
*[style*="color: #000"],
*[style*="color: black"] {
  color: ${fgColor} !important;
}

/* Code blocks */
pre {
  white-space: pre-wrap !important;
  tab-size: 2;
}
`;
}

/** Apply CSS styles to the renderer (lightweight update path) */
function applyRendererStyles(
  view: FoliateView,
  settings: ViewSettings,
  isFixedLayout: boolean,
  theme: AppTheme,
) {
  const renderer = view.renderer;
  if (!renderer?.setStyles) return;

  const colors = getThemeColors(theme);
  const bgColor = colors.bg;

  if (isFixedLayout) {
    // Fixed layout (PDF/CBZ): only set background, don't override font/size/lineHeight
    // as it would break the TextLayer positioning in PDF
    renderer.setStyles(`
      html, body {
        background-color: ${bgColor} !important;
      }
    `);
    return;
  }

  // Apply CSS string styles
  syncRemoteFontStyles(view, settings);
  console.log("[FoliateViewer][Font] apply-renderer-styles", {
    fontTheme: settings.fontTheme,
    customFontFamily: settings.customFontFamily ?? null,
    customFontCssUrls: settings.customFontCssUrls ?? [],
    customFontFaceCSSLength: settings.customFontFaceCSS?.length ?? 0,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
  });
  const styles = getRendererStyles(settings, theme);
  renderer.setStyles(styles);
}

/**
 * Note tooltip system — uses event delegation with real-time position calculation.
 * No fixed-position hover divs; works correctly after resize/reflow.
 */
const NOTE_TOOLTIP_STYLES = `
  .foliate-note-tooltip {
    position: absolute;
    z-index: 9999;
    max-width: 320px;
    padding: 10px 14px;
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.95);
    color: #f1f5f9;
    font-size: 13px;
    line-height: 1.5;
    box-shadow: 0 8px 24px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.15);
    backdrop-filter: blur(8px);
    pointer-events: none;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 0.15s ease, transform 0.15s ease;
    word-break: break-word;
    border: 1px solid rgba(100, 116, 139, 0.3);
  }
  .foliate-note-tooltip.visible {
    opacity: 1;
    transform: translateY(0);
  }
  .foliate-note-tooltip::before {
    content: '';
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 6px solid rgba(15, 23, 42, 0.95);
  }
  .foliate-note-tooltip.below::before {
    top: -6px; bottom: auto;
    border-top: none;
    border-bottom: 6px solid rgba(15, 23, 42, 0.95);
  }
  .foliate-note-tooltip .note-content {
    display: -webkit-box;
    -webkit-line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  /* Markdown styles for tooltip */
  .foliate-note-tooltip .note-content strong { font-weight: 600; color: #fff; }
  .foliate-note-tooltip .note-content em { font-style: italic; color: #e2e8f0; }
  .foliate-note-tooltip .note-content del { text-decoration: line-through; opacity: 0.7; }
  .foliate-note-tooltip .note-content code {
    background: rgba(255,255,255,0.1);
    padding: 1px 5px;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
  }
  .foliate-note-tooltip .note-content pre {
    background: rgba(0,0,0,0.3);
    border-radius: 6px;
    padding: 8px 10px;
    margin: 6px 0;
    overflow-x: auto;
  }
  .foliate-note-tooltip .note-content pre code {
    background: none;
    padding: 0;
    border-radius: 0;
    font-size: 12px;
    line-height: 1.4;
    white-space: pre;
  }
  .foliate-note-tooltip .note-content h1,
  .foliate-note-tooltip .note-content h2,
  .foliate-note-tooltip .note-content h3 {
    color: #fff;
    font-weight: 600;
    margin: 6px 0 2px;
    line-height: 1.3;
  }
  .foliate-note-tooltip .note-content h1 { font-size: 16px; }
  .foliate-note-tooltip .note-content h2 { font-size: 15px; }
  .foliate-note-tooltip .note-content h3 { font-size: 14px; }
  .foliate-note-tooltip .note-content hr {
    border: none;
    border-top: 1px solid rgba(148, 163, 184, 0.3);
    margin: 6px 0;
  }
  .foliate-note-tooltip .note-content ul,
  .foliate-note-tooltip .note-content ol {
    margin: 4px 0;
    padding-left: 18px;
  }
  .foliate-note-tooltip .note-content ol { list-style: decimal; }
  .foliate-note-tooltip .note-content ul { list-style: disc; }
  .foliate-note-tooltip .note-content li { margin: 2px 0; }
  .foliate-note-tooltip .note-content blockquote {
    margin: 4px 0;
    padding-left: 10px;
    border-left: 2px solid rgba(148, 163, 184, 0.5);
    color: #cbd5e1;
    font-style: italic;
  }
  .foliate-note-tooltip .note-content a { color: #60a5fa; text-decoration: underline; }
  .foliate-note-tooltip .note-content p { margin: 2px 0; }
  .foliate-note-tooltip .note-content table {
    border-collapse: collapse;
    margin: 6px 0;
    font-size: 12px;
    width: 100%;
  }
  .foliate-note-tooltip .note-content th,
  .foliate-note-tooltip .note-content td {
    border: 1px solid rgba(148, 163, 184, 0.3);
    padding: 3px 8px;
    text-align: left;
  }
  .foliate-note-tooltip .note-content th {
    background: rgba(255,255,255,0.06);
    font-weight: 600;
    color: #fff;
  }
  .foliate-note-tooltip .note-content input[type="checkbox"] {
    margin-right: 4px;
    vertical-align: middle;
  }
`;

// Per-doc registry: cfi -> { range, note }
const docNoteRegistries = new WeakMap<Document, Map<string, { range: Range; note: string }>>();

// Global set to track CFIs that have notes (for showAnnotationHandler)
const cfisWithNotes = new Set<string>();

// Configure marked for tooltip rendering (GFM: tables, strikethrough, task lists etc.)
marked.setOptions({ gfm: true, breaks: true });

// Markdown to HTML converter for tooltip — powered by marked
function noteMarkdownToHtml(text: string): string {
  if (!text || typeof text !== "string") return "";
  try {
    return marked.parse(text) as string;
  } catch {
    // Fallback: escape HTML and convert newlines
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }
}

function ensureNoteTooltipSystem(doc: Document) {
  if (doc.getElementById("foliate-note-tooltip-styles")) return;

  // Inject styles
  const style = doc.createElement("style");
  style.id = "foliate-note-tooltip-styles";
  style.textContent = NOTE_TOOLTIP_STYLES;
  doc.head.appendChild(style);

  // Create shared tooltip element
  const tooltip = doc.createElement("div");
  tooltip.className = "foliate-note-tooltip";
  tooltip.id = "foliate-note-shared-tooltip";
  const content = doc.createElement("div");
  content.className = "note-content";
  tooltip.appendChild(content);
  doc.body.appendChild(tooltip);

  let activeCfi: string | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const showTooltip = (note: string, range: Range) => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    // Render markdown as HTML
    try {
      content.innerHTML = noteMarkdownToHtml(note);
    } catch {
      content.textContent = note;
    }
    tooltip.classList.remove("below");
    // Make visible off-screen to measure
    tooltip.style.left = "-9999px";
    tooltip.style.top = "-9999px";
    tooltip.classList.add("visible");

    // Get fresh rects from range (correct after resize)
    const rects = range.getClientRects();
    if (rects.length === 0) {
      tooltip.classList.remove("visible");
      return;
    }
    const firstRect = rects[0];
    const scrollX = doc.defaultView?.scrollX || 0;
    const scrollY = doc.defaultView?.scrollY || 0;
    const tooltipW = tooltip.offsetWidth;
    const tooltipH = tooltip.offsetHeight;
    const viewW = doc.documentElement.clientWidth;

    let left = firstRect.left + scrollX + firstRect.width / 2 - tooltipW / 2;
    left = Math.max(8, Math.min(left, viewW - tooltipW - 8 + scrollX));
    let top = firstRect.top + scrollY - tooltipH - 10;
    if (top < scrollY + 8) {
      // Show below
      const lastRect = rects[rects.length - 1];
      top = lastRect.bottom + scrollY + 10;
      tooltip.classList.add("below");
    }
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const hideTooltip = () => {
    hideTimer = setTimeout(() => {
      tooltip.classList.remove("visible");
      activeCfi = null;
    }, 100);
  };

  // Check if a point is inside any rect of a range (with padding for wavy underline)
  const isPointInRange = (range: Range, x: number, y: number): boolean => {
    const padX = 2;
    const padTop = 2;
    const padBottom = 8; // extra padding below for the wavy underline drawn beneath text
    for (const rect of range.getClientRects()) {
      if (
        x >= rect.left - padX &&
        x <= rect.right + padX &&
        y >= rect.top - padTop &&
        y <= rect.bottom + padBottom
      ) {
        return true;
      }
    }
    return false;
  };

  // Event delegation on doc body
  doc.addEventListener("mousemove", (e: MouseEvent) => {
    const registry = docNoteRegistries.get(doc);
    if (!registry || registry.size === 0) return;

    let found: { cfi: string; range: Range; note: string } | null = null;
    for (const [cfi, entry] of registry) {
      if (isPointInRange(entry.range, e.clientX, e.clientY)) {
        found = { cfi, ...entry };
        break;
      }
    }

    if (found) {
      if (activeCfi !== found.cfi) {
        activeCfi = found.cfi;
        showTooltip(found.note, found.range);
      }
    } else if (activeCfi) {
      hideTooltip();
    }
  });
}

function createNoteTooltip(doc: Document, range: Range, note: string, cfi?: string) {
  if (!cfi) return;
  ensureNoteTooltipSystem(doc);
  let registry = docNoteRegistries.get(doc);
  if (!registry) {
    registry = new Map();
    docNoteRegistries.set(doc, registry);
  }
  registry.set(cfi, { range, note });
}

function removeNoteTooltip(doc: Document, cfi: string) {
  const registry = docNoteRegistries.get(doc);
  if (registry) registry.delete(cfi);
}
