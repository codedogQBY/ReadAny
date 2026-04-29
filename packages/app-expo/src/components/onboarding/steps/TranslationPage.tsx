import { DarkModeSvg } from "@/components/DarkModeSvg";
import { useSettingsStore } from "@/stores";
import { useTheme } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { testDeepLConnection } from "@readany/core/translation/providers";
import { AlertCircle, Check, CheckCircle2 } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { SlideInRight } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DiscussionSvg from "../../../../assets/illustrations/discussion.svg";
import type { OnboardingStackParamList } from "../OnboardingNavigator";

type NavProp = NativeStackNavigationProp<OnboardingStackParamList, "Translation">;

export function TranslationPage() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavProp>();
  const { colors, isDark } = useTheme();
  const { translationConfig, updateTranslationConfig } = useSettingsStore();
  const insets = useSafeAreaInsets();

  const [provider, setProvider] = useState<"ai" | "deepl">(
    translationConfig.provider.id as "ai" | "deepl",
  );
  const [apiKey, setApiKey] = useState(translationConfig.provider.apiKey || "");
  const [baseUrl, setBaseUrl] = useState(translationConfig.provider.baseUrl || "");
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");

  const syncToStore = (p: "ai" | "deepl", key: string, nextBaseUrl: string) => {
    updateTranslationConfig({
      provider: {
        ...translationConfig.provider,
        id: p,
        name: p === "ai" ? "AI Translation" : "DeepL",
        apiKey: p === "deepl" ? key : undefined,
        baseUrl: p === "deepl" ? nextBaseUrl : undefined,
      },
    });
  };

  const handleProviderChange = (p: "ai" | "deepl") => {
    setProvider(p);
    setStatus("idle");
    syncToStore(p, apiKey, baseUrl);
  };

  const handleApiKeyChange = (key: string) => {
    setApiKey(key);
    setStatus("idle");
    syncToStore(provider, key, baseUrl);
  };

  const handleBaseUrlChange = (nextBaseUrl: string) => {
    setBaseUrl(nextBaseUrl);
    setStatus("idle");
    syncToStore(provider, apiKey, nextBaseUrl);
  };

  const testConnection = async () => {
    setStatus("testing");
    try {
      await testDeepLConnection(apiKey, baseUrl);
      setStatus("success");
    } catch {
      setStatus("error");
    }
  };

  const handleNext = () => {
    navigation.navigate("Sync");
  };

  return (
    <View style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <Animated.View entering={SlideInRight.duration(500)} style={styles.container}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: "transparent", shadowOpacity: 0, width: "100%", height: 140 },
              ]}
            >
              <DarkModeSvg width={140} height={140}>
                <DiscussionSvg width={140} height={140} />
              </DarkModeSvg>
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t("onboarding.translation.title", "Translation Engine")}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {t(
                "onboarding.translation.desc",
                "Enable seamless bilingual reading with your preferred engine.",
              )}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              {t("settings.translationProvider", "Provider")}
            </Text>
            <View style={styles.providerGrid}>
              <Pressable
                style={[
                  styles.providerCard,
                  provider === "ai" && styles.providerCardActive,
                  {
                    borderColor: provider === "ai" ? colors.primary : colors.border,
                    backgroundColor: colors.card,
                  },
                ]}
                onPress={() => handleProviderChange("ai")}
              >
                <View style={styles.providerContent}>
                  <Text style={[styles.providerName, { color: colors.foreground }]}>
                    {t("onboarding.translation.aiProvider", "AI Co-pilot")}
                  </Text>
                  <Text style={[styles.providerDesc, { color: colors.mutedForeground }]}>
                    {t("onboarding.translation.aiProviderDesc", "Free")}
                  </Text>
                </View>
                {provider === "ai" && <Check size={18} color={colors.primary} />}
              </Pressable>

              <Pressable
                style={[
                  styles.providerCard,
                  provider === "deepl" && styles.providerCardActive,
                  {
                    borderColor: provider === "deepl" ? colors.primary : colors.border,
                    backgroundColor: colors.card,
                  },
                ]}
                onPress={() => handleProviderChange("deepl")}
              >
                <View style={styles.providerContent}>
                  <Text style={[styles.providerName, { color: colors.foreground }]}>
                    {t("onboarding.translation.deeplProviderName", "DeepL Pro")}
                  </Text>
                  <Text style={[styles.providerDesc, { color: colors.mutedForeground }]}>
                    {t("onboarding.translation.deeplDesc", "Premium")}
                  </Text>
                </View>
                {provider === "deepl" && <Check size={18} color={colors.primary} />}
              </Pressable>
            </View>
          </View>

          {provider === "deepl" && (
            <View
              style={[
                styles.deeplSection,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>
                  {t("settings.apiKey", "DeepL API Key")}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  value={apiKey}
                  onChangeText={handleApiKeyChange}
                  placeholder={t(
                    "onboarding.translation.apiKeyPlaceholder",
                    "Enter your DeepL API key",
                  )}
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>
                  {t("translation.deeplBaseUrl", "DeepL 请求地址")}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  value={baseUrl}
                  onChangeText={handleBaseUrlChange}
                  placeholder={t(
                    "translation.deeplBaseUrlPlaceholder",
                    "https://api-free.deepl.com/v2",
                  )}
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={[styles.inputHint, { color: colors.mutedForeground }]}>
                  {t(
                    "translation.deeplBaseUrlHint",
                    "填写基础地址，也支持直接粘贴完整的 /translate 地址。",
                  )}
                </Text>
              </View>

              <View style={styles.testRow}>
                <Pressable
                  onPress={testConnection}
                  style={[
                    styles.testBtn,
                    {
                      borderColor: colors.primary,
                      opacity: !apiKey || status === "testing" ? 0.5 : 1,
                    },
                  ]}
                  disabled={!apiKey || status === "testing"}
                >
                  {status === "testing" ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={[styles.testBtnText, { color: colors.primary }]}>
                      {t("onboarding.ai.test", "Test Connection")}
                    </Text>
                  )}
                </Pressable>

                {status === "success" && (
                  <View style={styles.statusBadge}>
                    <CheckCircle2 size={16} color="#10b981" />
                    <Text style={styles.successText}>{t("common.success", "Success!")}</Text>
                  </View>
                )}
                {status === "error" && (
                  <View style={styles.statusBadge}>
                    <AlertCircle size={16} color="#ef4444" />
                    <Text style={styles.errorText}>{t("common.failed", "Failed")}</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
              paddingBottom: 16 + insets.bottom,
            },
          ]}
        >
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>{t("common.back", "Back")}</Text>
          </Pressable>
          <View style={styles.rightActions}>
            <Pressable
              onPress={() => navigation.navigate("Sync")}
              style={[styles.skipBtn, { opacity: 0.8 }]}
            >
              <Text style={[styles.skipText, { color: colors.mutedForeground }]}>
                {t("onboarding.skipForNow", "Skip for now")}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleNext}
              disabled={status === "testing"}
              style={[
                styles.nextBtn,
                { backgroundColor: colors.primary, shadowColor: "transparent" },
              ]}
            >
              <Text style={[styles.nextText, { color: colors.primaryForeground }]}>
                {t("common.next", "Next")} →
              </Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f8fafc" },
  container: { flex: 1, flexDirection: "column" },
  scroll: { flex: 1 },
  scrollContent: { padding: 24 },
  header: { alignItems: "center", marginBottom: 32 },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#e0e7ff",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0f172a",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: { fontSize: 16, color: "#64748b", textAlign: "center" },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  providerGrid: { gap: 12 },
  providerCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
  },
  providerCardActive: {
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  providerContent: { flex: 1 },
  providerName: { fontSize: 15, fontWeight: "600", marginBottom: 2 },
  providerDesc: { fontSize: 12 },
  deeplSection: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 16 },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 12, fontWeight: "500" },
  inputHint: { fontSize: 12, lineHeight: 18 },
  input: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 15,
  },
  testRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  testBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  testBtnText: { fontSize: 14, fontWeight: "600" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  successText: { fontSize: 13, color: "#10b981", fontWeight: "500" },
  errorText: { fontSize: 13, color: "#ef4444", fontWeight: "500" },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
  },
  backBtn: { paddingVertical: 12, paddingHorizontal: 4 },
  backText: { fontSize: 16, color: "#64748b", fontWeight: "500" },
  rightActions: { flexDirection: "row", gap: 16, alignItems: "center" },
  skipBtn: { paddingVertical: 12 },
  skipText: { fontSize: 14, color: "#94a3b8", fontWeight: "500" },
  nextBtn: {
    backgroundColor: "#6366f1",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 999,
  },
  nextText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
