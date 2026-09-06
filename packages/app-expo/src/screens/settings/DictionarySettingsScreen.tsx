import { KeyboardAwareScrollView } from "@/components/ui/KeyboardAwareScrollView";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useDictionaryStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useColors } from "@/styles/theme";
import type { DictionaryLanguage, DictionaryPackDescriptor } from "@readany/core/dictionary";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { StoreApi, UseBoundStore } from "zustand";
import type { DictionaryStoreState } from "../../stores/dictionary-store";
import { SettingsHeader } from "./SettingsHeader";

type DictionaryStore = UseBoundStore<StoreApi<DictionaryStoreState>>;

export interface DictionarySettingsScreenProps {
  /** Allows a configured store to be supplied by the application or tests. */
  dictionaryStore?: DictionaryStore;
}

const languages: DictionaryLanguage[] = ["en", "zh"];

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DictionaryPackRow({
  descriptor,
  language,
  pack,
  onInstall,
  onRemove,
  onRetry,
}: {
  descriptor?: DictionaryPackDescriptor;
  language: DictionaryLanguage;
  pack: DictionaryStoreState["packs"][DictionaryLanguage];
  onInstall: (language: DictionaryLanguage) => void;
  onRemove: (language: DictionaryLanguage) => void;
  onRetry: (language: DictionaryLanguage) => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();
  const name = t(`dictionary.${language === "en" ? "english" : "chinese"}`);
  const actionLabel = (action: string) => t("dictionary.actionLabel", { action, language: name });
  const descriptorSize = descriptor ? formatBytes(descriptor.sizeBytes) : null;
  const unavailable = !descriptor && pack.state === "not-installed";

  const status = (() => {
    if (unavailable) return t("dictionary.unavailable");

    switch (pack.state) {
      case "verifying":
        return t("dictionary.verifying");
      case "downloading":
        return t("dictionary.downloading", {
          progress: Math.round(pack.progress * 100),
        });
      case "installed":
        return t("dictionary.installedStatus", {
          installed: t("dictionary.installed"),
          size: formatBytes(pack.sizeBytes),
          version: t("dictionary.version", { version: pack.version }),
        });
      case "update-available":
        return t("dictionary.updateStatus", {
          availableVersion: pack.availableVersion,
          installedVersion: pack.installedVersion,
          updateAvailable: t("dictionary.updateAvailable"),
        });
      case "error":
        return t("dictionary.packError", { language: name });
      default:
        return t("dictionary.notDownloaded");
    }
  })();

  return (
    <View style={styles.packRow}>
      <View style={styles.packCopy}>
        <Text style={styles.packName}>{name}</Text>
        <Text style={styles.statusText}>{status}</Text>
        {(pack.state === "not-installed" || pack.state === "update-available") && descriptorSize ? (
          <Text style={styles.metaText}>{t("dictionary.size", { size: descriptorSize })}</Text>
        ) : null}
        {descriptor ? (
          <View style={styles.licenseLine}>
            <TouchableOpacity
              accessibilityLabel={t("dictionary.attributionLabel", { language: name })}
              accessibilityRole="button"
              onPress={() => void Linking.openURL(descriptor.attributionUrl)}
            >
              <Text style={styles.linkText}>{t("dictionary.attribution")}</Text>
            </TouchableOpacity>
            <Text style={styles.metaText}>
              {"· "}
              {t("dictionary.licenseDetail", {
                label: t("dictionary.license"),
                license: descriptor.license,
              })}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        {pack.state === "not-installed" && !unavailable ? (
          <ActionButton
            accessibilityLabel={actionLabel(t("dictionary.download"))}
            label={t("dictionary.download")}
            onPress={() => onInstall(language)}
          />
        ) : null}
        {pack.state === "downloading" || pack.state === "verifying" ? (
          <ActivityIndicator
            accessibilityLabel={t("dictionary.statusLabel", { language: name, status })}
            color={colors.primary}
          />
        ) : null}
        {pack.state === "installed" ? (
          <ActionButton
            destructive
            accessibilityLabel={actionLabel(t("dictionary.remove"))}
            label={t("dictionary.remove")}
            onPress={() => onRemove(language)}
          />
        ) : null}
        {pack.state === "update-available" ? (
          <>
            <ActionButton
              accessibilityLabel={actionLabel(t("dictionary.update"))}
              label={t("dictionary.update")}
              onPress={() => onInstall(language)}
            />
            <ActionButton
              destructive
              accessibilityLabel={actionLabel(t("dictionary.remove"))}
              label={t("dictionary.remove")}
              onPress={() => onRemove(language)}
            />
          </>
        ) : null}
        {pack.state === "error" ? (
          <>
            {descriptor ? (
              <ActionButton
                accessibilityLabel={actionLabel(
                  t(pack.hasActivePack ? "dictionary.repair" : "dictionary.retry"),
                )}
                label={t(pack.hasActivePack ? "dictionary.repair" : "dictionary.retry")}
                onPress={() => onRetry(language)}
              />
            ) : null}
            {pack.hasActivePack ? (
              <ActionButton
                destructive
                accessibilityLabel={actionLabel(t("dictionary.remove"))}
                label={t("dictionary.remove")}
                onPress={() => onRemove(language)}
              />
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

function ActionButton({
  accessibilityLabel,
  destructive = false,
  label,
  onPress,
}: {
  accessibilityLabel: string;
  destructive?: boolean;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.actionButton, destructive && styles.destructiveButton]}
    >
      <Text style={[styles.actionLabel, destructive && styles.destructiveLabel]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function DictionarySettingsScreen({
  dictionaryStore = useDictionaryStore,
}: DictionarySettingsScreenProps) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const layout = useResponsiveLayout();
  const { t } = useTranslation();
  const manifest = dictionaryStore((state) => state.manifest);
  const packs = dictionaryStore((state) => state.packs);
  const initialize = dictionaryStore((state) => state.initialize);
  const install = dictionaryStore((state) => state.install);
  const remove = dictionaryStore((state) => state.remove);

  useEffect(() => {
    void initialize().catch((error) =>
      console.warn("[DictionarySettings] failed to initialize dictionary packs", error),
    );
  }, [initialize]);

  useEffect(() => {
    for (const language of languages) {
      const pack = packs[language];
      if (pack.state === "error") {
        console.warn("[DictionarySettings] dictionary pack error", {
          error: pack.message,
          language,
        });
      }
    }
  }, [packs]);

  const handleInstall = (language: DictionaryLanguage) => {
    void install(language).catch((error) =>
      console.warn(`[DictionarySettings] failed to install ${language} dictionary`, error),
    );
  };

  const handleRemove = (language: DictionaryLanguage) => {
    const languageName = t(`dictionary.${language === "en" ? "english" : "chinese"}`);
    Alert.alert(
      t("dictionary.removeTitle", { language: languageName }),
      t("dictionary.removeMessage", {
        language: languageName,
      }),
      [
        { text: t("dictionary.cancel"), style: "cancel" },
        {
          text: t("dictionary.remove"),
          style: "destructive",
          onPress: () =>
            void remove(language).catch((error) =>
              console.warn(`[DictionarySettings] failed to remove ${language} dictionary`, error),
            ),
        },
      ],
    );
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <SettingsHeader title={t("dictionary.dictionaries")} />
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { alignItems: "center" }]}
      >
        <View
          style={[styles.contentColumn, { width: "100%", maxWidth: layout.centeredContentWidth }]}
        >
          <Text style={styles.sectionTitle}>{t("dictionary.manageDictionaries")}</Text>
          <View style={styles.listCard}>
            {languages.map((language, index) => (
              <View
                key={language}
                style={index < languages.length - 1 ? styles.rowBorder : undefined}
              >
                <DictionaryPackRow
                  descriptor={manifest?.packs[language]}
                  language={language}
                  pack={packs[language]}
                  onInstall={handleInstall}
                  onRemove={handleRemove}
                  onRetry={handleInstall}
                />
              </View>
            ))}
          </View>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { padding: spacing.lg, paddingBottom: 56 },
    contentColumn: {},
    sectionTitle: {
      color: colors.foreground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      marginBottom: 10,
    },
    listCard: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: radius.xl,
      borderWidth: 1,
      overflow: "hidden",
    },
    rowBorder: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    packRow: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: spacing.md,
      justifyContent: "space-between",
      padding: spacing.lg,
    },
    packCopy: { flex: 1, gap: 3 },
    packName: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.medium },
    statusText: { color: colors.mutedForeground, fontSize: fontSize.sm, lineHeight: 20 },
    metaText: { color: colors.mutedForeground, fontSize: fontSize.xs, lineHeight: 18 },
    licenseLine: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", marginTop: 2 },
    linkText: { color: colors.primary, fontSize: fontSize.xs, lineHeight: 18 },
    actions: { alignItems: "flex-end", gap: spacing.sm },
    actionButton: {
      borderColor: colors.primary,
      borderRadius: radius.lg,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    actionLabel: { color: colors.primary, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
    destructiveButton: { borderColor: colors.destructive },
    destructiveLabel: { color: colors.destructive },
  });
