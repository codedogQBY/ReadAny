import { KeyboardAwareScrollView } from "@/components/ui/KeyboardAwareScrollView";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import {
  DEFAULT_SYSTEM_VOICE_VALUE,
  type NativeSystemVoiceOption,
  findSystemVoiceLabel,
  getSystemVoiceOptionsAsync,
  groupSystemVoiceOptions,
  resolveSystemVoiceValue,
} from "@/lib/platform/system-voices";
import { previewTTSConfig, stopTTSPreview } from "@/lib/platform/tts-preview";
import { useTTSStore } from "@/stores";
import {
  DASHSCOPE_VOICES,
  DEFAULT_XIAOMI_STYLE_PROMPT,
  EDGE_TTS_VOICES,
  type TTSProfile,
  type TTSProviderType,
  XIAOMI_TTS_VOICES,
  getActiveTTSProfile,
  getLocaleDisplayLabel,
  groupEdgeTTSVoices,
} from "@readany/core/tts";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
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

const PREVIEW_FALLBACK_TIMEOUT_MS = 8000;

function providerLabel(provider: TTSProviderType, t: TFunction) {
  return t(`tts.provider.${provider}.label`, { defaultValue: provider });
}

function profileName(profile: TTSProfile, t: TFunction) {
  return profile.id.endsWith("-default")
    ? providerLabel(profile.provider, t)
    : profile.name || providerLabel(profile.provider, t);
}

