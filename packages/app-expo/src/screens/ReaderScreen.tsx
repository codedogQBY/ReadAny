import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { BookmarkRibbon } from "@/components/reader/BookmarkRibbon";
import { ChapterTranslationSheet } from "@/components/reader/ChapterTranslationSheet";
import { SelectionPopover } from "@/components/reader/SelectionPopover";
import { TTSPage } from "@/components/reader/TTSPage";
import { TranslationPanel } from "@/components/reader/TranslationPanel";
import {
  BookmarkFilledIcon,
  BookmarkIcon,
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HeadphonesIcon,
  LanguagesIcon,
  NotebookPenIcon,
  SearchIcon,
  XIcon,
} from "@/components/ui/Icon";
import { useReaderBridge } from "@/hooks/use-reader-bridge";
import { startFileServer, stopFileServer } from "@/lib/reader/local-file-server";
import type { RelocateEvent, SelectionEvent, VisibleTTSSegment } from "@/hooks/use-reader-bridge";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import {
  useAnnotationStore,
  useLibraryStore,
  useReaderStore,
  useReadingSessionStore,
  useSettingsStore,
  useTTSStore,
} from "@/stores";
import { useMissingBookPromptStore } from "@/stores/missing-book-prompt-store";
import { useTheme } from "@/styles/ThemeContext";
import { useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { readingContextService } from "@readany/core/ai/reading-context-service";
import { runWithDbRetry } from "@readany/core/db/write-retry";
import { useChapterTranslation } from "@readany/core/hooks";
import { useReadingSession } from "@readany/core/hooks/use-reading-session";
import { createSelectionNoteMutation } from "@readany/core/reader";
import { getPlatformService } from "@readany/core/services";
import { getCSSFontFace, useFontStore } from "@readany/core/stores";
import type { ReadSettings, TOCItem } from "@readany/core/types";
import { eventBus } from "@readany/core/utils/event-bus";
import { throttle } from "@readany/core/utils/throttle";
import { Asset } from "expo-asset";
import * as DocumentPicker from "expo-document-picker";
/**
 * ReaderScreen — WebView-based reader with foliate-js engine.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

// ── Extracted modules ──
import { ReaderNoteViewModal } from "./reader/ReaderNoteViewModal";

const REFLOWABLE_CHARACTERS_PER_LOCATION = 1500;
const MAX_TRACKED_LOCATION_DELTA = 20;
const MAX_TRACKED_PAGE_DELTA = 20;
const MAX_TRACKED_FRACTION_DELTA = 0.08;
const INITIAL_PROGRESS_RESTORE_GUARD_MS = 1800;
const PROGRAMMATIC_NAV_GUARD_MS = 1200;
const BOOK_MIME_TYPES = [
  "application/epub+zip",
  "application/pdf",
  "application/x-mobipocket-ebook",
  "application/vnd.amazon.ebook",
  "application/vnd.comicbook+zip",
  "application/x-fictionbook+xml",
  "text/plain",
  "application/octet-stream",
];

const BOOK_FORMAT_MIME_TYPES: Partial<Record<string, string>> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  mobi: "application/x-mobipocket-ebook",
  azw: "application/vnd.amazon.ebook",
  azw3: "application/vnd.amazon.ebook",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook+zip",
  fb2: "application/x-fictionbook+xml",
  fbz: "application/x-zip-compressed-fb2",
  txt: "text/plain",
};

function normalizeBookIdentityText(value?: string): string {
  return (value || "").toLowerCase().replace(/[\s\p{P}\p{S}_-]+/gu, "");
}

function authorsLikelyMatch(a?: string, b?: string): boolean {
  const left = normalizeBookIdentityText(a);
  const right = normalizeBookIdentityText(b);
  if (!left || !right) return true;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftParts = left.split(/[,，、/&]+/).filter((part) => part.length > 1);
  const rightParts = right.split(/[,，、/&]+/).filter((part) => part.length > 1);
  return leftParts.some((part) =>
    rightParts.some((candidate) => part.includes(candidate) || candidate.includes(part)),
  );
}

function shouldConfirmReimportCandidate(
  originalBook: { meta: { title: string; author: string }; format: string; fileHash?: string },
  candidate: { title: string; author: string; format: string; fileHash?: string },
): boolean {
  if (candidate.fileHash && originalBook.fileHash && candidate.fileHash === originalBook.fileHash) {
    return false;
  }
  const originalTitle = normalizeBookIdentityText(originalBook.meta.title);
  const candidateTitle = normalizeBookIdentityText(candidate.title);
  const titleMismatch =
    !!originalTitle &&
    !!candidateTitle &&
    originalTitle !== candidateTitle &&
    !originalTitle.includes(candidateTitle) &&
    !candidateTitle.includes(originalTitle);
  const authorMismatch = !authorsLikelyMatch(originalBook.meta.author, candidate.author);
  const formatMismatch = originalBook.format !== candidate.format;
  return titleMismatch || (formatMismatch && authorMismatch);
}
const NOTE_TOOLTIP_WIDTH = 300;
const NOTE_TOOLTIP_SIDE_PADDING = 12;
const NOTE_TOOLTIP_ABOVE_OFFSET = 2;
const NOTE_TOOLTIP_BELOW_OFFSET = 8;
const NOTE_TOOLTIP_TOP_THRESHOLD = 180;
import { ReaderSettingsPanel } from "./reader/ReaderSettingsPanel";
import { ReaderTOCPanel } from "./reader/ReaderTOCPanel";
import {
  CONTROLS_TIMEOUT,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  getVolumeManager,
} from "./reader/reader-constants";
import { BatteryIcon, ListIcon, SettingsIcon } from "./reader/reader-icons";
import { makeStyles, noteTooltipMdStyles } from "./reader/reader-styles";
import { useReaderBookmark } from "./reader/useReaderBookmark";
import { useReaderSearch } from "./reader/useReaderSearch";
import { useReaderSystemInfo } from "./reader/useReaderSystemInfo";
import { useReaderTTS } from "./reader/useReaderTTS";
import { useVolumeButtonPaging } from "./reader/useVolumeButtonPaging";
import { SyncButton } from "@/components/ui/SyncButton";

const READER_HTML_ASSET = Asset.fromModule(require("../../assets/reader/reader.html"));

type Props = NativeStackScreenProps<RootStackParamList, "Reader">;
type TTSSegment = VisibleTTSSegment;

// ──────────────────────────── helpers ────────────────────────────

function buildCustomFontFaceCSS(
  fonts: import("@readany/core/types/font").CustomFont[],
  selectedFontId: string | null,
): string {
  if (!selectedFontId) return "";
  const platform = getPlatformService();
  return fonts
    .filter((f) => f.id === selectedFontId)
    .map((f) => {
      // CSS-based remote fonts: @import into the reader iframe
      if (f.source === "remote" && f.remoteCssUrl) {
        return `@import url('${f.remoteCssUrl}');`;
      }
      if (f.source === "remote") return getCSSFontFace(f);
      if (!f.filePath) return "";
      const fileUrl = platform.convertFileSrc(f.filePath);
      const cssFormat =
        f.format === "otf"
          ? "opentype"
          : f.format === "woff"
            ? "woff"
            : f.format === "woff2"
              ? "woff2"
              : "truetype";
      return `@font-face {\n  font-family: '${f.fontFamily}';\n  src: url('${fileUrl}') format('${cssFormat}');\n  font-weight: normal;\n  font-style: normal;\n}`;
    })
    .filter(Boolean)
    .join("\n");
}

// ──────────────────────────── ReaderScreen ────────────────────────────
export function ReaderScreen({ route, navigation }: Props) {
  const colors = useColors();
  const { mode: themeMode } = useTheme();
  const s = makeStyles(colors);
  const { bookId, cfi, highlight: shouldHighlight, openTTS } = route.params;
  const { t, i18n } = useTranslation();
  const isWideLayout = SCREEN_WIDTH >= 768;
  const isIPadLayout = Platform.OS === "ios" && Platform.isPad;
  const shouldToggleSystemStatusBar = !isIPadLayout;
  const baseTopInset = Platform.OS === "ios" ? 20 : 24;

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [tocActiveTab, setTocActiveTab] = useState<"toc" | "bookmarks">("toc");
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotebook, setShowNotebook] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationText, setTranslationText] = useState("");
  const [showTTS, setShowTTS] = useState(false);
  const [showChapterTranslation, setShowChapterTranslation] = useState(false);
  const [isReimporting, setIsReimporting] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [progress, setProgress] = useState(0);
  const [currentChapter, setCurrentChapter] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [toc, setToc] = useState<TOCItem[]>([]);
  const [bookTitle, setBookTitle] = useState("");
  const [webViewReady, setWebViewReady] = useState(false);
  const [translationReady, setTranslationReady] = useState(false);
  const [readerHtmlUri, setReaderHtmlUri] = useState<string | null>(null);
  const [currentCfi, setCurrentCfi] = useState("");
  const [selection, setSelection] = useState<SelectionEvent | null>(null);
  const [noteViewHighlight, setNoteViewHighlight] = useState<{
    id: string;
    text: string;
    note?: string;
    cfi: string;
    color: string;
  } | null>(null);
  const [noteViewEditing, setNoteViewEditing] = useState(false);
  const [noteViewContent, setNoteViewContent] = useState("");
  const [noteTooltip, setNoteTooltip] = useState<{
    note: string;
    cfi: string;
    position: { x: number; y: number; selectionTop: number; selectionBottom: number };
  } | null>(null);
  const noteTooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTooltipVisibleRef = useRef(false);
  const suppressReaderTapUntilRef = useRef(0);
  const assetLoadedRef = useRef(false);
  // Mediator ref so onRelocate can fire TTS continuation without direct hook dependency
  const ttsPendingContinueRef = useRef<{
    pendingTTSContinueCallbackRef: React.RefObject<(() => void) | null>;
    pendingTTSContinueSafetyTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  } | null>(null);

  const bridgeRef = useRef<{
    requestPageSnippet: () => void;
    goNext: () => void;
    search: (query: string) => void;
    clearSearch: () => void;
    navigateSearch: (index: number) => void;
    getVisibleText: () => Promise<string>;
    getVisibleTTSSegments: (alignCfi?: string | null) => Promise<TTSSegment[]>;
    getChapterParagraphs: () => Promise<Array<{ id: string; text: string; tagName: string }>>;
    getTTSSegmentContext: (
      cfi: string,
      before?: number,
      after?: number,
    ) => Promise<{ before: TTSSegment[]; after: TTSSegment[] }>;
    getHrefTTSSegments?: (href: string, count?: number) => Promise<TTSSegment[]>;
    getSectionTTSSegments?: (sectionIndex: number, count?: number) => Promise<TTSSegment[]>;
    goToFraction: (fraction: number) => void;
    goToSection: (sectionIndex: number) => void;
    goToCFI: (cfi: string) => void;
    goToHref: (href: string) => void;
    flashHighlight: (cfi: string, color?: string, duration?: number) => void;
    addAnnotation: (annotation: {
      value: string;
      type?: string;
      color?: string;
      note?: string;
    }) => void;
    removeAnnotation: (annotation: { value: string; type?: string }) => void;
    setTTSHighlight: (cfi: string | null, color?: string, force?: boolean) => void;
  } | null>(null);

  // Chapter translation state
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const webViewRefForVisibility = useRef<WebView | null>(null);
  const chapterTranslationBridgeRef = useRef<{
    getChapterParagraphs: () => Promise<Array<{ id: string; text: string; tagName: string }>>;
    injectChapterTranslations: (
      results: Array<{ paragraphId: string; originalText: string; translatedText: string }>,
    ) => void;
    removeChapterTranslations: () => void;
  } | null>(null);

  const readSettings = useSettingsStore((s) => s.readSettings);
  const updateReadSettings = useSettingsStore((s) => s.updateReadSettings);
  const translationConfig = useSettingsStore((s) => s.translationConfig);
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const settingViewMode = readSettings.viewMode;
  const showTopTitleProgress = readSettings.showTopTitleProgress !== false;
  const showBottomTimeBattery = readSettings.showBottomTimeBattery !== false;
  const volumeButtonsPageTurn = readSettings.volumeButtonsPageTurn === true;

  // Custom fonts — build @font-face CSS per-font using individual filePath
  const customFonts = useFontStore((s) => s.fonts);
  const selectedFontId = useFontStore((s) => s.selectedFontId);
  const customFontFamily = useMemo(() => {
    if (!selectedFontId) return undefined;
    return customFonts.find((f) => f.id === selectedFontId)?.fontFamily;
  }, [customFonts, selectedFontId]);
  const customFontFaceCSS = useMemo(
    () => buildCustomFontFaceCSS(customFonts, selectedFontId),
    [customFonts, selectedFontId],
  );

  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const TOOLBAR_HIDE_OFFSET = 100;
  const toolbarAnim = useRef(new Animated.Value(TOOLBAR_HIDE_OFFSET)).current;
  const readerPullAnim = useRef(new Animated.Value(0)).current;
  const lastCfiRef = useRef<string>("");
  const progressRef = useRef(0);
  const locationHistoryRef = useRef<string[]>([]);
  const lastNavigatedCfiRef = useRef<string | undefined>(undefined);
  const fileServerRef = useRef<string | null>(null);
  const sessionProgressRef = useRef<{
    mode: "location" | "page" | "characters";
    current: number;
    fraction?: number;
    section?: number;
    page?: number;
  } | null>(null);
  const totalBookCharactersRef = useRef<number | null>(null);
  const progressTrackingGuardUntilRef = useRef(0);

  const incrementPagesRead = useReadingSessionStore((s) => s.incrementPagesRead);
  const incrementCharactersRead = useReadingSessionStore((s) => s.incrementCharactersRead);
  const { sendEvent } = useReadingSession(bookId); // Added useReadingSession hook
  const { books, updateBook } = useLibraryStore();
  const setGoToCfiFn = useReaderStore((s) => s.setGoToCfiFn);

  // Throttled progress save (same as desktop - 5 seconds)
  const throttledSaveProgress = useRef(
    throttle((bId: string, prog: number, cfi: string) => {
      updateBook(bId, {
        progress: prog,
        currentCfi: cfi,
      });
    }, 5000),
  ).current;
  const {
    addHighlight,
    updateHighlight,
    removeHighlight,
    loadAnnotations,
    highlights,
    removeBookmark,
  } = useAnnotationStore();
  const book = useMemo(() => books.find((b) => b.id === bookId), [books, bookId]);

  // ── System info (clock/battery/statusBar/SafeArea) ─────────────────────────
  const { readerClock, batteryLevel, isBatteryCharging, stableTopInset, insets } =
    useReaderSystemInfo({ showSearch, isIPadLayout, shouldToggleSystemStatusBar, baseTopInset });

  // ── Bookmark ───────────────────────────────────────────────────────────────
  const bookmark = useReaderBookmark({
    bookId,
    currentCfi,
    currentChapter,
    requestPageSnippet: () => bridgeRef.current?.requestPageSnippet(),
  });
  const { isBookmarked, bookBookmarks, handleToggleBookmark } = bookmark;

  const suppressProgressTracking = useCallback((duration = PROGRAMMATIC_NAV_GUARD_MS) => {
    progressTrackingGuardUntilRef.current = Math.max(
      progressTrackingGuardUntilRef.current,
      Date.now() + duration,
    );
  }, []);

  const goToCFISafely = useCallback(
    (targetCfi: string) => {
      if (!targetCfi) return;
      suppressProgressTracking();
      bridgeRef.current?.goToCFI(targetCfi);
    },
    [suppressProgressTracking],
  );

  const goToHrefSafely = useCallback(
    (href: string) => {
      if (!href) return;
      suppressProgressTracking();
      bridgeRef.current?.goToHref(href);
    },
    [suppressProgressTracking],
  );

  // ── Search ─────────────────────────────────────────────────────────────────
  // Use bridgeRef for lazy access (bridge is initialized later)
  const search = useReaderSearch({
    currentCfi,
    bridge: {
      search: (q) => bridgeRef.current?.search?.(q),
      clearSearch: () => bridgeRef.current?.clearSearch?.(),
      navigateSearch: (idx) => bridgeRef.current?.navigateSearch?.(idx),
      goToCFI: (cfi) => goToCFISafely(cfi),
    },
  });

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    sessionProgressRef.current = null;
    totalBookCharactersRef.current = null;
    suppressProgressTracking(INITIAL_PROGRESS_RESTORE_GUARD_MS);
  }, [bookId]);
  const chapterTranslation = useChapterTranslation({
    bookId,
    sectionIndex: currentSectionIndex,
    aiConfig,
    ready: translationReady,
    translationConfig,
    getParagraphs: async () => {
      if (!chapterTranslationBridgeRef.current) return [];
      return chapterTranslationBridgeRef.current.getChapterParagraphs();
    },
    injectTranslations: (results) => {
      chapterTranslationBridgeRef.current?.injectChapterTranslations(results);
    },
    removeTranslations: () => {
      chapterTranslationBridgeRef.current?.removeChapterTranslations();
    },
    applyVisibility: (originalVisible, translationVisible) => {
      const translationHidden = !translationVisible;
      const originalHidden = !originalVisible;
      const solo = !originalVisible && translationVisible;
      webViewRefForVisibility.current?.injectJavaScript(`
        (function() {
          try {
            var doc = null;
            var renderer = typeof view !== 'undefined' && view && view.renderer;
            if (renderer && renderer.getContents) {
              var contents = renderer.getContents();
              if (contents && contents[0] && contents[0].doc) doc = contents[0].doc;
            }
            if (!doc) {
              var iframes = document.querySelectorAll('iframe');
              for (var fi = 0; fi < iframes.length; fi++) {
                try {
                  var iframeDoc = iframes[fi].contentDocument || (iframes[fi].contentWindow && iframes[fi].contentWindow.document);
                  if (iframeDoc && iframeDoc.body) { doc = iframeDoc; break; }
                } catch (e) {}
              }
            }
            if (!doc) return;
            var els = doc.querySelectorAll('.readany-translation');
            for (var i = 0; i < els.length; i++) {
              els[i].setAttribute('data-hidden', '${translationHidden}');
              els[i].setAttribute('data-solo', '${solo}');
            }
            var origEls = doc.querySelectorAll('[data-translate-id]');
            for (var j = 0; j < origEls.length; j++) {
              origEls[j].setAttribute('data-original-hidden', '${originalHidden}');
            }
          } catch(e) {}
        })();
        true;
      `);
    },
  });

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  // Also read ttsPlayState from store for volume paging guard
  const ttsPlayState = useTTSStore((s) => s.playState);
  const ttsConfig = useTTSStore((s) => s.config);

  // Load reader HTML asset
  useEffect(() => {
    if (assetLoadedRef.current) return;
    assetLoadedRef.current = true;

    const loadAsset = async () => {
      try {
        const asset = READER_HTML_ASSET;
        await asset.downloadAsync();
        const uri = asset.localUri || asset.uri;
        setReaderHtmlUri(uri);
      } catch (err) {
        console.error("[ReaderScreen] Failed to load reader.html asset:", err);
        setError("Failed to load reader");
      }
    };
    loadAsset();
  }, []);

  // Controls toggle — declared before bridge so onTap can reference it without TS error
  const toggleControls = useCallback(() => {
    const willShow = !showControls;
    setShowControls(willShow);
    Animated.timing(toolbarAnim, {
      toValue: willShow ? 0 : TOOLBAR_HIDE_OFFSET,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    if (willShow) {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
      controlsTimer.current = setTimeout(() => {
        setShowControls(false);
        Animated.timing(toolbarAnim, {
          toValue: TOOLBAR_HIDE_OFFSET,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }, CONTROLS_TIMEOUT);
    }
  }, [showControls, toolbarAnim]);

  // Reader bridge
  const bridge = useReaderBridge({
    onReady: () => {
      setWebViewReady(true);
      bridge.webViewRef.current?.injectJavaScript(`
        (function() {
          if (!window.__view && document.querySelector('foliate-view')) {
            window.__view = document.querySelector('foliate-view');
          }
        })();
        true;
      `);
    },
    onLoaded: () => {
      setLoading(false);
      const settings = useSettingsStore.getState().readSettings;
      const { fonts, selectedFontId: selId } = useFontStore.getState();
      const fontCSS = buildCustomFontFaceCSS(fonts, selId);
      const fontFamily = selId ? fonts.find((f) => f.id === selId)?.fontFamily : undefined;
      console.log("[ReaderScreen][Font] selection", {
        selectedFontId: selId,
        fontFamily,
        fontCSSLength: fontCSS.length,
      });
      bridge.applySettings({
        fontSize: settings.fontSize,
        lineHeight: settings.lineHeight,
        paragraphSpacing: settings.paragraphSpacing,
        pageMargin: settings.pageMargin,
        fontTheme: settings.fontTheme,
        viewMode: settings.viewMode,
        paginatedLayout: settings.paginatedLayout,
        customFontFaceCSS: fontCSS,
        customFontFamily: fontFamily,
      });
    },
    onBookTextMetrics: ({ totalCharacters }) => {
      totalBookCharactersRef.current = totalCharacters > 0 ? totalCharacters : null;
    },
    onRelocate: (detail: RelocateEvent) => {
      console.log("[ReaderScreen] onRelocate", {
        section: detail.section,
        fraction: detail.fraction,
        cfi: detail.cfi,
        routeCfi: cfi,
        lastNavigated: lastNavigatedCfiRef.current,
      });
      if (loading) {
        setLoading(false);
      }
      // Track section changes for chapter translation reset
      const newSection = detail.section?.current ?? 0;
      if (newSection !== currentSectionIndex) {
        setCurrentSectionIndex(newSection);
        setTranslationReady(false);
        chapterTranslation.reset();
      }

      if (detail.fraction != null) setProgress(detail.fraction);

      if (detail.page) {
        setCurrentPage(Math.max(1, detail.page.current));
        setTotalPages(Math.max(1, detail.page.total));
      } else if (detail.section?.total && !detail.location?.total) {
        // Fixed-layout documents can still expose stable section pages.
        setCurrentPage(Math.max(1, detail.section.current + 1));
        setTotalPages(Math.max(1, detail.section.total));
      } else {
        // Reflowable books without renderer-backed pagination should fall back to percent.
        setCurrentPage(0);
        setTotalPages(0);
      }

      const trackingSuppressed = Date.now() < progressTrackingGuardUntilRef.current;

      if (detail.location?.total) {
        const totalBookCharacters = totalBookCharactersRef.current;
        const fraction = detail.fraction ?? 0;
        if (totalBookCharacters && totalBookCharacters > 0) {
          const currentCharacters = Math.round(totalBookCharacters * fraction);
          const previous = sessionProgressRef.current;
          const currentSection = detail.section?.current ?? 0;
          const currentRendererPage = detail.page?.current ?? null;

          if (
            !trackingSuppressed &&
            previous?.mode === "characters" &&
            currentCharacters > previous.current
          ) {
            if (currentRendererPage != null && previous.page != null && previous.section != null) {
              const samePage =
                previous.section === currentSection && previous.page === currentRendererPage;
              const movedForwardWithinSection =
                previous.section === currentSection &&
                currentRendererPage > previous.page &&
                currentRendererPage - previous.page <= MAX_TRACKED_PAGE_DELTA;
              const movedForwardAcrossSection =
                currentSection > previous.section && currentSection - previous.section <= 1;

              if (!samePage && (movedForwardWithinSection || movedForwardAcrossSection)) {
                incrementCharactersRead(currentCharacters - previous.current);
              }
            } else if (
              Math.abs(fraction - (previous.fraction ?? 0)) <= MAX_TRACKED_FRACTION_DELTA
            ) {
              incrementCharactersRead(currentCharacters - previous.current);
            }
          }
          sessionProgressRef.current = {
            mode: "characters",
            current: currentCharacters,
            fraction,
            section: currentSection,
            page: currentRendererPage ?? undefined,
          };
        } else {
          const previous = sessionProgressRef.current;
          if (
            !trackingSuppressed &&
            previous?.mode === "location" &&
            detail.location.current > previous.current
          ) {
            const delta = detail.location.current - previous.current;
            if (delta <= MAX_TRACKED_LOCATION_DELTA) {
              incrementCharactersRead(delta * REFLOWABLE_CHARACTERS_PER_LOCATION);
            }
          }
          sessionProgressRef.current = {
            mode: "location",
            current: detail.location.current,
            fraction,
          };
        }
      } else if (detail.section?.total) {
        const previous = sessionProgressRef.current;
        if (
          !trackingSuppressed &&
          previous?.mode === "page" &&
          detail.section.current > previous.current
        ) {
          const delta = detail.section.current - previous.current;
          if (delta <= MAX_TRACKED_PAGE_DELTA) {
            incrementPagesRead(delta);
          }
        }
        sessionProgressRef.current = { mode: "page", current: detail.section.current };
      }
      if (detail.tocItem?.label) setCurrentChapter(detail.tocItem.label);
      if (detail.cfi) {
        if (lastCfiRef.current && detail.cfi !== lastCfiRef.current) {
          const fractionDiff = Math.abs((detail.fraction ?? 0) - progress);
          if (fractionDiff > 0.02 || locationHistoryRef.current.length === 0) {
            locationHistoryRef.current.push(lastCfiRef.current);
            if (locationHistoryRef.current.length > 50) {
              locationHistoryRef.current.shift();
            }
          }
        }
        lastCfiRef.current = detail.cfi;
        setCurrentCfi(detail.cfi);
        // Use throttled save instead of immediate update
        throttledSaveProgress(bookId, detail.fraction ?? 0, detail.cfi);
      }

      // Mark translation ready after first successful relocate (CFI navigation done)
      if (!translationReady) setTranslationReady(true);

      // If TTS is waiting for a page turn to complete, fire the continuation callback now
      // that the renderer has fully updated its position (renderer.start reflects new page).
      if (ttsPendingContinueRef.current?.pendingTTSContinueCallbackRef.current) {
        console.log("[ReaderScreen][TTS] onRelocate triggered pending TTS continuation");
        const cb = ttsPendingContinueRef.current.pendingTTSContinueCallbackRef.current;
        ttsPendingContinueRef.current.pendingTTSContinueCallbackRef.current = null;
        // Cancel the safety timer since onRelocate fired successfully
        const safetyTimerRef = ttsPendingContinueRef.current.pendingTTSContinueSafetyTimerRef;
        if (safetyTimerRef.current) {
          clearTimeout(safetyTimerRef.current);
          safetyTimerRef.current = null;
        }
        void cb();
      }

      // Sync reading context for AI tools
      readingContextService.updateContext({
        bookId,
        bookTitle: book?.meta?.title || "",
        currentChapter: {
          index: detail.section?.current ?? 0,
          title: detail.tocItem?.label || "",
          href: detail.tocItem?.href || "",
        },
        currentPosition: {
          cfi: detail.cfi || "",
          percentage: (detail.fraction ?? 0) * 100,
        },
      });
    },
    onTocReady: (items: TOCItem[]) => {
      setToc(items);
    },
    onSelection: (detail: SelectionEvent) => {
      setSelection(detail);
      // Sync selection for AI tools
      if (detail.cfi) {
        readingContextService.updateSelection({
          text: detail.text,
          cfi: detail.cfi,
          chapterIndex: 0,
          chapterTitle: "",
        });
      }
    },
    onSelectionCleared: () => {
      setSelection(null);
      readingContextService.clearSelection();
    },
    onTap: () => {
      if (noteTooltipVisibleRef.current || Date.now() < suppressReaderTapUntilRef.current) {
        return;
      }
      sendEvent({ type: "activity" });
      if (selection) {
        setSelection(null);
        return;
      }
      toggleControls();
    },
    onToggleBookmark: () => {
      handleToggleBookmark();
    },
    onBookmarkPull: ({ offset, active }) => {
      if (active) {
        readerPullAnim.setValue(offset);
        return;
      }

      Animated.timing(readerPullAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    },
    onSearchResult: (index: number, count: number) => {
      search.onSearchResult(index, count);
    },
    onSearchComplete: (count: number) => {
      search.onSearchComplete(count);
    },
    onError: (message: string) => {
      console.error("[Reader] WebView error:", message);
      if (loading) {
        setError(message);
        setLoading(false);
      }
    },
    onShowAnnotation: (detail: {
      value: string;
      position: { x: number; y: number; selectionTop: number; selectionBottom: number };
    }) => {
      suppressReaderTapUntilRef.current = Date.now() + 650;
      const highlight = highlights.find((h) => h.cfi === detail.value);
      if (!highlight) return;
      if (highlight.note) {
        setNoteViewHighlight({
          id: highlight.id,
          text: highlight.text,
          note: highlight.note,
          cfi: highlight.cfi,
          color: highlight.color,
        });
        setNoteViewContent(highlight.note);
        setNoteViewEditing(false);
      } else {
        setSelection({
          text: highlight.text,
          cfi: highlight.cfi,
          position: detail.position,
        });
      }
    },
    onNoteTooltip: (detail) => {
      suppressReaderTapUntilRef.current = Date.now() + 900;
      // Dismiss any existing tooltip
      if (noteTooltipTimer.current) {
        clearTimeout(noteTooltipTimer.current);
      }
      setNoteTooltip({
        note: detail.note,
        cfi: detail.cfi,
        position: detail.position,
      });
      // Auto-hide after 4 seconds
      noteTooltipTimer.current = setTimeout(() => {
        setNoteTooltip(null);
        noteTooltipTimer.current = null;
      }, 4000);
    },
    onPageSnippet: (_text: string) => {
      // page snippet handled by bookmark hook if pending
    },
    onBookmarkSnippet: (text: string) => {
      bookmark.onBookmarkSnippet(text);
    },
  });

  useEffect(() => {
    noteTooltipVisibleRef.current = !!noteTooltip;
  }, [noteTooltip]);

  // ── Volume button paging ─────────────────────────────────────────────────
  const volumeButtonPagingActive =
    Platform.OS !== "web" &&
    Platform.OS !== "windows" &&
    !!NativeModules.VolumeManager &&
    !!getVolumeManager() &&
    volumeButtonsPageTurn &&
    webViewReady &&
    !showSearch &&
    !showTOC &&
    !showSettings &&
    !showNotebook &&
    !showTTS &&
    ttsPlayState === "stopped";

  useVolumeButtonPaging({
    active: volumeButtonPagingActive,
    settingViewMode,
    onPrev: () => bridge.goPrev(),
    onNext: () => bridge.goNext(),
  });

  bridgeRef.current = bridge;
  chapterTranslationBridgeRef.current = bridge;

  // ── useReaderTTS ──
  const tts = useReaderTTS({
    bookId,
    bookTitle: bookTitle || book?.meta.title || "",
    currentChapter,
    currentSectionIndex,
    currentCfi,
    webViewReady,
    showTTS,
    setShowTTS,
    setShowControls,
    bridgeRef,
    toc,
    bookCoverUrl: book?.meta.coverUrl,
    colors,
    goToHref: bridge.goToHref,
  });

  // Bind mediator ref so onRelocate can fire the TTS continuation callback
  ttsPendingContinueRef.current = {
    pendingTTSContinueCallbackRef: tts.pendingTTSContinueCallbackRef,
    pendingTTSContinueSafetyTimerRef: tts.pendingTTSContinueSafetyTimerRef,
  };

  // ── Non-TTS callbacks ──────────────────────────────────────────────────────

  const goToTocItem = useCallback(
    (href: string) => {
      if (lastCfiRef.current) {
        locationHistoryRef.current.push(lastCfiRef.current);
      }
      goToHrefSafely(href);
      setShowTOC(false);
    },
    [goToHrefSafely],
  );

  const goBackToPreviousLocation = useCallback(() => {
    if (locationHistoryRef.current.length === 0) return;
    const previousCfi = locationHistoryRef.current.pop();
    if (previousCfi) {
      goToCFISafely(previousCfi);
    }
  }, [goToCFISafely]);

  const canGoBack = locationHistoryRef.current.length > 0;

  const updateSetting = useCallback(
    <K extends keyof ReadSettings>(key: K, value: ReadSettings[K]) => {
      const updates = { [key]: value } as Partial<ReadSettings>;
      updateReadSettings(updates);
      const currentSettings = useSettingsStore.getState().readSettings;
      const { fonts, selectedFontId: selId } = useFontStore.getState();
      const fontCSS = buildCustomFontFaceCSS(fonts, selId);
      const fontFamily = selId ? fonts.find((f) => f.id === selId)?.fontFamily : undefined;
      bridge.applySettings({
        ...currentSettings,
        ...updates,
        customFontFaceCSS: fontCSS,
        customFontFamily: fontFamily,
      });
    },
    [bridge, updateReadSettings],
  );

  // Selection popover handlers
  const handleHighlight = useCallback(
    (color: string) => {
      if (!selection) return;
      const highlight = {
        id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        bookId,
        cfi: selection.cfi,
        text: selection.text,
        color: color as any,
        chapterTitle: currentChapter,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addHighlight(highlight);
      bridge.addAnnotation({ value: selection.cfi, type: "highlight", color });
      setSelection(null);
    },
    [selection, bookId, currentChapter, addHighlight, bridge],
  );

  const handleDismissSelection = useCallback(() => {
    setSelection(null);
  }, []);

  useEffect(() => {
    setGoToCfiFn(() => bridge.goToCFI);
    return () => setGoToCfiFn(null);
  }, [bridge.goToCFI, setGoToCfiFn]);

  // ── Book loading effects ───────────────────────────────────────────────────

  // Load book metadata and annotations
  useEffect(() => {
    if (!book) {
      setError(t("reader.bookNotFound", "书籍未找到"));
      setLoading(false);
      return;
    }
    setBookTitle(book.meta.title);
    updateBook(bookId, { lastOpenedAt: Date.now() });
    loadAnnotations(bookId);

    return () => {
      readingContextService.clearContext();
    };
  }, [bookId]);

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      void loadAnnotations(bookId);
    });
  }, [bookId, loadAnnotations]);

  // Save progress immediately on unmount
  useEffect(() => {
    return () => {
      if (fileServerRef.current) {
        stopFileServer();
        fileServerRef.current = null;
      }
      if (lastCfiRef.current) {
        const db = require("@readany/core/db/database");
        runWithDbRetry(
          () =>
            db.updateBook(bookId, {
              progress: progressRef.current,
              currentCfi: lastCfiRef.current,
            }),
          { attempts: 10, initialDelayMs: 150 },
        ).catch((err: Error) => console.error("Failed to save progress on unmount:", err));
      }
      const { useSyncStore } = require("@readany/core/stores/sync-store");
      useSyncStore.getState().syncNow?.();
    };
  }, [bookId]);

  // When WebView is ready and book is available, send the open command
  useEffect(() => {
    if (!webViewReady || !book?.filePath) {
      return;
    }

    const loadBook = async () => {
      try {
        setLoading(true);
        setError(null);
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, book.filePath);
        const lastLocation = book.currentCfi || undefined;
        const fileName = book.filePath.split("/").pop() || "book.epub";
        const mimeType = BOOK_FORMAT_MIME_TYPES[book.format] || "application/octet-stream";

        // Start a local HTTP server so the WebView can fetch the file directly.
        // This avoids loading the entire file into RN memory + base64 encoding (33% overhead)
        // and the massive JSON serialization through injectJavaScript.
        const serverUrl = await startFileServer(appData);
        fileServerRef.current = serverUrl;
        const encodedPath = book.filePath
          .split("/")
          .map((s) => encodeURIComponent(s))
          .join("/");

        bridge.openBook({
          uri: `${serverUrl}/${encodedPath}`,
          fileName,
          mimeType,
          lastLocation,
          pageMargin: readSettings.pageMargin,
          paginatedLayout: readSettings.paginatedLayout,
        });

        bridge.setThemeColors({
          background: colors.background,
          foreground: colors.foreground,
          muted: colors.mutedForeground,
          primary: colors.primary,
        });
      } catch (err: any) {
        console.error("[ReaderScreen] Failed to load book:", err);
        setError(err.message || "Failed to load book file");
        setLoading(false);
      }
    };

    loadBook();
  }, [bookId, book?.filePath, loadAttempt, webViewReady]);

  const handleReimportMissingBook = useCallback(async () => {
    if (isReimporting) return;
    setIsReimporting(true);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: BOOK_MIME_TYPES,
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const selectedUri = result.assets[0].uri;
      if (book) {
        const candidate = await useLibraryStore.getState().inspectDeletedBookCandidate(bookId, {
          uri: selectedUri,
          name: result.assets[0].name,
        });
        if (candidate && shouldConfirmReimportCandidate(book, candidate)) {
          const shouldContinue = await useMissingBookPromptStore.getState().showPrompt({
            title: t("reader.reimportMismatchTitle", "这份文件看起来和原书不太一致"),
            description: t(
              "reader.reimportMismatchDescription",
              "原书《{{originalTitle}}》与当前文件《{{candidateTitle}}》信息差异较大。仍要把它接回原来的笔记和阅读统计吗？",
              {
                originalTitle: book.meta.title,
                candidateTitle: candidate.title || t("reader.unknownBook", "未命名书籍"),
              },
            ),
            confirmLabel: t("reader.reimportContinue", "继续接回"),
            cancelLabel: t("reader.reimportPickAnotherFile", "重新选择"),
          });
          if (!shouldContinue) return;
        }
      }

      const restoredBook = await useLibraryStore
        .getState()
        .reimportDeletedBook(bookId, { uri: selectedUri, name: result.assets[0].name });

      if (!restoredBook) {
        setError(t("reader.reimportFailed", "重新导入失败，请稍后再试。"));
        return;
      }

      setError(null);
      setLoading(true);
    } catch (err) {
      console.error("[ReaderScreen] Failed to re-import missing book:", err);
      setError(
        err instanceof Error
          ? err.message
          : t("reader.reimportFailed", "重新导入失败，请稍后再试。"),
      );
    } finally {
      setIsReimporting(false);
    }
  }, [bookId, isReimporting, t]);

  // Apply theme colors when theme changes
  useEffect(() => {
    if (!webViewReady) return;
    bridge.setThemeColors({
      background: colors.background,
      foreground: colors.foreground,
      muted: colors.mutedForeground,
      primary: colors.primary,
    });
  }, [themeMode, webViewReady]);

  // Re-apply font settings when custom fonts or selected font changes
  useEffect(() => {
    if (!webViewReady) return;
    bridge.applySettings({
      customFontFaceCSS: customFontFaceCSS,
      customFontFamily: customFontFamily,
    });
  }, [customFontFaceCSS, customFontFamily, webViewReady]);

  // Load annotations into reader when ready
  useEffect(() => {
    if (!webViewReady || loading || highlights.length === 0) return;
    for (const h of highlights) {
      bridge.addAnnotation({ value: h.cfi, type: "highlight", color: h.color, note: h.note });
    }
  }, [webViewReady, loading, highlights]);

  // Reset last navigated CFI when book changes
  useEffect(() => {
    lastNavigatedCfiRef.current = undefined;
  }, [bookId]);

  // Navigate to CFI when book is loaded (from NotesPage or AI citation navigation)
  useEffect(() => {
    if (!webViewReady || loading || !cfi || cfi === lastNavigatedCfiRef.current) return;
    goToCFISafely(cfi);
    lastNavigatedCfiRef.current = cfi;
    navigation.setParams({ bookId, cfi: undefined, highlight: undefined });

    if (shouldHighlight) {
      let flashCount = 0;
      const doFlash = () => {
        if (flashCount >= 3) return;
        bridge.flashHighlight(cfi, "orange", 500);
        flashCount++;
        if (flashCount < 3) setTimeout(doFlash, 600);
      };
      setTimeout(doFlash, 100);
    }
  }, [webViewReady, loading, cfi, shouldHighlight, goToCFISafely, navigation, bookId]);

  // Open TTS lyrics page when navigating from notification
  useEffect(() => {
    if (!openTTS || !webViewReady || loading) return;

    let cancelled = false;
    const openLyricsPage = async () => {
      const targetCfi =
        tts.resolvedTTSSegmentCfi || tts.ttsDisplaySegments[0]?.cfi || currentCfi || null;
      if (targetCfi && targetCfi !== currentCfi) {
        goToCFISafely(targetCfi);
        await new Promise((resolve) => setTimeout(resolve, 320));
      }
      if (cancelled) return;
      setShowControls(false);
      setShowTTS(true);
      navigation.setParams({ bookId, openTTS: undefined });
    };

    void openLyricsPage();
    return () => {
      cancelled = true;
    };
  }, [bookId, currentCfi, goToCFISafely, loading, navigation, openTTS, webViewReady]);

  // Lock navigation when selection is active
  useEffect(() => {
    if (!webViewReady) return;
    bridge.setNavigationLocked(!!selection);
  }, [webViewReady, selection]);

  if (loading && !webViewReady && !readerHtmlUri) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.loadingText}>{t("reader.loading", "正在加载...")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        <View style={s.loadingWrap}>
          <Text style={s.errorText}>{t("reader.loadFailed", "加载失败")}</Text>
          <Text style={[s.loadingText, { textAlign: "center", maxWidth: 320 }]}>{error}</Text>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
            <TouchableOpacity
              style={s.backButton}
              onPress={() => {
                if (book?.filePath) {
                  setLoading(true);
                  setError(null);
                  setLoadAttempt((value) => value + 1);
                  return;
                }
                navigation.reset({ routes: [{ name: "Tabs" }] });
              }}
            >
              <Text style={s.backButtonText}>
                {book?.filePath ? t("common.retry", "重试") : t("common.back", "返回")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                s.backButton,
                { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
              ]}
              onPress={() => void handleReimportMissingBook()}
              disabled={isReimporting}
            >
              <Text style={[s.backButtonText, { color: colors.foreground }]}>
                {isReimporting
                  ? t("reader.reimporting", "正在重新导入...")
                  : t("reader.reimport", "重新导入")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!readerHtmlUri) {
    return (
      <View style={s.container}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.loadingText}>{t("reader.loading", "加载阅读器...")}</Text>
        </View>
      </View>
    );
  }

  const layoutTopInset = stableTopInset;
  const topToolbarRowHeight = isWideLayout ? 62 : 48;
  const bottomDockIconSize = isWideLayout ? 24 : 22;
  const topToolbarIconSize = isWideLayout ? 24 : 22;
  const percent = Math.round(progress * 100);
  const topControlsTranslate = toolbarAnim.interpolate({
    inputRange: [0, TOOLBAR_HIDE_OFFSET],
    outputRange: [0, -10],
  });
  const topControlsOpacity = toolbarAnim.interpolate({
    inputRange: [0, TOOLBAR_HIDE_OFFSET * 0.5, TOOLBAR_HIDE_OFFSET],
    outputRange: [1, 0.28, 0],
  });
  const bottomControlsTranslate = toolbarAnim.interpolate({
    inputRange: [0, TOOLBAR_HIDE_OFFSET],
    outputRange: [0, 12],
  });
  const bottomControlsOpacity = toolbarAnim.interpolate({
    inputRange: [0, TOOLBAR_HIDE_OFFSET * 0.5, TOOLBAR_HIDE_OFFSET],
    outputRange: [1, 0.28, 0],
  });
  const auxToolsTranslate = toolbarAnim.interpolate({
    inputRange: [0, TOOLBAR_HIDE_OFFSET],
    outputRange: [0, 14],
  });
  const auxToolsOpacity = toolbarAnim.interpolate({
    inputRange: [0, TOOLBAR_HIDE_OFFSET * 0.55, TOOLBAR_HIDE_OFFSET],
    outputRange: [1, 0.24, 0],
  });

  const isPanelOpen = showTOC || showSettings || showSearch || showNotebook || showTranslation;
  const existingSelectionHighlight = selection
    ? (highlights.find((highlight) => highlight.cfi === selection.cfi) ?? null)
    : null;
  const readerTopMargin = !showSearch
    ? showTopTitleProgress
      ? layoutTopInset + 30
      : layoutTopInset
    : 0;
  const readerBottomInset =
    !showSearch && showBottomTimeBattery ? Math.max(insets.bottom, 8) + 14 : 0;
  const batteryLabel = batteryLevel == null ? "--%" : `${Math.round(batteryLevel * 100)}%`;
  const selectionPopoverSelection = selection
    ? {
        ...selection,
        position: {
          ...selection.position,
          y: selection.position.y + readerTopMargin,
          selectionTop: selection.position.selectionTop + readerTopMargin,
          selectionBottom: selection.position.selectionBottom + readerTopMargin,
        },
      }
    : null;
  const adjustedNoteTooltip = noteTooltip
    ? {
        ...noteTooltip,
        position: {
          ...noteTooltip.position,
          y: noteTooltip.position.y + readerTopMargin,
          selectionTop: noteTooltip.position.selectionTop + readerTopMargin,
          selectionBottom: noteTooltip.position.selectionBottom + readerTopMargin,
        },
      }
    : null;

  return (
    <View style={[s.container, { paddingBottom: insets.bottom }]}>
      <Animated.View
        style={[s.readerStage, { transform: [{ translateY: readerPullAnim }] }]}
        pointerEvents="box-none"
      >
        {/* WebView with foliate-js */}
        <View style={{ flex: 1 }}>
          <WebView
            ref={bridge.webViewRef}
            source={{ uri: readerHtmlUri }}
            style={[
              s.webview,
              {
                marginTop: readerTopMargin,
                marginBottom: readerBottomInset,
              },
            ]}
            pointerEvents={isPanelOpen ? "none" : "auto"}
            onMessage={bridge.handleMessage}
            onError={(e) => {
              console.error("[ReaderScreen] WebView error:", e.nativeEvent);
            }}
            onHttpError={(e) => {
              console.error("[ReaderScreen] WebView HTTP error:", e.nativeEvent);
            }}
            onContentProcessDidTerminate={() => {
              console.warn("[ReaderScreen] WebView content process terminated");
            }}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            allowsInlineMediaPlayback
            scrollEnabled={false}
            showsVerticalScrollIndicator={false}
            originWhitelist={["*"]}
            mixedContentMode="always"
          />
        </View>

        {/* Loading overlay */}
        {loading && (
          <View style={s.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}

        {/* ─── Top Info Bar (always visible) ─── */}
        {!showSearch && !showControls && showTopTitleProgress && (
          <View style={[s.topInfoBar, { top: layoutTopInset }]}>
            <View style={s.topInfoRow}>
              <Text style={s.topInfoText} numberOfLines={1}>
                {currentChapter || bookTitle}
              </Text>
              <Text style={s.topInfoPageText}>
                {currentPage > 0 && totalPages > 0 ? `${currentPage}/${totalPages}` : `${percent}%`}
              </Text>
            </View>
          </View>
        )}
      </Animated.View>

      {/* ─── Bookmark Ribbon (top-right) ─── */}
      <BookmarkRibbon visible={isBookmarked} topOffset={0} />

      {!showSearch && (
        <Animated.View
          pointerEvents={showControls ? "auto" : "none"}
          style={[
            s.topToolbar,
            {
              top: 0,
              left: 0,
              right: 0,
              opacity: topControlsOpacity,
              transform: [{ translateY: topControlsTranslate }],
            },
          ]}
        >
          <View
            style={[
              s.topToolbarBar,
              {
                paddingTop: layoutTopInset,
                minHeight: layoutTopInset + topToolbarRowHeight,
              },
            ]}
          >
            <View
              style={[
                s.topToolbarRow,
                {
                  minHeight: topToolbarRowHeight,
                  paddingLeft: insets.left + 12,
                  paddingRight: insets.right + 16,
                },
              ]}
            >
              <View style={s.topToolbarSideSlot}>
                <TouchableOpacity
                  style={s.topToolbarBackBtn}
                  onPress={() => navigation.reset({ routes: [{ name: "Tabs" }] })}
                >
                  <ChevronLeftIcon size={topToolbarIconSize} color={colors.foreground} />
                </TouchableOpacity>
              </View>
              <View style={s.topToolbarTitleWrap}>
                <Text style={s.topToolbarTitleText} numberOfLines={1}>
                  {currentChapter || bookTitle}
                </Text>
              </View>
              <View style={[s.topToolbarSideSlot, s.topToolbarMetaWrap, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
                <SyncButton size={16} color={colors.foreground} />
                <Text style={s.topToolbarMetaText}>
                  {currentPage > 0 && totalPages > 0
                    ? `${currentPage}/${totalPages}`
                    : `${percent}%`}
                </Text>
              </View>
            </View>
            <View style={s.topToolbarProgressTrack}>
              <View style={[s.topToolbarProgressFill, { width: `${percent}%` }]} />
            </View>
          </View>
        </Animated.View>
      )}

      {/* Selection Popover */}
      {selectionPopoverSelection && (
        <SelectionPopover
          selection={selectionPopoverSelection}
          onHighlight={handleHighlight}
          onDismiss={handleDismissSelection}
          onCopy={() => {
            setSelection(null);
          }}
          onAIChat={() => {
            const selectedText = selectionPopoverSelection.text;
            const chapter = currentChapter;
            setSelection(null);
            navigation.navigate("BookChat", {
              bookId,
              selectedText,
              chapterTitle: chapter,
            });
          }}
          onNote={(text, cfi) => {
            const mutation = createSelectionNoteMutation({
              bookId,
              cfi,
              text: selectionPopoverSelection.text,
              note: text,
              chapterTitle: currentChapter,
              existingHighlight: existingSelectionHighlight,
              defaultColor: "yellow",
            });

            if (mutation.kind === "create") {
              addHighlight(mutation.highlight);
              bridge.addAnnotation({
                value: cfi,
                type: "highlight",
                color: mutation.highlight.color,
                note: mutation.highlight.note,
              });
              return;
            }

            updateHighlight(mutation.id, mutation.updates);
            bridge.addAnnotation({
              value: cfi,
              type: "highlight",
              color: existingSelectionHighlight?.color || "yellow",
              note: mutation.updates.note,
            });
          }}
          onTranslate={(text) => {
            setShowTranslation(true);
            setTranslationText(text);
          }}
          existingHighlight={
            existingSelectionHighlight
              ? {
                  id: existingSelectionHighlight.id,
                  color: existingSelectionHighlight.color,
                  note: existingSelectionHighlight.note,
                }
              : null
          }
          onRemoveHighlight={() => {
            const existing = highlights.find((h) => h.cfi === selectionPopoverSelection.cfi);
            if (existing) {
              removeHighlight(existing.id);
              bridge.removeAnnotation({ value: existing.cfi });
            }
          }}
        />
      )}

      {/* Note Tooltip (long-press on wavy underline) */}
      {adjustedNoteTooltip && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              suppressReaderTapUntilRef.current = Date.now() + 350;
              if (noteTooltipTimer.current) {
                clearTimeout(noteTooltipTimer.current);
                noteTooltipTimer.current = null;
              }
              setNoteTooltip(null);
            }}
          />
          <Pressable
            style={[
              s.noteTooltip,
              {
                left: Math.max(
                  NOTE_TOOLTIP_SIDE_PADDING,
                  Math.min(
                    adjustedNoteTooltip.position.x - NOTE_TOOLTIP_WIDTH / 2,
                    SCREEN_WIDTH - NOTE_TOOLTIP_WIDTH - NOTE_TOOLTIP_SIDE_PADDING,
                  ),
                ),
                ...(adjustedNoteTooltip.position.selectionTop > NOTE_TOOLTIP_TOP_THRESHOLD
                  ? {
                      bottom:
                        SCREEN_HEIGHT -
                        adjustedNoteTooltip.position.selectionTop +
                        NOTE_TOOLTIP_ABOVE_OFFSET,
                    }
                  : {
                      top: adjustedNoteTooltip.position.selectionBottom + NOTE_TOOLTIP_BELOW_OFFSET,
                    }),
              },
            ]}
            onPress={(event) => {
              event.stopPropagation();
              suppressReaderTapUntilRef.current = Date.now() + 550;
            }}
            onPressIn={(event) => {
              event.stopPropagation();
              suppressReaderTapUntilRef.current = Date.now() + 550;
            }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
          >
            <View style={s.noteTooltipContent}>
              <MarkdownRenderer
                content={adjustedNoteTooltip.note || ""}
                styleOverrides={noteTooltipMdStyles}
              />
            </View>
          </Pressable>
        </View>
      )}

      {!showSearch && (
        <Animated.View
          pointerEvents={showControls ? "auto" : "none"}
          style={[
            s.floatingTools,
            {
              right: insets.right + 16,
              bottom: insets.bottom + 110,
              opacity: auxToolsOpacity,
              transform: [{ translateY: auxToolsTranslate }],
            },
          ]}
        >
          <TouchableOpacity
            style={[
              s.floatingToolBtn,
              (showChapterTranslation || chapterTranslation.state.status !== "idle") &&
                s.floatingToolBtnActive,
            ]}
            onPress={() => setShowChapterTranslation(true)}
          >
            <LanguagesIcon size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              s.floatingToolBtn,
              (showTTS || ttsPlayState !== "stopped") && s.floatingToolBtnActive,
            ]}
            onPress={tts.handleToggleTTS}
          >
            <HeadphonesIcon size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.floatingToolBtn}
            onPress={() => navigation.navigate("BookChat", { bookId })}
          >
            <BotIcon size={20} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      )}

      {!showSearch && !showControls && showBottomTimeBattery && (
        <View
          pointerEvents="none"
          style={[
            s.bottomInfoBar,
            {
              left: insets.left + 18,
              right: insets.right + 18,
              bottom: Math.max(insets.bottom, 8) + 4,
            },
          ]}
        >
          <Text style={s.bottomInfoText}>{readerClock}</Text>
          <View style={s.bottomInfoSide}>
            <BatteryIcon
              width={22}
              height={11}
              color={colors.mutedForeground}
              level={batteryLevel}
              charging={isBatteryCharging}
            />
            <Text style={s.bottomInfoText}>{batteryLabel}</Text>
          </View>
        </View>
      )}

      {/* ─── Bottom Toolbar ─── */}
      {!showSearch && (
        <Animated.View
          pointerEvents={showControls ? "auto" : "none"}
          style={[
            s.bottomToolbar,
            {
              left: 0,
              right: 0,
              opacity: bottomControlsOpacity,
              transform: [{ translateY: bottomControlsTranslate }],
            },
          ]}
        >
          <View
            style={[
              s.bottomToolbarGlass,
              {
                paddingBottom: Math.max(insets.bottom, 8) + 6,
                paddingLeft: insets.left + 18,
                paddingRight: insets.right + 18,
              },
            ]}
          >
            <View style={s.bottomToolbarProgressTrack}>
              <View style={[s.bottomToolbarProgressFill, { width: `${percent}%` }]} />
            </View>
            <View style={s.bottomDockRow}>
              <TouchableOpacity
                style={s.bottomDockBtn}
                onPress={() => {
                  setTocActiveTab("toc");
                  setShowTOC(true);
                }}
              >
                <ListIcon size={bottomDockIconSize} color={colors.foreground} />
                <Text style={s.bottomDockLabel}>{t("reader.toc", "目录")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.bottomDockBtn, isBookmarked && s.bottomDockBtnActive]}
                onPress={handleToggleBookmark}
              >
                {isBookmarked ? (
                  <BookmarkFilledIcon size={bottomDockIconSize} color={colors.primary} />
                ) : (
                  <BookmarkIcon size={bottomDockIconSize} color={colors.foreground} />
                )}
                <Text style={[s.bottomDockLabel, isBookmarked && s.bottomDockLabelActive]}>
                  {t("reader.bookmarks", "书签")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.bottomDockBtn}
                onPress={() => navigation.navigate("FullScreenNotes", { bookId })}
              >
                <NotebookPenIcon size={bottomDockIconSize} color={colors.foreground} />
                <Text style={s.bottomDockLabel}>{t("notes.title", "笔记")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.bottomDockBtn}
                onPress={() => {
                  setShowSearch(true);
                  setShowControls(false);
                  Animated.timing(toolbarAnim, {
                    toValue: TOOLBAR_HIDE_OFFSET,
                    duration: 180,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                  }).start();
                }}
              >
                <SearchIcon size={bottomDockIconSize} color={colors.foreground} />
                <Text style={s.bottomDockLabel}>{t("reader.search", "搜索")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.bottomDockBtn} onPress={() => setShowSettings(true)}>
                <SettingsIcon size={bottomDockIconSize} color={colors.foreground} />
                <Text style={s.bottomDockLabel}>{t("common.settings", "设置")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      )}

      {/* ─── Search Bar ─── */}
      {showSearch && (
        <View style={[s.searchBarWrap, { paddingTop: layoutTopInset }]}>
          <View style={s.searchBarRow}>
            <View style={s.searchInputWrap}>
              <SearchIcon size={16} color={colors.mutedForeground} />
              <TextInput
                style={s.searchInput}
                placeholder={t("reader.searchInBook", "在书中搜索")}
                placeholderTextColor={colors.mutedForeground}
                value={search.searchQuery}
                onChangeText={search.handleSearchInput}
                autoFocus
                returnKeyType="search"
              />
            </View>
            <View style={s.searchMetaRow}>
              {search.isSearching ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : search.searchQuery && search.searchResultCount > 0 ? (
                <Text style={s.searchCount}>
                  {search.searchIndex + 1} / {search.searchResultCount}
                </Text>
              ) : search.searchQuery && !search.isSearching ? (
                <Text style={s.searchCount}>0</Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={s.searchNavBtn}
              onPress={() => search.navigateSearch("prev")}
              disabled={search.searchResultCount === 0}
            >
              <ChevronLeftIcon
                size={16}
                color={search.searchResultCount > 0 ? colors.foreground : colors.mutedForeground}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.searchNavBtn}
              onPress={() => search.navigateSearch("next")}
              disabled={search.searchResultCount === 0}
            >
              <ChevronRightIcon
                size={16}
                color={search.searchResultCount > 0 ? colors.foreground : colors.mutedForeground}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.searchNavBtn}
              onPress={() => {
                if (search.searchStartCfi && search.searchResultCount > 0) {
                  Alert.alert(
                    t("reader.searchComplete", "搜索完成"),
                    t("reader.returnToOriginal", "是否返回搜索前的位置？"),
                    [
                      {
                        text: t("common.cancel", "取消"),
                        style: "cancel",
                        onPress: () => {
                          search.setSearchStartCfi(null);
                        },
                      },
                      {
                        text: t("common.confirm", "确定"),
                        onPress: () => {
                          goToCFISafely(search.searchStartCfi!);
                          search.setSearchStartCfi(null);
                        },
                      },
                    ],
                  );
                } else {
                  search.setSearchStartCfi(null);
                }
                setShowSearch(false);
                search.clearSearch();
                setShowControls(true);
                Animated.timing(toolbarAnim, {
                  toValue: 0,
                  duration: 180,
                  easing: Easing.out(Easing.cubic),
                  useNativeDriver: true,
                }).start();
              }}
            >
              <XIcon size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ─── TOC & Bookmarks Panel ─── */}
      <ReaderTOCPanel
        visible={showTOC}
        activeTab={tocActiveTab}
        toc={toc}
        bookmarks={bookBookmarks}
        currentChapter={currentChapter}
        onClose={() => setShowTOC(false)}
        onTabChange={setTocActiveTab}
        onSelectTocItem={goToTocItem}
        onGoToBookmark={(cfi) => {
          goToCFISafely(cfi);
          setShowTOC(false);
        }}
        onDeleteBookmark={(id) => removeBookmark(id)}
      />

      {/* ─── Settings Panel ─── */}
      <ReaderSettingsPanel
        visible={showSettings}
        readSettings={readSettings}
        onClose={() => setShowSettings(false)}
        onUpdateSetting={updateSetting}
      />

      {/* ─── Notebook Panel ─── */}
      <Modal
        visible={showNotebook}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNotebook(false)}
      >
        <Pressable style={s.modalBackdrop} onPress={() => setShowNotebook(false)} />
        <View
          style={[
            s.bottomSheet,
            { maxHeight: SCREEN_HEIGHT * 0.7, paddingBottom: insets.bottom || 16 },
          ]}
        >
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{t("reader.notebook", "笔记本")}</Text>
            <TouchableOpacity onPress={() => setShowNotebook(false)}>
              <XIcon size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          {highlights.length > 0 ? (
            <ScrollView showsVerticalScrollIndicator={false} style={s.sheetScroll}>
              {highlights.map((h) => (
                <View key={h.id} style={s.highlightItem}>
                  <View
                    style={[
                      s.highlightColorDot,
                      {
                        backgroundColor:
                          h.color === "yellow"
                            ? "#facc15"
                            : h.color === "green"
                              ? "#4ade80"
                              : h.color === "blue"
                                ? "#60a5fa"
                                : h.color === "pink"
                                  ? "#ec4899"
                                  : h.color === "red"
                                    ? "#f87171"
                                    : "#a78bfa",
                      },
                    ]}
                  />
                  <View style={s.highlightContent}>
                    <Text style={s.highlightText} numberOfLines={3}>
                      {h.text}
                    </Text>
                    {h.note && <Text style={s.highlightNote}>{h.note}</Text>}
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={s.notebookPlaceholder}>
              <NotebookPenIcon size={40} color={colors.mutedForeground} />
              <Text style={s.notebookPlaceholderText}>
                {t("reader.notebookHint", "在阅读时选中文字来创建笔记和高亮")}
              </Text>
            </View>
          )}
        </View>
      </Modal>

      {/* ─── Note View Modal ─── */}
      <ReaderNoteViewModal
        highlight={noteViewHighlight}
        editing={noteViewEditing}
        editContent={noteViewContent}
        bookId={bookId}
        onClose={() => {
          setNoteViewHighlight(null);
          setNoteViewEditing(false);
        }}
        onStartEdit={() => {
          setNoteViewContent(noteViewHighlight?.note || "");
          setNoteViewEditing(true);
        }}
        onCancelEdit={() => {
          setNoteViewEditing(false);
          setNoteViewContent(noteViewHighlight?.note || "");
        }}
        onContentChange={setNoteViewContent}
        onSave={(highlight, newNote) => {
          bridge.removeAnnotation({ value: highlight.cfi });
          bridge.addAnnotation({
            value: highlight.cfi,
            type: "highlight",
            color: highlight.color,
            note: newNote,
          });
          setNoteViewHighlight({ ...highlight, note: newNote });
          setNoteViewEditing(false);
        }}
      />

      {/* ─── Translation Panel ─── */}
      {showTranslation && translationText && (
        <TranslationPanel
          text={translationText}
          onClose={() => {
            setShowTranslation(false);
            setTranslationText("");
          }}
        />
      )}

      {/* ─── Chapter Translation Sheet ─── */}
      <ChapterTranslationSheet
        visible={showChapterTranslation}
        onClose={() => setShowChapterTranslation(false)}
        state={chapterTranslation.state}
        onStart={chapterTranslation.startTranslation}
        onCancel={chapterTranslation.cancelTranslation}
        onToggleOriginalVisible={chapterTranslation.toggleOriginalVisible}
        onToggleTranslationVisible={chapterTranslation.toggleTranslationVisible}
        onReset={chapterTranslation.reset}
      />

      <TTSPage
        visible={showTTS}
        bookTitle={bookTitle || book?.meta.title || ""}
        chapterTitle={currentChapter}
        coverUri={tts.ttsCoverUri}
        playState={ttsPlayState}
        currentText={tts.currentTTSSegment?.text || tts.ttsLastText}
        config={ttsConfig}
        readingProgress={progress}
        currentPage={currentPage}
        totalPages={totalPages}
        sourceLabel={tts.ttsSourceLabel}
        continuousEnabled={tts.ttsContinuousEnabled}
        narrationSegments={tts.ttsDisplaySegments}
        prevNarrationSegments={tts.ttsPrevPageSegments}
        currentSegmentCfi={tts.resolvedTTSSegmentCfi}
        currentSegmentText={tts.currentTTSSegment?.text || null}
        currentChunkIndex={tts.localTTSChunkIndex}
        totalChunks={tts.ttsDisplaySegments.length}
        onClose={() => setShowTTS(false)}
        onReturnToReading={tts.handleTTSReturnToReading}
        onReplay={tts.handleTTSReplay}
        onPlayPause={tts.handleTTSPlayPause}
        onJumpToSegment={tts.handleJumpToTTSSegment}
        onJumpToLyricSegment={tts.handleJumpToTTSLyricSegment}
        onLoadMoreAbove={tts.handleLoadMoreAboveTTSLyrics}
        onLoadMoreBelow={tts.handleLoadMoreBelowTTSLyrics}
        onStop={tts.handleTTSStop}
        onAdjustRate={tts.handleAdjustTTSRate}
        onAdjustPitch={tts.handleAdjustTTSPitch}
        onToggleContinuous={tts.handleToggleTTSContinuous}
        onUpdateConfig={tts.handleUpdateTTSConfig}
        onPrevChapter={toc.length > 0 ? tts.handleTTSPrevChapter : undefined}
        onNextChapter={toc.length > 0 ? tts.handleTTSNextChapter : undefined}
      />
    </View>
  );
}
