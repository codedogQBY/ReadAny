import { useTTSStore } from "@/stores";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import {
  DEFAULT_SYSTEM_VOICE_VALUE,
  findSystemVoiceLabel,
  getSystemVoiceOptionsAsync,
  groupSystemVoiceOptions,
  resolveSystemVoiceValue,
  type NativeSystemVoiceOption,
} from "@/lib/platform/system-voices";
import { previewTTSConfig, stopTTSPreview } from "@/lib/platform/tts-preview";
import {
  DASHSCOPE_VOICES,
  EDGE_TTS_VOICES,
  getLocaleDisplayLabel,
  groupEdgeTTSVoices,
  type TTSEngine,
} from "@readany/core/tts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PasswordInput } from "../../components/ui/PasswordInput";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  useColors,
} from "../../styles/theme";
import { SettingsHeader } from "./SettingsHeader";

const ENGINES: { id: TTSEngine; labelKey: string }[] = [
  { id: "edge", labelKey: "tts.edgeEngine" },
  { id: "system", labelKey: "tts.system" },
  { id: "dashscope", labelKey: "tts.tongyi" },
];

export default function TTSSettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t, i18n } = useTranslation();
  const layout = useResponsiveLayout();
  const { config, updateConfig, stop } = useTTSStore();
  const [systemVoices, setSystemVoices] = useState<NativeSystemVoiceOption[]>([]);

  const displayLocale = i18n.resolvedLanguage || i18n.language;
  const edgeVoiceGroups = useMemo(() => groupEdgeTTSVoices(EDGE_TTS_VOICES), []);

  const systemVoiceGroups = useMemo(
    () => groupSystemVoiceOptions(systemVoices),
    [systemVoices],
  );
  const selectedSystemVoiceValue = useMemo(
    () => resolveSystemVoiceValue(config.voiceName, systemVoices),
    [config.voiceName, systemVoices],
  );

  useEffect(() => {
    if (config.engine === "system") {
      void getSystemVoiceOptionsAsync().then(setSystemVoices);
    }
  }, [config.engine]);

  useEffect(() => stopTTSPreview, []);

  const handlePreview = useCallback(() => {
    stop();
    void previewTTSConfig(t("tts.testText", "这是一段测试文本"), config);
  }, [config, stop, t]);

  const previewBtn = (
    <TouchableOpacity style={styles.previewBtn} onPress={handlePreview} activeOpacity={0.7}>
      <Text style={styles.previewBtnText}>▶ {t("common.preview", "试听")}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <SettingsHeader
        title={t("tts.title", "TTS 设置")}
        subtitle={t("settings.realtimeHint")}
        right={previewBtn}
      />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { alignItems: "center" }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={[styles.contentColumn, { width: "100%", maxWidth: layout.centeredContentWidth }]}>
            {/* Engine Selection */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("tts.ttsEngine", "TTS 引擎")}</Text>
              <View style={styles.engineGrid}>
                {ENGINES.map((eng) => {
                  const active = config.engine === eng.id;
                  return (
                    <TouchableOpacity
                      key={eng.id}
                      style={[styles.engineCard, active && styles.engineCardActive]}
                      onPress={() => updateConfig({ engine: eng.id })}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.engineLabel, active && styles.engineLabelActive]}>
                        {t(eng.labelKey, eng.id)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Voice Selection */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("tts.voiceSelect", "声音选择")}</Text>

            {config.engine === "edge" && (
              <ScrollView style={styles.voiceList} nestedScrollEnabled>
                {edgeVoiceGroups.map(([lang, voices]) => (
                  <View key={lang}>
                    <View style={styles.voiceGroupHeader}>
                      <Text style={styles.voiceGroupLabel}>
                        {getLocaleDisplayLabel(lang, displayLocale)}
                      </Text>
                    </View>
                    {voices.map((v) => (
                      <TouchableOpacity
                        key={v.id}
                        style={styles.voiceItem}
                        onPress={() => updateConfig({ edgeVoice: v.id })}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.voiceName,
                            config.edgeVoice === v.id && styles.voiceNameActive,
                          ]}
                        >
                          {v.name}
                        </Text>
                        {config.edgeVoice === v.id && <Text style={styles.micIcon}>♪</Text>}
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </ScrollView>
            )}

            {config.engine === "dashscope" && (
              <>
                <ScrollView style={styles.voiceList} nestedScrollEnabled>
                  {DASHSCOPE_VOICES.map((v) => (
                    <TouchableOpacity
                      key={v.id}
                      style={styles.voiceItem}
                      onPress={() => updateConfig({ dashscopeVoice: v.id })}
                      activeOpacity={0.7}
                    >
                      <View>
                        <Text
                          style={[
                            styles.voiceName,
                            config.dashscopeVoice === v.id && styles.voiceNameActive,
                          ]}
                        >
                          {v.label}
                        </Text>
                        <Text style={styles.voiceSubLabel}>{v.id}</Text>
                      </View>
                      {config.dashscopeVoice === v.id && <Text style={styles.micIcon}>♪</Text>}
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* DashScope API Key */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("tts.apiKey", "DashScope API Key")}</Text>
                  <PasswordInput
                    style={styles.input}
                    value={config.dashscopeApiKey || ""}
                    onChangeText={(v) => updateConfig({ dashscopeApiKey: v })}
                    placeholder="sk-..."
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
              </>
            )}

            {config.engine === "system" && (
              <ScrollView style={styles.voiceList} nestedScrollEnabled>
                <TouchableOpacity
                  style={styles.voiceItem}
                  onPress={() => updateConfig({ voiceName: "", systemVoiceLabel: "" })}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.voiceName,
                      selectedSystemVoiceValue === DEFAULT_SYSTEM_VOICE_VALUE &&
                        styles.voiceNameActive,
                    ]}
                  >
                    {t("tts.defaultVoice")}
                  </Text>
                  {selectedSystemVoiceValue === DEFAULT_SYSTEM_VOICE_VALUE && (
                    <Text style={styles.micIcon}>♪</Text>
                  )}
                </TouchableOpacity>
                {systemVoiceGroups.map(([lang, voices]) => (
                  <View key={lang}>
                    <View style={styles.voiceGroupHeader}>
                      <Text style={styles.voiceGroupLabel}>
                        {getLocaleDisplayLabel(lang, displayLocale)}
                      </Text>
                    </View>
                    {voices.map((voice) => (
                      <TouchableOpacity
                        key={voice.id}
                        style={styles.voiceItem}
                        onPress={() =>
                          updateConfig({
                            voiceName: voice.id,
                            systemVoiceLabel: findSystemVoiceLabel(voice.id, systemVoices),
                          })
                        }
                        activeOpacity={0.7}
                      >
                        <View>
                          <Text
                            style={[
                              styles.voiceName,
                              selectedSystemVoiceValue === voice.id && styles.voiceNameActive,
                            ]}
                          >
                            {voice.label}
                          </Text>
                          <Text style={styles.voiceSubLabel}>
                            {getLocaleDisplayLabel(voice.lang, displayLocale)}
                          </Text>
                        </View>
                        {selectedSystemVoiceValue === voice.id && (
                          <Text style={styles.micIcon}>♪</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </ScrollView>
            )}
            </View>

            {/* Rate & Pitch */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("tts.params", "语音参数")}</Text>
              <View style={styles.paramsCard}>
                {/* Rate */}
                <View style={styles.paramRow}>
                  <View style={styles.paramHeader}>
                    <Text style={styles.paramLabel}>{t("tts.rate", "语速")}</Text>
                    <Text style={styles.paramValue}>{config.rate.toFixed(1)}x</Text>
                  </View>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    value={String(config.rate)}
                    onChangeText={(v) => {
                      const n = Number.parseFloat(v);
                      if (!Number.isNaN(n) && n >= 0.5 && n <= 2) updateConfig({ rate: n });
                    }}
                    placeholder="0.5 - 2.0"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>

                {/* Pitch (system only) */}
                {config.engine === "system" && (
                  <View style={styles.paramRow}>
                    <View style={styles.paramHeader}>
                      <Text style={styles.paramLabel}>{t("tts.pitch", "音调")}</Text>
                      <Text style={styles.paramValue}>{config.pitch.toFixed(1)}</Text>
                    </View>
                    <TextInput
                      style={styles.input}
                      keyboardType="decimal-pad"
                      value={String(config.pitch)}
                      onChangeText={(v) => {
                        const n = Number.parseFloat(v);
                        if (!Number.isNaN(n) && n >= 0.5 && n <= 2) updateConfig({ pitch: n });
                      }}
                      placeholder="0.5 - 2.0"
                      placeholderTextColor={colors.mutedForeground}
                    />
                  </View>
                )}
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    keyboardView: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xxl,
      paddingBottom: 56,
      gap: 24,
    },
    contentColumn: {
      gap: spacing.xl,
    },
    previewBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    previewBtnText: {
      fontSize: fontSize.sm,
      color: colors.primary,
    },
    section: { gap: 14 },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    engineGrid: {
      flexDirection: "row",
      gap: 8,
    },
    engineCard: {
      flex: 1,
      alignItems: "center",
      gap: 6,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 12,
    },
    engineCardActive: {
      borderColor: colors.primary,
      backgroundColor: colors.accent,
    },
    engineLabel: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    engineLabelActive: {
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },
    voiceList: {
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      maxHeight: 240,
    },
    voiceGroupHeader: {
      backgroundColor: colors.muted,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    voiceGroupLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    voiceItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: 10,
    },
    voiceName: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    voiceNameActive: {
      color: colors.primary,
      fontWeight: fontWeight.medium,
    },
    voiceSubLabel: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      marginTop: 2,
      lineHeight: 20,
    },
    micIcon: {
      fontSize: 14,
      color: colors.primary,
    },
    emptyVoice: {
      padding: 24,
      alignItems: "center",
    },
    emptyVoiceText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
    },
    fieldGroup: { gap: 6, marginTop: 12 },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    input: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    paramsCard: {
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: 16,
    },
    paramRow: { gap: 8 },
    paramHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    paramLabel: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    paramValue: {
      fontSize: fontSize.sm,
      color: colors.foreground,
      fontWeight: fontWeight.medium,
      fontVariant: ["tabular-nums"],
    },
  });
