import { useUpdateStore } from "@/stores/update-store";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  useColors,
  withOpacity,
} from "@/styles/theme";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";

/**
 * Themed update dialog — shown when a new version is detected.
 * Finds the `.apk` asset from the GitHub release and opens it via Linking.
 */
export function UpdateDialog() {
  const colors = useColors();
  const { t } = useTranslation();
  const dialogVisible = useUpdateStore((s) => s.dialogVisible);
  const checkResult = useUpdateStore((s) => s.checkResult);
  const hideDialog = useUpdateStore((s) => s.hideDialog);
  const dismissVersion = useUpdateStore((s) => s.dismissVersion);

  const release = checkResult?.release;
  const version = release?.version ?? checkResult?.latestVersion;

  const apkUrl = useMemo(() => {
    if (!release?.assets) return null;
    const apk = release.assets.find((a) => a.name.endsWith(".apk"));
    return apk?.downloadUrl ?? null;
  }, [release]);

  const downloadUrl = apkUrl ?? release?.htmlUrl ?? null;

  const notes = useMemo(() => {
    if (!release?.notes) return "";
    // Strip markdown headings, links, images, bold/italic — keep plain text
    const plain = release.notes
      .replace(/#{1,6}\s*/g, "")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[([^\]]*)\]\(.*?\)/g, "$1")
      .replace(/[*_~`]/g, "")
      .trim();
    return plain.length > 200 ? `${plain.slice(0, 200)}...` : plain;
  }, [release]);

  const handleDownload = useCallback(() => {
    if (downloadUrl) {
      Linking.openURL(downloadUrl);
    }
    hideDialog();
  }, [downloadUrl, hideDialog]);

  const handleLater = useCallback(() => {
    if (version) {
      dismissVersion(version);
    } else {
      hideDialog();
    }
  }, [version, dismissVersion, hideDialog]);

  if (!dialogVisible || !checkResult?.hasUpdate) return null;

  const s = makeStyles(colors);

  return (
    <Modal transparent animationType="fade" onRequestClose={handleLater}>
      <Pressable style={s.overlay} onPress={handleLater}>
        <Pressable style={s.card} onPress={() => {}}>
          {/* Version badge */}
          <View style={s.badgeRow}>
            <View style={[s.badge, { backgroundColor: withOpacity(colors.primary, 0.12) }]}>
              <Text style={[s.badgeText, { color: colors.primary }]}>v{version}</Text>
            </View>
          </View>

          {/* Title */}
          <Text style={s.title}>{t("settings.updateAvailable")}</Text>

          {/* Description */}
          <Text style={s.description}>{t("settings.newVersionAvailable", { version })}</Text>

          {/* Release notes */}
          {notes.length > 0 && (
            <View style={s.notesBox}>
              <Text style={s.notesText} numberOfLines={5}>
                {notes}
              </Text>
            </View>
          )}

          {/* Actions */}
          <View style={s.actions}>
            <TouchableOpacity style={s.primaryBtn} onPress={handleDownload} activeOpacity={0.8}>
              <Text style={s.primaryBtnText}>{t("settings.downloadUpdate")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryBtn} onPress={handleLater} activeOpacity={0.7}>
              <Text style={s.secondaryBtnText}>{t("settings.later")}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.xxl,
    },
    card: {
      width: "100%",
      maxWidth: 340,
      backgroundColor: colors.card,
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.xxl,
    },
    badgeRow: {
      flexDirection: "row",
      justifyContent: "center",
      marginBottom: spacing.md,
    },
    badge: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.full,
    },
    badgeText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    title: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      color: colors.foreground,
      textAlign: "center",
      marginBottom: spacing.sm,
    },
    description: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
      marginBottom: spacing.lg,
    },
    notesBox: {
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },
    notesText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      lineHeight: 18,
    },
    actions: {
      gap: spacing.sm,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.xl,
      paddingVertical: 12,
      alignItems: "center",
    },
    primaryBtnText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: colors.primaryForeground,
    },
    secondaryBtn: {
      borderRadius: radius.xl,
      paddingVertical: 10,
      alignItems: "center",
    },
    secondaryBtnText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
  });
