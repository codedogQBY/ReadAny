import { useTranslation } from "react-i18next";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import { PasswordInput } from "../../../components/ui/PasswordInput";
import { useColors } from "../../../styles/theme";
import { makeStyles } from "./sync-styles";

interface S3FormProps {
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3RemoteRoot: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3PathStyle: boolean;
  testing: boolean;
  testResult: "success" | "error" | null;
  testError: string;
  saving: boolean;
  onChangeEndpoint: (v: string) => void;
  onChangeRegion: (v: string) => void;
  onChangeBucket: (v: string) => void;
  onChangeRemoteRoot: (v: string) => void;
  onChangeAccessKeyId: (v: string) => void;
  onChangeSecretAccessKey: (v: string) => void;
  onTogglePathStyle: () => void;
  onTest: () => void;
  onSave: () => void;
}

export function S3Form({
  s3Endpoint,
  s3Region,
  s3Bucket,
  s3RemoteRoot,
  s3AccessKeyId,
  s3SecretAccessKey,
  s3PathStyle,
  testing,
  testResult,
  testError,
  saving,
  onChangeEndpoint,
  onChangeRegion,
  onChangeBucket,
  onChangeRemoteRoot,
  onChangeAccessKeyId,
  onChangeSecretAccessKey,
  onTogglePathStyle,
  onTest,
  onSave,
}: S3FormProps) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();

  return (
    <View style={[styles.section, styles.sectionSpaced]}>
      <Text style={styles.sectionTitle}>{t("settings.syncConnection")}</Text>
      <View style={styles.card}>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t("settings.syncS3Endpoint")}</Text>
          <TextInput
            style={styles.input}
            value={s3Endpoint}
            onChangeText={onChangeEndpoint}
            placeholder="https://s3.amazonaws.com"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t("settings.syncS3Region")}</Text>
          <TextInput
            style={styles.input}
            value={s3Region}
            onChangeText={onChangeRegion}
            placeholder="us-east-1"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t("settings.syncS3Bucket")}</Text>
          <TextInput
            style={styles.input}
            value={s3Bucket}
            onChangeText={onChangeBucket}
            placeholder="my-bucket"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>
            {t("settings.syncS3RemoteRoot", t("settings.syncRemoteRoot"))}
          </Text>
          <TextInput
            style={styles.input}
            value={s3RemoteRoot}
            onChangeText={onChangeRemoteRoot}
            placeholder={t("settings.syncRemoteRootPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />
          <Text style={[styles.autoSyncDesc, { marginTop: 6 }]}>
            {t("settings.syncS3RemoteRootDesc", t("settings.syncRemoteRootDesc"))}
          </Text>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t("settings.syncS3AccessKeyId")}</Text>
          <TextInput
            style={styles.input}
            value={s3AccessKeyId}
            onChangeText={onChangeAccessKeyId}
            placeholder="AKIAIOSFODNN7EXAMPLE"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t("settings.syncS3SecretAccessKey")}</Text>
          <PasswordInput
            style={styles.input}
            value={s3SecretAccessKey}
            onChangeText={onChangeSecretAccessKey}
            placeholder={t("settings.syncS3SecretAccessKey")}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
        </View>

        <View style={styles.autoSyncRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.autoSyncLabel}>{t("settings.syncS3PathStyle")}</Text>
          </View>
          <TouchableOpacity
            style={[styles.toggle, s3PathStyle && styles.toggleActive]}
            onPress={onTogglePathStyle}
          >
            <View style={[styles.toggleThumb, s3PathStyle && styles.toggleThumbActive]} />
          </TouchableOpacity>
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.outlineBtn, (!s3Endpoint || !s3Bucket || testing) && styles.btnDisabled]}
            onPress={onTest}
            disabled={testing || !s3Endpoint || !s3Bucket}
            activeOpacity={0.7}
          >
            <Text style={styles.outlineBtnText}>
              {testing ? t("settings.syncTesting") : t("settings.syncTestConnection")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              (saving || !s3Endpoint || !s3Bucket || !s3AccessKeyId) && styles.btnDisabled,
            ]}
            onPress={onSave}
            disabled={saving || !s3Endpoint || !s3Bucket || !s3AccessKeyId}
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
