import {
  ChevronDownIcon,
  ClockIcon,
  HeadphonesIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SquareIcon,
} from "@/components/ui/Icon";
import { useColors, radius } from "@/styles/theme";
import {
  buildNarrationPreview,
  type TTSConfig,
  type TTSPlayState,
  getTTSVoiceLabel,
} from "@readany/core/tts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BookCoverImage } from "./tts/BookCoverImage";
import { makeStyles, SH } from "./tts/tts-page-styles";
import { VoicePickerModal } from "./tts/VoicePickerModal";
import { TTSSleepTimerSheet } from "@/components/tts/TTSSleepTimerSheet";
import { useTTSStore } from "@/stores";

// ── Local constants ───────────────────────────────────────────────────────────
const THUMB_W = 48;
const THUMB_H = Math.round(THUMB_W * (41 / 28)); // ≈ 70

// ── Props ─────────────────────────────────────────────────────────────────────

interface TTSPageProps {
  visible: boolean;
  bookTitle: string;
  chapterTitle: string;
  coverUri?: string;
  playState: TTSPlayState;
  currentText: string;
  config: TTSConfig;
  readingProgress: number;
  currentPage: number;
  totalPages: number;
  sourceLabel: string;
  continuousEnabled: boolean;
  narrationSegments?: Array<{ text: string; cfi?: string | null }>;
  /** Sentences from the previously-read page, shown above current page sentences */
  prevNarrationSegments?: Array<{ text: string; cfi?: string | null }>;
  currentSegmentCfi?: string | null;
  currentSegmentText?: string | null;
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
  /**
   * Called when user taps a lyric line.
   * `offsetFromCurrent` is 0-based within the current page segments;
   * negative values mean a sentence from the previous page.
   */
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

function clampPct(p: number) {
  return Math.max(0, Math.min(100, Math.round(p * 100)));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TTSPage({
  visible,
  bookTitle,
  chapterTitle,
  coverUri,
  playState,
  currentText,
  config,
  readingProgress,
  currentPage,
  totalPages,
  continuousEnabled,
  narrationSegments = [],
  prevNarrationSegments = [],
  currentSegmentCfi,
  currentSegmentText,
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
  onPrevChapter,
  onNextChapter,
}: TTSPageProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [voicePickerVisible, setVoicePickerVisible] = useState(false);
  const [timerSheetVisible, setTimerSheetVisible] = useState(false);
  const sleepTimerEndsAt = useTTSStore((s) => s.sleepTimerEndsAt);
  const [now, setNow] = useState(Date.now());
  const lyricScrollRef = useRef<ScrollView>(null);
  const lyricLayoutRef = useRef(new Map<string, { y: number; height: number }>());
  const lastCenteredSignatureRef = useRef<string | null>(null);
  const userScrollingRef = useRef(false);
  const userScrollUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreAboveLockRef = useRef(false);
  const loadMoreBelowLockRef = useRef(false);
  const loadMoreAboveArmedRef = useRef(true);
  const loadMoreBelowArmedRef = useRef(true);
  const autoScrollLockUntilRef = useRef(0);

  const fallbackPreview = useMemo(() => buildNarrationPreview(currentText), [currentText]);

  // Measured height of the lyricArea — used to compute paddingBottom so the
  // last sentence can always scroll to the vertical center of the list.
  const [lyricAreaHeight, setLyricAreaHeight] = useState(SH * 0.4);
  const onLyricAreaLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const nextHeight = e.nativeEvent.layout.height;
    // Ignore transient tiny heights during modal open/close animation.
    if (nextHeight < 120) return;
    setLyricAreaHeight((prev) => (Math.abs(prev - nextHeight) > 2 ? nextHeight : prev));
  }, []);

