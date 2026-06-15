import { DarkModeSvg } from "@/components/DarkModeSvg";
import { KeyboardAwareScrollView } from "@/components/ui/KeyboardAwareScrollView";
import { useVectorModelStore } from "@/stores/vector-model-store";
import { useTheme } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { VectorModelConfig } from "@readany/core/types";
import { normalizeEmbeddingEndpointUrl, testEmbeddingEndpoint } from "@readany/core/utils/api";
import { Check, Cloud, Plus, Trash2, X } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { SlideInRight } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SearchSvg from "../../../../assets/illustrations/search.svg";
import type { OnboardingStackParamList } from "../OnboardingNavigator";

type NavProp = NativeStackNavigationProp<OnboardingStackParamList, "Embedding">;

export function EmbeddingPage() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const {
    vectorModels,
    addVectorModel,
    deleteVectorModel,
    updateVectorModel,
    setSelectedVectorModelId,
  } = useVectorModelStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", url: "", modelId: "", apiKey: "" });
  const [testingId, setTestingId] = useState<string | null>(null);

  const handleAddModel = () => {
    if (!formData.name.trim() || !formData.url.trim() || !formData.modelId.trim()) return;
    const newModel: VectorModelConfig = {
      id: `vm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: formData.name.trim(),
      url: normalizeEmbeddingEndpointUrl(formData.url),
      modelId: formData.modelId.trim(),
      apiKey: formData.apiKey.trim(),
    };
    addVectorModel(newModel);
    setFormData({ name: "", url: "", modelId: "", apiKey: "" });
    setShowAddForm(false);
  };

  const testRemoteModel = async (model: VectorModelConfig) => {
    setTestingId(model.id);
    try {
      const result = await testEmbeddingEndpoint({
        url: model.url,
        modelId: model.modelId,
        apiKey: model.apiKey,
      });
      updateVectorModel(model.id, { dimension: result.dimension, url: result.url });
      setSelectedVectorModelId(model.id);
    } catch (err) {
      console.warn("[Onboarding] Embedding model test failed:", err);
    } finally {
      setTestingId(null);
    }
  };

  const handleNext = () => {
    navigation.navigate("Translation");
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
                <SearchSvg width={140} height={140} />
              </DarkModeSvg>
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t("onboarding.embedding.title", "Smart Search")}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {t(
                "onboarding.embedding.desc",
                "Enable semantic search by configuring an embedding model.",
              )}
            </Text>
          </View>

          <View style={styles.section}>
            <View
              style={[
                styles.modeCard,
                styles.modeCardActive,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.primary,
                },
              ]}
            >
              <View style={[styles.modeIcon, { backgroundColor: "#6366f120" }]}>
                <Cloud size={24} color="#6366f1" />
              </View>
              <View style={styles.modeContent}>
                <Text style={[styles.modeTitle, { color: colors.foreground }]}>
                  {t("onboarding.embedding.remoteMode", "Remote API Mode")}
                </Text>
                <Text style={[styles.modeDesc, { color: colors.mutedForeground }]}>
                  {t("onboarding.embedding.remoteDesc", "Connect to external embedding API.")}
                </Text>
              </View>
              <Check size={20} color={colors.primary} />
            </View>
          </View>

          <View style={styles.remoteSection}>
            {!showAddForm && (
              <Pressable
                style={[styles.addBtn, { borderColor: colors.primary }]}
                onPress={() => setShowAddForm(true)}
              >
                <Plus size={18} color={colors.primary} />
                <Text style={[styles.addBtnText, { color: colors.primary }]}>
                  {t("settings.vm_addModel", "Add Remote Model")}
                </Text>
              </Pressable>
            )}

            {showAddForm && (
              <View
                style={[
                  styles.formCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.formHeader}>
                  <Text style={[styles.formTitle, { color: colors.foreground }]}>
                    {t("settings.vm_addModelTitle", "Add Model")}
                  </Text>
                  <Pressable onPress={() => setShowAddForm(false)}>
                    <X size={18} color={colors.mutedForeground} />
                  </Pressable>
                </View>

                <View style={styles.formField}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                    {t("settings.vm_name", "Name")} *
                  </Text>
                  <TextInput
                    style={[
                      styles.fieldInput,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                    value={formData.name}
                    onChangeText={(text) => setFormData({ ...formData, name: text })}
                    placeholder="OpenAI Embedding"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>

                <View style={styles.formField}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                    {t("settings.vm_modelId", "Model ID")} *
                  </Text>
                  <TextInput
                    style={[
                      styles.fieldInput,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                    value={formData.modelId}
                    onChangeText={(text) => setFormData({ ...formData, modelId: text })}
                    placeholder="text-embedding-3-small"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>

                <View style={styles.formField}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                    {t("settings.vm_url", "URL")} *
                  </Text>
                  <TextInput
                    style={[
                      styles.fieldInput,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                    value={formData.url}
                    onChangeText={(text) => setFormData({ ...formData, url: text })}
                    placeholder="https://api.openai.com/v1"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                  />
                  <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
                    {t("settings.vm_urlHint")}
                  </Text>
                </View>

                <View style={styles.formField}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                    {t("settings.vm_apiKey", "API Key")}
                  </Text>
                  <TextInput
                    style={[
                      styles.fieldInput,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                    value={formData.apiKey}
                    onChangeText={(text) => setFormData({ ...formData, apiKey: text })}
                    placeholder="sk-..."
                    placeholderTextColor={colors.mutedForeground}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                </View>

                <Pressable
                  style={[
                    styles.saveBtn,
                    {
                      backgroundColor: colors.primary,
                      opacity: !formData.name || !formData.url || !formData.modelId ? 0.5 : 1,
                    },
                  ]}
                  onPress={handleAddModel}
                  disabled={!formData.name || !formData.url || !formData.modelId}
                >
                  <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
                    {t("common.save", "Save")}
                  </Text>
                </Pressable>
              </View>
            )}

            {vectorModels.map((m) => (
              <View
                key={m.id}
                style={[
                  styles.modelItem,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.modelItemInfo}>
                  <Text style={[styles.modelItemName, { color: colors.foreground }]}>{m.name}</Text>
                  <Text style={[styles.modelItemMeta, { color: colors.mutedForeground }]}>
                    {m.modelId}
                  </Text>
                </View>
                <View style={styles.modelItemActions}>
                  {testingId === m.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Pressable onPress={() => testRemoteModel(m)} style={styles.testBtnSmall}>
                      <Text style={[styles.testBtnText, { color: colors.primary }]}>
                        {t("settings.vm_test", "Test")}
                      </Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => deleteVectorModel(m.id)}>
                    <Trash2 size={16} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              </View>
            ))}

            {vectorModels.length === 0 && !showAddForm && (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {t("settings.vm_noRemoteModels", "No remote models configured yet.")}
              </Text>
            )}
          </View>
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
            <Pressable onPress={handleNext} style={[styles.skipBtn, { opacity: 0.8 }]}>
              <Text style={[styles.skipText, { color: colors.mutedForeground }]}>
                {t("onboarding.skipForNow", "Skip for now")}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleNext}
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
  scrollContent: { padding: 24, paddingBottom: 0 },
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
  section: { gap: 12 },
  modeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderRadius: 16,
    borderWidth: 2,
  },
  modeCardActive: {
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  modeIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  modeContent: { flex: 1, marginLeft: 16 },
  modeTitle: { fontSize: 16, fontWeight: "600", marginBottom: 2 },
  modeDesc: { fontSize: 13 },
  remoteSection: { marginTop: 24, gap: 12 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    gap: 8,
  },
  addBtnText: { fontSize: 14, fontWeight: "600" },
  formCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    gap: 16,
  },
  formHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  formTitle: { fontSize: 16, fontWeight: "600" },
  formField: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "500" },
  fieldHint: { fontSize: 11, lineHeight: 15 },
  fieldInput: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 14,
  },
  saveBtn: {
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },
  saveBtnText: { fontSize: 14, fontWeight: "600" },
  modelItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  modelItemInfo: { flex: 1 },
  modelItemName: { fontSize: 14, fontWeight: "600" },
  modelItemMeta: { fontSize: 12, marginTop: 2 },
  modelItemActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  testBtnSmall: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  testBtnText: { fontSize: 12, fontWeight: "600" },
  emptyText: { fontSize: 14, textAlign: "center", marginTop: 16 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 16,
    paddingHorizontal: 24,
    borderTopWidth: 1,
  },
  backBtn: { padding: 8 },
  backText: { fontSize: 14, color: "#64748b" },
  rightActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  skipBtn: { paddingVertical: 10 },
  skipText: { fontSize: 14 },
  nextBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  nextText: { fontSize: 14, fontWeight: "600" },
});
