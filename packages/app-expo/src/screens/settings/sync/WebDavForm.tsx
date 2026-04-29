import { useTranslation } from "react-i18next";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import { PasswordInput } from "../../../components/ui/PasswordInput";
import { useColors } from "../../../styles/theme";
import { makeStyles } from "./sync-styles";

interface WebDavFormProps {
  url: string;
  username: string;
  password: string;
  remoteRoot: string;
  allowInsecure: boolean;
  testing: boolean;
  testResult: "success" | "error" | null;
  testError: string;
  saving: boolean;
  onChangeUrl: (v: string) => void;
  onChangeUsername: (v: string) => void;
  onChangePassword: (v: string) => void;
  onChangeRemoteRoot: (v: string) => void;
  onToggleAllowInsecure: () => void;
  onTest: () => void;
  onSave: () => void;
}

export function WebDavForm({
  url,
  username,
  password,
  remoteRoot,
  allowInsecure,
  testing,
  testResult,
  testError,
  saving,
  onChangeUrl,
  onChangeUsername,
  onChangePassword,
  onChangeRemoteRoot,
  onToggleAllowInsecure,
  onTest,
  onSave,
}: WebDavFormProps) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();

  return (
    <View style={[styles.section, styles.sectionSpaced]}>
      <Text style={styles.sectionTitle}>{t("settings.syncConnection")}</Text>
      <View style={styles.card}>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t("settings.syncUrl")}</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={onChangeUrl}
            placeholder={t("settings.syncUrlPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            keyboardType="url"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t("settings.syncUsername")}</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={onChangeUsername}
            placeholder={t("settings.syncUsername")}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t("settings.syncPassword")}</Text>
          <PasswordInput
            style={styles.input}
            value={password}
            onChangeText={onChangePassword}
            placeholder={t("settings.syncPassword")}
            placeholderTextColor={colors.mutedForeground}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t("settings.syncRemoteRoot")}</Text>
          <TextInput
            style={styles.input}
            value={remoteRoot}
            onChangeText={onChangeRemoteRoot}
            placeholder={t("settings.syncRemoteRootPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
          />
          <Text style={[styles.autoSyncDesc, { marginTop: 6 }]}>
            {t("settings.syncRemoteRootDesc")}
          </Text>
        </View>

        <View style={styles.autoSyncRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.autoSyncLabel}>{t("settings.syncAllowInsecure")}</Text>
            <Text style={styles.autoSyncDesc}>{t("settings.syncAllowInsecureDescMobile")}</Text>
          </View>
          <TouchableOpacity
            style={[styles.toggle, allowInsecure && styles.toggleActive]}
            onPress={onToggleAllowInsecure}
          >
            <View style={[styles.toggleThumb, allowInsecure && styles.toggleThumbActive]} />
          </TouchableOpacity>
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.outlineBtn, (!url || testing) && styles.btnDisabled]}
            onPress={onTest}
            disabled={testing || !url}
            activeOpacity={0.7}
          >
            <Text style={styles.outlineBtnText}>
              {testing ? t("settings.syncTesting") : t("settings.syncTestConnection")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtn, (saving || !url || !username) && styles.btnDisabled]}
            onPress={onSave}
            disabled={saving || !url || !username}
            activeOpacity={0.7}
          >
            <Text style={styles.primaryBtnText}>{t("settings.syncSave")}</Text>
          </TouchableOpacity>
        </View>

        {testResult === "success" && (
          <Text style={styles.successText}>{t("settings.syncTestSuccess")}</Text>
        )}
        {testResult === "error" && (
          <Text style={styles.errorText}>{t("settings.syncTestFailed", { error: testError })}</Text>
        )}
      </View>
    </View>
  );
}
