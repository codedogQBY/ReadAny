import {
  BookOpenIcon,
  ClockIcon,
  HeadphonesIcon,
  PauseIcon,
  PlayIcon,
  ScrollTextIcon,
  SquareIcon,
} from "@/components/ui/Icon";
import { pushRoute } from "@/lib/navigationRef";
import { useReaderStore } from "@/stores/reader-store";
import { useTTSStore } from "@/stores";
import { fontSize, radius, useColors, withOpacity } from "@/styles/theme";
import { eventBus } from "@readany/core/utils/event-bus";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState } from "react";
import { TTSSleepTimerSheet } from "./TTSSleepTimerSheet";

const BUBBLE_SIZE = 56;

interface TTSMiniPlayerProps {
  visible: boolean;
  onClose: () => void;
  anchorLayout: {
    left: number;
    top: number;
    size: number;
    screenWidth: number;
    screenHeight: number;
  } | null;
}

export function TTSMiniPlayer({ visible, onClose, anchorLayout }: TTSMiniPlayerProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const playState = useTTSStore((s) => s.playState);
  const currentBookTitle = useTTSStore((s) => s.currentBookTitle);
  const currentChapterTitle = useTTSStore((s) => s.currentChapterTitle);
  const currentBookId = useTTSStore((s) => s.currentBookId);
  const currentLocationCfi = useTTSStore((s) => s.currentLocationCfi);
  const goToCfiFn = useReaderStore((s) => s.goToCfiFn);
  const config = useTTSStore((s) => s.config);
  const pause = useTTSStore((s) => s.pause);
  const resume = useTTSStore((s) => s.resume);
  const stop = useTTSStore((s) => s.stop);
  const updateConfig = useTTSStore((s) => s.updateConfig);
  const sleepTimerEndsAt = useTTSStore((s) => s.sleepTimerEndsAt);

  const handleStop = useCallback(() => {
    stop();
    onClose();
  }, [stop, onClose]);

  const handleJumpToCurrentLocation = useCallback(() => {
    let handled = false;
    if (currentBookId && currentLocationCfi) {
      eventBus.emit("tts:jump-to-current", {
        bookId: currentBookId,
        cfi: currentLocationCfi,
        respond: () => { handled = true; },
      });
    }
    if (!handled && currentLocationCfi && goToCfiFn) {
      goToCfiFn(currentLocationCfi);
      onClose();
      return;
    }
    if (!handled && currentBookId) {
      pushRoute("Reader", { bookId: currentBookId, cfi: currentLocationCfi || undefined });
    }
    onClose();
  }, [currentBookId, currentLocationCfi, goToCfiFn, onClose]);

  const handleOpenLyricsPage = useCallback(() => {
    if (!currentBookId) return;
    let handled = false;
    eventBus.emit("tts:open-lyrics-page", {
      bookId: currentBookId,
      respond: () => { handled = true; },
    });
    if (!handled) {
      pushRoute("Reader", { bookId: currentBookId, openTTS: true });
    }
    onClose();
  }, [currentBookId, onClose]);

  const handlePlayPause = useCallback(() => {
    if (playState === "playing") pause();
    else if (playState === "paused") resume();
  }, [playState, pause, resume]);

  const adjustRate = useCallback(
    (delta: number) => {
      const newRate = Math.round(Math.max(0.5, Math.min(2.0, config.rate + delta)) * 10) / 10;
      updateConfig({ rate: newRate });
    },
    [config.rate, updateConfig],
  );

  // Pulse animation for the headphones icon when playing
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (playState === "playing") {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      anim.start();
      return () => anim.stop();
    }
    pulseAnim.setValue(1);
  }, [playState, pulseAnim]);

  const statusText =
    playState === "loading" ? t("tts.loading")
    : playState === "playing" ? t("tts.playing")
    : playState === "paused" ? t("tts.paused")
    : t("tts.stopped");

  const panelWidth = Math.min(388, Math.max(320, (anchorLayout?.screenWidth || 360) - 16));
  const [panelHeight, setPanelHeight] = useState(152);
  const [panelMeasured, setPanelMeasured] = useState(false);
  const [timerSheetVisible, setTimerSheetVisible] = useState(false);
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const anchor = anchorLayout ?? {
    left: 16, top: 120, size: BUBBLE_SIZE,
    screenWidth: Dimensions.get("window").width,
    screenHeight: Dimensions.get("window").height,
  };
  const left = clamp(anchor.left + anchor.size / 2 - panelWidth / 2, 10, anchor.screenWidth - panelWidth - 10);
  const safeTop = (insets.top || 12) + 8;
  const safeBottom = anchor.screenHeight - panelHeight - Math.max(insets.bottom, 16) - 8;
  const aboveTop = anchor.top - panelHeight - 10;
  const belowTop = anchor.top + anchor.size + 10;
  const canPlaceAbove = aboveTop >= safeTop;
  const canPlaceBelow = belowTop <= safeBottom;
  const top = canPlaceAbove ? aboveTop : canPlaceBelow ? belowTop : clamp(belowTop, safeTop, safeBottom);

  const handlePanelLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height || 0);
    if (nextHeight > 0) {
      if (nextHeight !== panelHeight) setPanelHeight(nextHeight);
      if (!panelMeasured) setPanelMeasured(true);
    }
  }, [panelHeight, panelMeasured]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessible={false} />
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            left,
            top,
            width: panelWidth,
            opacity: panelMeasured || !visible ? 1 : 0,
          },
        ]}
        pointerEvents="box-none"
        onLayout={handlePanelLayout}
      >
        {/* Header row */}
        <View style={styles.header}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <HeadphonesIcon size={18} color={colors.primary} />
          </Animated.View>
          <View style={styles.titleGroup}>
            <Text style={[styles.bookText, { color: colors.foreground }]} numberOfLines={1}>
              {currentBookTitle || t("tts.listeningToBook")}
            </Text>
            {!!currentChapterTitle && (
              <Text style={[styles.chapterText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {currentChapterTitle}
              </Text>
            )}
          </View>
          <Text style={[styles.statusText, { color: colors.mutedForeground }]}>{statusText}</Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.controls}>
          <View style={styles.playbackRow}>
            <View style={[styles.rateCluster, { backgroundColor: colors.muted }]}>
              <TouchableOpacity
                style={styles.rateBtn}
                onPress={() => adjustRate(-0.1)}
                accessibilityRole="button"
                accessibilityLabel={t("tts.decreaseRate")}
              >
                <Text style={[styles.rateBtnText, { color: colors.foreground }]}>−</Text>
              </TouchableOpacity>
              <View style={styles.rateCenter}>
                <Text style={[styles.rateLabel, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {t("tts.rate")}
                </Text>
                <Text style={[styles.rateValue, { color: colors.foreground }]}>
                  {config.rate.toFixed(1)}x
                </Text>
              </View>
              <TouchableOpacity
                style={styles.rateBtn}
                onPress={() => adjustRate(0.1)}
                accessibilityRole="button"
                accessibilityLabel={t("tts.increaseRate")}
              >
                <Text style={[styles.rateBtnText, { color: colors.foreground }]}>+</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.playBtn, { backgroundColor: colors.primary }]}
              onPress={handlePlayPause}
              disabled={playState === "loading" || playState === "stopped"}
              accessibilityRole="button"
              accessibilityLabel={playState === "playing" ? t("tts.pause") : t("tts.play")}
            >
              {playState === "loading" ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : playState === "playing" ? (
                <PauseIcon size={20} color={colors.primaryForeground} />
              ) : (
                <PlayIcon size={20} color={colors.primaryForeground} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.stopBtn, { backgroundColor: colors.muted }]}
              onPress={handleStop}
              accessibilityRole="button"
              accessibilityLabel={t("tts.stop", "停止")}
            >
              <SquareIcon size={15} color={colors.foreground} />
              <Text style={[styles.stopBtnText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {t("tts.stopShort")}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.quickActions}>
            <TouchableOpacity
              style={[
                styles.quickAction,
                {
                  backgroundColor: sleepTimerEndsAt
                    ? withOpacity(colors.primary, 0.14)
                    : colors.muted,
                },
              ]}
              onPress={() => setTimerSheetVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={t("tts.sleepTimer", "定时停止")}
            >
              <ClockIcon size={15} color={sleepTimerEndsAt ? colors.primary : colors.foreground} />
              <Text
                style={[
                  styles.quickActionText,
                  { color: sleepTimerEndsAt ? colors.primary : colors.mutedForeground },
                ]}
                numberOfLines={1}
              >
                {t("tts.timerShort")}
              </Text>
            </TouchableOpacity>

            {!!currentBookId && (
              <TouchableOpacity
                style={[styles.quickAction, { backgroundColor: colors.muted }]}
                onPress={handleJumpToCurrentLocation}
                accessibilityRole="button"
                accessibilityLabel={t("tts.jumpToCurrentLocation")}
              >
                <BookOpenIcon size={15} color={colors.foreground} />
                <Text style={[styles.quickActionText, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {t("tts.readerShort")}
                </Text>
              </TouchableOpacity>
            )}

            {!!currentBookId && (
              <TouchableOpacity
                style={[styles.quickAction, { backgroundColor: colors.muted }]}
                onPress={handleOpenLyricsPage}
                accessibilityRole="button"
                accessibilityLabel={t("tts.openLyricsPage", "跳到歌词页")}
              >
                <ScrollTextIcon size={15} color={colors.foreground} />
                <Text style={[styles.quickActionText, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {t("tts.lyricsShort")}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
      <TTSSleepTimerSheet visible={timerSheetVisible} onClose={() => setTimerSheetVisible(false)} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    borderRadius: radius.xl,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 20,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  titleGroup: { flex: 1, gap: 2 },
  bookText: { fontSize: fontSize.sm, fontWeight: "600" },
  chapterText: { fontSize: fontSize.xs },
  statusText: { fontSize: fontSize.xs },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  controls: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  playbackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rateCluster: {
    flex: 1,
    minWidth: 128,
    height: 44,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  rateBtn: {
    width: 34,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  rateBtnText: { fontSize: 18, fontWeight: "500", lineHeight: 20 },
  rateCenter: { minWidth: 42, alignItems: "center", gap: 1 },
  rateLabel: { fontSize: 10, lineHeight: 12 },
  rateValue: { fontSize: fontSize.xs, fontWeight: "600", textAlign: "center" },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  stopBtn: {
    width: 62,
    height: 44,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  stopBtnText: { fontSize: 11, fontWeight: "600", lineHeight: 13 },
  quickActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  quickAction: {
    flex: 1,
    minWidth: 0,
    height: 34,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 8,
  },
  quickActionText: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 13,
    textAlign: "center",
  },
});
