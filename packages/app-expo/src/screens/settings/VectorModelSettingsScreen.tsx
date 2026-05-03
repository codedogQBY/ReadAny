import {
  ChevronLeftIcon,
  EditIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { ConfigTransfer } from "../../components/settings/ConfigTransfer";
import { useVectorModelStore } from "@/stores/vector-model-store";
import { type ThemeColors, fontSize, fontWeight, radius, useColors, withOpacity } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { VectorModelConfig } from "@readany/core/types";
/**
 * VectorModelSettingsScreen — Mobile version only supports remote embedding APIs.
 * Local embedding is not supported to reduce APK size by ~100MB.
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PasswordInput } from "../../components/ui/PasswordInput";

export default function VectorModelSettingsScreen() {
  const colors = useColors();
  const s = makeStyles(colors);
  const nav = useNavigation();
  const { t } = useTranslation();
  const layout = useResponsiveLayout();
  const {
    vectorModelEnabled,
    setVectorModelEnabled,
  } = useVectorModelStore();

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
      {/* Header */}
      <View style={s.header}>
        <View style={[s.headerInner, { maxWidth: layout.centeredContentWidth }]}>
          <TouchableOpacity style={s.backBtn} onPress={() => nav.goBack()}>
            <ChevronLeftIcon size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{t("settings.vm_title", "向量模型")}</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={s.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={s.scrollView}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={{ width: "100%", maxWidth: layout.centeredContentWidth }}>
            {/* Enable switch */}
            <View style={s.section}>
              <View style={s.enableCard}>
                <View style={s.enableInfo}>
                  <Text style={s.enableTitle}>{t("settings.vm_title", "向量模型")}</Text>
                  <Text style={s.enableDesc}>{t("settings.vm_desc", "启用向量搜索和知识检索")}</Text>
                </View>
                <Switch
                  value={vectorModelEnabled}
                  onValueChange={setVectorModelEnabled}
                  trackColor={{ false: colors.muted, true: colors.primary }}
                  thumbColor={colors.card}
                />
              </View>
            </View>

            {vectorModelEnabled && <RemoteModelsSection />}

            {/* Transfer */}
            <View style={{ marginTop: 16 }}>
              <Text style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground, marginBottom: 8 }}>
                {t("settings.transferConfig", "配置迁移")}
              </Text>
              <ConfigTransfer
                label={t("settings.vectorConfig", "向量化配置")}
                getData={() => {
                  const state = useVectorModelStore.getState();
                  return {
                    vectorModels: state.vectorModels,
                    selectedVectorModelId: state.selectedVectorModelId,
                    vectorModelEnabled: state.vectorModelEnabled,
                    vectorModelMode: state.vectorModelMode,
                    selectedBuiltinModelId: state.selectedBuiltinModelId,
                  };
                }}
                applyData={(data) => {
                  const d = data as Record<string, unknown>;
                  const store = useVectorModelStore.getState();
                  if (Array.isArray(d.vectorModels)) {
                    for (const m of store.vectorModels) store.deleteVectorModel(m.id);
                    for (const m of d.vectorModels as VectorModelConfig[]) store.addVectorModel(m);
                  }
                  if (d.selectedVectorModelId) store.setSelectedVectorModelId(d.selectedVectorModelId as string);
                  if (typeof d.vectorModelEnabled === "boolean") store.setVectorModelEnabled(d.vectorModelEnabled);
                  if (d.vectorModelMode === "remote" || d.vectorModelMode === "builtin") store.setVectorModelMode(d.vectorModelMode);
                  if (d.selectedBuiltinModelId) store.setSelectedBuiltinModelId(d.selectedBuiltinModelId as string);
                }}
                validate={(d) => typeof d === "object" && d !== null && "vectorModels" in d}
              />
            </View>

            <View style={{ height: 24 }} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RemoteModelsSection() {
  const colors = useColors();
  const s = makeStyles(colors);
  const { t } = useTranslation();
  const {
    vectorModels,
    selectedVectorModelId,
    addVectorModel,
    updateVectorModel,
    deleteVectorModel,
    setSelectedVectorModelId,
    setVectorModelMode,
  } = useVectorModelStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formModelId, setFormModelId] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formDesc, setFormDesc] = useState("");

  const resetForm = useCallback(() => {
    setFormName("");
    setFormUrl("");
    setFormModelId("");
    setFormApiKey("");
    setFormDesc("");
    setShowAddForm(false);
    setEditingId(null);
  }, []);

  const handleAdd = useCallback(() => {
    if (!formName.trim() || !formUrl.trim() || !formModelId.trim()) return;
    const newModel: VectorModelConfig = {
      id: `vm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: formName.trim(),
      url: formUrl.trim(),
      modelId: formModelId.trim(),
      apiKey: formApiKey.trim(),
      description: formDesc.trim(),
    };
    addVectorModel(newModel);
    resetForm();
  }, [formName, formUrl, formModelId, formApiKey, formDesc, addVectorModel, resetForm]);

  const startEdit = useCallback((model: VectorModelConfig) => {
    setFormName(model.name);
    setFormUrl(model.url);
    setFormModelId(model.modelId);
    setFormApiKey(model.apiKey);
    setFormDesc(model.description || "");
    setEditingId(model.id);
    setShowAddForm(false);
  }, []);

  const handleEdit = useCallback(() => {
    if (!editingId || !formName.trim() || !formUrl.trim() || !formModelId.trim()) return;
    updateVectorModel(editingId, {
      name: formName.trim(),
      url: formUrl.trim(),
      modelId: formModelId.trim(),
      apiKey: formApiKey.trim(),
      description: formDesc.trim(),
    });
    resetForm();
  }, [
    editingId,
    formName,
    formUrl,
    formModelId,
    formApiKey,
    formDesc,
    updateVectorModel,
    resetForm,
  ]);

  return (
    <View style={s.section}>
      <View style={s.remoteTitleRow}>
        <View>
          <Text style={s.sectionTitle}>{t("settings.vm_remoteModels", "远程模型")}</Text>
          <Text style={s.sectionDesc}>
            {t("settings.vm_remoteDesc", "通过 API 调用的嵌入模型")}
          </Text>
        </View>
        {!showAddForm && !editingId && (
          <TouchableOpacity
            style={s.addModelBtn}
            onPress={() => {
              setShowAddForm(true);
              setEditingId(null);
            }}
          >
            <PlusIcon size={12} color={colors.foreground} />
            <Text style={s.addModelText}>{t("settings.vm_addModel", "添加模型")}</Text>
          </TouchableOpacity>
        )}
      </View>

      {vectorModels.length === 0 && !showAddForm && !editingId && (
        <Text style={s.noModels}>{t("settings.vm_noRemoteModels", "暂无远程模型")}</Text>
      )}

      {vectorModels.map((model) => (
        <View
          key={model.id}
          style={[s.modelCard, selectedVectorModelId === model.id && s.modelCardActive]}
        >
          <View style={s.modelCardTop}>
            <View style={s.modelInfo}>
              <Text style={s.modelName}>{model.name}</Text>
              <Text style={s.modelSize}>{model.modelId}</Text>
            </View>
            <Switch
              value={selectedVectorModelId === model.id}
              onValueChange={(v) => {
                if (v) {
                  setSelectedVectorModelId(model.id);
                  setVectorModelMode("remote");
                } else {
                  setSelectedVectorModelId(null);
                }
              }}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.card}
            />
          </View>
          {model.url ? (
            <Text style={s.modelDesc} numberOfLines={1}>
              {model.url}
            </Text>
          ) : null}
          <View style={s.remoteActions}>
            <TouchableOpacity style={s.iconBtn} onPress={() => startEdit(model)}>
              <EditIcon size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity style={s.iconBtn} onPress={() => deleteVectorModel(model.id)}>
              <Trash2Icon size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {/* Add/Edit form */}
      {(showAddForm || editingId) && (
        <View style={s.formCard}>
          <View style={s.formHeader}>
            <Text style={s.formTitle}>
              {editingId
                ? t("settings.vm_editModel", "编辑模型")
                : t("settings.vm_addModelTitle", "添加模型")}
            </Text>
            <TouchableOpacity onPress={resetForm}>
              <XIcon size={16} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <Text style={s.fieldLabel}>{t("settings.vm_name", "名称")} *</Text>
          <TextInput
            style={s.fieldInput}
            value={formName}
            onChangeText={setFormName}
            placeholder="OpenAI Embedding"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={s.fieldLabel}>{t("settings.vm_modelId", "模型 ID")} *</Text>
          <TextInput
            style={s.fieldInput}
            value={formModelId}
            onChangeText={setFormModelId}
            placeholder="text-embedding-3-small"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={s.fieldLabel}>{t("settings.vm_url", "URL")} *</Text>
          <TextInput
            style={s.fieldInput}
            value={formUrl}
            onChangeText={setFormUrl}
            placeholder="https://api.openai.com/v1/embeddings"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={s.fieldLabel}>{t("settings.vm_apiKey", "API Key")}</Text>
          <PasswordInput
            style={s.fieldInput}
            value={formApiKey}
            onChangeText={setFormApiKey}
            placeholder="sk-..."
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={s.fieldLabel}>{t("settings.vm_description", "描述")}</Text>
          <TextInput
            style={s.fieldInput}
            value={formDesc}
            onChangeText={setFormDesc}
            placeholderTextColor={colors.mutedForeground}
          />

          <View style={s.formActions}>
            <TouchableOpacity style={s.formCancelBtn} onPress={resetForm}>
              <Text style={s.formCancelText}>{t("common.cancel", "取消")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                s.formSaveBtn,
                (!formName.trim() || !formUrl.trim() || !formModelId.trim()) &&
                  s.formSaveBtnDisabled,
              ]}
              onPress={editingId ? handleEdit : handleAdd}
              disabled={!formName.trim() || !formUrl.trim() || !formModelId.trim()}
            >
              <Text style={s.formSaveText}>
                {editingId ? t("common.save", "保存") : t("settings.vm_addModel", "添加模型")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    keyboardView: { flex: 1 },
    header: {
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    headerInner: {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    backBtn: { padding: 4 },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    scrollView: { flex: 1 },
    scrollContent: {
      paddingTop: 24,
      paddingBottom: 48,
      alignItems: "center",
    },
    section: { paddingHorizontal: 16, paddingTop: 16 },
    sectionTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    sectionDesc: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginTop: 2,
      marginBottom: 12,
    },
    // Enable card
    enableCard: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 16,
    },
    enableInfo: { flex: 1, marginRight: 12 },
    enableTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },
    enableDesc: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },
    // Mode
    modeTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
      marginBottom: 8,
    },
    modeRow: { flexDirection: "row", gap: 8 },
    modeCard: {
      flex: 1,
      borderWidth: 0.5,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      padding: 12,
    },
    modeCardActive: { borderColor: colors.primary, backgroundColor: colors.accent },
    modeCardTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    modeCardDesc: { fontSize: 11, color: colors.mutedForeground, marginTop: 2 },
    // Model card
    modelCard: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 8,
    },
    modelCardActive: { borderColor: colors.primary, backgroundColor: colors.accent },
    modelCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    cardActions: { alignItems: "flex-end", justifyContent: "center" },
    iconBtn: { padding: 4 },
    modelNameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
    modelName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },
    modelSize: { fontSize: 11, color: colors.mutedForeground },
    modelBadges: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
    recommendBadge: {
      backgroundColor: colors.muted,
      borderRadius: radius.sm,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    recommendText: { fontSize: 10, fontWeight: fontWeight.medium, color: colors.primary },
    readyBadge: { flexDirection: "row", alignItems: "center", gap: 2 },
    readyText: { fontSize: 10, color: colors.emerald },
    modelDesc: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 6 },
    downloadingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    downloadingText: { fontSize: fontSize.xs, color: colors.mutedForeground },
    readyActions: { flexDirection: "row", alignItems: "center", gap: 10 },
    clearBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.md,
      borderWidth: 0.5,
      borderColor: colors.border,
    },
    clearBtnText: { fontSize: 11, color: colors.mutedForeground },
    downloadBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: radius.md,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    downloadBtnText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },
    modelInfo: { flex: 1, minWidth: 0 },
    // Remote
    desktopOnlyNotice: {
      backgroundColor: withOpacity(colors.primary, 0.08),
      borderRadius: radius.md,
      padding: 10,
      marginBottom: 4,
    },
    desktopOnlyText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      lineHeight: 18,
    },
    remoteTitleRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    addModelBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderWidth: 0.5,
      borderColor: colors.border,
      borderRadius: radius.lg,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    addModelText: { fontSize: fontSize.xs, color: colors.foreground },
    noModels: {
      textAlign: "center",
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      paddingVertical: 24,
    },
    remoteActions: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
    // Form
    formCard: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 16,
      marginTop: 12,
    },
    formHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    formTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },
    fieldLabel: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginBottom: 4,
      marginTop: 12,
    },
    fieldInput: {
      height: 36,
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    formActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 },
    formCancelBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.lg,
      borderWidth: 0.5,
      borderColor: colors.border,
    },
    formCancelText: { fontSize: fontSize.xs, color: colors.foreground },
    formSaveBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
    },
    formSaveBtnDisabled: { opacity: 0.5 },
    formSaveText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
  });
