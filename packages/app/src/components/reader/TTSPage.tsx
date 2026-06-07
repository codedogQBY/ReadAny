import {
  buildNarrationPreview,
  DASHSCOPE_VOICES,
  EDGE_TTS_VOICES,
  getLocaleDisplayLabel,
  getTTSVoiceLabel,
  groupEdgeTTSVoices,
  type TTSConfig,
  type TTSPlayState,
} from "@readany/core/tts";
import { getSystemVoices } from "@/lib/tts/tts-service";
import { TTSSleepTimerControl } from "@/components/tts/TTSSleepTimerControl";
import {
  DEFAULT_SYSTEM_VOICE_VALUE,
  findSystemVoiceLabel,
  getSystemVoiceOptions,
  groupSystemVoiceOptions,
  resolveSystemVoiceValue,
} from "@/lib/tts/system-voices";
import {
  ChevronLeft,
  ChevronRight,
  Headphones,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
} from "lucide-react";
import { useTTSStore } from "@/stores/tts-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface TTSLyricSegment {
  text: string;
  cfi?: string | null;
}

interface TTSPageProps {
  visible: boolean;
  bookTitle: string;
  chapterTitle: string;
  coverSrc?: string;
  playState: TTSPlayState;
  currentText: string;
  config: TTSConfig;
  readingProgress: number;
  currentPage: number;
  totalPages: number;
  sourceLabel: string;
  continuousEnabled: boolean;
  narrationSegments?: TTSLyricSegment[];
  prevNarrationSegments?: TTSLyricSegment[];
  currentChunkIndex?: number;
  totalChunks?: number;
  onClose: () => void;
  onReturnToReading?: () => void | Promise<void>;
  onReplay: () => void | Promise<void>;
  onPlayPause: () => void | Promise<void>;
  onStop: () => void;
  onAdjustRate: (delta: number) => void;
  onAdjustPitch: (delta: number) => void;
  onToggleContinuous: () => void;
  onJumpToSegment?: (offsetFromCurrent: number) => void;
  onJumpToLyricSegment?: (
    segment: { text: string; cfi?: string | null },
    offsetFromCurrent: number,
  ) => void | Promise<void>;
  onLoadMoreAbove?: () => void | Promise<void>;
  onLoadMoreBelow?: () => void | Promise<void>;
  onUpdateConfig?: (updates: Partial<TTSConfig>) => void;
  onPrevChapter?: () => void | Promise<void>;
  onNextChapter?: () => void | Promise<void>;
}

function clampProgress(progress: number) {
  return Math.max(0, Math.min(100, Math.round(progress * 100)));
}

