import type { VisibleTTSSegment } from "@/hooks/use-reader-bridge";
import { useTTSStore } from "@/stores";
import { getPlatformService } from "@readany/core/services";
import {
  TTSReadingSession,
  mergeTTSConfigUpdates,
  mergeTTSLyricContext,
  mergeTTSLyrics,
  normalizeTTSConfig,
  splitNarrationText,
} from "@readany/core/tts";
import type { TTSConfig } from "@readany/core/tts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type TTSSegment = VisibleTTSSegment;
const TTS_READER_HIGHLIGHT_COLOR = "rgba(96, 165, 250, 0.35)";

export type TTSBridgeRef = {
  getVisibleText: () => Promise<string>;
  getVisibleTTSSegments: (alignCfi?: string | null) => Promise<TTSSegment[]>;
  getChapterParagraphs: () => Promise<Array<{ id: string; text: string; tagName: string }>>;
  getTTSSegmentContext: (
    cfi: string,
    before?: number,
    after?: number,
  ) => Promise<{ before: TTSSegment[]; after: TTSSegment[] }>;
  goToSection?: (sectionIndex: number) => void;
  goToCFI: (cfi: string) => void;
  setTTSHighlight: (cfi: string | null, color?: string) => void;
  flashHighlight: (cfi: string, color?: string, duration?: number) => void;
};

export interface UseReaderTTSOptions {
  bookId: string;
  bookTitle: string;
  currentChapter: string;
  currentSectionIndex: number;
  currentCfi: string;
  webViewReady: boolean;
  showTTS: boolean;
  setShowTTS: (v: boolean) => void;
  setShowControls: (v: boolean) => void;
  bridgeRef: React.RefObject<TTSBridgeRef | null>;
  toc: Array<{ title: string; href?: string }>;
  bookCoverUrl?: string;
  colors: { primary: string };
  goToHref: (href: string) => void;
}

export interface UseReaderTTSResult {
  ttsCoverUri: string | undefined;
  ttsLastText: string;
  ttsSegments: TTSSegment[];
  ttsPrevPageSegments: TTSSegment[];
  ttsFutureSegments: TTSSegment[];
  lyricSegments: TTSSegment[];
  ttsChunkOffset: number;
  ttsSourceKind: "page" | "selection";
  ttsContinuousEnabled: boolean;
  ttsSourceLabel: string;
  allLyricSegments: TTSSegment[];
  ttsDisplaySegments: TTSSegment[];
  currentTTSSegment: TTSSegment | null;
  resolvedTTSSegmentCfi: string | null;
  ttsHighlightColor: string;
  localTTSChunkIndex: number;
  handleToggleTTS: () => Promise<void>;
  handleTTSReplay: () => Promise<void>;
  handleTTSPlayPause: () => Promise<void>;
  handleAdjustTTSRate: (delta: number) => void;
  handleAdjustTTSPitch: (delta: number) => void;
  handleUpdateTTSConfig: (u: Partial<TTSConfig>) => void;
  handleToggleTTSContinuous: () => void;
  handleJumpToTTSSegment: (offset: number) => void;
  handleJumpToTTSLyricSegment: (s: { text: string; cfi?: string | null }, offset: number) => void;
  handleLoadMoreAboveTTSLyrics: () => Promise<void>;
  handleLoadMoreBelowTTSLyrics: () => Promise<void>;
  handleTTSPrevChapter: () => void;
  handleTTSNextChapter: () => void;
  startTTSFromSelection: (selectionCfi: string) => Promise<void>;
  handleTTSStop: () => void;
  handleTTSReturnToReading: () => void;
  pendingTTSContinueCallbackRef: React.RefObject<(() => void) | null>;
  pendingTTSContinueSectionRef: React.RefObject<number | null>;
  pendingTTSContinueSafetyTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
}

