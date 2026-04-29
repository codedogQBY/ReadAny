import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPlatformService } from "@readany/core/services";
import { useSyncStore } from "@readany/core/stores/sync-store";
import { SYNC_SECRET_KEYS } from "@readany/core/sync/sync-backend";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { OnboardingLayout } from "../OnboardingLayout";

export function SyncPage({ onNext, onPrev, step, totalSteps }: any) {
  const { t } = useTranslation();
  const { config, saveWebDavConfig, testWebDavConnection } = useSyncStore();

  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remoteRoot, setRemoteRoot] = useState("readany");
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [testError, setTestError] = useState("");

  useEffect(() => {
    const loadExistingConfig = async () => {
      if (config?.type === "webdav") {
        if (config.url) setUrl(config.url);
        if (config.username) setUsername(config.username);
        if (config.remoteRoot) setRemoteRoot(config.remoteRoot);
      }

      const platform = getPlatformService();
      const savedPassword = await platform.kvGetItem(SYNC_SECRET_KEYS.webdav);
      if (savedPassword) setPassword(savedPassword);
    };
    loadExistingConfig();
  }, [config]);

  const handleTest = async () => {
    setStatus("testing");
    setTestError("");
    try {
      const ok = await testWebDavConnection(url, username, password, undefined, remoteRoot);
      setStatus(ok ? "success" : "error");
      if (!ok) setTestError(t("common.failed", "Failed"));
    } catch (error) {
      setStatus("error");
      setTestError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleNext = async () => {
    if (url && username && password) {
      await saveWebDavConfig(url, username, password, undefined, remoteRoot);
    }
    onNext();
  };

  return (
    <OnboardingLayout
      illustration="/illustrations/send_email.svg"
      step={step}
      totalSteps={totalSteps}
      footer={
        <>
          <Button variant="ghost" onClick={onPrev}>
            {t("common.back", "Back")}
          </Button>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onNext} className="text-muted-foreground">
              {t("onboarding.skipForNow", "Skip for now")}
            </Button>
            <Button
              onClick={handleNext}
              disabled={status === "testing"}
              className="rounded-full px-8 shadow-md"
            >
              {t("common.next", "Next")} →
            </Button>
          </div>
        </>
      }
    >
      <div className="animate-in fade-in slide-in-from-right-4 duration-500 flex-1 flex flex-col justify-center">
        <div className="space-y-2 text-center mb-6">
          <h2 className="text-2xl font-bold tracking-tight">
            {t("onboarding.sync.title", "Cloud Sync")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "onboarding.sync.desc",
              "Keep your progress perfectly in sync across devices using WebDAV.",
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.webdavUrl", "WebDAV Server URL")}
            </label>
            <Input
              placeholder="https://dav.jianguoyun.com/dav/"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.username", "Username")}
            </label>
            <Input
              placeholder="name@example.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        <div className="space-y-1.5 mt-4">
          <label className="text-xs font-medium text-muted-foreground">
            {t("settings.password", "App Password")}
          </label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 text-sm pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5 mt-4">
          <label className="text-xs font-medium text-muted-foreground">
            {t("settings.syncRemoteRoot")}
          </label>
          <Input
            placeholder={t("settings.syncRemoteRootPlaceholder")}
            value={remoteRoot}
            onChange={(e) => setRemoteRoot(e.target.value)}
            className="h-9 text-sm"
          />
          <p className="text-xs text-muted-foreground">{t("settings.syncRemoteRootDesc")}</p>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={status === "testing" || !url || !username || !password}
            >
              {status === "testing" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {status === "success" && (
                <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-emerald-500" />
              )}
              {status === "error" && <AlertCircle className="mr-2 h-3.5 w-3.5 text-destructive" />}
              {t("settings.testConnection", "Test Connection")}
            </Button>
          </div>
          {status === "error" && (
            <p className="text-xs leading-5 break-words text-destructive">
              {t("settings.syncTestFailed", { error: testError || t("common.failed", "Failed") })}
            </p>
          )}
          {status === "success" && <p className="text-xs text-emerald-600">Connected!</p>}
        </div>
      </div>
    </OnboardingLayout>
  );
}
