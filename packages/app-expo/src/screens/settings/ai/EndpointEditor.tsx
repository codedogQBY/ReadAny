import { getAIEndpointRequestPreview, testAIEndpoint } from "@readany/core/ai";
import { getPlatformService } from "@readany/core/services";
import type { AIEndpoint, AIProviderType } from "@readany/core/types";
import {
  getDefaultBaseUrl,
  PROVIDER_CONFIGS,
  providerRequiresApiKey,
  providerSupportsExactRequestUrl,
} from "@readany/core/utils";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LoaderIcon, Trash2Icon, XIcon } from "../../../components/ui/Icon";
import { PasswordInput } from "../../../components/ui/PasswordInput";
import type { ThemeColors } from "../../../styles/theme";
import { makeStyles } from "./ai-settings-styles";

const PROVIDERS: { id: AIProviderType; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "atlascloud", label: "Atlas Cloud" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google", label: "Google Gemini" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "ollama", label: "Ollama" },
  { id: "lmstudio", label: "LM Studio" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "siliconflow", label: "SiliconFlow" },
  { id: "moonshot", label: "Moonshot" },
  { id: "zhipu", label: "智谱 GLM" },
  { id: "aliyun", label: "阿里云通义" },
  { id: "custom", label: "Custom" },
];

export { PROVIDERS };

/** Searchable model list — shows a search input + scrollable filtered list */
function ModelSearchableList({
  models,
  activeModel,
  onSelect,
  onRemove,
  colors,
  t,
}: {
  models: string[];
  activeModel?: string;
  onSelect: (model: string) => void;
  onRemove: (model: string) => void;
  colors: any;
  t: any;
}) {
  const [search, setSearch] = useState("");
  const filtered = search.trim()
    ? models.filter((m) => m.toLowerCase().includes(search.toLowerCase()))
    : models;

  return (
    <View style={{ gap: 6 }}>
      {activeModel && models.includes(activeModel) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 }}>
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{t("settings.ai_activeModel", "当前模型")}:</Text>
          <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>{activeModel}</Text>
        </View>
      )}
      <TextInput
        style={{
          height: 32,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 6,
          paddingHorizontal: 10,
          fontSize: 12,
          color: colors.foreground,
          backgroundColor: colors.background,
        }}
        placeholder={t("settings.ai_searchModelPlaceholder", "搜索模型...")}
        placeholderTextColor={colors.mutedForeground}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <ScrollView
        style={{ maxHeight: 160, borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.background }}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {filtered.length === 0 ? (
          <Text style={{ padding: 12, fontSize: 12, color: colors.mutedForeground, textAlign: "center" }}>
            {t("common.noResults", "无匹配结果")}
          </Text>
        ) : (
          filtered.map((m) => {
            const isActive = m === activeModel;
            return (
              <TouchableOpacity
                key={m}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderBottomWidth: 0.5,
                  borderBottomColor: colors.border,
                  backgroundColor: isActive ? `${colors.primary}10` : "transparent",
                }}
                onPress={() => onSelect(m)}
                activeOpacity={0.7}
              >
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: isActive ? colors.primary : colors.foreground,
                    fontWeight: isActive ? "600" : "400",
                  }}
                  numberOfLines={1}
                >
                  {m}
                </Text>
                <TouchableOpacity
                  onPress={() => onRemove(m)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <XIcon size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
      <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
        {t("settings.ai_modelsCount", "共 {{count}} 个模型", { count: models.length })}
      </Text>
    </View>
  );
}

