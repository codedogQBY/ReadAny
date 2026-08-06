import { KeyboardAwareScrollView } from "@/components/ui/KeyboardAwareScrollView";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useSettingsStore } from "@/stores";
import {
  TRANSLATOR_LANGS,
  TRANSLATOR_PROVIDERS,
  type TranslationTargetLang,
} from "@readany/core/types/translation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
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

export default function TranslationSettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();
  const layout = useResponsiveLayout();
  const { translationConfig, updateTranslationConfig, aiConfig } = useSettingsStore();
  const [showModelPicker, setShowModelPicker] = useState(false);

  const isAIProvider = translationConfig.provider.id === "ai";

  const endpointsWithModels = aiConfig.endpoints.filter((e) => e.models.length > 0);
  const totalModels = endpointsWithModels.reduce((sum, ep) => sum + ep.models.length, 0);
  const multipleEndpoints = endpointsWithModels.length > 1;

  const selectedEndpointId = translationConfig.provider.endpointId || aiConfig.activeEndpointId;
  const selectedModel = translationConfig.provider.model || aiConfig.activeModel;

  const handleProviderChange = (providerId: "ai" | "deepl" | "microsoft", providerName: string) => {
    updateTranslationConfig({
      provider: {
        ...translationConfig.provider,
        id: providerId,
        name: providerName,
      },
    });
  };

  const handleModelSelect = (endpointId: string, model: string) => {
    updateTranslationConfig({
      provider: {
        ...translationConfig.provider,
        model,
        endpointId,
      },
    });
    setShowModelPicker(false);
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <SettingsHeader
        title={t("translation.settingsTitle", "翻译设置")}
        subtitle={t("settings.realtimeHint")}
      />

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { alignItems: "center" }]}
      >
          <View style={[styles.contentColumn, { width: "100%", maxWidth: layout.centeredContentWidth }]}>
            {/* Provider */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("translation.engine", "翻译引擎")}</Text>
              <View style={styles.listCard}>
                {TRANSLATOR_PROVIDERS.map((p, idx) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.listItem,
                      idx < TRANSLATOR_PROVIDERS.length - 1 && styles.listItemBorder,
                    ]}
                    onPress={() => handleProviderChange(p.id, p.labelKey)}
                    activeOpacity={0.7}
                  >
                    <View>
                      <Text style={styles.listItemText}>{t(p.labelKey)}</Text>
                      {p.id === "ai" && (
                        <Text style={styles.listItemSub}>
                          {t("translation.useAIModel", {
                            model: selectedModel || "AI",
                          })}
                        </Text>
                      )}
                      {p.id === "microsoft" && (
                        <Text style={styles.listItemSub}>
                          {t("translation.microsoftHint", "免费，无需配置")}
                        </Text>
                      )}
                    </View>
                    {translationConfig.provider.id === p.id && <Text style={styles.check}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* DeepL API Key */}
            {translationConfig.provider.id === "deepl" && (
              <View style={[styles.section, styles.sectionSpaced]}>
                <Text style={styles.sectionTitle}>{t("translation.deeplApiKey", "DeepL API Key")}</Text>
                <PasswordInput
                  style={styles.apiKeyInput}
                  value={translationConfig.provider.apiKey || ""}
                  onChangeText={(v) =>
                    updateTranslationConfig({
                      provider: {
                        ...translationConfig.provider,
                        apiKey: v,
                      },
                    })
                  }
                  placeholder={t("translation.deeplApiKeyPlaceholder", "输入 DeepL API Key")}
                  placeholderTextColor={colors.mutedForeground}
                />
                <Text style={styles.fieldHint}>{t("settings.deeplKeyHint", "DeepL API 密钥")}</Text>

                <Text style={[styles.sectionTitle, styles.subSectionTitle]}>
                  {t("translation.deeplBaseUrl", "DeepL 请求地址")}
                </Text>
                <TextInput
                  style={styles.apiKeyInput}
                  value={translationConfig.provider.baseUrl || ""}
                  onChangeText={(v) =>
                    updateTranslationConfig({
                      provider: {
                        ...translationConfig.provider,
                        baseUrl: v,
                      },
                    })
                  }
                  placeholder={t(
                    "translation.deeplBaseUrlPlaceholder",
                    "https://api-free.deepl.com/v2",
                  )}
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={styles.fieldHint}>
                  {t(
                    "translation.deeplBaseUrlHint",
                    "填写基础地址，也支持直接粘贴完整的 /translate 地址。",
                  )}
                </Text>
              </View>
            )}

            {/* AI Model Selection */}
            {isAIProvider && (
              <View style={[styles.section, styles.sectionSpaced]}>
                <Text style={styles.sectionTitle}>{t("settings.translationModel", "翻译模型")}</Text>
                {endpointsWithModels.length > 0 ? (
                  <TouchableOpacity
                    style={styles.modelSelector}
                    onPress={() => totalModels > 1 && setShowModelPicker(true)}
                    activeOpacity={totalModels > 1 ? 0.7 : 1}
                  >
                    <Text style={styles.modelSelectorText} numberOfLines={1}>
                      {selectedModel || t("settings.selectModel", "选择模型")}
                    </Text>
                    {totalModels > 1 && <Text style={styles.chevron}>▾</Text>}
                  </TouchableOpacity>
                ) : (
                  <View style={styles.modelSelector}>
                    <Text style={styles.modelSelectorPlaceholder}>
                      {t("settings.noModelsFetched", "未获取到模型")}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Target Language */}
            <View style={[styles.section, styles.sectionSpaced]}>
              <Text style={styles.sectionTitle}>{t("translation.targetLanguage", "目标语言")}</Text>
              <View style={[styles.listCard, { maxHeight: 320 }]}>
                <ScrollView nestedScrollEnabled>
                  {Object.entries(TRANSLATOR_LANGS).map(([code, name]) => (
                    <TouchableOpacity
                      key={code}
                      style={styles.langItem}
                      onPress={() =>
                        updateTranslationConfig({
                          targetLang: code as TranslationTargetLang,
                        })
                      }
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.langText,
                          translationConfig.targetLang === code && styles.langTextActive,
                        ]}
                      >
                        {name}
                      </Text>
                      {translationConfig.targetLang === code && <Text style={styles.check}>✓</Text>}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          </View>
      </KeyboardAwareScrollView>

      {/* Model Picker Modal */}
      <Modal
        visible={showModelPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModelPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowModelPicker(false)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>{t("settings.selectModel", "选择模型")}</Text>
            <ScrollView nestedScrollEnabled>
              {endpointsWithModels.map((ep) => (
                <View key={ep.id}>
                  {multipleEndpoints && (
                    <Text style={styles.endpointLabel}>{ep.name || ep.baseUrl}</Text>
                  )}
                  {ep.models.map((model) => {
                    const isActive = model === selectedModel && ep.id === selectedEndpointId;
                    return (
                      <TouchableOpacity
                        key={`${ep.id}-${model}`}
                        style={styles.modelItem}
                        onPress={() => handleModelSelect(ep.id, model)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[styles.modelItemText, isActive && styles.modelItemTextActive]}
                          numberOfLines={1}
                        >
                          {model}
                        </Text>
                        {isActive && <Text style={styles.check}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
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
    contentColumn: {},
    section: {},
    sectionSpaced: {
      marginTop: spacing.xl,
    },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      marginBottom: 10,
    },
    listCard: {
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    listItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: 14,
    },
    listItemBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    listItemText: {
      fontSize: fontSize.md,
      color: colors.foreground,
    },
    listItemSub: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      marginTop: 2,
      lineHeight: 20,
    },
    check: {
      fontSize: 14,
      color: colors.primary,
    },
    apiKeyInput: {
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: spacing.lg,
      paddingVertical: 12,
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    fieldHint: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      marginTop: 6,
      lineHeight: 20,
    },
    subSectionTitle: {
      marginTop: 16,
      marginBottom: 10,
    },
    langItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: 12,
    },
    langText: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    langTextActive: {
      color: colors.primary,
      fontWeight: fontWeight.medium,
    },
    modelSelector: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: spacing.lg,
      paddingVertical: 12,
    },
    modelSelectorText: {
      flex: 1,
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    modelSelectorPlaceholder: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    chevron: {
      fontSize: 14,
      color: colors.mutedForeground,
      marginLeft: 8,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "center",
      alignItems: "center",
    },
    modalContent: {
      width: 280,
      maxHeight: 400,
      backgroundColor: colors.background,
      borderRadius: radius.xl,
      overflow: "hidden",
    },
    modalTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      textAlign: "center",
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    endpointLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
      paddingHorizontal: spacing.lg,
      paddingTop: 10,
      paddingBottom: 4,
    },
    modelItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modelItemText: {
      flex: 1,
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    modelItemTextActive: {
      color: colors.primary,
      fontWeight: fontWeight.medium,
    },
  });
