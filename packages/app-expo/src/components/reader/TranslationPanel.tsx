import { CheckIcon, ChevronDownIcon, XIcon } from "@/components/ui/Icon";
import { useSettingsStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, radius, useColors } from "@/styles/theme";
import { TRANSLATOR_LANGS, type TranslationTargetLang } from "@readany/core/types/translation";
import { providerRequiresApiKey } from "@readany/core/utils";
import { buildOpenAICompatibleUrl } from "@readany/core/utils/api";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface TranslationPanelProps {
  text: string;
  onClose: () => void;
}

export function TranslationPanel({ text, onClose }: TranslationPanelProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const s = makeStyles(colors);

  const translationConfig = useSettingsStore((s) => s.translationConfig);
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const updateTranslationConfig = useSettingsStore((s) => s.updateTranslationConfig);

  const [targetLang, setTargetLang] = useState<TranslationTargetLang>(translationConfig.targetLang);
  const [translation, setTranslation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLangPicker, setShowLangPicker] = useState(false);

  const translate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTranslation(null);

    try {
      const { getEndpointById } = useSettingsStore.getState();
      const endpointId = translationConfig.provider.endpointId || aiConfig.activeEndpointId;
      const endpoint = await getEndpointById(endpointId);

      if (!endpoint || (providerRequiresApiKey(endpoint.provider) && !endpoint.apiKey)) {
        throw new Error(t("translation.noApiKey", "请先配置 AI 设置"));
      }

      // Resolve model: translation-specific → global active → first from endpoint
      let model = translationConfig.provider.model || aiConfig.activeModel;
      if (endpoint.models.length > 0) {
        if (!model || !endpoint.models.includes(model)) {
          model = endpoint.models[0];
        }
      }

      const requestUrl = buildOpenAICompatibleUrl(
        endpoint.baseUrl,
        "chat/completions",
        "https://api.openai.com",
        endpoint.useExactRequestUrl || false,
      );
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (endpoint.apiKey) {
        headers.Authorization = `Bearer ${endpoint.apiKey}`;
      }

      const response = await fetch(requestUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a translator. Translate the following text to ${TRANSLATOR_LANGS[targetLang]}. Only output the translation, no explanations.`,
            },
            {
              role: "user",
              content: text.split("\n").join(" ").trim(),
            },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = data.choices?.[0]?.message?.content?.trim();
      if (result) {
        setTranslation(result);
      } else {
        throw new Error(t("translation.noResult", "翻译失败，请重试"));
      }
    } catch (err: any) {
      console.error("[TranslationPanel] Error:", err);
      setError(err.message || t("translation.error", "翻译出错"));
    } finally {
      setLoading(false);
    }
  }, [text, targetLang, translationConfig, aiConfig, t]);

  useEffect(() => {
    translate();
  }, [targetLang]);

  const handleLangChange = useCallback(
    (lang: TranslationTargetLang) => {
      setTargetLang(lang);
      updateTranslationConfig({ targetLang: lang });
      setShowLangPicker(false);
    },
    [updateTranslationConfig],
  );

  const providerName =
    translationConfig.provider.id === "ai"
      ? aiConfig.endpoints.find(
          (e) => e.id === (translationConfig.provider.endpointId || aiConfig.activeEndpointId),
        )?.name || "AI"
      : translationConfig.provider.name;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.container, { paddingBottom: insets.bottom || 16 }]}>
        <View style={s.handle} />

        <View style={s.header}>
          <View style={s.headerLeft}>
            <TouchableOpacity style={s.langBtn} onPress={() => setShowLangPicker(!showLangPicker)}>
              <Text style={s.langBtnText}>{TRANSLATOR_LANGS[targetLang]}</Text>
              <ChevronDownIcon size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
            <Text style={s.providerText}>{providerName}</Text>
          </View>
          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <XIcon size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {showLangPicker && (
          <ScrollView style={s.langPicker} nestedScrollEnabled>
            {(Object.entries(TRANSLATOR_LANGS) as [TranslationTargetLang, string][]).map(
              ([lang, label]) => (
                <TouchableOpacity
                  key={lang}
                  style={[s.langOption, targetLang === lang && s.langOptionActive]}
                  onPress={() => handleLangChange(lang)}
                >
                  <Text style={[s.langOptionText, targetLang === lang && s.langOptionTextActive]}>
                    {label}
                  </Text>
                  {targetLang === lang && <CheckIcon size={14} color={colors.primary} />}
                </TouchableOpacity>
              ),
            )}
          </ScrollView>
        )}

        <ScrollView style={s.content} nestedScrollEnabled>
          <Text style={s.originalLabel}>{t("translation.original", "原文")}</Text>
          <Text style={s.originalText}>{text}</Text>

          <View style={s.divider} />

          <Text style={s.translationLabel}>{t("translation.translation", "译文")}</Text>
          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={s.loadingText}>{t("translation.translating", "翻译中...")}</Text>
            </View>
          ) : error ? (
            <View style={s.errorWrap}>
              <Text style={s.errorText}>{error}</Text>
              <TouchableOpacity style={s.retryBtn} onPress={translate}>
                <Text style={s.retryBtnText}>{t("common.retry", "重试")}</Text>
              </TouchableOpacity>
            </View>
          ) : translation ? (
            <Text style={s.translationText}>{translation}</Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.3)",
    },
    container: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: "60%",
    },
    handle: {
      width: 40,
      height: 4,
      backgroundColor: colors.muted,
      borderRadius: 2,
      alignSelf: "center",
      marginTop: 8,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    langBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
    },
    langBtnText: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    providerText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    langPicker: {
      maxHeight: 200,
      backgroundColor: colors.card,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    langOption: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    langOptionActive: {
      backgroundColor: colors.muted,
    },
    langOptionText: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    langOptionTextActive: {
      color: colors.primary,
      fontWeight: fontWeight.medium,
    },
    content: {
      padding: 16,
    },
    originalLabel: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginBottom: 4,
    },
    originalText: {
      fontSize: fontSize.base,
      color: colors.foreground,
      lineHeight: 22,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 16,
    },
    translationLabel: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginBottom: 4,
    },
    loadingWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 16,
    },
    loadingText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    errorWrap: {
      paddingVertical: 16,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: colors.destructive,
      marginBottom: 8,
    },
    retryBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
      alignSelf: "flex-start",
    },
    retryBtnText: {
      fontSize: fontSize.sm,
      color: colors.primaryForeground,
    },
    translationText: {
      fontSize: fontSize.base,
      color: colors.foreground,
      lineHeight: 22,
    },
  });