export function EndpointEditor({
  ep,
  isActive,
  onUpdate,
  onDelete,
  onFetchModels,
  aiConfig,
  setActiveEndpoint,
  setActiveModel,
  colors,
  t,
}: {
  ep: AIEndpoint;
  isActive: boolean;
  onUpdate: (id: string, updates: Partial<AIEndpoint>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onFetchModels: (ep: AIEndpoint) => Promise<void>;
  aiConfig: { activeModel: string; activeEndpointId: string };
  setActiveEndpoint: (id: string) => void;
  setActiveModel: (model: string) => void;
  colors: ThemeColors;
  t: TFunction;
}) {
  const styles = makeStyles(colors);
  const [name, setName] = useState(ep.name);
  const [apiKey, setApiKey] = useState(ep.apiKey);
  const [baseUrl, setBaseUrl] = useState(ep.baseUrl);
  const [useExactRequestUrl, setUseExactRequestUrl] = useState(!!ep.useExactRequestUrl);
  const [newModelInput, setNewModelInput] = useState("");
  const [testModel, setTestModel] = useState("__auto__");
  const [testState, setTestState] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  const epRef = useRef(ep);
  epRef.current = ep;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const stateRef = useRef({ name, apiKey, baseUrl, useExactRequestUrl });
  stateRef.current = { name, apiKey, baseUrl, useExactRequestUrl };

  useEffect(() => {
    return () => {
      const current = epRef.current;
      const update = onUpdateRef.current;
      const state = stateRef.current;
      if (
        state.name !== current.name ||
        state.apiKey !== current.apiKey ||
        state.baseUrl !== current.baseUrl ||
        state.useExactRequestUrl !== !!current.useExactRequestUrl
      ) {
        update(current.id, {
          name: state.name,
          apiKey: state.apiKey,
          baseUrl: state.baseUrl,
          useExactRequestUrl: state.useExactRequestUrl,
        }).catch(console.error);
      }
    };
  }, []);

  useEffect(() => {
    if (testModel !== "__auto__" && !ep.models.includes(testModel)) {
      setTestModel("__auto__");
    }
  }, [ep.models, testModel]);

  const currentEndpoint = useMemo(
    () => ({ ...ep, name, apiKey, baseUrl, useExactRequestUrl }),
    [apiKey, baseUrl, ep, name, useExactRequestUrl],
  );

  const supportsExactRequestUrl = providerSupportsExactRequestUrl(ep.provider);
  const exactRequestUrlEnabled = supportsExactRequestUrl && useExactRequestUrl;

  const requestPreview = useMemo(
    () => getAIEndpointRequestPreview(currentEndpoint, testModel === "__auto__" ? undefined : testModel),
    [currentEndpoint, testModel],
  );

  const handleCopyRequestPreview = useCallback(async () => {
    if (!requestPreview) return;
    try {
      await getPlatformService().copyToClipboard(requestPreview);
      Alert.alert(t("common.success", "成功！"), t("notes.copiedToClipboard", "已复制到剪贴板"));
    } catch (error) {
      Alert.alert(t("common.failed", "失败"), error instanceof Error ? error.message : t("common.failed", "失败"));
    }
  }, [requestPreview, t]);

  const handleAddModel = useCallback(() => {
    const trimmed = newModelInput.trim();
    if (!trimmed || ep.models.includes(trimmed)) return;
    onUpdate(ep.id, { models: [...ep.models, trimmed] }).catch(console.error);
    setNewModelInput("");
  }, [newModelInput, ep.models, ep.id, onUpdate]);

  const handleTestConnection = useCallback(async () => {
    setTestState("testing");
    setTestMessage("");
    try {
      await onUpdate(ep.id, { name, apiKey, baseUrl, useExactRequestUrl });
      const result = await testAIEndpoint(currentEndpoint, {
        model: testModel === "__auto__" ? undefined : testModel,
      });
      setTestState("success");
      setTestMessage(
        result.testedModel
          ? t("settings.ai_testSuccessWithModel", { model: result.testedModel })
          : result.modelCount && result.modelCount > 0
            ? t("settings.ai_testSuccessWithModels", { count: result.modelCount })
            : t("settings.ai_testSuccess"),
      );
    } catch (err) {
      setTestState("error");
      setTestMessage(err instanceof Error ? err.message : t("settings.ai_testFailed"));
    }
  }, [apiKey, baseUrl, currentEndpoint, ep.id, name, onUpdate, t, testModel, useExactRequestUrl]);

  return (
    <View style={styles.expandedContent}>
      <TouchableOpacity style={styles.row} onPress={() => setActiveEndpoint(ep.id)}>
        <Text style={styles.label}>{t("settings.ai_setDefault", "设为默认")}</Text>
        <View style={[styles.toggle, isActive && styles.toggleActive]}>
          <View style={[styles.toggleThumb, isActive && styles.toggleThumbActive]} />
        </View>
      </TouchableOpacity>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>{t("settings.ai_name", "名称")}</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          onBlur={() => { if (name !== ep.name) onUpdate(ep.id, { name }).catch(console.error); }}
          placeholderTextColor={colors.mutedForeground}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>{t("settings.ai_providerLabel", "提供商")}</Text>
        <View style={styles.providerGrid}>
          {PROVIDERS.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.providerBtn, ep.provider === p.id && styles.providerBtnActive]}
              onPress={() => {
                const config = PROVIDER_CONFIGS[p.id];
                const defaultBaseUrl = getDefaultBaseUrl(p.id);
                onUpdate(ep.id, {
                  provider: p.id,
                  baseUrl: defaultBaseUrl,
                  useExactRequestUrl: false,
                  name: config?.name || p.label,
                  models: [],
                  modelsFetched: false,
                }).catch(console.error);
                setBaseUrl(defaultBaseUrl);
                setUseExactRequestUrl(false);
                setName(config?.name || p.label);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.providerBtnText, ep.provider === p.id && styles.providerBtnTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>{t("settings.ai_apiKey", "API Key")}</Text>
        <PasswordInput
          style={styles.input}
          value={apiKey}
          onChangeText={setApiKey}
          onBlur={() => { if (apiKey !== ep.apiKey) onUpdate(ep.id, { apiKey }).catch(console.error); }}
          placeholder="sk-..."
          placeholderTextColor={colors.mutedForeground}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {exactRequestUrlEnabled
            ? t("settings.ai_exactRequestUrlLabel", "完整请求地址")
            : t("settings.ai_baseUrl", "Base URL")}
        </Text>
        <TextInput
          style={styles.input}
          value={baseUrl}
          onChangeText={setBaseUrl}
          onBlur={() => { if (baseUrl !== ep.baseUrl) onUpdate(ep.id, { baseUrl }).catch(console.error); }}
          placeholderTextColor={colors.mutedForeground}
          placeholder={PROVIDER_CONFIGS[ep.provider || "openai"]?.placeholder || "https://api.example.com"}
          autoCapitalize="none"
        />
        {supportsExactRequestUrl && (
          <View style={styles.exactUrlCard}>
            <View style={styles.exactUrlInfo}>
              <Text style={styles.fieldLabel}>{t("settings.ai_exactRequestUrl", "完全自定义请求地址")}</Text>
              <Text style={styles.baseUrlHint}>{t("settings.ai_exactRequestUrlDesc", "启用后将按你填写的地址原样请求，不再自动追加 /v1、/chat/completions 或 /models。")}</Text>
            </View>
            <Switch
              value={exactRequestUrlEnabled}
              onValueChange={(value) => {
                setUseExactRequestUrl(value);
                onUpdate(ep.id, { useExactRequestUrl: value }).catch(console.error);
              }}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.card}
            />
          </View>
        )}
        {!exactRequestUrlEnabled && PROVIDER_CONFIGS[ep.provider]?.needsV1Suffix && (
          <Text style={styles.baseUrlHint}>{t("settings.ai_baseUrlHint", "OpenAI-compatible endpoints append /v1 by default.")}</Text>
        )}
        <View style={styles.previewCard}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewLabel}>{t("settings.ai_requestUrlPreview", "最终请求地址")}</Text>
            <TouchableOpacity style={styles.previewCopyButton} onPress={handleCopyRequestPreview} activeOpacity={0.8} disabled={!requestPreview}>
              <Text style={styles.previewCopyButtonText}>{t("common.copy", "复制")}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.previewValue}>{requestPreview || "—"}</Text>
          <Text style={styles.previewLabel}>{t("settings.ai_testModel", "测试模型")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <TouchableOpacity
              style={[styles.testModelChip, testModel === "__auto__" && styles.testModelChipActive]}
              onPress={() => setTestModel("__auto__")}
              activeOpacity={0.8}
            >
              <Text style={[styles.testModelChipText, testModel === "__auto__" && styles.testModelChipTextActive]}>
                {t("settings.ai_testModelAuto", "自动")}
              </Text>
            </TouchableOpacity>
            {testModel !== "__auto__" && (
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "500" }}>{testModel}</Text>
            )}
          </View>
          {ep.models.length > 0 && (
            <ModelSearchableList
              models={ep.models}
              activeModel={testModel === "__auto__" ? undefined : testModel}
              onSelect={(m) => setTestModel(m)}
              onRemove={(m) => onUpdate(ep.id, { models: ep.models.filter((x) => x !== m) }).catch(console.error)}
              colors={colors}
              t={t}
            />
          )}
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <View style={styles.modelsHeader}>
          <Text style={styles.fieldLabel}>{t("settings.ai_modelsList", "模型列表")}</Text>
          <View style={styles.modelsActions}>
            <TouchableOpacity
              style={styles.fetchBtn}
              onPress={() => onFetchModels({ ...ep, name, apiKey, baseUrl, useExactRequestUrl })}
              disabled={exactRequestUrlEnabled || !!ep.modelsFetching || (providerRequiresApiKey(ep.provider) && !apiKey.trim())}
            >
              {ep.modelsFetching ? <LoaderIcon size={12} color={colors.primary} /> : (
                <Text style={styles.fetchBtnText}>{t("settings.ai_fetchModels", "获取模型")}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.fetchBtn} onPress={handleTestConnection} disabled={testState === "testing"}>
              {testState === "testing" ? <LoaderIcon size={12} color={colors.primary} /> : (
                <Text style={styles.fetchBtnText}>{t("settings.ai_testConnection", "测试连接")}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
        {exactRequestUrlEnabled && (
          <Text style={styles.endpointTestResult}>{t("settings.ai_exactRequestUrlFetchHint", "完全自定义请求地址模式下无法自动推断模型列表地址，请手动添加模型后再测试。")}</Text>
        )}
        {testState !== "idle" && !!testMessage && (
          <Text style={[styles.endpointTestResult, testState === "success" ? styles.endpointTestSuccess : styles.endpointTestError]}>
            {testMessage}
          </Text>
        )}

        {ep.models.length > 0 && (
          <ModelSearchableList
            models={ep.models}
            activeModel={isActive ? aiConfig.activeModel : undefined}
            onSelect={(m) => { setActiveEndpoint(ep.id); setActiveModel(m); }}
            onRemove={(m) => onUpdate(ep.id, { models: ep.models.filter((x) => x !== m) }).catch(console.error)}
            colors={colors}
            t={t}
          />
        )}

        <View style={styles.addModelRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder={t("settings.ai_addManualModelPlaceholder", "手动添加模型名")}
            placeholderTextColor={colors.mutedForeground}
            value={newModelInput}
            onChangeText={setNewModelInput}
            onSubmitEditing={handleAddModel}
          />
          <TouchableOpacity style={styles.addModelBtn} onPress={handleAddModel} activeOpacity={0.8}>
            <Text style={styles.addModelBtnText}>{t("common.add", "添加")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(ep.id)} activeOpacity={0.8}>
        <Trash2Icon size={14} color={colors.destructive} />
        <Text style={styles.deleteBtnText}>{t("common.delete", "删除")}</Text>
      </TouchableOpacity>
    </View>
  );
}