  // Number of prev-page sentences prepended to the list (only used in fallback mode)
  // Number of prev-page sentences prepended to the list
  const prevCount =
    prevNarrationSegments?.filter((segment) => segment.text.trim().length > 0).length ?? 0;
  const lyricSegments = useMemo(() => {
    const keyCounts = new Map<string, number>();
    const toLyricItem = (
      prefix: "prev" | "curr",
      segment: { text: string; cfi?: string | null },
      index: number,
    ) => {
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

    const prev = (prevNarrationSegments ?? [])
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment, index) => toLyricItem("prev", segment, index));
    const curr = (narrationSegments ?? [])
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment, index) => toLyricItem("curr", segment, index));
    if (prev.length > 0 || curr.length > 0) {
      return [...prev, ...curr];
    }
    return currentText ? [{ id: "fallback:current-text", text: currentText, cfi: null }] : [];
  }, [currentText, narrationSegments, prevNarrationSegments]);
  const lyricSegmentIdsKey = useMemo(
    () => lyricSegments.map((segment) => segment.id).join("|"),
    [lyricSegments],
  );

  // Prefer the actual spoken segment CFI so lyric centering doesn't reset when
  // the visible/current arrays are sliced or rebuilt around the current sentence.
  const safeChunkIndex = useMemo(() => {
    if (!lyricSegments.length) return 0;
    const normalizedCurrentText = currentSegmentText?.trim() || "";
    if (currentSegmentCfi || normalizedCurrentText) {
      const currentIndex = lyricSegments.findIndex((segment) => {
        if (currentSegmentCfi && segment.cfi !== currentSegmentCfi) return false;
        if (normalizedCurrentText && segment.text.trim() !== normalizedCurrentText) return false;
        return true;
      });
      if (currentIndex >= 0) {
        return currentIndex;
      }
    }
    const actualPrevCount = lyricSegments.filter((s) => s.id.startsWith("prev:")).length;
    const prevCountStale = prevCount !== actualPrevCount;
    if (prevCountStale) {
      const cfiInCurr = narrationSegments
        ? narrationSegments.findIndex((s) => {
            if (currentSegmentCfi && s.cfi !== currentSegmentCfi) return false;
            if (normalizedCurrentText && s.text.trim() !== normalizedCurrentText) return false;
            return true;
          })
        : -1;
      if (cfiInCurr >= 0) {
        return Math.min(actualPrevCount + cfiInCurr, lyricSegments.length - 1);
      }
      return Math.min(actualPrevCount, lyricSegments.length - 1);
    }
    const fallback = prevCount + currentChunkIndex;
    if (fallback < lyricSegments.length) {
      return Math.max(0, fallback);
    }
    const cfiInCurr = narrationSegments
      ? narrationSegments.findIndex((s) => {
          if (currentSegmentCfi && s.cfi !== currentSegmentCfi) return false;
          if (normalizedCurrentText && s.text.trim() !== normalizedCurrentText) return false;
          return true;
        })
      : -1;
    if (cfiInCurr >= 0) {
      return prevCount + cfiInCurr;
    }
    return Math.max(0, Math.min(prevCount, lyricSegments.length - 1));
  }, [
    currentChunkIndex,
    currentSegmentCfi,
    currentSegmentText,
    lyricSegments,
    narrationSegments,
    prevCount,
  ]);
  const lyricCenterPadding = useMemo(
    () => Math.max(40, Math.round(lyricAreaHeight / 2 - 32)),
    [lyricAreaHeight],
  );
  const currentExcerpt = lyricSegments[safeChunkIndex]?.text || fallbackPreview.currentExcerpt;
  const centerLyricIndex = useCallback(
    (index: number, animated = true) => {
      const id = lyricSegments[index]?.id;
      const layout = id ? lyricLayoutRef.current.get(id) : undefined;
      if (layout) {
        const targetOffset = Math.max(
          0,
          lyricCenterPadding + layout.y - (lyricAreaHeight - layout.height) / 2,
        );
        autoScrollLockUntilRef.current = Date.now() + (animated ? 800 : 250);
        if (__DEV__) {
          console.log("[TTSPage][lyrics] center", {
            index,
            animated,
            layoutY: layout.y,
            layoutHeight: layout.height,
            lyricAreaHeight,
            lyricCenterPadding,
            targetOffset,
          });
        }
        lyricScrollRef.current?.scrollTo({
          y: targetOffset,
          x: 0,
          animated,
        });
        return;
      }
      const estimatedOffset = Math.max(
        0,
        lyricCenterPadding + index * 44 - lyricAreaHeight / 2 + 22,
      );
      autoScrollLockUntilRef.current = Date.now() + (animated ? 800 : 250);
      if (__DEV__) {
        console.log("[TTSPage][lyrics] center-estimated", {
          index,
          animated,
          lyricAreaHeight,
          lyricCenterPadding,
          estimatedOffset,
        });
      }
      lyricScrollRef.current?.scrollTo({
        y: estimatedOffset,
        x: 0,
        animated,
      });
    },
    [lyricAreaHeight, lyricCenterPadding, lyricSegments],
  );

  const pct = clampPct(readingProgress);
  const voiceLabel = getTTSVoiceLabel(config);
  const isPlaying = playState === "playing";
  const isLoading = playState === "loading";
  const shouldAutoCenterLyrics = isPlaying || isLoading;
  const chromeTopInset =
    Platform.OS === "android" ? Math.max(insets.top, 6) : Math.max(insets.top, 10);
  const chromeBottomInset =
    Platform.OS === "android" ? Math.max(insets.bottom, 6) : Math.max(insets.bottom, 10);

  const stateLabel =
    playState === "loading"
      ? t("tts.loading")
      : playState === "playing"
        ? t("tts.playing")
        : playState === "paused"
          ? t("tts.paused")
          : t("tts.stopped");

  const pageLabel =
    currentPage > 0 && totalPages > 0
      ? t("tts.pageProgress", { current: currentPage, total: totalPages })
      : `${pct}%`;

  const engineLabel =
    config.engine === "edge"
      ? "Edge TTS"
      : config.engine === "dashscope"
        ? "DashScope"
        : t("tts.system");

  useEffect(() => {
    if (!sleepTimerEndsAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
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

  const pendingCenterRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) {
      pendingCenterRef.current = null;
      lastCenteredSignatureRef.current = null;
      userScrollingRef.current = false;
      autoScrollLockUntilRef.current = 0;
      loadMoreAboveArmedRef.current = true;
      loadMoreBelowArmedRef.current = true;
      return;
    }

    // Keep the measured lyric row layouts when the sheet is temporarily closed.
    // Re-mounting / clearing this cache was causing the mobile lyric list to
    // reflow as one collapsed block before the next layout pass completed.
    pendingCenterRef.current = null;
    lastCenteredSignatureRef.current = null;
    userScrollingRef.current = false;
    autoScrollLockUntilRef.current = 0;
    loadMoreAboveArmedRef.current = true;
    loadMoreBelowArmedRef.current = true;
  }, [visible]);

  useEffect(() => {
    // Keep layout entries that still exist in the current segment list; evict stale ones.
    const currentIds = new Set(lyricSegments.map((s) => s.id));
    for (const key of lyricLayoutRef.current.keys()) {
      if (!currentIds.has(key)) {
        lyricLayoutRef.current.delete(key);
      }
    }
    pendingCenterRef.current = null;
    loadMoreAboveArmedRef.current = true;
    loadMoreBelowArmedRef.current = true;
  }, [lyricSegmentIdsKey]);

  useEffect(() => {
    if (!visible || lyricSegments.length <= 1) return;
    if (!shouldAutoCenterLyrics) return;
    if (userScrollingRef.current) return;
    const targetIndex = Math.max(0, Math.min(safeChunkIndex, lyricSegments.length - 1));
    const centerSignature = `${targetIndex}:${currentSegmentCfi || ""}:${Math.round(lyricAreaHeight)}`;
    if (lastCenteredSignatureRef.current === centerSignature) return;
    if (__DEV__) {
      console.log("[TTSPage][lyrics] active-changed", {
        currentSegmentCfi,
        currentChunkIndex,
        safeChunkIndex: targetIndex,
        lyricSegmentsLength: lyricSegments.length,
      });
    }
    const targetId = lyricSegments[targetIndex]?.id;
    if (targetId && lyricLayoutRef.current.has(targetId)) {
      const timer = setTimeout(() => {
        if (!shouldAutoCenterLyrics) return;
        lastCenteredSignatureRef.current = centerSignature;
        centerLyricIndex(targetIndex, true);
      }, 80);
      return () => clearTimeout(timer);
    } else {
      pendingCenterRef.current = targetIndex;
    }
  }, [
    centerLyricIndex,
    currentChunkIndex,
    currentSegmentCfi,
    lyricAreaHeight,
    lyricSegments,
    safeChunkIndex,
    shouldAutoCenterLyrics,
    visible,
  ]);

  useEffect(() => {
    return () => {
      if (userScrollUnlockTimerRef.current) {
        clearTimeout(userScrollUnlockTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!__DEV__) return;
    if (!visible) return;
    if (lyricSegments.length > 1) return;
    console.log("[TTSPage][lyrics] fallback-render", {
      lyricSegmentsLength: lyricSegments.length,
      narrationSegmentsLength: narrationSegments.length,
      prevNarrationSegmentsLength: prevNarrationSegments?.length ?? 0,
      currentSegmentCfi,
      currentSegmentTextLength: (currentSegmentText || "").length,
      currentTextLength: currentText.length,
    });
  }, [
    currentSegmentCfi,
    currentSegmentText,
    currentText,
    lyricSegments.length,
    narrationSegments.length,
    prevNarrationSegments?.length,
    visible,
  ]);

  const markUserScrolling = useCallback(() => {
    userScrollingRef.current = true;
    if (userScrollUnlockTimerRef.current) {
      clearTimeout(userScrollUnlockTimerRef.current);
      userScrollUnlockTimerRef.current = null;
    }
  }, []);

  const releaseUserScrolling = useCallback(() => {
    if (userScrollUnlockTimerRef.current) {
      clearTimeout(userScrollUnlockTimerRef.current);
    }
    userScrollUnlockTimerRef.current = setTimeout(() => {
      userScrollingRef.current = false;
    }, 900);
  }, []);

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
    setTimeout(() => {
      loadMoreAboveLockRef.current = false;
    }, 350);
  }, [onLoadMoreAbove]);

  const triggerLoadMoreBelow = useCallback(() => {
    if (!onLoadMoreBelow || loadMoreBelowLockRef.current) return;
    loadMoreBelowLockRef.current = true;
    onLoadMoreBelow();
    setTimeout(() => {
      loadMoreBelowLockRef.current = false;
    }, 350);
  }, [onLoadMoreBelow]);

  // Proactive load-more: when the active segment is near the end of the list
  // (and we haven't locked), trigger below-load even if the list isn't scrollable.
  const proactiveLoadBelowFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      proactiveLoadBelowFiredRef.current = null;
      return;
    }
    if (!onLoadMoreBelow) return;
    if (lyricSegments.length <= 1) return;
    const nearEnd = safeChunkIndex >= lyricSegments.length - 2;
    if (!nearEnd) return;
    const dedupeKey = lyricSegments[lyricSegments.length - 1]?.id ?? "";
    if (proactiveLoadBelowFiredRef.current === dedupeKey) return;
    proactiveLoadBelowFiredRef.current = dedupeKey;
    if (__DEV__) {
      console.log("[TTSPage][lyrics] proactive load-more-below", {
        safeChunkIndex,
        lyricSegmentsLength: lyricSegments.length,
      });
    }
    triggerLoadMoreBelow();
  }, [lyricSegments, onLoadMoreBelow, safeChunkIndex, triggerLoadMoreBelow, visible]);

  // ── PanResponder listener removed — replaced by native ScrollView paging ──

  const s = makeStyles(colors);

  // ── Shared UI blocks ───────────────────────────────────────────────────────

  const progressBarJSX = (
    <View style={s.progress}>
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${pct}%` as unknown as number }]} />
      </View>
      <View style={s.progressRow}>
        <Text style={s.progressTxt}>{pageLabel}</Text>
        <Text style={s.progressTxt}>
          {totalChunks > 0 ? `${currentChunkIndex + 1} / ${totalChunks}` : `${pct}%`}
        </Text>
      </View>
    </View>
  );

  const controlsJSX = (
    <View style={s.controls}>
      {/* Prev segment */}
      <View style={s.controlItem}>
        <Pressable
          style={({ pressed }) => [
            s.ctrlBtnSm,
            pressed && { opacity: 0.5 },
            safeChunkIndex <= 0 && s.ctrlBtnDisabled,
          ]}
          onPress={() => {
            if (safeChunkIndex > 0) {
              handleLyricPress(lyricSegments[safeChunkIndex - 1], safeChunkIndex - 1);
            }
          }}
          hitSlop={12}
          disabled={safeChunkIndex <= 0}
          accessibilityLabel={t("tts.prevSentence")}
        >
          <SkipBackIcon
            size={18}
            color={safeChunkIndex > 0 ? colors.foreground : colors.mutedForeground}
          />
        </Pressable>
        <Text style={s.controlLabel} numberOfLines={1}>
          {t("tts.prevSentenceShort")}
        </Text>
      </View>

      <View style={s.controlItem}>
        <Pressable
          style={({ pressed }) => [s.ctrlBtn, pressed && { opacity: 0.5 }]}
          onPress={onReplay}
          hitSlop={14}
          accessibilityLabel={t("tts.restartFromHere")}
        >
          <RotateCcwIcon size={20} color={colors.foreground} />
        </Pressable>
        <Text style={s.controlLabel} numberOfLines={1}>
          {t("tts.replayShort")}
        </Text>
      </View>

      <View style={[s.controlItem, s.controlItemPrimary]}>
        <TouchableOpacity
          style={s.playBtn}
          onPress={onPlayPause}
          activeOpacity={0.85}
          accessibilityLabel={isPlaying ? t("tts.pause") : t("tts.play")}
        >
          {isLoading ? (
            <ActivityIndicator size="large" color={colors.primaryForeground} />
          ) : isPlaying ? (
            <PauseIcon size={28} color={colors.primaryForeground} />
          ) : (
            <PlayIcon size={30} color={colors.primaryForeground} />
          )}
        </TouchableOpacity>
        <Text style={[s.controlLabel, s.controlLabelPrimary]} numberOfLines={1}>
          {isPlaying ? t("tts.pauseShort") : t("tts.playShort")}
        </Text>
      </View>

      <View style={s.controlItem}>
        <Pressable
          style={({ pressed }) => [s.ctrlBtn, pressed && { opacity: 0.5 }]}
          onPress={onStop}
          hitSlop={14}
          accessibilityLabel={t("common.stop")}
        >
          <SquareIcon size={18} color={colors.foreground} />
        </Pressable>
        <Text style={s.controlLabel} numberOfLines={1}>
          {t("tts.stopShort")}
        </Text>
      </View>

      {/* Next segment */}
      <View style={s.controlItem}>
        <Pressable
          style={({ pressed }) => [
            s.ctrlBtnSm,
            pressed && { opacity: 0.5 },
            safeChunkIndex >= lyricSegments.length - 1 && s.ctrlBtnDisabled,
          ]}
          onPress={() => {
            if (safeChunkIndex < lyricSegments.length - 1) {
              handleLyricPress(lyricSegments[safeChunkIndex + 1], safeChunkIndex + 1);
            }
          }}
          hitSlop={12}
          disabled={safeChunkIndex >= lyricSegments.length - 1}
          accessibilityLabel={t("tts.nextSentence")}
        >
          <SkipForwardIcon
            size={18}
            color={
              safeChunkIndex < lyricSegments.length - 1 ? colors.foreground : colors.mutedForeground
            }
          />
        </Pressable>
        <Text style={s.controlLabel} numberOfLines={1}>
          {t("tts.nextSentenceShort")}
        </Text>
      </View>
    </View>
  );

  const settingsJSX = (
    <>
      <View style={s.settings}>
        {/* Rate stepper */}
        <View style={s.settingGroup}>
          <Text style={s.settingLbl}>{t("tts.rate")}</Text>
          <View style={s.stepper}>
            <Pressable
              style={s.stepBtn}
              onPress={() => onAdjustRate(-0.1)}
              hitSlop={12}
              accessibilityLabel={t("tts.decreaseRate")}
            >
              <MinusIcon size={10} color={colors.foreground} />
            </Pressable>
            <Text style={s.stepVal}>{config.rate.toFixed(1)}x</Text>
            <Pressable
              style={s.stepBtn}
              onPress={() => onAdjustRate(0.1)}
              hitSlop={12}
              accessibilityLabel={t("tts.increaseRate")}
            >
              <PlusIcon size={10} color={colors.foreground} />
            </Pressable>
          </View>
        </View>

        <View style={s.settingDiv} />

        {/* Pitch stepper */}
        <View style={s.settingGroup}>
          <Text style={s.settingLbl}>{t("tts.pitch")}</Text>
          <View style={s.stepper}>
            <Pressable
              style={s.stepBtn}
              onPress={() => onAdjustPitch(-0.1)}
              hitSlop={12}
              accessibilityLabel={t("tts.decreasePitch")}
            >
              <MinusIcon size={10} color={colors.foreground} />
            </Pressable>
            <Text style={s.stepVal}>{config.pitch.toFixed(1)}</Text>
            <Pressable
              style={s.stepBtn}
              onPress={() => onAdjustPitch(0.1)}
              hitSlop={12}
              accessibilityLabel={t("tts.increasePitch")}
            >
              <PlusIcon size={10} color={colors.foreground} />
            </Pressable>
          </View>
        </View>

        <View style={s.settingDiv} />

        <TouchableOpacity
          style={[s.timerQuickCluster, sleepTimerLabel ? s.timerQuickClusterActive : null]}
          onPress={() => setTimerSheetVisible(true)}
          activeOpacity={0.8}
        >
          <View style={[s.timerQuickBtn, sleepTimerLabel ? s.timerQuickBtnActive : null]}>
            <ClockIcon size={14} color={sleepTimerLabel ? colors.primary : colors.foreground} />
          </View>
          {sleepTimerLabel ? <Text style={s.timerCountdownInline}>{sleepTimerLabel}</Text> : null}
        </TouchableOpacity>
      </View>
    </>
  );

  const chipsJSX = (
    <View style={s.chips}>
      {/* Engine chip — tappable if onUpdateConfig is provided */}
      <TouchableOpacity
        style={s.chip}
        onPress={() => onUpdateConfig && setVoicePickerVisible(true)}
        activeOpacity={onUpdateConfig ? 0.7 : 1}
        disabled={!onUpdateConfig}
      >
        <Text
          style={[s.chipTxt, onUpdateConfig ? { color: colors.primary } : null]}
          numberOfLines={1}
        >
          {engineLabel}
          {onUpdateConfig ? " ›" : ""}
        </Text>
      </TouchableOpacity>
      {/* Voice chip — tappable if onUpdateConfig is provided */}
      <TouchableOpacity
        style={s.chip}
        onPress={() => onUpdateConfig && setVoicePickerVisible(true)}
        activeOpacity={onUpdateConfig ? 0.7 : 1}
        disabled={!onUpdateConfig}
      >
        <Text
          style={[s.chipTxt, onUpdateConfig ? { color: colors.primary } : null]}
          numberOfLines={1}
        >
          {voiceLabel}
          {onUpdateConfig ? " ›" : ""}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const bottomStripJSX = (
    <View style={s.bottomStrip}>
      <View style={s.bottomStripLeft}>
        <TouchableOpacity
          style={s.returnBtn}
          onPress={() => {
            if (onReturnToReading) {
              onReturnToReading();
              return;
            }
            handleLyricPress(
              lyricSegments[safeChunkIndex] ?? { text: currentText, cfi: null },
              safeChunkIndex,
            );
          }}
          activeOpacity={0.8}
        >
          <Text style={s.returnBtnTxt}>{t("tts.returnToReading")}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.contBtn, continuousEnabled && s.contBtnOn]}
          onPress={onToggleContinuous}
          activeOpacity={0.8}
        >
          <Text style={[s.contBtnTxt, continuousEnabled && s.contBtnTxtOn]}>
            {continuousEnabled ? t("tts.autoContinuePage") : t("tts.keepPageAligned")}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Engine + voice chips — right side */}
      {chipsJSX}
    </View>
  );

  // ── Top bar ────────────────────────────────────────────────────────────────

  const topBarJSX = (
    <View
      style={[
        s.topBar,
        {
          paddingTop: chromeTopInset + (Platform.OS === "android" ? 8 : 10),
          paddingBottom: Platform.OS === "android" ? 0 : 2,
        },
      ]}
    >
      <TouchableOpacity style={s.iconBtn} onPress={onClose} activeOpacity={0.7}>
        <ChevronDownIcon size={22} color={colors.mutedForeground} />
      </TouchableOpacity>
      <View style={s.statusPill}>
        <HeadphonesIcon size={10} color={colors.primary} />
        <Text style={s.statusTxt}>{stateLabel}</Text>
      </View>
      <TouchableOpacity
        style={s.iconBtn}
        onPress={() => setTimerSheetVisible(true)}
        activeOpacity={0.7}
      >
        <ClockIcon size={20} color={sleepTimerEndsAt ? colors.primary : colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent={Platform.OS === "android"}
      navigationBarTranslucent={Platform.OS === "android"}
      hardwareAccelerated={Platform.OS === "android"}
    >
      <View style={s.screen}>
        {topBarJSX}
        <View style={s.content}>
          <View style={s.lyricHeaderRow}>
            <View style={s.thumbShadowWrap}>
              <BookCoverImage
                coverUri={coverUri}
                bookTitle={bookTitle}
                chapterTitle={chapterTitle}
                width={THUMB_W}
                height={THUMB_H}
                borderRadius={radius.sm ?? 6}
                pct={pct}
                colors={colors}
                t={t}
              />
            </View>
            <View style={s.lyricHeaderMeta}>
              <Text style={s.lyricBookName} numberOfLines={2}>
                {bookTitle || t("reader.untitled")}
              </Text>
              <Text style={s.lyricChapterName} numberOfLines={1}>
                {chapterTitle || t("tts.fromCurrentPage")}
              </Text>
            </View>
          </View>

          <View style={s.lyricArea} onLayout={onLyricAreaLayout}>
            {lyricSegments.length > 0 ? (
              <ScrollView
                ref={lyricScrollRef}
                style={s.lyricList}
                contentContainerStyle={[
                  s.lyricListContent,
                  {
                    paddingTop: lyricCenterPadding,
                    paddingBottom: lyricCenterPadding,
                    minHeight: lyricAreaHeight + lyricCenterPadding * 2,
                  },
                ]}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                onScrollBeginDrag={markUserScrolling}
                onScrollEndDrag={releaseUserScrolling}
                scrollEventThrottle={16}
                onScroll={(event) => {
                  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                  const distanceFromBottom =
                    contentSize.height - (contentOffset.y + layoutMeasurement.height);
                  const canAutoLoadMore =
                    userScrollingRef.current && Date.now() > autoScrollLockUntilRef.current;
                  if (contentOffset.y > 120) {
                    loadMoreAboveArmedRef.current = true;
                  }
                  if (distanceFromBottom > 120) {
                    loadMoreBelowArmedRef.current = true;
                  }
                  if (
                    canAutoLoadMore &&
                    loadMoreAboveArmedRef.current &&
                    contentOffset.y >= 0 &&
                    contentOffset.y < 32
                  ) {
                    loadMoreAboveArmedRef.current = false;
                    if (__DEV__) {
                      console.log("[TTSPage][lyrics] load-more-above", {
                        offsetY: contentOffset.y,
                      });
                    }
                    triggerLoadMoreAbove();
                  }
                  if (canAutoLoadMore && loadMoreBelowArmedRef.current && distanceFromBottom < 32) {
                    loadMoreBelowArmedRef.current = false;
                    if (__DEV__) {
                      console.log("[TTSPage][lyrics] load-more-below", {
                        distanceFromBottom,
                      });
                    }
                    triggerLoadMoreBelow();
                  }
                }}
              >
                <View style={s.lyricInner}>
                  {lyricSegments.map((item, index) => {
                    const active = index === safeChunkIndex;
                    const past = index < safeChunkIndex;
                    return (
                      <View
                        key={item.id}
                        onLayout={(event) => {
                          const { y, height } = event.nativeEvent.layout;
                          lyricLayoutRef.current.set(item.id, { y, height });
                          if (
                            visible &&
                            shouldAutoCenterLyrics &&
                            pendingCenterRef.current === index &&
                            !userScrollingRef.current
                          ) {
                            pendingCenterRef.current = null;
                            lastCenteredSignatureRef.current = `${index}:${currentSegmentCfi || ""}:${Math.round(lyricAreaHeight)}`;
                            requestAnimationFrame(() => {
                              if (!shouldAutoCenterLyrics) return;
                              centerLyricIndex(index, true);
                            });
                          }
                        }}
                      >
                        <Pressable
                          style={[s.lyricLinePressable, active && s.lyricLinePressableActive]}
                          onPress={() => handleLyricPress(item, index)}
                        >
                          <Text
                            style={[
                              s.lyricLine,
                              active && s.lyricLineActive,
                              past && s.lyricLinePast,
                            ]}
                          >
                            {item.text}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}

                  {continuousEnabled &&
                  playState === "playing" &&
                  safeChunkIndex >= lyricSegments.length - 1 ? (
                    <View style={s.lyricLoadingFooter}>
                      <ActivityIndicator size="small" color={colors.mutedForeground} />
                    </View>
                  ) : null}
                </View>
              </ScrollView>
            ) : (
              <Text style={s.lyricActive}>{currentExcerpt || t("tts.waitingText")}</Text>
            )}
          </View>

          {progressBarJSX}
          {controlsJSX}
          {settingsJSX}

          <View style={[s.bottom, { paddingBottom: chromeBottomInset + 10 }]}>
            {bottomStripJSX}
          </View>
        </View>
      </View>

      {onUpdateConfig && (
        <VoicePickerModal
          visible={voicePickerVisible}
          config={config}
          onClose={() => setVoicePickerVisible(false)}
          onUpdateConfig={onUpdateConfig}
        />
      )}
      <TTSSleepTimerSheet visible={timerSheetVisible} onClose={() => setTimerSheetVisible(false)} />
    </Modal>
  );
}
