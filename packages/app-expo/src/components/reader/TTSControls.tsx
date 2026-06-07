import { ChevronDownIcon, ChevronUpIcon, ClockIcon } from "@/components/ui/Icon";
import { TTSSleepTimerSheet } from "@/components/tts/TTSSleepTimerSheet";
import { useTTSStore } from "@/stores";
import { type ThemeColors, fontSize, radius, useColors, withOpacity } from "@/styles/theme";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

function PlayIcon({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}

function PauseIcon({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 4h4v16H6zM14 4h4v16h-4z" />
    </Svg>
  );
}

function SquareIcon({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 6h12v12H6z" />
    </Svg>
  );
}

function Volume2Icon({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M11 5L6 9H2v6h4l5 4V5z" />
      <Path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </Svg>
  );
}

function MinusIcon({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M5 12h14" />
    </Svg>
  );
}

function PlusIcon({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

interface TTSControlsProps {
  onClose: () => void;
  onReplay?: () => void;
}

export function TTSControls({ onClose, onReplay }: TTSControlsProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const s = makeStyles(colors);

  const playState = useTTSStore((s) => s.playState);
  const config = useTTSStore((s) => s.config);
  const pause = useTTSStore((s) => s.pause);
  const resume = useTTSStore((s) => s.resume);
  const stop = useTTSStore((s) => s.stop);
  const updateConfig = useTTSStore((s) => s.updateConfig);
  const sleepTimerEndsAt = useTTSStore((s) => s.sleepTimerEndsAt);

  const [expanded, setExpanded] = useState(false);
  const [timerSheetVisible, setTimerSheetVisible] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!sleepTimerEndsAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sleepTimerEndsAt]);

  const remainingLabel = useMemo(() => {
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

  const handleClose = useCallback(() => {
    console.log("[TTSControls] handleClose called");
    stop();
    onClose();
  }, [stop, onClose]);

  const handlePlayPress = useCallback(() => {
    console.log("[TTSControls] handlePlayPress called, playState:", playState);
    if (playState === "playing") {
      console.log("[TTSControls] pausing");
      pause();
    } else if (playState === "paused") {
      console.log("[TTSControls] resuming");
      resume();
    } else if (playState === "stopped" && onReplay) {
      console.log("[TTSControls] calling onReplay");
      onReplay();
    } else {
      console.log("[TTSControls] no action taken, onReplay:", !!onReplay);
    }
  }, [playState, pause, resume, onReplay]);

  const adjustRate = useCallback(
    (delta: number) => {
      const newRate = Math.round(Math.max(0.5, Math.min(2.0, config.rate + delta)) * 10) / 10;
      updateConfig({ rate: newRate });
    },
    [config.rate, updateConfig],
  );

  const adjustPitch = useCallback(
    (delta: number) => {
      const newPitch = Math.round(Math.max(0.5, Math.min(2.0, config.pitch + delta)) * 10) / 10;
      updateConfig({ pitch: newPitch });
    },
    [config.pitch, updateConfig],
  );

  const stateLabel =
    playState === "loading"
      ? t("tts.loading", "加载中")
      : playState === "playing"
        ? t("tts.playing", "正在朗读")
        : playState === "paused"
          ? t("tts.paused", "已暂停")
          : t("tts.stopped", "已停止");

  return (
    <View style={[s.container, { paddingBottom: insets.bottom || 16 }]} pointerEvents="box-none">
      {expanded && (
        <View style={s.expandedPanel}>
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("tts.rate", "语速")}</Text>
            <View style={s.settingControl}>
              <TouchableOpacity style={s.stepBtn} onPress={() => adjustRate(-0.1)}>
                <MinusIcon size={14} color={colors.foreground} />
              </TouchableOpacity>
              <Text style={s.settingValue}>{config.rate.toFixed(1)}x</Text>
              <TouchableOpacity style={s.stepBtn} onPress={() => adjustRate(0.1)}>
                <PlusIcon size={14} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("tts.pitch", "音调")}</Text>
            <View style={s.settingControl}>
              <TouchableOpacity style={s.stepBtn} onPress={() => adjustPitch(-0.1)}>
                <MinusIcon size={14} color={colors.foreground} />
              </TouchableOpacity>
              <Text style={s.settingValue}>{config.pitch.toFixed(1)}</Text>
              <TouchableOpacity style={s.stepBtn} onPress={() => adjustPitch(0.1)}>
                <PlusIcon size={14} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <View style={s.mainBar}>
        <View style={s.leftSection}>
          <Volume2Icon size={16} color={colors.primary} />
          <Text style={s.stateLabel}>{stateLabel}</Text>
        </View>

        <View style={s.centerSection}>
          <TouchableOpacity style={s.stepBtn} onPress={() => adjustRate(-0.1)}>
            <MinusIcon size={14} color={colors.foreground} />
          </TouchableOpacity>

          <Text style={s.rateLabel}>{config.rate.toFixed(1)}x</Text>

          <TouchableOpacity style={s.stepBtn} onPress={() => adjustRate(0.1)}>
            <PlusIcon size={14} color={colors.foreground} />
          </TouchableOpacity>

          <View style={s.divider} />

          <TouchableOpacity
            style={s.playBtn}
            onPress={handlePlayPress}
            disabled={playState === "loading"}
          >
            {playState === "loading" ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : playState === "playing" ? (
              <PauseIcon size={16} color="#fff" />
            ) : (
              <PlayIcon size={16} color="#fff" />
            )}
          </TouchableOpacity>

          <TouchableOpacity style={s.stopBtn} onPress={handleClose}>
            <SquareIcon size={14} color={colors.foreground} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.timerBtn, remainingLabel ? s.timerBtnActive : null]}
            onPress={() => setTimerSheetVisible(true)}
          >
            <ClockIcon size={14} color={remainingLabel ? colors.primary : colors.foreground} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.expandBtn} onPress={() => setExpanded(!expanded)}>
          {expanded ? (
            <ChevronDownIcon size={16} color={colors.mutedForeground} />
          ) : (
            <ChevronUpIcon size={16} color={colors.mutedForeground} />
          )}
        </TouchableOpacity>
      </View>

      {remainingLabel ? (
        <TouchableOpacity style={s.timerCountdownRow} onPress={() => setTimerSheetVisible(true)} activeOpacity={0.8}>
          <ClockIcon size={12} color={colors.primary} />
          <Text style={s.timerCountdownText}>
            {t("tts.sleepTimerRemaining", {
              time: remainingLabel,
              defaultValue: `Remaining ${remainingLabel}`,
            })}
          </Text>
        </TouchableOpacity>
      ) : null}

      <TTSSleepTimerSheet
        visible={timerSheetVisible}
        onClose={() => setTimerSheetVisible(false)}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      zIndex: 60,
    },
    expandedPanel: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    settingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    settingLabel: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    settingControl: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    settingValue: {
      fontSize: fontSize.sm,
      color: colors.foreground,
      width: 40,
      textAlign: "center",
    },
    stepBtn: {
      width: 28,
      height: 28,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    mainBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      height: 44,
    },
    leftSection: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flex: 1,
    },
    stateLabel: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    centerSection: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    rateLabel: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      width: 32,
      textAlign: "center",
    },
    divider: {
      width: 1,
      height: 14,
      backgroundColor: colors.border,
      marginHorizontal: 3,
    },
    playBtn: {
      width: 34,
      height: 34,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    stopBtn: {
      width: 28,
      height: 28,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    timerBtn: {
      width: 28,
      height: 28,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    timerBtnActive: {
      backgroundColor: withOpacity(colors.primary, 0.14),
    },
    expandBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.lg,
      justifyContent: "center",
      flex: 1,
      alignItems: "flex-end",
    },
    timerCountdownRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingHorizontal: 16,
      paddingBottom: 10,
      marginTop: -2,
    },
    timerCountdownText: {
      fontSize: 11,
      color: colors.primary,
      fontWeight: "600",
    },
  });