export function TTSPage({
  visible,
  bookTitle,
  chapterTitle,
  coverSrc,
  playState,
  currentText,
  config,
  readingProgress,
  currentPage,
  totalPages,
  sourceLabel,
  continuousEnabled,
  narrationSegments,
  prevNarrationSegments,
  currentChunkIndex = 0,
  totalChunks = 0,
  onClose,
  onReturnToReading,
  onReplay,
  onPlayPause,
  onStop,
  onAdjustRate,
  onAdjustPitch,
  onToggleContinuous,
  onJumpToSegment,
  onJumpToLyricSegment,
  onLoadMoreAbove,
  onLoadMoreBelow,
  onUpdateConfig,
  onPrevChapter: _onPrevChapter,
  onNextChapter: _onNextChapter,
}: TTSPageProps) {
  const { t, i18n } = useTranslation();
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const sleepTimerEndsAt = useTTSStore((s) => s.sleepTimerEndsAt);
  const [now, setNow] = useState(Date.now());
  const voiceAnchorRef = useRef<HTMLButtonElement>(null);
  const activeLyricRef = useRef<HTMLButtonElement | null>(null);
  const pendingScrollRef = useRef(false);
  const autoScrollLyricsRef = useRef(false);

  const setActiveLyricRef = useCallback((el: HTMLButtonElement | null) => {
    activeLyricRef.current = el;
    if (el && pendingScrollRef.current) {
      pendingScrollRef.current = false;
      requestAnimationFrame(() => {
        if (!autoScrollLyricsRef.current) return;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  }, []);
  const loadMoreAboveLockRef = useRef(false);
  const loadMoreBelowLockRef = useRef(false);

  const fallbackPreview = useMemo(() => buildNarrationPreview(currentText), [currentText]);
  useEffect(() => {
    const loadVoices = () => setSystemVoices(getSystemVoices());
    loadVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices);
  }, []);

  const displayLocale = i18n.resolvedLanguage || i18n.language;
  const edgeVoiceGroups = useMemo(() => groupEdgeTTSVoices(EDGE_TTS_VOICES), []);
  const systemVoiceOptions = useMemo(() => getSystemVoiceOptions(systemVoices), [systemVoices]);
  const systemVoiceGroups = useMemo(
    () => groupSystemVoiceOptions(systemVoiceOptions),
    [systemVoiceOptions],
  );
  const selectedSystemVoiceValue = useMemo(
    () => resolveSystemVoiceValue(config.voiceName, systemVoiceOptions),
    [config.voiceName, systemVoiceOptions],
  );
  const prevCount =
    prevNarrationSegments?.filter((segment) => segment.text.trim().length > 0).length ?? 0;
  const lyricSegments = useMemo(() => {
    const keyCounts = new Map<string, number>();
    const toLyricItem = (prefix: "prev" | "curr", segment: TTSLyricSegment, index: number) => {
      const fallbackKey = segment.text.trim().slice(0, 32) || `line-${index}`;
      const baseKey = segment.cfi
        ? `${prefix}:${segment.cfi}`
        : `${prefix}:${index}:${fallbackKey}`;
      const occurrence = keyCounts.get(baseKey) ?? 0;
      keyCounts.set(baseKey, occurrence + 1);
      return {
        id: `${baseKey}:${occurrence}`,
        text: segment.text,
        cfi: segment.cfi ?? null,
      };
    };

    const previous = (prevNarrationSegments ?? [])
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment, index) => toLyricItem("prev", segment, index));
    const current = (narrationSegments ?? [])
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment, index) => toLyricItem("curr", segment, index));

    if (previous.length > 0 || current.length > 0) {
      return [...previous, ...current];
    }

    return currentText ? [{ id: "fallback:current-text", text: currentText, cfi: null }] : [];
  }, [currentText, narrationSegments, prevNarrationSegments]);
  const safeChunkIndex = lyricSegments.length
    ? Math.max(0, Math.min(prevCount + currentChunkIndex, lyricSegments.length - 1))
    : 0;
  const currentExcerpt = lyricSegments[safeChunkIndex]?.text || fallbackPreview.currentExcerpt;
  const nextExcerpt = lyricSegments[safeChunkIndex + 1]?.text || fallbackPreview.nextExcerpt;
  const supportingExcerpt =
    lyricSegments[safeChunkIndex - 1]?.text || fallbackPreview.supportingExcerpt;
  const shouldAutoScrollLyrics = visible && (playState === "playing" || playState === "loading");

  useEffect(() => {
    autoScrollLyricsRef.current = shouldAutoScrollLyrics;
    if (!shouldAutoScrollLyrics) {
      pendingScrollRef.current = false;
    }
  }, [shouldAutoScrollLyrics]);

  useEffect(() => {
    if (!shouldAutoScrollLyrics) return;
    const el = activeLyricRef.current;
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      // Element not mounted yet — flag so setActiveLyricRef scrolls when it mounts
      pendingScrollRef.current = true;
    }
  }, [safeChunkIndex, shouldAutoScrollLyrics]);

  const handleLyricPress = useCallback(
    (segment: { text: string; cfi?: string | null }, index: number) => {
      const offsetFromCurrent = index - prevCount;
      if (onJumpToLyricSegment) {
        onJumpToLyricSegment(segment, offsetFromCurrent);
        return;
      }
      onJumpToSegment?.(offsetFromCurrent);
    },
    [onJumpToLyricSegment, onJumpToSegment, prevCount],
  );

  const triggerLoadMoreAbove = useCallback(() => {
    if (!onLoadMoreAbove || loadMoreAboveLockRef.current) return;
    loadMoreAboveLockRef.current = true;
    onLoadMoreAbove();
    window.setTimeout(() => {
      loadMoreAboveLockRef.current = false;
    }, 350);
  }, [onLoadMoreAbove]);

  const triggerLoadMoreBelow = useCallback(() => {
    if (!onLoadMoreBelow || loadMoreBelowLockRef.current) return;
    loadMoreBelowLockRef.current = true;
    onLoadMoreBelow();
    window.setTimeout(() => {
      loadMoreBelowLockRef.current = false;
    }, 350);
  }, [onLoadMoreBelow]);

  // Proactive load-more: when the active segment is near the end of the list,
  // trigger below-load even if the list isn't scrollable (too few items to scroll).
  const proactiveLoadBelowFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onLoadMoreBelow) return;
    if (!lyricSegments.length) return;
    const nearEnd = safeChunkIndex >= lyricSegments.length - 2;
    if (!nearEnd) return;
    const dedupeKey = lyricSegments[lyricSegments.length - 1]?.id ?? "";
    if (proactiveLoadBelowFiredRef.current === dedupeKey) return;
    proactiveLoadBelowFiredRef.current = dedupeKey;
    triggerLoadMoreBelow();
  }, [safeChunkIndex, lyricSegments, onLoadMoreBelow, triggerLoadMoreBelow]);

  const progressPct = clampProgress(readingProgress);
  const voiceLabel = getTTSVoiceLabel(config);

  const statusLabel =
    playState === "loading"
      ? t("tts.loading")
      : playState === "playing"
        ? t("tts.playing")
        : playState === "paused"
          ? t("tts.paused")
          : t("tts.stopped");

  const isPlaying = playState === "playing";
  const isLoading = playState === "loading";

  useEffect(() => {
    if (!sleepTimerEndsAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sleepTimerEndsAt]);

  const sleepTimerLabel = useMemo(() => {
    void now;
    if (!sleepTimerEndsAt) return null;
    const remainingMs = Math.max(0, sleepTimerEndsAt - Date.now());
    if (remainingMs <= 0) return null;
    const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [now, sleepTimerEndsAt]);

  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-[65] flex bg-background">
      {/* ═══════════════════════════════════════════════════════════
          LEFT PANEL — Cover + album info (Apple Music ~45%)
      ══════════════════════════════════════════════════════════════ */}
      <div className="relative flex w-[44%] shrink-0 flex-col items-center justify-center overflow-hidden px-10 py-8">
        {/* Ambient glow behind cover */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[55%] w-[70%] rounded-full bg-primary/10 blur-3xl" />
        </div>

        {/* Cover — BookCard 28:41 style, large */}
        <div className="relative z-10 w-full max-w-[240px]">
          <div className="book-cover-shadow relative aspect-[28/41] w-full overflow-hidden rounded-lg">
            {coverSrc ? (
              <>
                <img src={coverSrc} alt={bookTitle} className="h-full w-full object-cover" />
                <div className="book-spine absolute inset-0 rounded-lg" />
              </>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-stone-100 to-stone-200 p-4">
                <div className="flex flex-1 items-center justify-center">
                  <span className="line-clamp-4 text-center font-serif text-base font-medium leading-snug text-stone-500">
                    {bookTitle || t("reader.untitled")}
                  </span>
                </div>
                <div className="h-px w-8 bg-stone-300/60" />
                {chapterTitle && (
                  <div className="flex h-1/4 items-center justify-center">
                    <span className="line-clamp-1 text-center font-serif text-xs text-stone-400">
                      {chapterTitle}
                    </span>
                  </div>
                )}
              </div>
            )}
            {/* Progress strip at bottom of cover */}
            {progressPct > 0 && progressPct < 100 && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/10">
                <div
                  className="h-full bg-primary/80 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Book title + chapter */}
        <div className="relative z-10 mt-6 w-full max-w-[240px] text-center">
          <h1 className="truncate text-lg font-bold leading-snug text-foreground">
            {bookTitle || t("reader.untitled")}
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {chapterTitle || t("tts.fromCurrentPage")}
          </p>
          {sourceLabel && (
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground/50">{sourceLabel}</p>
          )}

          {/* Engine + voice chips — click either to open picker */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            {/* Engine chip — clickable when onUpdateConfig is provided */}
            <div className="relative">
              <button
                type="button"
                onClick={() => onUpdateConfig && setVoicePickerOpen((p) => !p)}
                className={`inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors ${onUpdateConfig ? "cursor-pointer hover:bg-primary/10 hover:text-primary" : "cursor-default"}`}
              >
                {config.engine === "edge"
                  ? "Edge TTS"
                  : config.engine === "dashscope"
                    ? "DashScope"
                    : t("tts.system")}
                {onUpdateConfig && <ChevronRight className="h-2.5 w-2.5" />}
              </button>
            </div>
            {/* Voice chip — clickable when onUpdateConfig is provided */}
            <div className="relative">
              <button
                ref={voiceAnchorRef}
                type="button"
                onClick={() => onUpdateConfig && setVoicePickerOpen((p) => !p)}
                className={`inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors ${onUpdateConfig ? "cursor-pointer hover:bg-primary/10 hover:text-primary" : "cursor-default"}`}
              >
                {voiceLabel}
                {onUpdateConfig && <ChevronRight className="h-2.5 w-2.5" />}
              </button>

              {/* Engine + Voice picker dropdown */}
              {voicePickerOpen && onUpdateConfig && (
                <>
                  {/* Backdrop */}
                  <div className="fixed inset-0 z-[70]" onClick={() => setVoicePickerOpen(false)} />
                  <div className="absolute bottom-full left-1/2 z-[71] mb-2 max-h-[420px] w-64 -translate-x-1/2 overflow-y-auto rounded-xl border border-border/60 bg-background shadow-xl">
                    {/* Engine section */}
                    <div className="sticky top-0 z-10 border-b border-border/30 bg-background/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("tts.selectEngine")}
                    </div>
                    {(["edge", "dashscope", "system"] as const).map((eng) => {
                      const isActive = config.engine === eng;
                      const label =
                        eng === "edge"
                          ? "Edge TTS"
                          : eng === "dashscope"
                            ? "DashScope"
                            : t("tts.system");
                      const desc =
                        eng === "edge"
                          ? t("tts.engineDescEdge")
                          : eng === "dashscope"
                            ? t("tts.engineDescDashscope")
                            : t("tts.engineDescSystem");
                      return (
                        <button
                          key={eng}
                          type="button"
                          onClick={() => onUpdateConfig({ engine: eng })}
                          className={`flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-muted ${isActive ? "bg-primary/5" : ""}`}
                        >
                          <span className="flex flex-col">
                            <span
                              className={`text-xs font-semibold ${isActive ? "text-primary" : "text-foreground"}`}
                            >
                              {label}
                            </span>
                            <span className="text-[10px] text-muted-foreground/70">{desc}</span>
                          </span>
                          {isActive && (
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {/* Voice section */}
                    {config.engine !== "system" && (
                      <div className="sticky top-8 z-10 border-y border-border/30 bg-background/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("tts.selectVoice")}
                      </div>
                    )}
                    {config.engine === "dashscope" &&
                      DASHSCOPE_VOICES.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            onUpdateConfig({ dashscopeVoice: v.id });
                            setVoicePickerOpen(false);
                          }}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-muted ${config.dashscopeVoice === v.id ? "font-semibold text-primary" : "text-foreground"}`}
                        >
                          {v.label}
                          {config.dashscopeVoice === v.id && (
                            <span className="text-[11px] font-bold text-primary">✓</span>
                          )}
                        </button>
                      ))}
                    {config.engine === "edge" &&
                      edgeVoiceGroups.map(([lang, voices]) => (
                        <div key={lang}>
                          <div className="bg-muted/60 px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                            {getLocaleDisplayLabel(lang, displayLocale)}
                          </div>
                          {voices.map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => {
                                onUpdateConfig({ edgeVoice: v.id });
                                setVoicePickerOpen(false);
                              }}
                              className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-muted ${config.edgeVoice === v.id ? "font-semibold text-primary" : "text-foreground"}`}
                            >
                              {v.name}
                              {config.edgeVoice === v.id && (
                                <span className="text-[11px] font-bold text-primary">✓</span>
                              )}
                            </button>
                          ))}
                        </div>
                      ))}
                    {config.engine === "system" && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onUpdateConfig?.({ voiceName: "", systemVoiceLabel: "" });
                            setVoicePickerOpen(false);
                          }}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-muted ${selectedSystemVoiceValue === DEFAULT_SYSTEM_VOICE_VALUE ? "font-semibold text-primary" : "text-foreground"}`}
                        >
                          {t("tts.defaultVoice")}
                          {selectedSystemVoiceValue === DEFAULT_SYSTEM_VOICE_VALUE && (
                            <span className="text-[11px] font-bold text-primary">✓</span>
                          )}
                        </button>
                        {systemVoiceGroups.map(([lang, langVoices]) => (
                          <div key={lang}>
                            <div className="bg-muted/60 px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                              {getLocaleDisplayLabel(lang, displayLocale)}
                            </div>
                            {langVoices.map((voice) => {
                              const isSelected = selectedSystemVoiceValue === voice.id;
                              return (
                                <button
                                  key={voice.id}
                                  type="button"
                                  onClick={() => {
                                    onUpdateConfig?.({
                                      voiceName: voice.id,
                                      systemVoiceLabel: findSystemVoiceLabel(
                                        voice.id,
                                        systemVoiceOptions,
                                      ),
                                    });
                                    setVoicePickerOpen(false);
                                  }}
                                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-muted ${isSelected ? "font-semibold text-primary" : "text-foreground"}`}
                                >
                                  {voice.label}
                                  {isSelected && (
                                    <span className="text-[11px] font-bold text-primary">✓</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          RIGHT PANEL — Lyrics + controls (56%)
      ══════════════════════════════════════════════════════════════ */}
      <div className="flex min-w-0 flex-1 flex-col border-l border-border/30">
        {/* ── Top bar ── */}
        <header className="flex shrink-0 items-center justify-between px-6 py-4">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            onClick={() => {
              if (onReturnToReading) {
                onReturnToReading();
                return;
              }
              if (lyricSegments.length > 0) {
                handleLyricPress(
                  lyricSegments[safeChunkIndex] ?? { text: currentText, cfi: null },
                  safeChunkIndex,
                );
                return;
              }
              if (onJumpToSegment) {
                onJumpToSegment(safeChunkIndex - prevCount);
                return;
              }
              onClose();
            }}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t("tts.returnToReading")}
          </button>

          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Headphones className="h-3 w-3" />
            {statusLabel}
          </div>

          {/* Page progress badge */}
          <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium tabular-nums text-muted-foreground">
            {currentPage > 0 && totalPages > 0
              ? t("tts.pageProgress", { current: currentPage, total: totalPages })
              : `${progressPct}%`}
          </span>
        </header>

        {/* ── Lyrics — sentence-aligned, like mobile/readest style ── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-10 pb-2">
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={(event) => {
              const el = event.currentTarget;
              const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
              if (el.scrollTop < 180) {
                triggerLoadMoreAbove();
              }
              if (distanceFromBottom < 260) {
                triggerLoadMoreBelow();
              }
            }}
          >
            <div className="flex min-h-full flex-col justify-center py-20">
              {supportingExcerpt ? (
                <p className="mb-3 shrink-0 text-center text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/65">
                  {t("tts.justRead")}
                </p>
              ) : null}

              {lyricSegments.length > 0 ? (
                <div className="space-y-2">
                  {lyricSegments.map((segment, index) => {
                    const active = index === safeChunkIndex;
                    const past = index < safeChunkIndex;
                    return (
                      <button
                        key={segment.id}
                        ref={active ? setActiveLyricRef : undefined}
                        type="button"
                        onClick={() => handleLyricPress(segment, index)}
                        className={`block w-full rounded-xl px-4 py-2 text-center transition-colors ${
                          active
                            ? "bg-foreground/5 text-2xl font-bold leading-relaxed text-foreground"
                            : past
                              ? "text-base font-medium leading-7 text-foreground/60"
                              : "text-base font-medium leading-7 text-foreground/35"
                        }`}
                      >
                        {segment.text}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-center text-xl font-bold leading-relaxed text-foreground">
                  {currentExcerpt || t("tts.waitingText")}
                </p>
              )}

              {nextExcerpt ? (
                <p className="mt-4 shrink-0 text-center text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/65">
                  {t("tts.upNext")}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* ── Progress bar ── */}
        <div className="shrink-0 px-10 pb-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{t("tts.readingProgress", { progress: progressPct })}</span>
            <span className="tabular-nums">
              {totalChunks > 0 ? `${currentChunkIndex + 1} / ${totalChunks}` : `${progressPct}%`}
            </span>
          </div>
        </div>

        {/* ── Transport controls ── */}
        <div className="flex shrink-0 items-center justify-center gap-3 pb-5">
          {/* Prev segment */}
          <button
            type="button"
            className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background text-foreground transition-colors hover:bg-muted ${safeChunkIndex <= 0 ? "cursor-not-allowed opacity-30" : ""}`}
            onClick={() => {
              if (safeChunkIndex > 0) {
                handleLyricPress(lyricSegments[safeChunkIndex - 1], safeChunkIndex - 1);
              }
            }}
            disabled={safeChunkIndex <= 0}
            aria-label={t("tts.prevSentence")}
            title={t("tts.prevSentence")}
          >
            <SkipBack className="h-4 w-4" />
          </button>

          {/* Replay */}
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background text-foreground transition-colors hover:bg-muted"
            onClick={onReplay}
            aria-label={t("tts.restartFromHere")}
            title={t("tts.restartFromHere")}
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          {/* Play / Pause — primary */}
          <button
            type="button"
            className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-[1.04] active:scale-[0.97]"
            onClick={onPlayPause}
            aria-label={isPlaying ? t("tts.pause") : t("tts.play")}
            title={isPlaying ? t("tts.pause") : t("tts.play")}
          >
            {isLoading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
            ) : isPlaying ? (
              <Pause className="h-6 w-6 fill-current" />
            ) : (
              <Play className="ml-0.5 h-6 w-6 fill-current" />
            )}
          </button>

          {/* Stop */}
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background text-foreground transition-colors hover:bg-muted"
            onClick={onStop}
            aria-label={t("common.stop")}
            title={t("common.stop")}
          >
            <Square className="h-4 w-4 fill-current" />
          </button>

          {/* Next segment */}
          <button
            type="button"
            className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background text-foreground transition-colors hover:bg-muted ${safeChunkIndex >= lyricSegments.length - 1 ? "cursor-not-allowed opacity-30" : ""}`}
            onClick={() => {
              if (safeChunkIndex < lyricSegments.length - 1) {
                handleLyricPress(lyricSegments[safeChunkIndex + 1], safeChunkIndex + 1);
              }
            }}
            disabled={safeChunkIndex >= lyricSegments.length - 1}
            aria-label={t("tts.nextSentence")}
            title={t("tts.nextSentence")}
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        {/* ── Settings: rate + pitch + continuous ── */}
        <div className="flex shrink-0 items-center justify-center gap-0 rounded-none border-t border-border/30 bg-muted/30 px-6 py-3">
          {/* Rate */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground">{t("tts.rate")}</span>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/60 text-foreground transition-colors hover:bg-muted"
              onClick={() => onAdjustRate(-0.1)}
              aria-label={t("tts.decreaseRate")}
              title={t("tts.decreaseRate")}
            >
              <Minus className="h-2.5 w-2.5" />
            </button>
            <span className="min-w-[36px] text-center text-xs font-semibold tabular-nums text-foreground">
              {config.rate.toFixed(1)}x
            </span>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/60 text-foreground transition-colors hover:bg-muted"
              onClick={() => onAdjustRate(0.1)}
              aria-label={t("tts.increaseRate")}
              title={t("tts.increaseRate")}
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          </div>

          <div className="mx-4 h-4 w-px bg-border/50" />

          {/* Pitch */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground">{t("tts.pitch")}</span>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/60 text-foreground transition-colors hover:bg-muted"
              onClick={() => onAdjustPitch(-0.1)}
              aria-label={t("tts.decreasePitch")}
              title={t("tts.decreasePitch")}
            >
              <Minus className="h-2.5 w-2.5" />
            </button>
            <span className="min-w-[32px] text-center text-xs font-semibold tabular-nums text-foreground">
              {config.pitch.toFixed(1)}
            </span>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/60 text-foreground transition-colors hover:bg-muted"
              onClick={() => onAdjustPitch(0.1)}
              aria-label={t("tts.increasePitch")}
              title={t("tts.increasePitch")}
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          </div>

          <div className="mx-4 h-4 w-px bg-border/50" />

          {/* Continuous toggle */}
          <button
            type="button"
            onClick={onToggleContinuous}
            className={`rounded-full border px-3 py-1 text-[10px] font-semibold transition-colors ${
              continuousEnabled
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/60 bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            {continuousEnabled ? t("tts.autoContinuePage") : t("tts.keepPageAligned")}
          </button>

          <div className="mx-4 h-4 w-px bg-border/50" />

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground">
              {t("tts.sleepTimer", "定时停止")}
            </span>
            <TTSSleepTimerControl compact />
            {sleepTimerLabel ? (
              <span className="min-w-[44px] text-right text-[11px] font-semibold tabular-nums text-primary">
                {sleepTimerLabel}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
