import { ConfigTransfer } from "../../components/settings/ConfigTransfer";
import { getPlatformService } from "@readany/core/services";
import { useSyncStore } from "@readany/core/stores";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import type { S3Config, WebDavConfig } from "@readany/core/sync/sync-backend";
import { SYNC_SECRET_KEYS } from "@readany/core/sync/sync-backend";
/**
 * SyncSettingsScreen — Multi-backend sync configuration and status panel (mobile).
 * Supports WebDAV, S3, and LAN sync.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Constants from "expo-constants";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { spacing, useColors } from "../../styles/theme";
import { SettingsHeader } from "./SettingsHeader";
import { makeStyles } from "./sync/sync-styles";
import { WebDavForm } from "./sync/WebDavForm";
import { S3Form } from "./sync/S3Form";
import { LanSection } from "./sync/LanSection";

type BackendType = "webdav" | "s3" | "lan";

function isWebDavConfig(config: unknown): config is WebDavConfig {
  return (
    typeof config === "object" && config !== null && (config as WebDavConfig).type === "webdav"
  );
}

function isS3Config(config: unknown): config is S3Config {
  return typeof config === "object" && config !== null && (config as S3Config).type === "s3";
}

function hasAutoSync(config: unknown): config is { autoSync: boolean; syncIntervalMins?: number } {
  return typeof config === "object" && config !== null && "autoSync" in config;
}

export default function SyncSettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();
  const layout = useResponsiveLayout();

  const {
    config,
    isConfigured,
    backendType,
    status,
    lastSyncAt,
    lastResult,
    error,
    progress,
    pendingDirection,
    loadConfig,
    testWebDavConnection,
    saveWebDavConfig,
    testS3Connection,
    saveS3Config,
    syncNow,
    syncWithBackend,
    forceFullSync,
    setAutoSync,
    setSyncIntervalMins,
    resetSync,
  } = useSyncStore();

  const [selectedBackend, setSelectedBackend] = useState<BackendType>("webdav");

  // WebDAV state
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remoteRoot, setRemoteRoot] = useState("readany");
  const [allowInsecure, setAllowInsecure] = useState(false);

  // S3 state
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("auto");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3AccessKeyId, setS3AccessKeyId] = useState("");
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState("");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [syncIntervalInput, setSyncIntervalInput] = useState("30");

  const isBusy = status !== "idle" && status !== "error";
  const isLanContext = selectedBackend === "lan" || backendType === "lan";

  // Pulse animation for indeterminate progress (database phase)
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (isBusy && progress?.phase === "database") {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        ]),
      );
      animation.start();
      return () => animation.stop();
    }
    pulseAnim.setValue(0.4);
  }, [isBusy, progress?.phase, pulseAnim]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (config) {
      setSelectedBackend(config.type);
      if (config.type === "webdav") {
        setUrl(config.url);
        setUsername(config.username);
        setRemoteRoot(config.remoteRoot ?? "readany");
        setAllowInsecure(config.allowInsecure ?? false);
        setSyncIntervalInput(String(config.syncIntervalMins ?? 30));
        getPlatformService()
          .kvGetItem(SYNC_SECRET_KEYS.webdav)
          .then((pw) => {
            if (pw) setPassword(pw);
          });
      } else if (config.type === "s3") {
        setS3Endpoint(config.endpoint);
        setS3Region(config.region);
        setS3Bucket(config.bucket);
        setS3AccessKeyId(config.accessKeyId);
        setSyncIntervalInput(String(config.syncIntervalMins ?? 30));
        getPlatformService()
          .kvGetItem("sync_s3_secret_key")
          .then((key) => {
            if (key) setS3SecretAccessKey(key);
          });
      }
    }
  }, [config]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      let success = false;
      if (selectedBackend === "webdav") {
        const isExpoGo =
          Constants.executionEnvironment === "storeClient" || Constants.appOwnership === "expo";
        const normalizedUrl = url.trim().toLowerCase();
        if (Platform.OS === "android" && isExpoGo && normalizedUrl.startsWith("http://")) {
          throw new Error(t("settings.syncAndroidExpoGoHttpUnsupported"));
        }
        success = await testWebDavConnection(url, username, password, allowInsecure, remoteRoot);
      } else if (selectedBackend === "s3") {
        success = await testS3Connection(
          { endpoint: s3Endpoint, region: s3Region, bucket: s3Bucket, accessKeyId: s3AccessKeyId },
          s3SecretAccessKey,
        );
      }
      setTestResult(success ? "success" : "error");
      if (!success) setTestError(t("common.failed", "Failed"));
    } catch (e) {
      setTestResult("error");
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }, [
    selectedBackend, url, username, password, allowInsecure, remoteRoot,
    s3Endpoint, s3Region, s3Bucket, s3AccessKeyId, s3SecretAccessKey,
    testWebDavConnection, testS3Connection, t,
  ]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (selectedBackend === "webdav") {
        await saveWebDavConfig(url, username, password, allowInsecure, remoteRoot);
      } else if (selectedBackend === "s3") {
        await saveS3Config(
          { endpoint: s3Endpoint, region: s3Region, bucket: s3Bucket, accessKeyId: s3AccessKeyId },
          s3SecretAccessKey,
        );
      }
    } finally {
      setSaving(false);
    }
  }, [
    selectedBackend, url, username, password, allowInsecure, remoteRoot,
    s3Endpoint, s3Region, s3Bucket, s3AccessKeyId, s3SecretAccessKey,
    saveWebDavConfig, saveS3Config,
  ]);

  const handleSync = useCallback(async () => {
    await syncNow();
  }, [syncNow]);

  const handleConflict = useCallback(
    (direction: "upload" | "download") => { syncNow(direction); },
    [syncNow],
  );

  const handleReset = useCallback(() => {
    Alert.alert(t("settings.syncReset"), t("settings.syncResetConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        style: "destructive",
        onPress: () => {
          setSelectedBackend("webdav");
          setUrl("");
          setUsername("");
          setPassword("");
          setRemoteRoot("readany");
          setAllowInsecure(false);
          setS3Endpoint("");
          setS3Region("auto");
          setS3Bucket("");
          setS3AccessKeyId("");
          setS3SecretAccessKey("");
          void resetSync();
        },
      },
    ]);
  }, [t, resetSync]);

  const handleForceFullSync = useCallback(
    (direction: "upload" | "download") => {
      const isUpload = direction === "upload";
      Alert.alert(
        t(isUpload ? "settings.syncForceUpload" : "settings.syncForceDownload"),
        t(isUpload ? "settings.syncForceUploadConfirm" : "settings.syncForceDownloadConfirm"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("common.confirm"),
            style: "destructive",
            onPress: () => { void forceFullSync(direction); },
          },
        ],
      );
    },
    [forceFullSync, t],
  );

  const formatLastSync = (ts: number | null) => {
    if (!ts) return t("settings.syncNever");
    return new Date(ts).toLocaleString();
  };

  const statusLabel = () => {
    if (isLanContext) {
      switch (status) {
        case "checking": return t("settings.syncLANPreparingImport");
        case "downloading": return t("settings.syncLANImporting");
        case "syncing-files": return t("settings.syncLANImportingFiles");
        case "error": return t("settings.syncError");
        default: return null;
      }
    }
    switch (status) {
      case "checking": return t("settings.syncChecking");
      case "uploading": return t("settings.syncUploading");
      case "downloading": return t("settings.syncDownloading");
      case "syncing-files": return t("settings.syncSyncingFiles");
      case "error": return t("settings.syncError");
      default: return null;
    }
  };

  const autoSyncEnabled = hasAutoSync(config) ? config.autoSync : false;
  const showScheduledSyncSettings = hasAutoSync(config);

  const progressLabel = () => {
    if (!progress) return null;
    if (isLanContext) {
      return progress.phase === "database"
        ? t("settings.syncLANImportProgressDatabase")
        : t("settings.syncLANImportProgressFiles", {
            completed: progress.completedFiles,
            total: progress.totalFiles,
          });
    }
    return progress.phase === "database"
      ? t("settings.syncProgressDatabase", {
          operation: progress.operation === "upload"
            ? t("settings.syncUploading")
            : t("settings.syncDownloading"),
        })
      : t("settings.syncProgressFiles", {
          operation: progress.operation === "upload"
            ? t("settings.syncUploading")
            : t("settings.syncDownloading"),
          completed: progress.completedFiles,
          total: progress.totalFiles,
        });
  };

  const handleSyncIntervalBlur = useCallback(async () => {
    const parsed = Number.parseInt(syncIntervalInput, 10);
    const nextValue = Number.isFinite(parsed) ? Math.max(5, Math.min(720, parsed)) : 30;
    setSyncIntervalInput(String(nextValue));
    await setSyncIntervalMins(nextValue);
  }, [setSyncIntervalMins, syncIntervalInput]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <SettingsHeader title={t("settings.syncTitle")} />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { alignItems: "center" }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={[styles.contentColumn, { width: "100%", maxWidth: layout.centeredContentWidth }]}>
            {/* Backend Type Selector */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("settings.syncBackendType")}</Text>
              <View style={styles.backendSelector}>
                {(["webdav", "s3", "lan"] as const).map((backend) => (
                  <TouchableOpacity
                    key={backend}
                    style={[styles.backendBtn, selectedBackend === backend && styles.backendBtnActive]}
                    onPress={() => setSelectedBackend(backend)}
                  >
                    <Text
                      style={[
                        styles.backendBtnText,
                        selectedBackend === backend && styles.backendBtnTextActive,
                      ]}
                    >
                      {backend === "webdav" ? "WebDAV" : backend === "s3" ? "S3" : "LAN"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {selectedBackend === "webdav" && (
              <WebDavForm
                url={url}
                username={username}
                password={password}
                remoteRoot={remoteRoot}
                allowInsecure={allowInsecure}
                testing={testing}
                testResult={testResult}
                testError={testError}
                saving={saving}
                onChangeUrl={setUrl}
                onChangeUsername={setUsername}
                onChangePassword={setPassword}
                onChangeRemoteRoot={setRemoteRoot}
                onToggleAllowInsecure={() => setAllowInsecure(!allowInsecure)}
                onTest={handleTest}
                onSave={handleSave}
              />
            )}

            {selectedBackend === "s3" && (
              <S3Form
                s3Endpoint={s3Endpoint}
                s3Region={s3Region}
                s3Bucket={s3Bucket}
                s3AccessKeyId={s3AccessKeyId}
                s3SecretAccessKey={s3SecretAccessKey}
                testing={testing}
                testResult={testResult}
                testError={testError}
                saving={saving}
                onChangeEndpoint={setS3Endpoint}
                onChangeRegion={setS3Region}
                onChangeBucket={setS3Bucket}
                onChangeAccessKeyId={setS3AccessKeyId}
                onChangeSecretAccessKey={setS3SecretAccessKey}
                onTest={handleTest}
                onSave={handleSave}
              />
            )}

            {selectedBackend === "lan" && (
              <LanSection
                isBusy={isBusy}
                progress={progress}
                pulseAnim={pulseAnim}
                progressLabel={progressLabel}
                onSyncWithBackend={syncWithBackend}
              />
            )}

            {/* Conflict Resolution */}
            {pendingDirection === "conflict" && (
            <View style={[styles.section, styles.sectionSpaced]}>
              <View style={styles.conflictCard}>
                <Text style={styles.conflictTitle}>{t("settings.syncConflictTitle")}</Text>
                <Text style={styles.conflictDesc}>{t("settings.syncConflictDesc")}</Text>
                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={styles.uploadBtn}
                    onPress={() => handleConflict("upload")}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.uploadBtnText}>{t("settings.syncConflictUpload")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.downloadBtn}
                    onPress={() => handleConflict("download")}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.downloadBtnText}>{t("settings.syncConflictDownload")}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            )}

            {/* Sync Status */}
            {selectedBackend !== "lan" && (isConfigured || isBusy || lastSyncAt) && (
            <View style={[styles.section, styles.sectionSpaced]}>
              <Text style={styles.sectionTitle}>
                {isLanContext ? t("settings.syncLANImportStatus") : t("settings.syncStatus")}
              </Text>
              <View style={styles.card}>
                <View style={styles.syncRow}>
                  <View>
                    <Text style={styles.syncLabel}>
                      {isLanContext ? t("settings.syncLANLastImport") : t("settings.syncLastSync")}
                    </Text>
                    <Text style={styles.syncValue}>{formatLastSync(lastSyncAt)}</Text>
                    {statusLabel() && <Text style={styles.statusText}>{statusLabel()}</Text>}
                    {isBusy && progress && (
                      <View style={styles.progressContainer}>
                        <View style={styles.progressTrack}>
                          {progress.phase === "database" ? (
                            <Animated.View
                              style={[styles.progressFill, { width: "100%", opacity: pulseAnim }]}
                            />
                          ) : (
                            <View
                              style={[
                                styles.progressFill,
                                {
                                  width: `${progress.totalFiles > 0 ? Math.round((progress.completedFiles / progress.totalFiles) * 100) : 0}%`,
                                },
                              ]}
                            />
                          )}
                        </View>
                        <Text style={styles.progressText}>{progressLabel()}</Text>
                      </View>
                    )}
                  </View>
                  {!isLanContext && (
                    <TouchableOpacity
                      style={[styles.syncBtn, isBusy && styles.btnDisabled]}
                      onPress={handleSync}
                      disabled={isBusy}
                      activeOpacity={0.7}
                    >
                      {isBusy && <ActivityIndicator size="small" color={colors.primaryForeground} />}
                      <Text style={styles.syncBtnText}>
                        {isBusy ? t("settings.syncSyncing") : t("settings.syncNow")}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {lastResult && (
                  <View style={styles.resultCard}>
                    {lastResult.success ? (
                      <>
                        <Text style={styles.resultText}>
                          {isLanContext
                            ? t("settings.syncLANImportComplete")
                            : t("settings.syncDirection", { direction: lastResult.direction })}
                        </Text>
                        {lastResult.filesUploaded > 0 && (
                          <Text style={styles.resultText}>
                            {t("settings.syncFilesUp", { count: lastResult.filesUploaded })}
                          </Text>
                        )}
                        {lastResult.filesDownloaded > 0 && (
                          <Text style={styles.resultText}>
                            {isLanContext
                              ? t("settings.syncLANImportedFiles", { count: lastResult.filesDownloaded })
                              : t("settings.syncFilesDown", { count: lastResult.filesDownloaded })}
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text style={styles.errorText}>
                        {t("settings.syncFailed", { error: lastResult.error })}
                      </Text>
                    )}
                  </View>
                )}

                {error && !lastResult && <Text style={styles.errorText}>{error}</Text>}

                {showScheduledSyncSettings && (
                  <>
                    <View style={styles.autoSyncRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.autoSyncLabel}>{t("settings.syncAutoSync")}</Text>
                        <Text style={styles.autoSyncDesc}>{t("settings.syncAutoSyncDesc")}</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.toggle, autoSyncEnabled && styles.toggleActive]}
                        onPress={() => setAutoSync(!autoSyncEnabled)}
                      >
                        <View
                          style={[styles.toggleThumb, autoSyncEnabled && styles.toggleThumbActive]}
                        />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.intervalRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.autoSyncLabel}>{t("settings.syncInterval")}</Text>
                        <Text style={styles.autoSyncDesc}>{t("settings.syncIntervalDesc")}</Text>
                      </View>
                      <View style={styles.intervalInputWrap}>
                        <TextInput
                          style={styles.intervalInput}
                          value={syncIntervalInput}
                          onChangeText={setSyncIntervalInput}
                          onBlur={() => void handleSyncIntervalBlur()}
                          keyboardType="number-pad"
                          returnKeyType="done"
                        />
                        <Text style={styles.intervalSuffix}>
                          {t("settings.syncIntervalMinutes", {
                            count: Number.parseInt(syncIntervalInput || "30", 10) || 30,
                          })}
                        </Text>
                      </View>
                    </View>
                  </>
                )}
              </View>
            </View>
            )}

            {/* Advanced */}
            {isConfigured && selectedBackend !== "lan" && (
            <View style={[styles.section, styles.sectionSpaced]}>
              <TouchableOpacity
                style={styles.advancedHeader}
                onPress={() => setShowAdvanced(!showAdvanced)}
              >
                <Text style={styles.sectionTitle}>{t("settings.syncAdvanced")}</Text>
                <Text style={styles.chevron}>{showAdvanced ? "▲" : "▼"}</Text>
              </TouchableOpacity>
              {showAdvanced && (
                <View style={styles.card}>
                  <View style={styles.btnRow}>
                    <TouchableOpacity
                      style={[styles.uploadBtn, isBusy && styles.btnDisabled]}
                      onPress={() => handleForceFullSync("upload")}
                      disabled={isBusy}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.uploadBtnText}>{t("settings.syncForceUpload")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.downloadBtn, isBusy && styles.btnDisabled]}
                      onPress={() => handleForceFullSync("download")}
                      disabled={isBusy}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.downloadBtnText}>
                        {t("settings.syncForceDownload")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.resetDesc}>{t("settings.syncForceUploadDesc")}</Text>
                  <Text style={styles.resetDesc}>{t("settings.syncForceDownloadDesc")}</Text>
                  <TouchableOpacity
                    style={styles.resetBtn}
                    onPress={handleReset}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.resetBtnText}>{t("settings.syncReset")}</Text>
                  </TouchableOpacity>
                  <Text style={styles.resetDesc}>{t("settings.syncResetDesc")}</Text>
                </View>
              )}
            </View>
            )}

            {/* Transfer sync config */}
            <View style={[styles.section, { marginTop: spacing.lg }]}>
              <Text style={styles.sectionTitle}>{t("settings.transferConfig", "配置迁移")}</Text>
              <ConfigTransfer
                label={t("settings.syncConfig", "同步配置")}
                getData={() => {
                  const base = { backendType, config };
                  if (backendType === "webdav") {
                    return { ...base, password };
                  }
                  if (backendType === "s3") {
                    return { ...base, secretAccessKey: s3SecretAccessKey };
                  }
                  return base;
                }}
                applyData={(data) => {
                  const d = data as Record<string, unknown>;
                  if (d.backendType === "webdav" && d.config) {
                    const cfg = d.config as Record<string, unknown>;
                    saveWebDavConfig(
                      cfg.url as string,
                      cfg.username as string,
                      (d.password as string) || "",
                      cfg.allowInsecure as boolean,
                      cfg.remoteRoot as string,
                    );
                  } else if (d.backendType === "s3" && d.config) {
                    saveS3Config(d.config as never, (d.secretAccessKey as string) || "");
                  }
                }}
                validate={(d) => typeof d === "object" && d !== null && "backendType" in d}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
