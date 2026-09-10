import { BookOpenIcon, CheckIcon, ChevronDownIcon, MoonIcon, SunIcon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useTheme } from "@/styles/ThemeContext";
import type { ThemeMode } from "@/styles/ThemeContext";
import { fontSize, fontWeight, radius, spacing } from "@/styles/theme";
import { changeAndPersistLanguage } from "@readany/core/i18n";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsHeader } from "./SettingsHeader";

const THEMES: { id: ThemeMode; labelKey: string; fallback: string; Icon: typeof SunIcon }[] = [
  { id: "light", labelKey: "settings.light", fallback: "Light", Icon: SunIcon },
  { id: "dark", labelKey: "settings.dark", fallback: "Dark", Icon: MoonIcon },
  { id: "oled", labelKey: "settings.oled", fallback: "OLED Black", Icon: MoonIcon },
  { id: "sepia", labelKey: "settings.sepia", fallback: "Sepia", Icon: BookOpenIcon },
];

const LANGUAGES = [
  { code: "zh", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
] as const;

export default function AppearanceSettingsScreen() {
  const { t, i18n } = useTranslation();
  const { mode, setMode, colors } = useTheme();
  const layout = useResponsiveLayout();
  const [lang, setLang] = useState(() => i18n.language || "en");
  const [showLangPicker, setShowLangPicker] = useState(false);

  useEffect(() => {
    setLang(i18n.language || "en");
  }, [i18n.language]);

  const handleLangChange = useCallback(async (code: string) => {
    setLang(code);
    setShowLangPicker(false);
    try {
      await changeAndPersistLanguage(code);
    } catch (err) {
      console.warn("[Settings] Failed to change and persist language:", err);
    }
  }, []);

  const currentLangLabel = LANGUAGES.find((l) => l.code === lang)?.label || lang;

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <SettingsHeader title={t("settings.general", "通用")} subtitle={t("settings.realtimeHint")} />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { alignItems: "center" }]}
      >
        <View style={{ width: "100%", maxWidth: layout.centeredContentWidth, gap: 24 }}>
          {/* Theme */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>
              {t("settings.theme", "主题")}
            </Text>
            <View style={s.themeGrid}>
              {THEMES.map((item) => {
                const active = mode === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      s.themeCard,
                      { borderColor: colors.border, backgroundColor: colors.card },
                      active && {
                        borderColor: colors.primary,
                        backgroundColor: `${colors.primary}0D`,
                      },
                    ]}
                    onPress={() => setMode(item.id)}
                    activeOpacity={0.7}
                  >
                    <item.Icon size={24} color={active ? colors.primary : colors.mutedForeground} />
                    <Text
                      style={[
                        s.themeLabel,
                        { color: colors.foreground },
                        active && { fontWeight: fontWeight.medium, color: colors.primary },
                      ]}
                    >
                      {t(item.labelKey, item.fallback)}
                    </Text>
                    {active && (
                      <View style={s.checkBadge}>
                        <Text style={[s.checkMark, { color: colors.primary }]}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Language — single row, tap to open bottom sheet */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>
              {t("settings.language", "语言")}
            </Text>
            <TouchableOpacity
              style={[s.langRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setShowLangPicker(true)}
              activeOpacity={0.7}
            >
              <Text style={[s.langRowLabel, { color: colors.foreground }]}>{currentLangLabel}</Text>
              <ChevronDownIcon size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Custom bottom sheet language picker */}
      <Modal
        visible={showLangPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLangPicker(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowLangPicker(false)}>
          <Pressable style={[s.modalSheet, { backgroundColor: colors.card }]} onPress={() => {}}>
            {/* Handle bar */}
            <View style={s.handleBar}>
              <View style={[s.handle, { backgroundColor: colors.border }]} />
            </View>

            <Text style={[s.modalTitle, { color: colors.foreground }]}>
              {t("settings.language")}
            </Text>

            <View style={s.langList}>
              {LANGUAGES.map((l, idx) => {
                const isActive = lang === l.code;
                return (
                  <TouchableOpacity
                    key={l.code}
                    style={[
                      s.langItem,
                      { backgroundColor: isActive ? `${colors.primary}10` : "transparent" },
                      idx < LANGUAGES.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.border,
                      },
                    ]}
                    onPress={() => handleLangChange(l.code)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        s.langItemText,
                        { color: isActive ? colors.primary : colors.foreground },
                        isActive && { fontWeight: fontWeight.medium },
                      ]}
                    >
                      {l.label}
                    </Text>
                    {isActive && <CheckIcon size={18} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    container: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xxl,
      paddingBottom: 56,
      gap: 24,
    },
    section: { gap: 12 },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    themeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    themeCard: {
      width: "48%",
      alignItems: "center",
      gap: 8,
      borderRadius: radius.xl,
      borderWidth: 1,
      padding: 16,
      position: "relative",
    },
    themeLabel: { fontSize: fontSize.sm },
    checkBadge: { position: "absolute", top: 8, right: 8 },
    checkMark: { fontSize: 14 },
    langRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: 14,
      borderRadius: radius.xl,
      borderWidth: 1,
    },
    langRowLabel: { fontSize: fontSize.md },
    // Bottom sheet
    modalOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.35)",
    },
    modalSheet: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingBottom: 40,
    },
    handleBar: {
      alignItems: "center",
      paddingVertical: 12,
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
    },
    modalTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      textAlign: "center",
      marginBottom: 8,
    },
    langList: {
      marginHorizontal: 16,
      borderRadius: radius.xl,
      overflow: "hidden",
      backgroundColor: colors.background,
    },
    langItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    langItemText: {
      fontSize: fontSize.md,
    },
  });
}
