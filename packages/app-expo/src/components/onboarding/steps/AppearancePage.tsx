import { DarkModeSvg } from "@/components/DarkModeSvg";
import { type ThemeMode, useTheme } from "@/styles/ThemeContext";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { changeAndPersistLanguage } from "@readany/core/i18n";
import { Coffee, Moon, Sun } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInRight } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SmilingGirlSvg from "../../../../assets/illustrations/smiling_girl.svg";
import type { OnboardingStackParamList } from "../OnboardingNavigator";

type NavProp = NativeStackNavigationProp<OnboardingStackParamList, "Appearance">;

export function AppearancePage() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<NavProp>();
  const { mode: currentTheme, setMode: setTheme, colors } = useTheme();
  const insets = useSafeAreaInsets();

  const handleNext = () => navigation.navigate("AI");
  const handlePrev = () => navigation.goBack();

  const themes: { id: ThemeMode; name: string; icon: React.ReactNode }[] = [
    {
      id: "light",
      name: t("settings.light", "Light"),
      icon: <Sun size={24} color={colors.foreground} />,
    },
    {
      id: "dark",
      name: t("settings.dark", "Dark"),
      icon: <Moon size={24} color={colors.foreground} />,
    },
    {
      id: "oled",
      name: t("settings.oled", "OLED Black"),
      icon: <Moon size={24} color={colors.foreground} />,
    },
    {
      id: "sepia",
      name: t("settings.sepia", "Sepia"),
      icon: <Coffee size={24} color={colors.foreground} />,
    },
  ];

  const handleLangChange = async (code: string) => {
    try {
      await changeAndPersistLanguage(code);
    } catch (err) {
      console.warn("[Settings] Failed to change and persist language:", err);
      i18n.changeLanguage(code);
    }
  };

  return (
    <View style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <Animated.View entering={SlideInRight.duration(500)} style={styles.container}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: "transparent", shadowOpacity: 0, width: "100%", height: 160 },
              ]}
            >
              <DarkModeSvg width={160} height={160}>
                <SmilingGirlSvg width={160} height={160} />
              </DarkModeSvg>
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t("onboarding.appearance.title", "Appearance & Language")}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {t("onboarding.appearance.desc", "Customize ReadAny to suit your preferences.")}
            </Text>
          </View>

          <View style={styles.grid}>
            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>
                {t("settings.theme", "Theme")}
              </Text>
              <View style={styles.themeGrid}>
                {themes.map((theme) => {
                  const isActive = currentTheme === theme.id;
                  return (
                    <Pressable
                      key={theme.id}
                      style={[
                        styles.themeBtn,
                        {
                          borderColor: isActive ? colors.primary : colors.border,
                          backgroundColor: isActive ? `${colors.primary}20` : "transparent",
                        },
                        isActive && styles.themeBtnActive,
                      ]}
                      onPress={() => setTheme(theme.id)}
                    >
                      <View style={{ marginBottom: 6 }}>{theme.icon}</View>
                      <Text
                        style={[
                          styles.themeName,
                          { color: isActive ? colors.primary : colors.foreground },
                        ]}
                      >
                        {theme.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>
                {t("settings.language", "Language")}
              </Text>
              <View style={styles.langGrid}>
                {[
                  { code: "en", label: t("settings.english", "English") },
                  { code: "zh", label: t("settings.simplifiedChinese", "中文") },
                ].map((lang) => {
                  const isActive = i18n.language === lang.code;
                  return (
                    <Pressable
                      key={lang.code}
                      style={[
                        styles.langBtn,
                        {
                          borderColor: isActive ? colors.primary : colors.border,
                          backgroundColor: isActive ? colors.primary : colors.muted,
                        },
                        isActive && styles.langBtnActive,
                      ]}
                      onPress={() => handleLangChange(lang.code)}
                    >
                      <Text
                        style={[
                          styles.langLabel,
                          { color: isActive ? colors.primaryForeground : colors.mutedForeground },
                        ]}
                      >
                        {lang.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        </ScrollView>

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
          <Pressable onPress={handlePrev} style={styles.backBtn}>
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
  grid: { gap: 16 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16 },
  cardTitle: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  themeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  themeBtn: {
    width: "48%",
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 2,
    position: "relative",
  },
  themeBtnActive: {
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  themeName: { fontSize: 13, fontWeight: "500" },
  langGrid: { gap: 8 },
  langBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
  },
  langBtnActive: {
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  langLabel: { fontSize: 15, fontWeight: "500" },
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
