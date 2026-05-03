import { useSettingsStore } from "@/stores";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import type { AIEndpoint } from "@readany/core/types";
import { getDefaultBaseUrl, PROVIDER_CONFIGS } from "@readany/core/utils";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MinusIcon, PlusIcon } from "../../components/ui/Icon";
import { useColors } from "../../styles/theme";
import { fontSize, fontWeight, spacing } from "../../styles/theme";
import { ConfigTransfer } from "../../components/settings/ConfigTransfer";
import { SettingsHeader } from "./SettingsHeader";
import { EndpointEditor } from "./ai/EndpointEditor";
import { makeStyles } from "./ai/ai-settings-styles";

export default function AISettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();
  const layout = useResponsiveLayout();
  const {
    aiConfig,
    addEndpoint,
    updateEndpoint,
    removeEndpoint,
    setActiveEndpoint,
    setActiveModel,
    updateAIConfig,
    fetchModels,
  } = useSettingsStore();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const handleAddEndpoint = useCallback(async () => {
    const defaultProvider = "openai";
    const config = PROVIDER_CONFIGS[defaultProvider];
    const defaultBaseUrl = getDefaultBaseUrl(defaultProvider);
    await addEndpoint({
      id: `${Date.now()}`,
      name: config?.name || "OpenAI",
      provider: defaultProvider,
      apiKey: "",
      baseUrl: defaultBaseUrl,
      useExactRequestUrl: false,
      models: [],
      modelsFetched: false,
    });
  }, [addEndpoint]);

  const handleFetchModels = useCallback(
    async (ep: AIEndpoint) => {
      setFetchError(null);
      await updateEndpoint(ep.id, {
        name: ep.name,
        apiKey: ep.apiKey,
        baseUrl: ep.baseUrl,
        useExactRequestUrl: ep.useExactRequestUrl,
        modelsFetching: true,
      });
      try {
        const models = await fetchModels(ep.id);
        if (models.length > 0 && !aiConfig.activeModel) {
          setActiveEndpoint(ep.id);
          setActiveModel(models[0]);
        } else if (models.length === 0) {
          const message =
            "No models returned. Check your API key, model access, and whether the base URL points to the API root.";
          setFetchError(message);
          Alert.alert(t("common.failed", "失败"), message);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch models";
        console.error("Failed to fetch models:", err);
        setFetchError(message);
        Alert.alert(t("common.failed", "失败"), message);
      }
    },
    [fetchModels, updateEndpoint, aiConfig.activeModel, setActiveEndpoint, setActiveModel, t],
  );

  const addButton = (
    <TouchableOpacity style={styles.addBtn} onPress={handleAddEndpoint} activeOpacity={0.8}>
      <PlusIcon size={14} color={colors.primaryForeground} />
      <Text style={styles.addBtnText}>{t("common.add", "添加")}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <SettingsHeader
        title={t("settings.ai_title", "AI 设置")}
        subtitle={t("settings.realtimeHint")}
        right={addButton}
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
          showsVerticalScrollIndicator={true}
          alwaysBounceVertical={false}
          scrollEventThrottle={16}
          overScrollMode="never"
          bounces={true}
        >
          <View style={[styles.contentColumn, { width: "100%", maxWidth: layout.centeredContentWidth }]}>
            {/* Endpoints */}
            <View style={styles.endpointList}>
              {aiConfig.endpoints.map((ep) => {
                const isActive = ep.id === aiConfig.activeEndpointId;
                const isExpanded = expandedId === ep.id;
                return (
                  <View key={ep.id} style={[styles.endpointCard, isActive && styles.endpointCardActive]}>
                    <TouchableOpacity
                      style={styles.endpointHeader}
                      onPress={() => setExpandedId(isExpanded ? null : ep.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.endpointInfo}>
                        <View style={styles.endpointNameRow}>
                          <Text style={styles.endpointName}>{ep.name || t("common.unnamed", "未命名")}</Text>
                          {isActive && (
                            <View style={styles.currentBadge}>
                              <Text style={styles.currentBadgeText}>{t("common.current", "当前")}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.endpointProvider}>{ep.provider}</Text>
                      </View>
                      <Text style={styles.chevron}>{isExpanded ? "▲" : "▼"}</Text>
                    </TouchableOpacity>

                    {isExpanded && (
                      <EndpointEditor
                        ep={ep}
                        isActive={isActive}
                        onUpdate={updateEndpoint}
                        onDelete={removeEndpoint}
                        onFetchModels={handleFetchModels}
                        aiConfig={aiConfig}
                        setActiveEndpoint={setActiveEndpoint}
                        setActiveModel={setActiveModel}
                        colors={colors}
                        t={t}
                      />
                    )}
                  </View>
                );
              })}
            </View>

            {fetchError ? <Text style={styles.errorText}>{fetchError}</Text> : null}

            {/* Global Settings */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>{t("settings.ai_globalParams", "全局参数")}</Text>

              <View style={styles.paramRow}>
                <Text style={styles.paramLabel}>Temperature</Text>
                <View style={styles.stepperContainer}>
                  <TouchableOpacity style={styles.stepperBtn} activeOpacity={0.7}
                    onPress={() => updateAIConfig({ temperature: Math.round(Math.max(0, aiConfig.temperature - 0.1) * 10) / 10 })}>
                    <MinusIcon size={16} color={colors.foreground} />
                  </TouchableOpacity>
                  <TextInput
                    style={styles.stepperInput}
                    value={String(aiConfig.temperature)}
                    onChangeText={(v) => { const n = Number.parseFloat(v); if (!Number.isNaN(n) && n >= 0 && n <= 1) updateAIConfig({ temperature: n }); }}
                    keyboardType="decimal-pad"
                    placeholder="0.0 - 1.0"
                    textAlign="center"
                  />
                  <TouchableOpacity style={styles.stepperBtn} activeOpacity={0.7}
                    onPress={() => updateAIConfig({ temperature: Math.round(Math.min(1, aiConfig.temperature + 0.1) * 10) / 10 })}>
                    <PlusIcon size={16} color={colors.foreground} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={[styles.paramRow, { marginTop: spacing.md }]}>
                <Text style={styles.paramLabel}>Max Tokens</Text>
                <View style={styles.stepperContainer}>
                  <TouchableOpacity style={styles.stepperBtn} activeOpacity={0.7}
                    onPress={() => updateAIConfig({ maxTokens: Math.max(256, aiConfig.maxTokens - 256) })}>
                    <MinusIcon size={16} color={colors.foreground} />
                  </TouchableOpacity>
                  <TextInput
                    style={styles.stepperInput}
                    value={String(aiConfig.maxTokens)}
                    onChangeText={(v) => { const n = Number.parseInt(v, 10); if (!Number.isNaN(n) && n > 0) updateAIConfig({ maxTokens: n }); }}
                    keyboardType="number-pad"
                    textAlign="center"
                  />
                  <TouchableOpacity style={styles.stepperBtn} activeOpacity={0.7}
                    onPress={() => updateAIConfig({ maxTokens: Math.min(32768, aiConfig.maxTokens + 256) })}>
                    <PlusIcon size={16} color={colors.foreground} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={[styles.paramRow, { marginTop: spacing.md }]}>
                <Text style={styles.paramLabel}>{t("settings.ai_slidingWindow", "上下文窗口")}</Text>
                <View style={styles.stepperContainer}>
                  <TouchableOpacity style={styles.stepperBtn} activeOpacity={0.7}
                    onPress={() => updateAIConfig({ slidingWindowSize: Math.max(1, aiConfig.slidingWindowSize - 1) })}>
                    <MinusIcon size={16} color={colors.foreground} />
                  </TouchableOpacity>
                  <TextInput
                    style={styles.stepperInput}
                    value={String(aiConfig.slidingWindowSize)}
                    onChangeText={(v) => { const n = Number.parseInt(v, 10); if (!Number.isNaN(n) && n > 0) updateAIConfig({ slidingWindowSize: n }); }}
                    keyboardType="number-pad"
                    textAlign="center"
                  />
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    activeOpacity={0.7}
                    onPress={() => updateAIConfig({ slidingWindowSize: Math.min(100, aiConfig.slidingWindowSize + 1) })}
                  >
                    <PlusIcon size={16} color={colors.foreground} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Transfer */}
            <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
              <Text style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground }}>
                {t("settings.transferConfig", "配置迁移")}
              </Text>
              <ConfigTransfer
                label={t("settings.aiConfig", "AI 配置")}
                getData={() => aiConfig}
                applyData={(data) => {
                  const d = data as Record<string, unknown>;
                  if (d && typeof d === "object") {
                    useSettingsStore.setState((s) => ({
                      aiConfig: { ...s.aiConfig, ...(d as Partial<typeof s.aiConfig>) },
                    }));
                  }
                }}
                validate={(d) =>
                  typeof d === "object" && d !== null && "endpoints" in d && Array.isArray((d as Record<string, unknown>).endpoints)
                }
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