export default function TTSSettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t, i18n } = useTranslation();
  const layout = useResponsiveLayout();
  const { config, updateConfig, stop } = useTTSStore();
  const [systemVoices, setSystemVoices] = useState<NativeSystemVoiceOption[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const previewRunRef = useRef(0);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profiles = config.profiles;
  const activeProfile = getActiveTTSProfile(config);
  const defaultStylePrompt = t("tts.defaultStylePrompt", DEFAULT_XIAOMI_STYLE_PROMPT);
  const xiaomiStylePromptValue =
    config.xiaomiStylePrompt === DEFAULT_XIAOMI_STYLE_PROMPT
      ? defaultStylePrompt
      : config.xiaomiStylePrompt;
  const openAIStylePromptValue =
    config.openaiTtsStylePrompt === DEFAULT_XIAOMI_STYLE_PROMPT
      ? defaultStylePrompt
      : config.openaiTtsStylePrompt;

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

  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);

  const endPreviewFeedback = useCallback(
    (run: number) => {
      if (previewRunRef.current !== run) return;
      clearPreviewTimer();
      setIsPreviewing(false);
    },
    [clearPreviewTimer],
  );

  useEffect(
    () => () => {
      previewRunRef.current += 1;
      clearPreviewTimer();
      stopTTSPreview();
    },
    [clearPreviewTimer],
  );

  const handlePreview = useCallback(() => {
    if (isPreviewing) {
      previewRunRef.current += 1;
      clearPreviewTimer();
      stopTTSPreview();
      setIsPreviewing(false);
      return;
    }

    const run = previewRunRef.current + 1;
    previewRunRef.current = run;
    setIsPreviewing(true);
    stop();
    previewTimerRef.current = setTimeout(
      () => endPreviewFeedback(run),
      PREVIEW_FALLBACK_TIMEOUT_MS,
    );
    void previewTTSConfig(t("tts.testText", "这是一段测试文本"), config, {
      onStateChange: (state) => {
        if (state === "stopped") endPreviewFeedback(run);
      },
      onEnd: () => endPreviewFeedback(run),
    });
  }, [clearPreviewTimer, config, endPreviewFeedback, isPreviewing, stop, t]);

  const selectProfile = useCallback(
    (profileId: string) => {
      const profile = profiles.find((item) => item.id === profileId);
      if (!profile) return;
      updateConfig({ activeProfileId: profile.id, engine: profile.provider });
    },
    [profiles, updateConfig],
  );

  const updateActiveProfile = useCallback(
    (updates: Partial<TTSProfile>) => {
      updateConfig({
        profiles: profiles.map((profile) =>
          profile.id === activeProfile.id ? { ...profile, ...updates } : profile,
        ),
      });
    },
    [activeProfile.id, profiles, updateConfig],
  );

  const previewBtn = (
    <TouchableOpacity
      style={[styles.previewBtn, isPreviewing && styles.previewBtnActive]}
      onPress={handlePreview}
      activeOpacity={0.7}
    >
      <Text style={[styles.previewBtnText, isPreviewing && styles.previewBtnTextActive]}>
        {isPreviewing ? "■" : "▶"}{" "}
        {isPreviewing
          ? t("common.previewing", "试听中")
          : t("common.preview", "试听")}
      </Text>
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

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { alignItems: "center" }]}
      >
          <View style={[styles.contentColumn, { width: "100%", maxWidth: layout.centeredContentWidth }]}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("tts.voiceProfile", "朗读方案")}</Text>
              <View style={styles.profileList}>
                {profiles.map((profile) => {
                  const active = activeProfile.id === profile.id;
                  return (
                    <TouchableOpacity
                      key={profile.id}
                      style={[styles.profileItem, active && styles.profileItemActive]}
                      onPress={() => selectProfile(profile.id)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.profileName, active && styles.profileNameActive]}>
                          {profileName(profile, t)}
                        </Text>
                      </View>
                      {active && <Text style={styles.profileStatus}>✓</Text>}
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
                        onPress={() => {
                          updateActiveProfile({ voice: v.id });
                          updateConfig({ edgeVoice: v.id });
                        }}
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
                      onPress={() => {
                        updateActiveProfile({ voice: v.id });
                        updateConfig({ dashscopeVoice: v.id });
                      }}
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
                    onChangeText={(v) => {
                      updateActiveProfile({ apiKey: v });
                      updateConfig({ dashscopeApiKey: v });
                    }}
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
                  onPress={() => {
                    updateActiveProfile({ voice: "" });
                    updateConfig({ voiceName: "", systemVoiceLabel: "" });
                  }}
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
                        onPress={() => {
                          updateActiveProfile({ voice: voice.id });
                          updateConfig({
                            voiceName: voice.id,
                            systemVoiceLabel: findSystemVoiceLabel(voice.id, systemVoices),
                          });
                        }}
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

            {config.engine === "xiaomi" && (
              <>
                <ScrollView style={styles.voiceList} nestedScrollEnabled>
                  {XIAOMI_TTS_VOICES.map((v) => (
                    <TouchableOpacity
                      key={v.id}
                      style={styles.voiceItem}
                      onPress={() => {
                        updateActiveProfile({ voice: v.id });
                        updateConfig({ xiaomiVoice: v.id });
                      }}
                      activeOpacity={0.7}
                    >
                      <View>
                        <Text
                          style={[
                            styles.voiceName,
                            config.xiaomiVoice === v.id && styles.voiceNameActive,
                          ]}
                        >
                          {v.label}
                        </Text>
                        <Text style={styles.voiceSubLabel}>MiMo-V2.5-TTS</Text>
                      </View>
                      {config.xiaomiVoice === v.id && <Text style={styles.micIcon}>♪</Text>}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("tts.apiKey", "API Key")}</Text>
                  <PasswordInput
                    style={styles.input}
                    value={config.xiaomiApiKey || ""}
                    onChangeText={(v) => {
                      updateActiveProfile({ apiKey: v });
                      updateConfig({ xiaomiApiKey: v });
                    }}
                    placeholder="MIMO_API_KEY"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("tts.baseUrl", "Base URL")}</Text>
                  <TextInput
                    style={styles.input}
                    value={config.xiaomiBaseUrl}
                    onChangeText={(v) => {
                      updateActiveProfile({ baseUrl: v });
                      updateConfig({ xiaomiBaseUrl: v });
                    }}
                    placeholder="https://api.xiaomimimo.com/v1"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("tts.stylePrompt", "朗读风格")}</Text>
                  <TextInput
                    style={[styles.input, styles.multilineInput]}
                    value={xiaomiStylePromptValue}
                    onChangeText={(v) => {
                      updateActiveProfile({ stylePrompt: v });
                      updateConfig({ xiaomiStylePrompt: v });
                    }}
                    multiline
                    placeholder={defaultStylePrompt}
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
              </>
            )}

            {config.engine === "openai-compatible" && (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("tts.baseUrl", "Base URL")}</Text>
                  <TextInput
                    style={styles.input}
                    value={config.openaiTtsBaseUrl}
                    onChangeText={(v) => {
                      updateActiveProfile({ baseUrl: v });
                      updateConfig({ openaiTtsBaseUrl: v });
                    }}
                    placeholder="https://api.openai.com/v1"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("tts.endpoint", "Endpoint")}</Text>
                  <View style={styles.optionRow}>
                    {(["audio-speech", "chat-completions"] as const).map((endpoint) => {
                      const active = config.openaiTtsEndpoint === endpoint;
                      return (
                        <TouchableOpacity
                          key={endpoint}
                          style={[styles.optionChip, active && styles.optionChipActive]}
                          onPress={() => {
                            updateActiveProfile({ endpoint });
                            updateConfig({ openaiTtsEndpoint: endpoint });
                          }}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.optionChipText,
                              active && styles.optionChipTextActive,
                            ]}
                          >
                            {endpoint === "audio-speech" ? "/audio/speech" : "/chat/completions"}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("tts.format", "Format")}</Text>
                  <View style={styles.optionRow}>
                    {(["mp3", "wav", "pcm16"] as const).map((format) => {
                      const active = config.openaiTtsFormat === format;
                      return (
                        <TouchableOpacity
                          key={format}
                          style={[styles.optionChip, active && styles.optionChipActive]}
                          onPress={() => {
                            updateActiveProfile({ format });
                            updateConfig({ openaiTtsFormat: format });
                          }}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.optionChipText,
                              active && styles.optionChipTextActive,
                            ]}
                          >
                            {format}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("tts.model", "Model")}</Text>
                  <TextInput
                    style={styles.input}
                    value={config.openaiTtsModel}
                    onChangeText={(v) => {
                      updateActiveProfile({ model: v });
                      updateConfig({ openaiTtsModel: v });
                    }}
                    placeholder="gpt-4o-mini-tts"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("tts.voice", "声音")}</Text>
                  <TextInput
                    style={styles.input}
                    value={config.openaiTtsVoice}
                    onChangeText={(v) => {
                      updateActiveProfile({ voice: v });
                      updateConfig({ openaiTtsVoice: v });
                    }}
                    placeholder="alloy"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("tts.apiKey", "API Key")}</Text>
                  <PasswordInput
                    style={styles.input}
                    value={config.openaiTtsApiKey || ""}
                    onChangeText={(v) => {
                      updateActiveProfile({ apiKey: v });
                      updateConfig({ openaiTtsApiKey: v });
                    }}
                    placeholder="sk-..."
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("tts.stylePrompt", "朗读风格")}</Text>
                  <TextInput
                    style={[styles.input, styles.multilineInput]}
                    value={openAIStylePromptValue}
                    onChangeText={(v) => {
                      updateActiveProfile({ stylePrompt: v });
                      updateConfig({ openaiTtsStylePrompt: v });
                    }}
                    multiline
                    placeholder={defaultStylePrompt}
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
              </>
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
      </KeyboardAwareScrollView>
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
      borderRadius: radius.full,
      paddingHorizontal: 12,
      paddingVertical: 7,
      backgroundColor: colors.muted,
    },
    previewBtnActive: {
      backgroundColor: colors.primary,
    },
    previewBtnText: {
      fontSize: fontSize.sm,
      color: colors.primary,
      fontWeight: fontWeight.medium,
    },
    previewBtnTextActive: {
      color: colors.primaryForeground,
    },
    section: { gap: 14 },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    profileList: {
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    profileItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingHorizontal: spacing.lg,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    profileItemActive: {
      backgroundColor: colors.accent,
    },
    profileName: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    profileNameActive: {
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },
    profileStatus: {
      fontSize: fontSize.lg,
      color: colors.primary,
    },
    optionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    optionChip: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    optionChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.accent,
    },
    optionChipText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    optionChipTextActive: {
      color: colors.primary,
      fontWeight: fontWeight.medium,
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
    multilineInput: {
      minHeight: 84,
      textAlignVertical: "top",
      lineHeight: 20,
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