const normalize = (s: TTSSegment): TTSSegment => ({
  text: s.text.replace(/\s+/g, " ").trim(),
  cfi: s.cfi || "",
});
const getSegmentKey = (segment: TTSSegment) =>
  segment.cfi ? `${segment.cfi}::${segment.text}` : segment.text;
const dedupe = (items: TTSSegment[]) => {
  const seen = new Set<string>();
  return items.map(normalize).filter((s) => {
    if (!s.text) return false;
    const key = getSegmentKey(s);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export function useReaderTTS({
  bookId,
  bookTitle,
  currentChapter,
  currentSectionIndex,
  currentCfi,
  webViewReady,
  showTTS,
  setShowTTS,
  bridgeRef,
  toc,
  bookCoverUrl,
  colors,
  goToHref,
}: UseReaderTTSOptions): UseReaderTTSResult {
  const play = useTTSStore((s) => s.play),
    preload = useTTSStore((s) => s.preload),
    pause = useTTSStore((s) => s.pause),
    resume = useTTSStore((s) => s.resume),
    stop = useTTSStore((s) => s.stop);
  const playState = useTTSStore((s) => s.playState),
    currentText = useTTSStore((s) => s.currentText);
  const config = useTTSStore((s) => s.config),
    updateConfig = useTTSStore((s) => s.updateConfig),
    setOnEnd = useTTSStore((s) => s.setOnEnd);
  const setCurrentBook = useTTSStore((s) => s.setCurrentBook),
    setCurrentLocation = useTTSStore((s) => s.setCurrentLocation),
    currentLocationCfi = useTTSStore((s) => s.currentLocationCfi);
  const currentBookId = useTTSStore((s) => s.currentBookId),
    currentChunkIndex = useTTSStore((s) => s.currentChunkIndex),
    jumpToChunk = useTTSStore((s) => s.jumpToChunk);
  const [ttsCoverUri, setTtsCoverUri] = useState<string>(),
    [ttsLastText, setTtsLastText] = useState("");
  const [ttsSegments, setTtsSegments] = useState<TTSSegment[]>([]),
    [ttsPrevPageSegments, setTtsPrevPageSegments] = useState<TTSSegment[]>([]),
    [ttsFutureSegments, setTtsFutureSegments] = useState<TTSSegment[]>([]),
    [ttsLyricSegments, setTtsLyricSegments] = useState<TTSSegment[]>([]);
  const [ttsSourceKind, setTtsSourceKind] = useState<"page" | "selection">("page"),
    [ttsContinuousEnabled, setTtsContinuousEnabled] = useState(true);
  const readingSessionRef = useRef(new TTSReadingSession());
  const segmentsRef = useRef<TTSSegment[]>([]),
    lyricSegmentsRef = useRef<TTSSegment[]>([]),
    sourceRef = useRef<"page" | "selection">("page"),
    continuousRef = useRef(true);
  const pendingTTSContinueCallbackRef = useRef<(() => void) | null>(null),
    pendingTTSContinueSectionRef = useRef<number | null>(null),
    pendingTTSContinueSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0),
    handlePageEndRef = useRef<() => void>(() => undefined);

  const clearPending = useCallback(() => {
    pendingTTSContinueCallbackRef.current = null;
    pendingTTSContinueSectionRef.current = null;
    if (pendingTTSContinueSafetyTimerRef.current)
      clearTimeout(pendingTTSContinueSafetyTimerRef.current);
    pendingTTSContinueSafetyTimerRef.current = null;
  }, []);
  const resetLyrics = useCallback(() => {
    lyricSegmentsRef.current = [];
    setTtsLyricSegments([]);
  }, []);
  useEffect(() => {
    resetLyrics();
  }, [bookId, resetLyrics]);
  const commit = useCallback(
    (current: TTSSegment[], previous: TTSSegment[] = [], future: TTSSegment[] = []) => {
      const next = dedupe(current);
      const session = readingSessionRef.current;
      session.start(
        sourceRef.current,
        next.map((segment) => ({ text: segment.text, cfi: segment.cfi || null })),
        continuousRef.current,
      );
      session.setContext(
        previous.map((segment) => ({ text: segment.text, cfi: segment.cfi || null })),
        future.map((segment) => ({ text: segment.text, cfi: segment.cfi || null })),
      );
      setTtsSegments(next);
      setTtsPrevPageSegments(dedupe(previous));
      setTtsFutureSegments(dedupe(future));
      const lyricSegments = mergeTTSLyricContext(
        lyricSegmentsRef.current,
        previous,
        next,
        future,
      ) as TTSSegment[];
      lyricSegmentsRef.current = lyricSegments;
      setTtsLyricSegments(lyricSegments);
      segmentsRef.current = next;
    },
    [],
  );
  const loadContext = useCallback(
    async (cfi: string | null, before = 12, after = 12) => {
      if (!cfi || !bridgeRef.current?.getTTSSegmentContext) return { before: [], after: [] };
      try {
        const result = await bridgeRef.current.getTTSSegmentContext(cfi, before, after);
        return { before: dedupe(result.before || []), after: dedupe(result.after || []) };
      } catch {
        return { before: [], after: [] };
      }
    },
    [bridgeRef],
  );

  const preloadFollowingSegments = useCallback(
    (current: TTSSegment[], future: TTSSegment[]) => {
      if (!continuousRef.current) return;
      const currentKeys = new Set(current.map(getSegmentKey));
      const following = dedupe(future).filter(
        (segment) => !currentKeys.has(getSegmentKey(segment)),
      );
      if (following.length) preload(following.map((segment) => segment.text));
    },
    [preload],
  );

  const startPageFromCfi = useCallback(
    async (cfi?: string | null, options: { revealPlayer?: boolean } = {}) => {
      if (!webViewReady || !bridgeRef.current) return;
      clearPending();
      const generation = ++generationRef.current;
      const segments = dedupe(await bridgeRef.current.getVisibleTTSSegments(cfi || null));
      if (!segments.length || generation !== generationRef.current) return;
      const context = await loadContext(segments[0]?.cfi || cfi || null);
      if (generation !== generationRef.current) return;
      sourceRef.current = "page";
      commit(segments, context.before, context.after);
      setTtsSourceKind("page");
      const text = segments
        .map((s) => s.text)
        .join(" ")
        .trim();
      setTtsLastText(text);
      setCurrentBook(bookTitle, currentChapter, bookId);
      setCurrentLocation(segments[0]?.cfi || cfi || currentCfi);
      setOnEnd(continuousRef.current ? handlePageEndRef.current : null);
      play(segments.map((s) => s.text));
      preloadFollowingSegments(segments, context.after);
      if (options.revealPlayer) setShowTTS(true);
    },
    [
      bookId,
      bookTitle,
      bridgeRef,
      clearPending,
      commit,
      currentChapter,
      currentCfi,
      loadContext,
      play,
      preloadFollowingSegments,
      setCurrentBook,
      setCurrentLocation,
      setOnEnd,
      setShowTTS,
      webViewReady,
    ],
  );
  const startTTSFromSelection = useCallback(
    async (selectionCfi: string) => {
      if (!selectionCfi) return;
      resetLyrics();
      continuousRef.current = ttsContinuousEnabled;
      await startPageFromCfi(selectionCfi, { revealPlayer: true });
    },
    [resetLyrics, startPageFromCfi, ttsContinuousEnabled],
  );
  const handlePageEnd = useCallback(async () => {
    if (!continuousRef.current || sourceRef.current !== "page") return;
    const last = segmentsRef.current.at(-1)?.cfi || currentCfi;
    const context = await loadContext(last || null, 0, 1);
    const next = context.after[0];
    if (next?.cfi && bridgeRef.current) {
      const generation = ++generationRef.current;
      clearPending();
      pendingTTSContinueCallbackRef.current = () => {
        if (generation === generationRef.current) void startPageFromCfi(next.cfi);
      };
      pendingTTSContinueSectionRef.current = null;
      bridgeRef.current.goToCFI(next.cfi);
      pendingTTSContinueSafetyTimerRef.current = setTimeout(() => {
        const cb = pendingTTSContinueCallbackRef.current;
        if (pendingTTSContinueSectionRef.current !== null) {
          console.warn("[ReaderTTS] section continuation timed out; waiting for target relocate", {
            targetSection: pendingTTSContinueSectionRef.current,
          });
          const targetSection = pendingTTSContinueSectionRef.current;
          setTimeout(() => {
            if (pendingTTSContinueSectionRef.current === targetSection) clearPending();
          }, 10000);
          return;
        }
        clearPending();
        cb?.();
      }, 1500);
      return;
    }
    const section = currentSectionIndex + 1;
    if (bridgeRef.current?.goToSection && section < toc.length) {
      const generation = ++generationRef.current;
      clearPending();
      pendingTTSContinueCallbackRef.current = () => {
        if (generation === generationRef.current) void startPageFromCfi(null);
      };
      pendingTTSContinueSectionRef.current = section;
      bridgeRef.current.goToSection(section);
      return;
    }
    stop();
  }, [
    bridgeRef,
    clearPending,
    currentCfi,
    currentSectionIndex,
    loadContext,
    startPageFromCfi,
    stop,
    toc.length,
  ]);
  handlePageEndRef.current = handlePageEnd;

  useEffect(() => {
    if (!bookCoverUrl) return setTtsCoverUri(undefined);
    if (/^(https?|blob|file):/u.test(bookCoverUrl)) return setTtsCoverUri(bookCoverUrl);
    let cancelled = false;
    void (async () => {
      try {
        const p = getPlatformService();
        const path = await p.joinPath(await p.getAppDataDir(), bookCoverUrl);
        if (!cancelled) setTtsCoverUri(path);
      } catch {
        if (!cancelled) setTtsCoverUri(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookCoverUrl]);
  useEffect(
    () => () => {
      clearPending();
      if (useTTSStore.getState().currentBookId !== bookId) return;
      setOnEnd(null);
      stop();
    },
    [bookId, clearPending, setOnEnd, stop],
  );
  useEffect(() => {
    const ownsActivePageSession =
      currentBookId === bookId &&
      ttsSourceKind === "page" &&
      (playState === "playing" || playState === "paused" || playState === "loading");
    if (!ownsActivePageSession) {
      bridgeRef.current?.setTTSHighlight(null);
      return;
    }
    const cfi = ttsSegments[currentChunkIndex]?.cfi || currentLocationCfi;
    if (cfi) {
      bridgeRef.current?.setTTSHighlight(cfi, TTS_READER_HIGHLIGHT_COLOR);
      setCurrentLocation(cfi);
    }
  }, [
    bookId,
    bridgeRef,
    currentBookId,
    currentChunkIndex,
    currentLocationCfi,
    playState,
    setCurrentLocation,
    ttsSourceKind,
    ttsSegments,
  ]);

  const startSelectionTTS = useCallback(
    (text: string, cfi?: string | null) => {
      const segments = splitNarrationText(text).map((value) => ({ text: value, cfi: cfi || "" }));
      clearPending();
      generationRef.current += 1;
      continuousRef.current = false;
      sourceRef.current = "selection";
      resetLyrics();
      setTtsSourceKind("selection");
      setOnEnd(null);
      commit(segments);
      setTtsLastText(text.trim());
      setCurrentBook(bookTitle, currentChapter, bookId);
      setCurrentLocation(cfi || currentCfi);
      play(segments.map((s) => s.text));
      setShowTTS(true);
    },
    [
      bookId,
      bookTitle,
      clearPending,
      commit,
      currentChapter,
      currentCfi,
      play,
      setCurrentBook,
      setCurrentLocation,
      setOnEnd,
      resetLyrics,
      setShowTTS,
    ],
  );
  const startPage = useCallback(async () => {
    clearPending();
    const generation = ++generationRef.current;
    continuousRef.current = ttsContinuousEnabled;
    const segments = dedupe((await bridgeRef.current?.getVisibleTTSSegments(null)) || []);
    if (!segments.length || generation !== generationRef.current) return;
    const context = await loadContext(segments[0]?.cfi || currentCfi || null);
    if (generation !== generationRef.current) return;
    sourceRef.current = "page";
    resetLyrics();
    setTtsSourceKind("page");
    commit(segments, context.before, context.after);
    setTtsLastText(segments.map((s) => s.text).join(" "));
    setCurrentBook(bookTitle, currentChapter, bookId);
    setCurrentLocation(segments[0]?.cfi || currentCfi);
    setOnEnd(ttsContinuousEnabled ? handlePageEndRef.current : null);
    play(segments.map((s) => s.text));
    preloadFollowingSegments(segments, context.after);
    setShowTTS(true);
  }, [
    bookId,
    bookTitle,
    bridgeRef,
    clearPending,
    commit,
    currentChapter,
    currentCfi,
    loadContext,
    play,
    preloadFollowingSegments,
    setCurrentBook,
    setCurrentLocation,
    setOnEnd,
    resetLyrics,
    setShowTTS,
    ttsContinuousEnabled,
  ]);
  const handleToggleTTS = useCallback(async () => {
    if (showTTS) return setShowTTS(false);
    if (currentBookId === bookId && playState !== "stopped" && sourceRef.current === "page")
      return setShowTTS(true);
    await startPage();
  }, [bookId, currentBookId, playState, setShowTTS, showTTS, startPage]);
  const handleTTSReplay = useCallback(
    async () =>
      sourceRef.current === "selection"
        ? startSelectionTTS(currentText || ttsLastText, currentLocationCfi)
        : startPage(),
    [currentLocationCfi, currentText, startPage, startSelectionTTS, ttsLastText],
  );
  const handleTTSPlayPause = useCallback(async () => {
    if (playState === "playing" || playState === "loading") pause();
    else if (playState === "paused") resume();
    else if (sourceRef.current === "selection")
      startSelectionTTS(currentText || ttsLastText, currentLocationCfi);
    else await startPage();
  }, [
    currentLocationCfi,
    currentText,
    pause,
    playState,
    resume,
    startPage,
    startSelectionTTS,
    ttsLastText,
  ]);
  const handleAdjustTTSRate = useCallback(
    (delta: number) =>
      updateConfig({
        rate: Math.max(
          0.5,
          Math.min(2, Number((normalizeTTSConfig(config).rate + delta).toFixed(2))),
        ),
      }),
    [config, updateConfig],
  );
  const handleAdjustTTSPitch = useCallback(
    (delta: number) =>
      updateConfig({
        pitch: Math.max(
          0.5,
          Math.min(2, Number((normalizeTTSConfig(config).pitch + delta).toFixed(2))),
        ),
      }),
    [config, updateConfig],
  );
  const handleUpdateTTSConfig = useCallback(
    (updates: Partial<TTSConfig>) =>
      updateConfig(mergeTTSConfigUpdates(normalizeTTSConfig(config), updates)),
    [config, updateConfig],
  );
  const handleToggleTTSContinuous = useCallback(() => {
    const next = !continuousRef.current;
    continuousRef.current = next;
    setTtsContinuousEnabled(next);
    setOnEnd(next && sourceRef.current === "page" ? handlePageEndRef.current : null);
  }, [setOnEnd]);
  const handleJumpToTTSSegment = useCallback(
    (offset: number) => {
      clearPending();
      generationRef.current += 1;
      // TTSPage sends the active queue index (lyric index minus the previous
      // context count), not a delta from the currently spoken chunk.
      const index = offset;
      if (index >= 0 && index < ttsSegments.length) {
        jumpToChunk(index);
        setCurrentLocation(ttsSegments[index]?.cfi);
        return;
      }
      const jump = readingSessionRef.current.jump(offset);
      if (jump.kind === "outside" && jump.target.cfi) {
        const snapshot = jump.snapshot;
        const next = snapshot.current as TTSSegment[];
        setTtsSegments(next);
        setTtsPrevPageSegments(snapshot.previous as TTSSegment[]);
        setTtsFutureSegments(snapshot.future as TTSSegment[]);
        segmentsRef.current = next;
        setCurrentLocation(jump.target.cfi);
        void startPageFromCfi(jump.target.cfi);
      }
    },
    [
      clearPending,
      jumpToChunk,
      setCurrentLocation,
      startPageFromCfi,
      ttsSegments,
    ],
  );
  const handleJumpToTTSLyricSegment = useCallback(
    (segment: { text: string; cfi?: string | null }, offset: number) => {
      clearPending();
      generationRef.current += 1;
      if (segment.cfi) {
        const queueIndex = ttsSegments.findIndex((item) => item.cfi === segment.cfi);
        if (queueIndex >= 0) jumpToChunk(queueIndex);
        else void startPageFromCfi(segment.cfi);
        return;
      }
      if (offset >= 0 && offset < ttsSegments.length) jumpToChunk(offset);
    },
    [clearPending, jumpToChunk, startPageFromCfi, ttsSegments],
  );
  const handleLoadMoreAboveTTSLyrics = useCallback(async () => {
    const anchor = ttsPrevPageSegments[0]?.cfi || ttsSegments[0]?.cfi;
    if (!anchor) return;
    const context = await loadContext(anchor, 24, 0);
    const previous = dedupe([...context.before, ...ttsPrevPageSegments]);
    const lyrics = mergeTTSLyrics(lyricSegmentsRef.current, context.before, "above") as TTSSegment[];
    lyricSegmentsRef.current = lyrics;
    setTtsLyricSegments(lyrics);
    readingSessionRef.current.setContext(
      previous.map((segment) => ({ text: segment.text, cfi: segment.cfi || null })),
      ttsFutureSegments.map((segment) => ({ text: segment.text, cfi: segment.cfi || null })),
    );
    setTtsPrevPageSegments(previous);
  }, [loadContext, ttsFutureSegments, ttsPrevPageSegments, ttsSegments]);
  const handleLoadMoreBelowTTSLyrics = useCallback(async () => {
    const anchor = ttsFutureSegments.at(-1)?.cfi || ttsSegments.at(-1)?.cfi;
    if (!anchor) return;
    const context = await loadContext(anchor, 0, 24);
    const future = dedupe([...ttsFutureSegments, ...context.after]);
    const lyrics = mergeTTSLyrics(lyricSegmentsRef.current, context.after, "below") as TTSSegment[];
    lyricSegmentsRef.current = lyrics;
    setTtsLyricSegments(lyrics);
    readingSessionRef.current.setContext(
      ttsPrevPageSegments.map((segment) => ({ text: segment.text, cfi: segment.cfi || null })),
      future.map((segment) => ({ text: segment.text, cfi: segment.cfi || null })),
    );
    setTtsFutureSegments(future);
  }, [loadContext, ttsFutureSegments, ttsPrevPageSegments, ttsSegments]);
  const queueChapterTransition = useCallback(
    (index: number) => {
      if (index < 0 || index >= toc.length) return;
      const navigate = () => {
        if (bridgeRef.current?.goToSection) bridgeRef.current.goToSection(index);
        else if (toc[index]?.href) goToHref(toc[index].href);
      };
      if (sourceRef.current !== "page" || playState === "stopped") {
        navigate();
        return;
      }

      clearPending();
      const generation = ++generationRef.current;
      pendingTTSContinueCallbackRef.current = () => {
        if (generation !== generationRef.current) return;
        void startPageFromCfi(null);
      };
      pendingTTSContinueSectionRef.current = index;
      pendingTTSContinueSafetyTimerRef.current = setTimeout(() => {
        const callback = pendingTTSContinueCallbackRef.current;
        if (pendingTTSContinueSectionRef.current !== null) {
          console.warn("[ReaderTTS] manual section continuation timed out; waiting for target relocate", {
            targetSection: pendingTTSContinueSectionRef.current,
          });
          const targetSection = pendingTTSContinueSectionRef.current;
          setTimeout(() => {
            if (pendingTTSContinueSectionRef.current === targetSection) clearPending();
          }, 10000);
          return;
        }
        clearPending();
        callback?.();
      }, 1500);
      stop();
      navigate();
    },
    [bridgeRef, clearPending, goToHref, playState, startPageFromCfi, stop, toc],
  );
  const handleTTSPrevChapter = useCallback(
    () => queueChapterTransition(Math.max(0, currentSectionIndex - 1)),
    [currentSectionIndex, queueChapterTransition],
  );
  const handleTTSNextChapter = useCallback(
    () => queueChapterTransition(currentSectionIndex + 1),
    [currentSectionIndex, queueChapterTransition],
  );
  const handleTTSStop = useCallback(() => {
    clearPending();
    continuousRef.current = false;
    setOnEnd(null);
    stop();
    setShowTTS(false);
  }, [clearPending, setOnEnd, setShowTTS, stop]);
  const handleTTSReturnToReading = useCallback(() => {
    const cfi = ttsSegments[currentChunkIndex]?.cfi || currentLocationCfi || currentCfi;
    setShowTTS(false);
    if (cfi) {
      bridgeRef.current?.goToCFI(cfi);
      bridgeRef.current?.flashHighlight(cfi, colors.primary, 1000);
    }
  }, [
    bridgeRef,
    colors.primary,
    currentCfi,
    currentChunkIndex,
    currentLocationCfi,
    setShowTTS,
    ttsSegments,
  ]);
  const ttsDisplaySegments = useMemo(
    () => [...ttsSegments, ...ttsFutureSegments],
    [ttsFutureSegments, ttsSegments],
  );
  const allLyricSegments = useMemo(
    () => ttsLyricSegments,
    [ttsLyricSegments],
  );
  const currentTTSSegment =
    currentBookId === bookId
      ? ttsSegments[currentChunkIndex] ||
        allLyricSegments.find((s) => s.cfi === currentLocationCfi) ||
        null
      : null;
  return {
    ttsCoverUri,
    ttsLastText,
    ttsSegments,
    ttsPrevPageSegments,
    ttsFutureSegments,
    lyricSegments: ttsLyricSegments,
    ttsChunkOffset: 0,
    ttsSourceKind,
    ttsContinuousEnabled,
    ttsSourceLabel: ttsSourceKind === "selection" ? "来自选中文本" : "从当前页开始",
    allLyricSegments,
    ttsDisplaySegments,
    currentTTSSegment,
    resolvedTTSSegmentCfi: currentTTSSegment?.cfi || currentLocationCfi || null,
    ttsHighlightColor: TTS_READER_HIGHLIGHT_COLOR,
    localTTSChunkIndex: currentChunkIndex,
    handleToggleTTS,
    handleTTSReplay,
    handleTTSPlayPause,
    handleAdjustTTSRate,
    handleAdjustTTSPitch,
    handleUpdateTTSConfig,
    handleToggleTTSContinuous,
    handleJumpToTTSSegment,
    handleJumpToTTSLyricSegment,
    handleLoadMoreAboveTTSLyrics,
    handleLoadMoreBelowTTSLyrics,
    handleTTSPrevChapter,
    handleTTSNextChapter,
    startTTSFromSelection,
    handleTTSStop,
    handleTTSReturnToReading,
    pendingTTSContinueCallbackRef,
    pendingTTSContinueSectionRef,
    pendingTTSContinueSafetyTimerRef,
  };
}
