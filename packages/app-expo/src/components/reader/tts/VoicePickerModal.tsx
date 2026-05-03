import { useColors, radius } from "@/styles/theme";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import {
  DEFAULT_SYSTEM_VOICE_VALUE,
  findSystemVoiceLabel,
  getSystemVoiceOptionsAsync,
  groupSystemVoiceOptions,
  resolveSystemVoiceValue,
  type NativeSystemVoiceOption,
} from "@/lib/platform/system-voices";
import {
  DASHSCOPE_VOICES,
  EDGE_TTS_VOICES,
  getLocaleDisplayLabel,
  groupEdgeTTSVoices,
  type TTSConfig,
} from "@readany/core/tts";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { makeStyles } from "./tts-page-styles";

interface VoicePickerModalProps {
  visible: boolean;
  config: TTSConfig;
  onClose: () => void;
  onUpdateConfig: (updates: Partial<TTSConfig>) => void;
}

export function VoicePickerModal({
  visible,
  config,
  onClose,
  onUpdateConfig,
}: VoicePickerModalProps) {
  const colors = useColors();
  const s = makeStyles(colors);
  const layout = useResponsiveLayout();
  const { t, i18n } = useTranslation();
  const [systemVoices, setSystemVoices] = useState<NativeSystemVoiceOption[]>([]);
  const displayLocale = i18n.resolvedLanguage || i18n.language;

  useEffect(() => {
    if (!visible) return;
    void getSystemVoiceOptionsAsync().then(setSystemVoices);
  }, [visible]);

  const systemVoiceGroups = useMemo(
    () => groupSystemVoiceOptions(systemVoices),
    [systemVoices],
  );
  const edgeVoiceGroups = useMemo(() => groupEdgeTTSVoices(EDGE_TTS_VOICES), []);
  const selectedSystemVoiceValue = useMemo(
    () => resolveSystemVoiceValue(config.voiceName, systemVoices),
    [config.voiceName, systemVoices],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={s.voicePickerContainer}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View
          style={[
            s.voicePickerSheet,
            layout.isTablet && {
              width: "100%",
            },
          ]}
        >
          {/* Handle bar */}
          <View style={s.voicePickerHandle} />

          {/* Header */}
          <View style={s.voicePickerHeader}>
            <Text style={s.voicePickerTitle}>{t("tts.ttsEngine")}</Text>
          </View>

          {/* Engine selector */}
          <View style={s.engineSection}>
            {(["edge", "dashscope", "system"] as const).map((eng) => {
              const isActive = config.engine === eng;
              const label =
                eng === "edge" ? "Edge TTS" : eng === "dashscope" ? "DashScope" : t("tts.system");
              const desc =
                eng === "edge"
                  ? "Microsoft · 多语言"
                  : eng === "dashscope"
                    ? "阿里云通义 · 中文优化"
                    : "系统内置 · 免费";
              return (
                <TouchableOpacity
                  key={eng}
                  style={[s.engineRow, isActive && s.engineRowActive]}
                  onPress={() => onUpdateConfig({ engine: eng })}
                  activeOpacity={0.7}
                >
                  <View style={s.engineRowLeft}>
                    <Text style={[s.engineRowLabel, isActive && s.engineRowLabelActive]}>
                      {label}
                    </Text>
                    <Text style={s.engineRowDesc}>{desc}</Text>
                  </View>
                  {isActive && (
                    <View style={s.engineCheckmark}>
                      <Text style={s.engineCheckmarkTxt}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Divider + voice section title */}
          {config.engine !== "system" && (
            <View style={s.voicePickerHeader}>
              <Text style={s.voicePickerTitle}>{t("tts.selectVoice")}</Text>
            </View>
          )}

          <ScrollView style={s.voicePickerList} showsVerticalScrollIndicator={false}>
            {/* DashScope voices */}
            {config.engine === "dashscope" &&
              DASHSCOPE_VOICES.map((v) => {
                const isSelected = config.dashscopeVoice === v.id;
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[s.voiceItem, isSelected && s.voiceItemSelected]}
                    onPress={() => {
                      onUpdateConfig({ dashscopeVoice: v.id });
                      onClose();
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.voiceItemTxt, isSelected && s.voiceItemTxtSelected]}>
                      {v.label}
                    </Text>
                    {isSelected && <Text style={s.voiceItemCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              })}

            {/* Edge TTS voices — grouped by language, zh-* first */}
            {config.engine === "edge" &&
              edgeVoiceGroups.map(([lang, voices]) => (
                <View key={lang}>
                  <View style={s.voiceLangHeader}>
                    <Text style={s.voiceLangTxt}>
                      {getLocaleDisplayLabel(lang, displayLocale)}
                    </Text>
                  </View>
                  {voices.map((v) => {
                    const isSelected = config.edgeVoice === v.id;
                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[s.voiceItem, isSelected && s.voiceItemSelected]}
                        onPress={() => {
                          onUpdateConfig({ edgeVoice: v.id });
                          onClose();
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.voiceItemTxt, isSelected && s.voiceItemTxtSelected]}>
                          {v.name}
                        </Text>
                        {isSelected && <Text style={s.voiceItemCheck}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}

            {/* System voices */}
            {config.engine === "system" && (
              <>
                <TouchableOpacity
                  style={[
                    s.voiceItem,
                    selectedSystemVoiceValue === DEFAULT_SYSTEM_VOICE_VALUE &&
                      s.voiceItemSelected,
                  ]}
                  onPress={() => {
                    onUpdateConfig({ voiceName: "", systemVoiceLabel: "" });
                    onClose();
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      s.voiceItemTxt,
                      selectedSystemVoiceValue === DEFAULT_SYSTEM_VOICE_VALUE &&
                        s.voiceItemTxtSelected,
                    ]}
                  >
                    {t("tts.defaultVoice")}
                  </Text>
                  {selectedSystemVoiceValue === DEFAULT_SYSTEM_VOICE_VALUE && (
                    <Text style={s.voiceItemCheck}>✓</Text>
                  )}
                </TouchableOpacity>
                {systemVoiceGroups.map(([lang, voices]) => (
                  <View key={lang}>
                    <View style={s.voiceLangHeader}>
                      <Text style={s.voiceLangTxt}>
                        {getLocaleDisplayLabel(lang, displayLocale)}
                      </Text>
                    </View>
                    {voices.map((voice) => {
                      const isSelected = selectedSystemVoiceValue === voice.id;
                      return (
                        <TouchableOpacity
                          key={voice.id}
                          style={[s.voiceItem, isSelected && s.voiceItemSelected]}
                          onPress={() => {
                            onUpdateConfig({
                              voiceName: voice.id,
                              systemVoiceLabel: findSystemVoiceLabel(voice.id, systemVoices),
                            });
                            onClose();
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={[s.voiceItemTxt, isSelected && s.voiceItemTxtSelected]}>
                            {voice.label}
                          </Text>
                          {isSelected && <Text style={s.voiceItemCheck}>✓</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          {/* Cancel button */}
          <TouchableOpacity
            style={s.voicePickerCancel}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={s.voicePickerCancelTxt}>{t("common.cancel")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
