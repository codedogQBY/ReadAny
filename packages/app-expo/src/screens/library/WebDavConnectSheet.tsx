import {
  DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT,
  type WebDavImportSource,
} from "@readany/core";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { fontSize, fontWeight, radius, useColors, withOpacity } from "@/styles/theme";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface WebDavConnectSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (source: WebDavImportSource) => Promise<void>;
}

export function WebDavConnectSheet({
  visible,
  onClose,
  onSubmit,
}: WebDavConnectSheetProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();

  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remoteRoot, setRemoteRoot] = useState(DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT);
  const [allowInsecure, setAllowInsecure] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    url.trim().length > 0 && username.trim().length > 0 && password.trim().length > 0 && !submitting;

  const s = useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.36)",
          justifyContent: "flex-end",
        },
        sheet: {
          backgroundColor: colors.background,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16) + 14,
          gap: 14,
        },
        handle: {
          alignSelf: "center",
          width: 38,
          height: 4,
          borderRadius: radius.full,
          backgroundColor: withOpacity(colors.border, 0.9),
        },
        title: {
          fontSize: fontSize.xl,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        subtitle: {
          fontSize: fontSize.sm,
          lineHeight: 20,
          color: colors.mutedForeground,
        },
        form: {
          gap: 12,
        },
        field: {
          gap: 8,
        },
        label: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        input: {
          height: 48,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          paddingHorizontal: 14,
          fontSize: fontSize.base,
          color: colors.foreground,
        },
        helper: {
          fontSize: fontSize.xs,
          lineHeight: 18,
          color: colors.mutedForeground,
        },
        switchRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          paddingHorizontal: 14,
          paddingVertical: 12,
        },
        switchCopy: {
          flex: 1,
          minWidth: 0,
        },
        switchTitle: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        switchDesc: {
          marginTop: 2,
          fontSize: fontSize.xs,
          lineHeight: 18,
          color: colors.mutedForeground,
        },
        errorBox: {
          borderRadius: radius.xl,
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: withOpacity(colors.destructive, 0.08),
          borderWidth: 1,
          borderColor: withOpacity(colors.destructive, 0.18),
        },
        errorText: {
          fontSize: fontSize.sm,
          lineHeight: 20,
          color: colors.destructive,
        },
        footer: {
          flexDirection: "row",
          gap: 10,
        },
        secondaryBtn: {
          flex: 1,
          height: 48,
          borderRadius: radius.xl,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
          alignItems: "center",
          justifyContent: "center",
        },
        primaryBtn: {
          flex: 1.2,
          height: 48,
          borderRadius: radius.xl,
          backgroundColor: canSubmit ? colors.primary : withOpacity(colors.primary, 0.45),
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
        },
        secondaryBtnText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        primaryBtnText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.semibold,
          color: colors.primaryForeground,
        },
      }),
    [canSubmit, colors, insets.bottom],
  );

  const handleConnect = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        kind: "temporary",
        url: url.trim(),
        username: username.trim(),
        password,
        remoteRoot: remoteRoot.trim(),
        allowInsecure,
      });
      setUrl("");
      setUsername("");
      setPassword("");
      setRemoteRoot(DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT);
      setAllowInsecure(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable
          style={[
            s.sheet,
            layout.isTablet && {
              width: "100%",
            },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={s.handle} />
          <View>
            <Text style={s.title}>{t("library.importSourceTemporaryWebDav", "连接其他 WebDAV")}</Text>
            <Text style={s.subtitle}>
              {t(
                "library.importSourceTemporaryWebDavDesc",
                "临时输入另一个地址、账号和文件夹，这次导完就走，不会改动当前同步配置。",
              )}
            </Text>
          </View>

          <View style={s.form}>
            <View style={s.field}>
              <Text style={s.label}>{t("settings.webdavUrl", "WebDAV Server URL")}</Text>
              <TextInput
                style={s.input}
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="https://dav.example.com"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <View style={s.field}>
              <Text style={s.label}>{t("settings.webdavUsername", "Username")}</Text>
              <TextInput
                style={s.input}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t("settings.webdavUsername", "Username")}
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <View style={s.field}>
              <Text style={s.label}>{t("settings.webdavPassword", "App Password")}</Text>
              <TextInput
                style={s.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t("settings.webdavPassword", "App Password")}
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <View style={s.field}>
              <Text style={s.label}>{t("settings.syncRemoteRoot", "远端文件夹")}</Text>
              <TextInput
                style={s.input}
                value={remoteRoot}
                onChangeText={setRemoteRoot}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t("library.webdavImportRemoteRootPlaceholder", "留空则从服务器基准目录开始")}
                placeholderTextColor={colors.mutedForeground}
              />
              <Text style={s.helper}>
                {t(
                  "library.importRemoteRootHint",
                  "可以填写任意多级路径；留空时会从当前 WebDAV 服务的基准目录开始浏览。",
                )}
              </Text>
            </View>
            <View style={s.switchRow}>
              <View style={s.switchCopy}>
                <Text style={s.switchTitle}>
                  {t("settings.syncAllowInsecure", "允许不安全连接")}
                </Text>
                <Text style={s.switchDesc}>
                  {t(
                    "library.importAllowInsecureHint",
                    "对自签名证书或纯 HTTP 服务有帮助，生产环境仍建议使用 HTTPS。",
                  )}
                </Text>
              </View>
              <Switch value={allowInsecure} onValueChange={setAllowInsecure} />
            </View>
          </View>

          {error ? (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={s.footer}>
            <TouchableOpacity style={s.secondaryBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={s.secondaryBtnText}>{t("common.cancel", "取消")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.primaryBtn}
              onPress={handleConnect}
              activeOpacity={0.9}
              disabled={!canSubmit}
            >
              {submitting ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : null}
              <Text style={s.primaryBtnText}>
                {submitting
                  ? t("library.webdavImportConnecting", "连接中...")
                  : t("library.webdavImportConnectAndBrowse", "连接并浏览")}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
