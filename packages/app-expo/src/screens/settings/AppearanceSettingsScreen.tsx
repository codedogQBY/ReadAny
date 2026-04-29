import { BookOpenIcon, MoonIcon, SunIcon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useTheme } from "@/styles/ThemeContext";
import type { ThemeMode } from "@/styles/ThemeContext";
import { fontSize, fontWeight, radius, spacing } from "@/styles/theme";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsHeader } from "./SettingsHeader";

const THEMES: { id: ThemeMode; labelKey: string; fallback: string; Icon: typeof SunIcon }[] = [
  { id: "light", labelKey: "settings.light", fallback: "Light", Icon: SunIcon },
  { id: "dark", labelKey: "settings.dark", fallback: "Dark", Icon: MoonIcon },
  { id: "sepia", labelKey: "settings.sepia", fallback: "Sepia", Icon: BookOpenIcon },
];

const LANGUAGES = [
  { code: "zh", labelKey: "settings.simplifiedChinese", fallback: "简体中文" },
  { code: "en", labelKey: "settings.english", fallback: "English" },
] as const;

export default function AppearanceSettingsScreen() {
  const { t, i18n } = useTranslation();
  const { mode, setMode, colors } = useTheme();
  const layout = useResponsiveLayout();
  const [lang, setLang] = useState(() => (i18n.language?.startsWith("zh") ? "zh" : "en"));

  // Update lang state when i18n.language changes
  useEffect(() => {
    const newLang = i18n.language?.startsWith("zh") ? "zh" : "en";
    setLang(newLang);
  }, [i18n.language]);

  const handleLangChange = useCallback(async (code: string) => {
    setLang(code);
    try {
      const { changeAndPersistLanguage } = await import("@readany/core/i18n");
      await changeAndPersistLanguage(code);
    } catch {
      // fallback
    }
  }, []);

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <SettingsHeader
        title={t("settings.appearanceLanguage", "外观与语言")}
        subtitle={t("settings.realtimeHint")}
      />

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
                        backgroundColor: colors.primary + "0D",
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

          {/* Language */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>
              {t("settings.language", "语言")}
            </Text>
            <View
              style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              {LANGUAGES.map((l, idx) => (
                <TouchableOpacity
                  key={l.code}
                  style={[
                    s.listItem,
                    idx < LANGUAGES.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                  onPress={() => handleLangChange(l.code)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.listItemText, { color: colors.foreground }]}>
                    {t(l.labelKey, l.fallback)}
                  </Text>
                  {lang === l.code && (
                    <Text style={[s.checkPrimary, { color: colors.primary }]}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(_colors: ReturnType<typeof useTheme>["colors"]) {
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
    themeGrid: { flexDirection: "row", gap: 12 },
    themeCard: {
      flex: 1,
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
    listCard: {
      borderRadius: radius.xl,
      borderWidth: 1,
      overflow: "hidden",
    },
    listItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: 14,
    },
    listItemText: { fontSize: fontSize.md },
    checkPrimary: { fontSize: 14 },
  });
}
