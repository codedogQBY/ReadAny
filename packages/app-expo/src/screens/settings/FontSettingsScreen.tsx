import { GlobeIcon, LinkIcon, PlusIcon, Trash2Icon, TypeIcon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { fontSize, fontWeight, radius, spacing, useColors } from "@/styles/theme";
/**
 * FontSettingsScreen — custom font management for mobile
 */
import {
  createCustomFontFamily,
  generateFontId,
  saveFontFile,
  useFontStore,
} from "@readany/core/stores";
import type { CustomFont } from "@readany/core/types/font";
import { PRESET_FONTS } from "@readany/core/types/font";
import * as DocumentPicker from "expo-document-picker";
import * as Font from "expo-font";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsHeader } from "./SettingsHeader";

export default function FontSettingsScreen() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const layout = useResponsiveLayout();

  const fonts = useFontStore((s) => s.fonts);
  const fontsHydrated = useFontStore((s) => s._hasHydrated);
  const addFont = useFontStore((s) => s.addFont);
  const removeFont = useFontStore((s) => s.removeFont);

  const installedPresetIds = new Set(
    fonts.filter((f) => f.id.startsWith("preset-")).map((f) => f.id),
  );
  const availablePresetFonts = PRESET_FONTS.filter((preset) => !installedPresetIds.has(preset.id));

  const handleAddPreset = useCallback(
    (preset: (typeof PRESET_FONTS)[number]) => {
      const font: CustomFont = {
        id: preset.id,
        name: i18n.language === "zh" ? preset.name : preset.nameEn,
        fileName: `preset-${preset.id}.woff2`,
        fontFamily: preset.fontFamily,
        format: preset.format,
        addedAt: Date.now(),
        source: "remote",
        remoteCssUrl: preset.remoteCssUrl,
        remoteUrlWoff2: preset.remoteUrlWoff2,
        remoteUrl: preset.remoteUrl,
      };
      addFont(font, { select: true });
      Alert.alert(
        t("fonts.imported", "导入成功"),
        t("fonts.importedDesc", '字体 "{{name}}" 已添加', { name: font.name }),
      );
    },
    [addFont, i18n.language, t],
  );

  const [importing, setImporting] = useState(false);
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [urlModalVisible, setUrlModalVisible] = useState(false);
  const [pendingFontFile, setPendingFontFile] = useState<{ uri: string; name: string } | null>(
    null,
  );
  const [fontNameInput, setFontNameInput] = useState("");

  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteUrlWoff2, setRemoteUrlWoff2] = useState("");
  const [remoteFontName, setRemoteFontName] = useState("");
  const [loadedPreviewFontIds, setLoadedPreviewFontIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;

    const loadPreviewFonts = async () => {
      const loadedIds = new Set<string>();
      for (const font of fonts) {
        if (font.source !== "local" || !font.filePath) continue;
        try {
          if (!Font.isLoaded(font.fontFamily)) {
            await Font.loadAsync({ [font.fontFamily]: font.filePath });
          }
          loadedIds.add(font.id);
        } catch (err) {
          console.warn("[FontSettings] Failed to load font preview:", font.name, err);
        }
      }
      if (!cancelled) setLoadedPreviewFontIds(loadedIds);
    };

    void loadPreviewFonts();
    return () => {
      cancelled = true;
    };
  }, [fonts]);

  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/font-sfnt",
          "application/x-font-ttf",
          "application/x-font-otf",
          "font/ttf",
          "font/otf",
          "font/woff",
          "font/woff2",
          "*/*",
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        setImporting(false);
        return;
      }

      const file = result.assets[0];
      const fileName = file.name || "font.ttf";
      const nameWithoutExt = fileName.replace(/\.(ttf|otf|woff|woff2)$/i, "");

      setPendingFontFile({ uri: file.uri, name: fileName });
      setFontNameInput(nameWithoutExt);
      setNameModalVisible(true);
      setImporting(false);
    } catch (err) {
      console.error("[FontSettings] Pick error:", err);
      Alert.alert(t("fonts.error", "错误"), t("fonts.pickError", "选择字体文件失败"));
      setImporting(false);
    }
  }, [t]);

  const handleConfirmImport = useCallback(async () => {
    if (!fontNameInput.trim()) {
      Alert.alert(t("fonts.error", "错误"), t("fonts.nameRequired", "请输入字体名称"));
      return;
    }
    if (!pendingFontFile) return;

    setNameModalVisible(false);
    setImporting(true);

    try {
      const {
        filePath,
        fileName: savedName,
        size,
      } = await saveFontFile(pendingFontFile.uri, fontNameInput.trim(), pendingFontFile.name);

      const id = generateFontId();
      const font: CustomFont = {
        id,
        name: fontNameInput.trim(),
        fileName: savedName,
        filePath,
        fontFamily: createCustomFontFamily(id),
        format:
          (savedName.split(".").pop()?.toLowerCase() as "ttf" | "otf" | "woff" | "woff2") || "ttf",
        size,
        addedAt: Date.now(),
        source: "local",
      };

      addFont(font, { select: true });
      Alert.alert(
        t("fonts.imported", "导入成功"),
        t("fonts.importedDesc", '字体 "{{name}}" 已导入', { name: fontNameInput.trim() }),
      );
    } catch (err) {
      console.error("[FontSettings] Import error:", err);
      Alert.alert(t("fonts.error", "错误"), t("fonts.importError", "导入字体失败"));
    } finally {
      setImporting(false);
      setPendingFontFile(null);
      setFontNameInput("");
    }
  }, [fontNameInput, pendingFontFile, addFont, t]);

  const handleImportRemote = useCallback(async () => {
    if (!remoteFontName.trim()) {
      Alert.alert(t("fonts.error", "错误"), t("fonts.nameRequired", "请输入字体名称"));
      return;
    }
    if (!remoteUrl.trim() && !remoteUrlWoff2.trim()) {
      Alert.alert(t("fonts.error", "错误"), t("fonts.urlRequired", "请输入字体链接"));
      return;
    }

    setUrlModalVisible(false);
    setImporting(true);

    try {
      const id = generateFontId();
      const url = remoteUrl.trim();
      const woff2Url = remoteUrlWoff2.trim();
      const format = woff2Url ? "woff2" : url.endsWith(".woff2") ? "woff2" : "woff";

      const font: CustomFont = {
        id,
        name: remoteFontName.trim(),
        fileName: `remote-${Date.now()}.${format}`,
        fontFamily: createCustomFontFamily(id),
        format,
        addedAt: Date.now(),
        source: "remote",
        remoteUrl: url || undefined,
        remoteUrlWoff2: woff2Url || undefined,
      };

      addFont(font, { select: true });
      Alert.alert(
        t("fonts.imported", "导入成功"),
        t("fonts.importedDesc", '字体 "{{name}}" 已导入', { name: remoteFontName.trim() }),
      );
    } catch (err) {
      console.error("[FontSettings] Import remote error:", err);
      Alert.alert(t("fonts.error", "错误"), t("fonts.importError", "导入字体失败"));
    } finally {
      setImporting(false);
      setRemoteUrl("");
      setRemoteUrlWoff2("");
      setRemoteFontName("");
    }
  }, [remoteFontName, remoteUrl, remoteUrlWoff2, addFont, t]);

  const handleDelete = useCallback(
    (font: CustomFont) => {
      Alert.alert(
        t("fonts.deleteTitle", "删除字体"),
        t("fonts.deleteConfirm", '确定删除字体 "{{name}}" 吗？', { name: font.name }),
        [
          { text: t("common.cancel", "取消"), style: "cancel" },
          {
            text: t("common.delete", "删除"),
            style: "destructive",
            onPress: () => removeFont(font.id),
          },
        ],
      );
    },
    [removeFont, t],
  );

  const formatSize = (bytes?: number): string => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <SettingsHeader title={t("fonts.title", "字体")} />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { alignItems: "center" }]}
      >
        <View style={{ width: "100%", maxWidth: layout.centeredContentWidth }}>
          <View style={s.section}>
            <Text style={[s.hint, { color: colors.mutedForeground }]}>
              {t("fonts.desc", "导入自定义字体，在阅读器中使用。支持 TTF、OTF、WOFF、WOFF2 格式。")}
            </Text>
            <Text style={[s.hint, { color: colors.mutedForeground, marginTop: 6, fontSize: 12 }]}>
              {t(
                "fonts.importHint",
                "支持 TTF / OTF / WOFF / WOFF2，推荐 WOFF2（同款字体体积约为 TTF 的 1/3）",
              )}
            </Text>
          </View>

          {!fontsHydrated ? (
            <View style={s.loadingState}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[s.loadingText, { color: colors.mutedForeground }]}>
                {t("common.loading", "加载中...")}
              </Text>
            </View>
          ) : (
            <>
              <View style={s.buttonRow}>
                <TouchableOpacity
                  style={[s.importBtn, { backgroundColor: colors.primary }, s.importBtnHalf]}
                  onPress={handleImport}
                  disabled={importing}
                  activeOpacity={0.8}
                >
                  {importing ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <>
                      <PlusIcon size={18} color={colors.primaryForeground} />
                      <Text style={[s.importBtnText, { color: colors.primaryForeground }]}>
                        {t("fonts.fromFile", "本地文件")}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.importBtn, { backgroundColor: colors.primary }, s.importBtnHalf]}
                  onPress={() => setUrlModalVisible(true)}
                  disabled={importing}
                  activeOpacity={0.8}
                >
                  <LinkIcon size={18} color={colors.primaryForeground} />
                  <Text style={[s.importBtnText, { color: colors.primaryForeground }]}>
                    {t("fonts.fromUrl", "在线链接")}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Preset fonts */}
              {availablePresetFonts.length > 0 && (
                <View style={s.presetSection}>
                  <Text
                    style={[
                      s.hint,
                      { color: colors.mutedForeground, fontWeight: fontWeight.medium },
                    ]}
                  >
                    {t("fonts.presets", "推荐字体（在线，点击即可添加）")}
                  </Text>
                  {availablePresetFonts.map((preset) => {
                    const name = i18n.language === "zh" ? preset.name : preset.nameEn;
                    const desc = i18n.language === "zh" ? preset.description : preset.descriptionEn;
                    return (
                      <View
                        key={preset.id}
                        style={[
                          s.fontCard,
                          { backgroundColor: colors.card, borderColor: colors.border },
                        ]}
                      >
                        <View style={s.fontHeader}>
                          <View style={s.fontInfo}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <Text style={[s.fontName, { color: colors.foreground }]}>{name}</Text>
                              <View
                                style={[s.remoteBadge, { backgroundColor: `${colors.primary}22` }]}
                              >
                                <Text style={[s.remoteBadgeText, { color: colors.primary }]}>
                                  {preset.license}
                                </Text>
                              </View>
                            </View>
                            <Text
                              style={[s.fontMetaText, { color: colors.mutedForeground }]}
                              numberOfLines={2}
                            >
                              {desc}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={[
                              {
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                borderRadius: radius.md,
                                marginLeft: 8,
                              },
                              { backgroundColor: colors.primary },
                            ]}
                            onPress={() => handleAddPreset(preset)}
                          >
                            <Text
                              style={{
                                fontSize: fontSize.sm,
                                fontWeight: fontWeight.medium,
                                color: colors.primaryForeground,
                              }}
                            >
                              {t("fonts.add", "添加")}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {fonts.length === 0 ? (
                <View style={s.emptyState}>
                  <TypeIcon size={48} color={colors.mutedForeground} />
                  <Text style={[s.emptyText, { color: colors.mutedForeground }]}>
                    {t("fonts.empty", "暂无自定义字体")}
                  </Text>
                  <Text style={[s.emptyHint, { color: colors.mutedForeground }]}>
                    {t("fonts.emptyHint", "点击上方按钮导入字体文件")}
                  </Text>
                </View>
              ) : (
                <View style={s.fontList}>
                  {fonts.map((font) => (
                    <View
                      key={font.id}
                      style={[
                        s.fontCard,
                        { backgroundColor: colors.card, borderColor: colors.border },
                      ]}
                    >
                      <View style={s.fontHeader}>
                        <View style={s.fontInfo}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Text style={[s.fontName, { color: colors.foreground }]}>
                              {font.name}
                            </Text>
                            {font.source === "remote" && (
                              <View
                                style={[s.remoteBadge, { backgroundColor: `${colors.primary}22` }]}
                              >
                                <GlobeIcon size={12} color={colors.primary} />
                                <Text style={[s.remoteBadgeText, { color: colors.primary }]}>
                                  {t("fonts.remote", "在线")}
                                </Text>
                              </View>
                            )}
                          </View>
                          <View style={s.fontMeta}>
                            <Text style={[s.fontMetaText, { color: colors.mutedForeground }]}>
                              {font.format.toUpperCase()}
                            </Text>
                            <Text style={[s.fontMetaDot, { color: colors.mutedForeground }]}>
                              ·
                            </Text>
                            <Text style={[s.fontMetaText, { color: colors.mutedForeground }]}>
                              {formatSize(font.size)}
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={s.deleteBtn}
                          onPress={() => handleDelete(font)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Trash2Icon size={20} color={colors.destructive} />
                        </TouchableOpacity>
                      </View>

                      <View
                        style={[
                          s.previewBox,
                          { backgroundColor: colors.muted, borderColor: colors.border },
                        ]}
                      >
                        <Text
                          style={[
                            s.previewText,
                            { color: colors.foreground },
                            loadedPreviewFontIds.has(font.id) && { fontFamily: font.fontFamily },
                          ]}
                        >
                          {t("fonts.preview", "预览文字：阅读改变世界 The quick brown fox")}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* 命名 Modal（本地文件导入） */}
      <Modal
        visible={nameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNameModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={[s.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[s.modalTitle, { color: colors.foreground }]}>
              {t("fonts.nameFont", "字体名称")}
            </Text>
            <Text style={[s.modalDesc, { color: colors.mutedForeground }]}>
              {t("fonts.nameFontDesc", "请输入字体的显示名称")}
            </Text>
            <TextInput
              style={[
                s.modalInput,
                {
                  backgroundColor: colors.background,
                  color: colors.foreground,
                  borderColor: colors.border,
                },
              ]}
              value={fontNameInput}
              onChangeText={setFontNameInput}
              placeholder={t("fonts.namePlaceholder", "输入显示名称")}
              placeholderTextColor={colors.mutedForeground}
              autoFocus
            />
            <View style={s.modalButtons}>
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: colors.muted }]}
                onPress={() => {
                  setNameModalVisible(false);
                  setPendingFontFile(null);
                  setFontNameInput("");
                }}
              >
                <Text style={[s.modalBtnText, { color: colors.foreground }]}>
                  {t("common.cancel", "取消")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: colors.primary }]}
                onPress={handleConfirmImport}
              >
                <Text style={[s.modalBtnText, { color: colors.primaryForeground }]}>
                  {t("fonts.import", "导入")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 在线链接 Modal */}
      <Modal
        visible={urlModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setUrlModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={[s.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[s.modalTitle, { color: colors.foreground }]}>
              {t("fonts.fromUrl", "在线链接")}
            </Text>
            <Text style={[s.modalDesc, { color: colors.mutedForeground }]}>
              {t("fonts.urlHint", "输入字体 CDN 链接")}
            </Text>

            <Text style={[s.inputLabel, { color: colors.foreground }]}>
              {t("fonts.name", "字体名称")}
            </Text>
            <TextInput
              style={[
                s.modalInput,
                {
                  backgroundColor: colors.background,
                  color: colors.foreground,
                  borderColor: colors.border,
                },
              ]}
              value={remoteFontName}
              onChangeText={setRemoteFontName}
              placeholder={t("fonts.namePlaceholder", "输入显示名称")}
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[s.inputLabel, { color: colors.foreground }]}>
              {t("fonts.urlWoff2", "WOFF2 链接")}
            </Text>
            <TextInput
              style={[
                s.modalInput,
                {
                  backgroundColor: colors.background,
                  color: colors.foreground,
                  borderColor: colors.border,
                },
              ]}
              value={remoteUrlWoff2}
              onChangeText={setRemoteUrlWoff2}
              placeholder="https://example.com/font.woff2"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <Text style={[s.inputLabel, { color: colors.foreground }]}>
              {t("fonts.urlWoff", "WOFF 链接 (备选)")}
            </Text>
            <TextInput
              style={[
                s.modalInput,
                {
                  backgroundColor: colors.background,
                  color: colors.foreground,
                  borderColor: colors.border,
                },
              ]}
              value={remoteUrl}
              onChangeText={setRemoteUrl}
              placeholder="https://example.com/font.woff"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <View style={s.modalButtons}>
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: colors.muted }]}
                onPress={() => {
                  setUrlModalVisible(false);
                  setRemoteUrl("");
                  setRemoteUrlWoff2("");
                  setRemoteFontName("");
                }}
              >
                <Text style={[s.modalBtnText, { color: colors.foreground }]}>
                  {t("common.cancel", "取消")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: colors.primary }]}
                onPress={handleImportRemote}
              >
                <Text style={[s.modalBtnText, { color: colors.primaryForeground }]}>
                  {t("fonts.import", "导入")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(_colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xxl,
      paddingBottom: 56,
      gap: 20,
    },
    section: { gap: 10 },
    hint: {
      fontSize: fontSize.sm,
      lineHeight: 22,
    },
    loadingState: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 20,
    },
    loadingText: { fontSize: fontSize.sm },
    buttonRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
    presetSection: { gap: 8, marginBottom: 16 },
    importBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: radius.lg,
      paddingVertical: 14,
    },
    importBtnHalf: { flex: 1 },
    importBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.medium },
    emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 12 },
    emptyText: { fontSize: fontSize.base, fontWeight: fontWeight.medium },
    emptyHint: { fontSize: fontSize.sm },
    fontList: { gap: 12 },
    fontCard: { borderRadius: radius.xl, borderWidth: 1, padding: 16, gap: 12 },
    fontHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
    fontInfo: { flex: 1, gap: 4 },
    fontName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
    fontMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
    fontMetaText: { fontSize: fontSize.xs },
    fontMetaDot: { fontSize: fontSize.xs },
    deleteBtn: { padding: 4 },
    previewBox: { borderRadius: radius.md, borderWidth: 1, padding: 12 },
    previewText: { fontSize: fontSize.sm },
    remoteBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.sm,
    },
    remoteBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      alignItems: "center",
    },
    modalContent: { borderRadius: radius.xl, padding: 20, width: "85%", maxWidth: 340 },
    modalTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, marginBottom: 8 },
    modalDesc: { fontSize: fontSize.sm, marginBottom: 16 },
    inputLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginBottom: 4 },
    modalInput: {
      borderRadius: radius.md,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: fontSize.base,
      marginBottom: 12,
    },
    modalButtons: { flexDirection: "row", gap: 12, marginTop: 4 },
    modalBtn: { flex: 1, borderRadius: radius.md, paddingVertical: 10, alignItems: "center" },
    modalBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.medium },
  });
}
