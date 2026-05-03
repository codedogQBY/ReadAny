import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import { useSyncStore } from "@/stores/sync-store";
import { getPlatformService } from "@readany/core/services";
import { Cloud, Database, Download, Upload, Wifi } from "lucide-react";
/**
 * SyncSettings — Multi-backend sync configuration and status panel.
 * Supports WebDAV, S3, and LAN sync.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfigTransfer } from "./ConfigTransfer";
import { LANSyncDialog } from "./LANSyncDialog";

type BackendType = "webdav" | "s3" | "lan";

export function SyncSettings() {
  const { t } = useTranslation();
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
    forceFullSync,
    setAutoSync,
    setSyncIntervalMins,
    resetSync,
  } = useSyncStore();

  // WebDAV state
  const [webdavUrl, setWebdavUrl] = useState("");
  const [webdavUsername, setWebdavUsername] = useState("");
  const [webdavPassword, setWebdavPassword] = useState("");
  const [webdavRemoteRoot, setWebdavRemoteRoot] = useState("readany");
  const [webdavAllowInsecure, setWebdavAllowInsecure] = useState(false);

  // S3 state
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("auto");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3AccessKeyId, setS3AccessKeyId] = useState("");
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState("");
  const [s3PathStyle, setS3PathStyle] = useState(false);

  // UI state
  const [selectedBackend, setSelectedBackend] = useState<BackendType>("webdav");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [syncIntervalInput, setSyncIntervalInput] = useState("30");

  // LAN dialog state
  const [lanDialogOpen, setLanDialogOpen] = useState(false);
  const [lanDialogMode, setLanDialogMode] = useState<"server" | "client">("server");

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Load saved config when it changes
  useEffect(() => {
    if (config) {
      setSelectedBackend(config.type);
      if (config.type === "webdav") {
        setWebdavUrl(config.url);
        setWebdavUsername(config.username);
        setWebdavRemoteRoot(config.remoteRoot ?? "readany");
        setWebdavAllowInsecure(config.allowInsecure ?? false);
        setSyncIntervalInput(String(config.syncIntervalMins ?? 30));
        getPlatformService()
          .kvGetItem("sync_webdav_password")
          .then((pw) => {
            if (pw) setWebdavPassword(pw);
          });
      } else if (config.type === "s3") {
        setS3Endpoint(config.endpoint);
        setS3Region(config.region);
        setS3Bucket(config.bucket);
        setS3AccessKeyId(config.accessKeyId);
        setS3PathStyle(config.pathStyle ?? false);
        setSyncIntervalInput(String(config.syncIntervalMins ?? 30));
        getPlatformService()
          .kvGetItem("sync_s3_secret_key")
          .then((key) => {
            if (key) setS3SecretAccessKey(key);
          });
      }
    }
  }, [config]);

  const isBusy = status !== "idle" && status !== "error";
  const isLanContext = selectedBackend === "lan" || backendType === "lan";
  const showScheduledSyncSettings = config?.type === "webdav" || config?.type === "s3";

  const handleTestWebDav = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      const success = await testWebDavConnection(
        webdavUrl,
        webdavUsername,
        webdavPassword,
        webdavAllowInsecure,
        webdavRemoteRoot,
      );
      setTestResult(success ? "success" : "error");
      if (!success) {
        setTestError(t("common.failed", "Failed"));
      }
    } catch (e) {
      setTestResult("error");
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }, [
    webdavUrl,
    webdavUsername,
    webdavPassword,
    webdavAllowInsecure,
    webdavRemoteRoot,
    testWebDavConnection,
    t,
  ]);

  const handleSaveWebDav = useCallback(async () => {
    setSaving(true);
    try {
      await saveWebDavConfig(
        webdavUrl,
        webdavUsername,
        webdavPassword,
        webdavAllowInsecure,
        webdavRemoteRoot,
      );
    } finally {
      setSaving(false);
    }
  }, [
    webdavUrl,
    webdavUsername,
    webdavPassword,
    webdavAllowInsecure,
    webdavRemoteRoot,
    saveWebDavConfig,
  ]);

  const handleTestS3 = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      const success = await testS3Connection(
        {
          endpoint: s3Endpoint,
          region: s3Region,
          bucket: s3Bucket,
          accessKeyId: s3AccessKeyId,
          pathStyle: s3PathStyle,
        },
        s3SecretAccessKey,
      );
      setTestResult(success ? "success" : "error");
      if (!success) {
        setTestError(t("common.failed", "Failed"));
      }
    } catch (e) {
      setTestResult("error");
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }, [
    s3Endpoint,
    s3Region,
    s3Bucket,
    s3AccessKeyId,
    s3SecretAccessKey,
    s3PathStyle,
    testS3Connection,
    t,
  ]);

  const handleSaveS3 = useCallback(async () => {
    setSaving(true);
    try {
      await saveS3Config(
        {
          endpoint: s3Endpoint,
          region: s3Region,
          bucket: s3Bucket,
          accessKeyId: s3AccessKeyId,
          pathStyle: s3PathStyle,
        },
        s3SecretAccessKey,
      );
    } finally {
      setSaving(false);
    }
  }, [s3Endpoint, s3Region, s3Bucket, s3AccessKeyId, s3SecretAccessKey, s3PathStyle, saveS3Config]);

  const handleSync = useCallback(async () => {
    await syncNow();
  }, [syncNow]);

  const handleConflict = useCallback(
    async (direction: "upload" | "download") => {
      await syncNow(direction);
    },
    [syncNow],
  );

  const handleReset = useCallback(async () => {
    if (window.confirm(t("settings.syncResetConfirm"))) {
      await resetSync();
      setSelectedBackend("webdav");
      setWebdavUrl("");
      setWebdavUsername("");
      setWebdavPassword("");
      setWebdavRemoteRoot("readany");
      setS3Endpoint("");
      setS3Region("auto");
      setS3Bucket("");
      setS3AccessKeyId("");
      setS3SecretAccessKey("");
    }
  }, [resetSync, t]);

  const handleForceFullUpload = useCallback(async () => {
    if (window.confirm(t("settings.syncForceUploadConfirm"))) {
      await forceFullSync("upload");
    }
  }, [forceFullSync, t]);

  const handleForceFullDownload = useCallback(async () => {
    if (window.confirm(t("settings.syncForceDownloadConfirm"))) {
      await forceFullSync("download");
    }
  }, [forceFullSync, t]);

  const formatLastSync = (ts: number | null) => {
    if (!ts) return t("settings.syncNever");
    return new Date(ts).toLocaleString();
  };

  const handleSyncIntervalBlur = useCallback(async () => {
    const parsed = Number.parseInt(syncIntervalInput, 10);
    const nextValue = Number.isFinite(parsed) ? Math.max(5, Math.min(720, parsed)) : 30;
    setSyncIntervalInput(String(nextValue));
    await setSyncIntervalMins(nextValue);
  }, [setSyncIntervalMins, syncIntervalInput]);

  const statusLabel = () => {
    if (isLanContext) {
      switch (status) {
        case "checking":
          return t("settings.syncLANPreparingImport");
        case "downloading":
          return t("settings.syncLANImporting");
        case "syncing-files":
          return t("settings.syncLANImportingFiles");
        case "error":
          return t("settings.syncError");
        default:
          return null;
      }
    }

    switch (status) {
      case "checking":
        return t("settings.syncChecking");
      case "uploading":
        return t("settings.syncUploading");
      case "downloading":
        return t("settings.syncDownloading");
      case "syncing-files":
        return t("settings.syncSyncingFiles");
      case "error":
        return t("settings.syncError");
      default:
        return null;
    }
  };

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
          operation:
            progress.operation === "upload"
              ? t("settings.syncUploading")
              : t("settings.syncDownloading"),
        })
      : t("settings.syncProgressFiles", {
          operation:
            progress.operation === "upload"
              ? t("settings.syncUploading")
              : t("settings.syncDownloading"),
          completed: progress.completedFiles,
          total: progress.totalFiles,
        });
  };

  const renderBackendSelector = () => (
    <section id="tour-sync-backend" className="rounded-lg bg-muted/60 p-4">
      <h2 className="mb-4 text-sm font-medium text-foreground">{t("settings.syncBackendType")}</h2>
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => setSelectedBackend("webdav")}
          className={`rounded-lg border p-3 text-left transition-colors ${
            selectedBackend === "webdav"
              ? "border-primary bg-primary/10"
              : "border-input bg-background hover:bg-muted/50"
          }`}
        >
          <Cloud className="h-5 w-5 mb-1.5 text-muted-foreground" />
          <div className="text-sm font-medium">WebDAV</div>
          <div className="text-xs text-muted-foreground mt-0.5">{t("settings.syncWebdavDesc")}</div>
        </button>
        <button
          onClick={() => setSelectedBackend("s3")}
          className={`rounded-lg border p-3 text-left transition-colors ${
            selectedBackend === "s3"
              ? "border-primary bg-primary/10"
              : "border-input bg-background hover:bg-muted/50"
          }`}
        >
          <Database className="h-5 w-5 mb-1.5 text-muted-foreground" />
          <div className="text-sm font-medium">S3</div>
          <div className="text-xs text-muted-foreground mt-0.5">{t("settings.syncS3Desc")}</div>
        </button>
        <button
          onClick={() => setSelectedBackend("lan")}
          className={`rounded-lg border p-3 text-left transition-colors ${
            selectedBackend === "lan"
              ? "border-primary bg-primary/10"
              : "border-input bg-background hover:bg-muted/50"
          }`}
        >
          <Wifi className="h-5 w-5 mb-1.5 text-muted-foreground" />
          <div className="text-sm font-medium">LAN</div>
          <div className="text-xs text-muted-foreground mt-0.5">{t("settings.syncLANDesc")}</div>
        </button>
      </div>
    </section>
  );

  const renderWebDavConfig = () => (
    <section className="rounded-lg bg-muted/60 p-4">
      <h2 className="mb-4 text-sm font-medium text-foreground">{t("settings.syncWebDavConfig")}</h2>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm text-foreground">{t("settings.syncUrl")}</label>
          <input
            type="url"
            value={webdavUrl}
            onChange={(e) => setWebdavUrl(e.target.value)}
            placeholder={t("settings.syncUrlPlaceholder")}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm text-foreground">
              {t("settings.syncUsername")}
            </label>
            <input
              type="text"
              value={webdavUsername}
              onChange={(e) => setWebdavUsername(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-foreground">
              {t("settings.syncPassword")}
            </label>
            <PasswordInput
              value={webdavPassword}
              onChange={(e) => setWebdavPassword(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm text-foreground">{t("settings.syncRemoteRoot")}</label>
          <input
            type="text"
            value={webdavRemoteRoot}
            onChange={(e) => setWebdavRemoteRoot(e.target.value)}
            placeholder={t("settings.syncRemoteRootPlaceholder")}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.syncRemoteRootDesc")}</p>
        </div>
        <div className="flex items-center justify-between pt-1">
          <div>
            <span className="text-sm text-foreground">{t("settings.syncAllowInsecure")}</span>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.syncAllowInsecureDesc")}</p>
          </div>
          <Switch
            checked={webdavAllowInsecure}
            onCheckedChange={(checked) => setWebdavAllowInsecure(checked)}
          />
        </div>
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleTestWebDav}
              disabled={testing || !webdavUrl}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {testing ? t("settings.syncTesting") : t("settings.syncTestConnection")}
            </button>
            <button
              onClick={handleSaveWebDav}
              disabled={saving || !webdavUrl || !webdavUsername}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {t("settings.syncSave")}
            </button>
          </div>
          {testResult === "success" && (
            <p className="text-xs text-green-600">{t("settings.syncTestSuccess")}</p>
          )}
          {testResult === "error" && (
            <p className="text-xs leading-5 break-words text-red-500">
              {t("settings.syncTestFailed", { error: testError })}
            </p>
          )}
        </div>
      </div>
    </section>
  );

  const renderS3Config = () => (
    <section className="rounded-lg bg-muted/60 p-4">
      <h2 className="mb-4 text-sm font-medium text-foreground">{t("settings.syncS3Config")}</h2>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm text-foreground">
              {t("settings.syncS3Endpoint")}
            </label>
            <input
              type="url"
              value={s3Endpoint}
              onChange={(e) => setS3Endpoint(e.target.value)}
              placeholder="https://s3.amazonaws.com"
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-foreground">
              {t("settings.syncS3Region")}
            </label>
            <input
              type="text"
              value={s3Region}
              onChange={(e) => setS3Region(e.target.value)}
              placeholder="us-east-1"
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm text-foreground">{t("settings.syncS3Bucket")}</label>
          <input
            type="text"
            value={s3Bucket}
            onChange={(e) => setS3Bucket(e.target.value)}
            placeholder="my-bucket"
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm text-foreground">
              {t("settings.syncS3AccessKeyId")}
            </label>
            <input
              type="text"
              value={s3AccessKeyId}
              onChange={(e) => setS3AccessKeyId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-foreground">
              {t("settings.syncS3SecretAccessKey")}
            </label>
            <PasswordInput
              value={s3SecretAccessKey}
              onChange={(e) => setS3SecretAccessKey(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="s3PathStyle"
            checked={s3PathStyle}
            onChange={(e) => setS3PathStyle(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          <label htmlFor="s3PathStyle" className="text-sm text-foreground">
            {t("settings.syncS3PathStyle")}
          </label>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleTestS3}
            disabled={testing || !s3Endpoint || !s3Bucket}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {testing ? t("settings.syncTesting") : t("settings.syncTestConnection")}
          </button>
          <button
            onClick={handleSaveS3}
            disabled={saving || !s3Endpoint || !s3Bucket || !s3AccessKeyId}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {t("settings.syncSave")}
          </button>
          {testResult === "success" && (
            <span className="text-xs text-green-600">{t("settings.syncTestSuccess")}</span>
          )}
          {testResult === "error" && (
            <span className="text-xs text-red-500">
              {t("settings.syncTestFailed", { error: testError })}
            </span>
          )}
        </div>
      </div>
    </section>
  );

  const renderLANConfig = () => (
    <section className="rounded-lg bg-muted/60 p-4">
      <h2 className="mb-4 text-sm font-medium text-foreground">{t("settings.syncLANConfig")}</h2>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("settings.syncLANDescFull")}</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            className="rounded-lg border border-input bg-background p-4 text-left transition-colors hover:bg-muted/50"
            onClick={() => {
              setLanDialogMode("server");
              setLanDialogOpen(true);
            }}
          >
            <Upload className="h-5 w-5 mb-1.5 text-muted-foreground" />
            <div className="text-sm font-medium">{t("settings.syncLANServer")}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {t("settings.syncLANServerDesc")}
            </div>
          </button>
          <button
            className="rounded-lg border border-input bg-background p-4 text-left transition-colors hover:bg-muted/50"
            onClick={() => {
              setLanDialogMode("client");
              setLanDialogOpen(true);
            }}
          >
            <Download className="h-5 w-5 mb-1.5 text-muted-foreground" />
            <div className="text-sm font-medium">{t("settings.syncLANClient")}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {t("settings.syncLANClientDesc")}
            </div>
          </button>
        </div>
      </div>
    </section>
  );

  const renderSyncStatus = () => (
    <section className="rounded-lg bg-muted/60 p-4">
      <h2 className="mb-4 text-sm font-medium text-foreground">
        {isLanContext ? t("settings.syncLANImportStatus") : t("settings.syncStatus")}
      </h2>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">
              {isLanContext ? t("settings.syncLANLastImport") : t("settings.syncLastSync")}
            </span>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatLastSync(lastSyncAt)}</p>
            {statusLabel() && <p className="mt-0.5 text-xs text-primary">{statusLabel()}</p>}
            {isBusy && progress && (
              <div className="mt-2 w-48">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  {progress.phase === "database" ? (
                    <div className="h-full w-full animate-pulse rounded-full bg-primary" />
                  ) : (
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                      style={{
                        width: `${progress.totalFiles > 0 ? Math.round((progress.completedFiles / progress.totalFiles) * 100) : 0}%`,
                      }}
                    />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{progressLabel()}</p>
              </div>
            )}
          </div>
          {!isLanContext && (
            <button
              onClick={handleSync}
              disabled={isBusy}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isBusy ? t("settings.syncSyncing") : t("settings.syncNow")}
            </button>
          )}
        </div>

        {lastResult && (
          <div className="rounded-md bg-background/60 p-3 text-xs text-muted-foreground">
            {lastResult.success ? (
              <div className="space-y-0.5">
                <p>
                  {isLanContext
                    ? t("settings.syncLANImportComplete")
                    : t("settings.syncDirection", { direction: lastResult.direction })}
                </p>
                {lastResult.filesUploaded > 0 && (
                  <p>{t("settings.syncFilesUp", { count: lastResult.filesUploaded })}</p>
                )}
                {lastResult.filesDownloaded > 0 && (
                  <p>
                    {isLanContext
                      ? t("settings.syncLANImportedFiles", { count: lastResult.filesDownloaded })
                      : t("settings.syncFilesDown", { count: lastResult.filesDownloaded })}
                  </p>
                )}
                <p className="text-muted-foreground/60">
                  {t("settings.syncDuration", { ms: lastResult.durationMs })}
                </p>
              </div>
            ) : (
              <p className="text-red-500">
                {t("settings.syncFailed", { error: lastResult.error })}
              </p>
            )}
          </div>
        )}

        {error && !lastResult && (
          <div className="rounded-md bg-red-50/60 p-3 text-xs text-red-500 dark:bg-red-950/20">
            {error}
          </div>
        )}

        {showScheduledSyncSettings && (
          <>
            <div className="flex items-center justify-between pt-1">
              <div>
                <span className="text-sm text-foreground">{t("settings.syncAutoSync")}</span>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.syncAutoSyncDesc")}</p>
              </div>
              <Switch
                checked={config?.type === "webdav" || config?.type === "s3" ? config.autoSync : false}
                onCheckedChange={(checked) => setAutoSync(checked)}
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
              <div>
                <span className="text-sm text-foreground">{t("settings.syncInterval")}</span>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.syncIntervalDesc")}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={720}
                  step={1}
                  value={syncIntervalInput}
                  onChange={(e) => setSyncIntervalInput(e.target.value)}
                  onBlur={() => void handleSyncIntervalBlur()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-20 rounded-md border border-input bg-background px-3 py-1.5 text-right text-sm text-foreground outline-none focus:border-primary"
                />
                <span className="text-xs text-muted-foreground">{t("settings.syncIntervalMinutes", { count: Number.parseInt(syncIntervalInput || "30", 10) || 30 })}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );

  return (
    <div className="space-y-6 p-4 pt-3">
      {renderBackendSelector()}

      {selectedBackend === "webdav" && renderWebDavConfig()}
      {selectedBackend === "s3" && renderS3Config()}
      {selectedBackend === "lan" && renderLANConfig()}

      {/* Conflict Resolution Dialog */}
      {pendingDirection === "conflict" && (
        <section className="rounded-lg border-2 border-orange-400/60 bg-orange-50/40 p-4 dark:bg-orange-950/20">
          <h2 className="mb-2 text-sm font-medium text-foreground">
            {t("settings.syncConflictTitle")}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("settings.syncConflictDesc")}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleConflict("upload")}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t("settings.syncConflictUpload")}
            </button>
            <button
              onClick={() => handleConflict("download")}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t("settings.syncConflictDownload")}
            </button>
          </div>
        </section>
      )}

      {selectedBackend !== "lan" && (isConfigured || isBusy || lastSyncAt) && renderSyncStatus()}

      {/* Advanced Section */}
      {isConfigured && selectedBackend !== "lan" && (
        <section className="rounded-lg bg-muted/60 p-4">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="mb-2 text-sm font-medium text-foreground"
          >
            {t("settings.syncAdvanced")} {showAdvanced ? "−" : "+"}
          </button>

          {showAdvanced && (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  onClick={handleForceFullUpload}
                  disabled={isBusy}
                  className="rounded-lg border border-input bg-background p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                >
                  <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
                  <div className="text-sm font-medium text-foreground">
                    {t("settings.syncForceUpload")}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("settings.syncForceUploadDesc")}
                  </p>
                </button>
                <button
                  onClick={handleForceFullDownload}
                  disabled={isBusy}
                  className="rounded-lg border border-input bg-background p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                >
                  <Download className="mb-2 h-5 w-5 text-muted-foreground" />
                  <div className="text-sm font-medium text-foreground">
                    {t("settings.syncForceDownload")}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("settings.syncForceDownloadDesc")}
                  </p>
                </button>
              </div>
              <div className="pt-2">
                <button
                  onClick={handleReset}
                  className="rounded-md border border-destructive/30 px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                >
                  {t("settings.syncReset")}
                </button>
                <p className="mt-1 text-xs text-muted-foreground">{t("settings.syncResetDesc")}</p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Transfer sync config */}
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-medium text-foreground">
          {t("settings.transferConfig", "配置迁移")}
        </h3>
        <ConfigTransfer
          label={t("settings.syncConfig", "同步配置")}
          getData={() => {
            const base = { backendType, config };
            if (backendType === "webdav") {
              return { ...base, password: webdavPassword };
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
          validate={(d) =>
            typeof d === "object" && d !== null && "backendType" in d
          }
        />
      </section>

      {/* LAN Sync Dialog */}
      <LANSyncDialog
        open={lanDialogOpen}
        onClose={() => setLanDialogOpen(false)}
        mode={lanDialogMode}
      />
    </div>
  );
}
