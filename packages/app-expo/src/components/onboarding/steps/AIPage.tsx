import { DarkModeSvg } from "@/components/DarkModeSvg";
import { KeyboardAwareScrollView } from "@/components/ui/KeyboardAwareScrollView";
import { useTheme } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { testAIEndpoint } from "@readany/core/ai";
import { useSettingsStore } from "@/stores";
import type { AIProviderType } from "@readany/core/types";
import { getDefaultBaseUrl, PROVIDER_CONFIGS, providerRequiresApiKey } from "@readany/core/utils";
import { AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { SlideInRight } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BrainSvg from "../../../../assets/illustrations/ai_assistant.svg";
import type { OnboardingStackParamList } from "../OnboardingNavigator";

type NavProp = NativeStackNavigationProp<OnboardingStackParamList, "AI">;

const ONBOARDING_ENDPOINT_ID = "onboarding-ai-endpoint";

const PROVIDER_OPTIONS: { id: AIProviderType; name: string }[] = [
  { id: "openai", name: "OpenAI" },
  { id: "atlascloud", name: "Atlas Cloud" },
  { id: "anthropic", name: "Anthropic" },
  { id: "google", name: "Google Gemini" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "ollama", name: "Ollama" },
  { id: "lmstudio", name: "LM Studio" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "siliconflow", name: "SiliconFlow" },
  { id: "custom", name: "Custom" },
];

export function AIPage() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavProp>();
  const { colors, isDark } = useTheme();
  const { addEndpoint, updateEndpoint, setActiveEndpoint, aiConfig, _hasHydrated } =
    useSettingsStore();
  const insets = useSafeAreaInsets();

  const [provider, setProvider] = useState<AIProviderType>("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(getDefaultBaseUrl("openai"));
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [showApiKey, setShowApiKey] = useState(false);

  const syncEndpointId =
    aiConfig.endpoints.find((ep) => ep.apiKey && ep.apiKey.length > 0)?.id ||
    aiConfig.activeEndpointId ||
    aiConfig.endpoints[0]?.id ||
    ONBOARDING_ENDPOINT_ID;

  useEffect(() => {
    if (!_hasHydrated || aiConfig.endpoints.length === 0) return;

    const endpointWithKey = aiConfig.endpoints.find((ep) => ep.apiKey && ep.apiKey.length > 0);
    const activeEndpoint = aiConfig.endpoints.find((ep) => ep.id === aiConfig.activeEndpointId);
    const endpointToUse = endpointWithKey || activeEndpoint || aiConfig.endpoints[0];

    if (endpointToUse) {
      const newProvider = endpointToUse.provider || "openai";
      const newApiKey = endpointToUse.apiKey || "";
      const newBaseUrl = endpointToUse.baseUrl || getDefaultBaseUrl(newProvider);

      setProvider((prev) => (prev === newProvider ? prev : newProvider));
      setApiKey((prev) => (prev === newApiKey ? prev : newApiKey));
      setBaseUrl((prev) => (prev === newBaseUrl ? prev : newBaseUrl));
    }
  }, [aiConfig.endpoints.length, aiConfig.activeEndpointId, _hasHydrated]);

  const syncToStore = (p: AIProviderType, key: string, url: string) => {
    const config = PROVIDER_CONFIGS[p];
    const existingEndpoint = aiConfig.endpoints.find((ep) => ep.id === syncEndpointId);
    const endpointId = existingEndpoint ? syncEndpointId : ONBOARDING_ENDPOINT_ID;

    if (existingEndpoint) {
      updateEndpoint(endpointId, {
        provider: p,
        name: existingEndpoint.name || config?.name || p,
        apiKey: key,
        baseUrl: url,
      });
    } else {
      addEndpoint({
        id: endpointId,
        name: config?.name || p,
        provider: p,
        apiKey: key,
        baseUrl: url,
        models: [],
        modelsFetched: false,
      });
    }
    setActiveEndpoint(endpointId);
  };

  const handleProviderChange = (id: AIProviderType) => {
    setProvider(id);
    const newUrl = getDefaultBaseUrl(id);
    setBaseUrl(newUrl);
    setApiKey("");
    setStatus("idle");
    syncToStore(id, "", newUrl);
  };

  const handleApiKeyChange = (key: string) => {
    setApiKey(key);
    syncToStore(provider, key, baseUrl);
  };

  const handleBaseUrlChange = (url: string) => {
    setBaseUrl(url);
    syncToStore(provider, apiKey, url);
  };

  const testConnection = async () => {
    setStatus("testing");
    try {
      await testAIEndpoint({
        id: ONBOARDING_ENDPOINT_ID,
        name: PROVIDER_CONFIGS[provider]?.name || provider,
        provider,
        apiKey,
        baseUrl,
        models: [],
        modelsFetched: false,
      });
      setStatus("success");
    } catch (err) {
      console.warn("[Onboarding] AI connection test failed:", err);
      setStatus("error");
    }
  };

  const handleNext = () => {
    if (apiKey.trim()) {
      syncToStore(provider, apiKey, baseUrl);
    }
    if (!aiConfig.activeEndpointId) {
      setActiveEndpoint(ONBOARDING_ENDPOINT_ID);
    }
    navigation.navigate("Embedding");
  };

  return (
    <View style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <Animated.View entering={SlideInRight.duration(500)} style={styles.container}>
        <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: "transparent", shadowOpacity: 0, width: "100%", height: 140 },
              ]}
            >
              <DarkModeSvg width={140} height={140}>
                <BrainSvg width={140} height={140} />
              </DarkModeSvg>
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t("onboarding.ai.title", "AI Configuration")}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {t(
                "onboarding.ai.desc",
                "Set up your AI provider to enable smart chat and summarization.",
              )}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings.ai_provider", "Provider")}</Text>
            <View style={styles.providerGrid}>
              {PROVIDER_OPTIONS.map((p) => {
                const isActive = provider === p.id;
                return (
                  <Pressable
                    key={p.id}
                    style={[
                      styles.providerCard,
                      isActive && styles.providerCardActive,
                      {
                        borderColor: isActive ? colors.primary : colors.border,
                        backgroundColor: colors.card,
                      },
                    ]}
                    onPress={() => handleProviderChange(p.id)}
                  >
                    <Text
                      style={[
                        styles.providerText,
                        { color: isActive ? colors.primary : colors.foreground },
                      ]}
                    >
                      {p.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {providerRequiresApiKey(provider) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("settings.apiKey", "API Key")}</Text>
              <View
                style={[
                  styles.inputContainer,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <TextInput
                  style={[styles.inputWithIcon, { color: colors.foreground }]}
                  value={apiKey}
                  onChangeText={handleApiKeyChange}
                  placeholder="sk-..."
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry={!showApiKey}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable onPress={() => setShowApiKey(!showApiKey)} style={styles.eyeIcon}>
                  {showApiKey ? (
                    <EyeOff size={20} color={colors.mutedForeground} />
                  ) : (
                    <Eye size={20} color={colors.mutedForeground} />
                  )}
                </Pressable>
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings.baseUrl", "Base URL")}</Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              value={baseUrl}
              onChangeText={handleBaseUrlChange}
              placeholder={PROVIDER_CONFIGS[provider]?.placeholder || "https://api.example.com"}
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {PROVIDER_CONFIGS[provider]?.needsV1Suffix && (
              <Text style={[styles.baseUrlHint, { color: colors.mutedForeground }]}>
                {t(
                  "settings.ai_baseUrlHint",
                  "OpenAI-compatible endpoints append /v1 by default. End the URL with / to use your custom path as-is.",
                )}
              </Text>
            )}
          </View>

          {status !== "idle" && (
            <View style={styles.statusRow}>
              {status === "testing" && <ActivityIndicator size="small" color={colors.primary} />}
              {status === "success" && <CheckCircle2 size={20} color="#10b981" />}
              {status === "error" && <AlertCircle size={20} color="#ef4444" />}
              <Text
                style={[
                  styles.statusText,
                  {
                    color:
                      status === "success"
                        ? "#10b981"
                        : status === "error"
                          ? "#ef4444"
                          : colors.mutedForeground,
                  },
                ]}
              >
                {status === "testing"
                  ? t("common.testing", "Testing...")
                  : status === "success"
                    ? t("common.success", "Success!")
                    : t("common.failed", "Failed")}
              </Text>
            </View>
          )}

          <Pressable
            onPress={testConnection}
            style={[styles.testBtn, { borderColor: colors.primary }]}
          >
            <Text style={[styles.testBtnText, { color: colors.primary }]}>
              {t("onboarding.ai.test", "Test Connection")}
            </Text>
          </Pressable>
        </KeyboardAwareScrollView>

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
              onPress={() => navigation.navigate("Embedding")}
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
    fontSize: 14,
    fontWeight: "600",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  providerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  providerCard: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, borderWidth: 2 },
  providerCardActive: {
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  providerText: { fontSize: 14, fontWeight: "600" },
  input: { padding: 16, borderRadius: 12, borderWidth: 2, fontSize: 16 },
  baseUrlHint: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 2,
  },
  inputWithIcon: {
    flex: 1,
    padding: 16,
    fontSize: 16,
  },
  eyeIcon: {
    padding: 16,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  statusText: { fontSize: 14, fontWeight: "500" },
  testBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
  },
  testBtnText: { fontSize: 14, fontWeight: "600" },
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
