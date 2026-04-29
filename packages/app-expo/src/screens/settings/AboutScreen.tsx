import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useUpdateStore } from "@/stores/update-store";
import { getPlatformService } from "@readany/core/services";
import { checkForUpdate } from "@readany/core/update";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AppIcon from "../../../assets/icon.png";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  useColors,
} from "../../styles/theme";
import { SettingsHeader } from "./SettingsHeader";

const TECH_STACK = [
  { label: "Expo SDK 55", descKey: "about.nativeContainer" },
  { label: "React Native", descKey: "about.uiFramework" },
  { label: "Foliate.js", descKey: "about.ebookRenderer" },
  { label: "SQLite", descKey: "about.localDatabase" },
];

const LINKS = [
  {
    label: "GitHub",
    url: "https://github.com/nicepkg/ReadAny",
  },
];

export default function AboutScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();
  const layout = useResponsiveLayout();
  const [version, setVersion] = useState("1.0.0");
  const [checking, setChecking] = useState(false);

  const checkResult = useUpdateStore((s) => s.checkResult);
  const setCheckResult = useUpdateStore((s) => s.setCheckResult);
  const showDialog = useUpdateStore((s) => s.showDialog);

  useEffect(() => {
    getPlatformService().getAppVersion().then(setVersion);
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    setChecking(true);
    try {
      const platform = getPlatformService();
      const v = await platform.getAppVersion();
      const result = await checkForUpdate(v, platform, true);
      setCheckResult(result);
      if (result.hasUpdate && result.release) {
        showDialog();
      } else {
        Alert.alert(t("settings.upToDate"), t("settings.upToDate"));
      }
    } catch {
      Alert.alert(t("settings.updateError"), t("settings.updaterCheckFailed"));
    } finally {
      setChecking(false);
    }
  }, [t, setCheckResult, showDialog]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <SettingsHeader title={t("about.title", "关于")} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { alignItems: "center" }]}
      >
        <View style={{ width: "100%", maxWidth: layout.centeredContentWidth }}>
          {/* Logo & Version */}
          <View style={styles.logoSection}>
            <View style={styles.logoBadge}>
              <Image
                source={AppIcon}
                style={{ width: 80, height: 80, borderRadius: 18 }}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.appName}>ReadAny</Text>
            <Text style={styles.version}>v{version}</Text>
            <Text style={styles.desc}>
              {t("about.desc", "一个跨平台的智能电子书阅读器，支持 AI 对话、TTS 朗读、多语言翻译")}
            </Text>
          </View>

          {/* Check for Updates */}
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.updateBtn}
              onPress={handleCheckUpdate}
              disabled={checking}
              activeOpacity={0.7}
            >
              {checking && <ActivityIndicator size="small" color={colors.primaryForeground} />}
              <Text style={styles.updateBtnText}>
                {checking ? t("settings.updateChecking") : t("settings.checkUpdate")}
              </Text>
            </TouchableOpacity>
            {checkResult?.hasUpdate && checkResult.release && (
              <TouchableOpacity
                style={styles.updateBanner}
                onPress={() => showDialog()}
                activeOpacity={0.7}
              >
                <Text style={styles.updateBannerText}>
                  {t("settings.newVersionAvailable", { version: checkResult.latestVersion })}
                </Text>
                <Text style={styles.linkArrow}>→</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Tech Stack */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("about.techStack", "技术栈")}</Text>
            <View style={styles.techGrid}>
              {TECH_STACK.map((item) => (
                <View key={item.label} style={styles.techCard}>
                  <Text style={styles.techLabel}>{item.label}</Text>
                  <Text style={styles.techDesc}>{t(item.descKey, item.label)}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Links */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("about.links", "链接")}</Text>
            <View style={styles.linksCard}>
              {LINKS.map((link, idx) => (
                <TouchableOpacity
                  key={link.url}
                  style={[styles.linkItem, idx < LINKS.length - 1 && styles.linkItemBorder]}
                  onPress={() => Linking.openURL(link.url)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.linkText}>{link.label}</Text>
                  <Text style={styles.linkArrow}>→</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.linkItem}
                onPress={() => Linking.openURL("https://github.com/nicepkg/ReadAny/issues")}
                activeOpacity={0.7}
              >
                <Text style={styles.linkText}>{t("about.feedback", "问题反馈")}</Text>
                <Text style={styles.linkArrow}>→</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.madeBy}>{t("about.madeBy", "Made with love by nicepkg")}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    scrollContent: {
      paddingTop: spacing.xl,
      paddingBottom: 48,
    },
    logoSection: {
      alignItems: "center",
      paddingTop: 40,
      paddingBottom: 24,
      paddingHorizontal: 32,
    },
    logoBadge: {
      width: 80,
      height: 80,
      borderRadius: 18,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    appName: {
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      color: colors.foreground,
    },
    version: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      marginTop: 4,
    },
    desc: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
      marginTop: 12,
    },
    section: {
      paddingHorizontal: spacing.lg,
      marginBottom: 16,
      gap: 12,
    },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    updateBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: radius.xl,
      backgroundColor: colors.primary,
      paddingVertical: 12,
    },
    updateBtnText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
    updateBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.primary,
      paddingHorizontal: spacing.lg,
      paddingVertical: 12,
    },
    updateBannerText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },
    techGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    techCard: {
      width: "47%",
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      gap: 4,
    },
    techLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    techDesc: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    linksCard: {
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    linkItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: 14,
    },
    linkItemBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    linkText: {
      fontSize: fontSize.md,
      color: colors.foreground,
    },
    linkArrow: {
      fontSize: 16,
      color: colors.mutedForeground,
    },
    madeBy: {
      textAlign: "center",
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginTop: 16,
    },
  });
