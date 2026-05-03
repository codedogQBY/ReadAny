import { ClockIcon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useTTSStore } from "@/stores";
import { fontSize, fontWeight, radius, useColors, withOpacity } from "@/styles/theme";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PRESET_MINUTES = [15, 30, 45, 60] as const;

function formatRemainingLabel(endsAt: number | null): string | null {
  if (!endsAt) return null;
  const remainingMs = Math.max(0, endsAt - Date.now());
  if (remainingMs <= 0) return null;
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

interface TTSSleepTimerSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function TTSSleepTimerSheet({ visible, onClose }: TTSSleepTimerSheetProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const sleepTimerEndsAt = useTTSStore((s) => s.sleepTimerEndsAt);
  const sleepTimerDurationMinutes = useTTSStore((s) => s.sleepTimerDurationMinutes);
  const setSleepTimer = useTTSStore((s) => s.setSleepTimer);
  const clearSleepTimer = useTTSStore((s) => s.clearSleepTimer);
  const [customMinutes, setCustomMinutes] = useState(
    sleepTimerDurationMinutes ? String(sleepTimerDurationMinutes) : "30",
  );
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!visible) return;
    setCustomMinutes(sleepTimerDurationMinutes ? String(sleepTimerDurationMinutes) : "30");
  }, [sleepTimerDurationMinutes, visible]);

  useEffect(() => {
    if (!visible || !sleepTimerEndsAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sleepTimerEndsAt, visible]);

  const s = useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.36)",
          justifyContent: "flex-end",
        },
        sheet: {
          backgroundColor: colors.background,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16) + 12,
          gap: 16,
        },
        handle: {
          alignSelf: "center",
          width: 36,
          height: 4,
          borderRadius: 999,
          backgroundColor: withOpacity(colors.border, 0.9),
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        },
        title: {
          fontSize: fontSize.lg,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        subtitle: {
          marginTop: 2,
          fontSize: fontSize.sm,
          color: colors.mutedForeground,
        },
        current: {
          borderRadius: 16,
          paddingHorizontal: 14,
          paddingVertical: 12,
          backgroundColor: withOpacity(colors.primary, 0.08),
          borderWidth: 1,
          borderColor: withOpacity(colors.primary, 0.16),
        },
        currentLabel: {
          fontSize: fontSize.sm,
          color: colors.mutedForeground,
        },
        currentValue: {
          marginTop: 4,
          fontSize: fontSize.base,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        presets: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 10,
        },
        presetBtn: {
          minWidth: 76,
          borderRadius: radius.xl,
          paddingHorizontal: 14,
          paddingVertical: 12,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.8),
          alignItems: "center",
        },
        presetBtnText: {
          fontSize: fontSize.base,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        inputRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        },
        input: {
          flex: 1,
          height: 48,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
          paddingHorizontal: 14,
          fontSize: fontSize.base,
          color: colors.foreground,
          backgroundColor: colors.card,
        },
        applyBtn: {
          height: 48,
          borderRadius: radius.xl,
          paddingHorizontal: 18,
          backgroundColor: colors.primary,
          alignItems: "center",
          justifyContent: "center",
        },
        applyBtnText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.semibold,
          color: colors.primaryForeground,
        },
        footer: {
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 12,
        },
        ghostBtn: {
          flex: 1,
          height: 46,
          borderRadius: radius.xl,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.8),
        },
        ghostBtnText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
      }),
    [colors, insets.bottom],
  );

  const remainingLabel = useMemo(() => {
    void now;
    return formatRemainingLabel(sleepTimerEndsAt);
  }, [now, sleepTimerEndsAt]);

  const applyCustomMinutes = () => {
    const parsed = Number.parseInt(customMinutes.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setSleepTimer(parsed);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable
          style={[
            s.sheet,
            layout.isTablet && {
              width: "100%",
            },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={s.handle} />
          <View style={s.header}>
            <ClockIcon size={18} color={colors.primary} />
            <View>
              <Text style={s.title}>{t("tts.sleepTimer", "定时停止")}</Text>
              <Text style={s.subtitle}>
                {t("tts.sleepTimerSubtitle", "让朗读在你设定的时间后自动停止")}
              </Text>
            </View>
          </View>

          {sleepTimerEndsAt ? (
            <View style={s.current}>
              <Text style={s.currentLabel}>{t("tts.sleepTimerActive", "已开启睡眠定时")}</Text>
              <Text style={s.currentValue}>
                {remainingLabel
                  ? t("tts.sleepTimerRemaining", {
                      time: remainingLabel,
                      defaultValue: `Remaining ${remainingLabel}`,
                    })
                  : t("tts.sleepTimerSoon", "即将停止")}
              </Text>
            </View>
          ) : null}

          <View style={s.presets}>
            {PRESET_MINUTES.map((minutes) => (
              <TouchableOpacity
                key={minutes}
                style={s.presetBtn}
                onPress={() => {
                  setSleepTimer(minutes);
                  onClose();
                }}
              >
                <Text style={s.presetBtnText}>
                  {t("tts.sleepTimerPresetShort", { minutes, defaultValue: `${minutes} 分钟` })}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              keyboardType="number-pad"
              value={customMinutes}
              onChangeText={setCustomMinutes}
              placeholder={t("tts.sleepTimerCustomPlaceholder", "自定义分钟数")}
              placeholderTextColor={colors.mutedForeground}
            />
            <TouchableOpacity style={s.applyBtn} onPress={applyCustomMinutes}>
              <Text style={s.applyBtnText}>{t("tts.sleepTimerApply", "开始计时")}</Text>
            </TouchableOpacity>
          </View>

          <View style={s.footer}>
            {sleepTimerEndsAt ? (
              <TouchableOpacity
                style={s.ghostBtn}
                onPress={() => {
                  clearSleepTimer();
                  onClose();
                }}
              >
                <Text style={s.ghostBtnText}>{t("tts.sleepTimerCancel", "关闭定时")}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={s.ghostBtn} onPress={onClose}>
              <Text style={s.ghostBtnText}>{t("common.cancel", "取消")}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
