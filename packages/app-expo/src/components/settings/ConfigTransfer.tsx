import { decodeConfig, encodeConfig } from "@readany/core/utils";
import * as Clipboard from "expo-clipboard";
import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Text, TextInput, TouchableOpacity, View } from "react-native";
import { fontSize, fontWeight, radius, useColors } from "../../styles/theme";

interface ConfigTransferProps {
  getData: () => unknown;
  applyData: (data: unknown) => void;
  validate: (data: unknown) => boolean;
  label: string;
}

export const ConfigTransfer = memo(function ConfigTransfer({
  getData,
  applyData,
  validate,
  label,
}: ConfigTransferProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const [mode, setMode] = useState<"idle" | "export" | "import">("idle");
  const [token, setToken] = useState("");
  const [importText, setImportText] = useState("");

  const handleExport = useCallback(() => {
    try {
      const data = getData();
      const encoded = encodeConfig(data);
      setToken(encoded);
      setMode("export");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t("common.error", "错误"), `${t("settings.exportFailed", "导出失败")}: ${msg}`);
    }
  }, [getData, t]);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(token);
    Alert.alert(t("common.copied", "已复制"), t("settings.copiedToClipboard", "口令已复制到剪贴板"));
  }, [token, t]);

  const applyImportedData = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        Alert.alert(t("common.error", "错误"), t("settings.invalidConfig", "配置格式无效"));
        return;
      }
      const data = decodeConfig(trimmed);
      if (!data) {
        Alert.alert(t("common.error", "错误"), t("settings.invalidConfig", "配置格式无效，口令可能不完整"));
        return;
      }
      if (!validate(data)) {
        Alert.alert(t("common.error", "错误"), t("settings.invalidConfig", "配置格式无效"));
        return;
      }
      try {
        applyData(data);
        Alert.alert(t("common.success", "成功"), t("settings.configImported", "配置已导入"));
        setMode("idle");
        setImportText("");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert(t("common.error", "错误"), `${t("settings.importFailed", "导入失败")}: ${msg}`);
      }
    },
    [validate, applyData, t],
  );

  const handleImport = useCallback(() => applyImportedData(importText), [importText, applyImportedData]);

  const handlePaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setImportText(text);
  }, []);

  if (mode === "export") {
    return (
      <View
        style={{
          gap: 12,
          padding: 16,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.muted + "40",
        }}
      >
        <TextInput
          value={token}
          editable={false}
          multiline
          selectTextOnFocus
          style={{
            minHeight: 60,
            padding: 12,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            color: colors.foreground,
            fontSize: fontSize.xs,
            fontFamily: "monospace",
            textAlignVertical: "top",
          }}
        />
        <Text style={{ fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: "center" }}>
          {t("settings.copyToken", "复制下方口令，在另一台设备导入")}
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            onPress={handleCopy}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: radius.md,
              backgroundColor: colors.primary,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground, fontWeight: fontWeight.medium }}>
              {t("common.copy", "复制口令")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMode("idle")}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: radius.md,
              backgroundColor: colors.muted,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: fontSize.sm, color: colors.mutedForeground }}>
              {t("common.cancel", "取消")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (mode === "import") {
    return (
      <View
        style={{
          gap: 12,
          padding: 16,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.muted + "40",
        }}
      >
        <TextInput
          placeholder={t("settings.pasteConfig", "粘贴配置口令...")}
          placeholderTextColor={colors.mutedForeground}
          value={importText}
          onChangeText={setImportText}
          multiline
          style={{
            minHeight: 80,
            padding: 12,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            color: colors.foreground,
            fontSize: fontSize.xs,
            fontFamily: "monospace",
            textAlignVertical: "top",
          }}
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            onPress={handlePaste}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.background,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: fontSize.sm, color: colors.foreground }}>
              {t("common.paste", "粘贴")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleImport}
            disabled={!importText.trim()}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: radius.md,
              backgroundColor: colors.primary,
              alignItems: "center",
              opacity: importText.trim() ? 1 : 0.5,
            }}
          >
            <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground, fontWeight: fontWeight.medium }}>
              {t("settings.importConfig", "导入")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setMode("idle"); setImportText(""); }}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: radius.md,
              backgroundColor: colors.muted,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: fontSize.sm, color: colors.mutedForeground }}>
              {t("common.cancel", "取消")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TouchableOpacity
        onPress={handleExport}
        style={{
          flex: 1,
          paddingVertical: 10,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: fontSize.sm, color: colors.foreground }}>
          {t("settings.exportConfig", "导出")} {label}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setMode("import")}
        style={{
          flex: 1,
          paddingVertical: 10,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: fontSize.sm, color: colors.foreground }}>
          {t("settings.importConfig", "导入")} {label}
        </Text>
      </TouchableOpacity>
    </View>
  );
});
