import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  checkForUpdate,
  downloadAndInstall,
  getAvailableUpdate,
  getDownloadProgress,
  getErrorMessage,
  getUpdateStatus,
  relaunchApp,
  resetStatus,
  subscribeToUpdates,
} from "@/lib/updater";
import { getVersion } from "@tauri-apps/api/app";
import {
  AlertCircle,
  BookOpen,
  Check,
  Code2,
  Download,
  ExternalLink,
  Github,
  RefreshCw,
  Shield,
  Zap,
} from "lucide-react";
/**
 * AboutSettings — 关于页面
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const TECH_STACK = [
  { name: "Tauri", descKey: "settings.techStackTauri", icon: Shield },
  { name: "React", descKey: "settings.techStackReact", icon: Code2 },
  { name: "TypeScript", descKey: "settings.techStackTypeScript", icon: Zap },
  { name: "Foliate", descKey: "settings.techStackFoliate", icon: BookOpen },
];

type DialogType = "none" | "updateAvailable" | "upToDate" | "error";

export function AboutSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(getUpdateStatus());
  const [update, setUpdate] = useState(getAvailableUpdate());
  const [progress, setProgress] = useState(getDownloadProgress());
  const [error, setError] = useState(getErrorMessage());
  const [dialogType, setDialogType] = useState<DialogType>("none");
  const [isChecking, setIsChecking] = useState(false);
  const [isRelaunching, setIsRelaunching] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(console.error);
  }, []);

  useEffect(() => {
    return subscribeToUpdates((s, u, p, e) => {
      setStatus(s);
      setUpdate(u);
      setProgress(p);
      setError(e);

      if (s === "available" && u) {
        setIsChecking(false);
        setDialogType("updateAvailable");
      } else if (s === "error") {
        setIsChecking(false);
        setDialogType("error");
      } else if (s === "idle" && !u && !e && isChecking) {
        setIsChecking(false);
        setDialogType("upToDate");
      }
    });
  }, [isChecking]);

  const handleCheckUpdate = () => {
    setIsChecking(true);
    checkForUpdate();
  };

  const handleDownload = () => {
    setDialogType("none");
    downloadAndInstall();
  };

  const handleRelaunch = async () => {
    setIsRelaunching(true);
    try {
      await relaunchApp();
    } catch (error) {
      console.error("[AboutSettings] Relaunch failed:", error);
      setError(
        error instanceof Error && error.message
          ? error.message
          : t("settings.updaterRelaunchFailed"),
      );
      setDialogType("error");
    } finally {
      setIsRelaunching(false);
    }
  };

  const closeDialog = () => {
    setDialogType("none");
    if (status === "error") {
      resetStatus();
    }
    setIsChecking(false);
  };

  return (
    <div className="flex flex-col items-center p-6">
      {/* Logo & App Name */}
      <div className="mb-6 flex flex-col items-center">
        <img
          src="/logo.svg"
          alt="ReadAny Logo"
          className="mb-4 h-24 w-24 rounded-[22%] drop-shadow-lg"
        />
        <h1 className="text-2xl font-bold text-foreground">ReadAny</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.aboutDesc")}</p>
      </div>

      {/* Version Card */}
      <div className="mb-4 w-full max-w-md rounded-xl bg-muted/60 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t("settings.version")}</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-foreground">
              {appVersion || "..."}
            </span>
            <button
              onClick={handleCheckUpdate}
              disabled={status === "checking" || status === "downloading"}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              title={t("settings.checkUpdate")}
            >
              <RefreshCw className={`h-4 w-4 ${status === "checking" ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Download Progress */}
      {status === "downloading" && (
        <div className="mb-4 w-full max-w-md">
          <div className="rounded-lg bg-muted/60 p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("settings.downloading")}</span>
              <span className="font-mono text-foreground">{progress}%</span>
            </div>
            <Progress value={progress} aria-label={t("settings.downloading")} />
          </div>
        </div>
      )}

      {/* Update Ready */}
      {status === "ready" && (
        <div className="mb-4 w-full max-w-md space-y-2">
          <div className="rounded-lg bg-primary/10 p-3 text-center text-sm text-foreground">
            {t("settings.updateReadyMessage")}
          </div>
          <Button
            variant="default"
            className="w-full"
            onClick={() => void handleRelaunch()}
            disabled={isRelaunching}
          >
            {isRelaunching ? t("settings.relaunching") : t("settings.relaunch")}
          </Button>
        </div>
      )}

      {/* Dialogs */}
      <Dialog
        open={dialogType === "updateAvailable"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.updateAvailable")}</DialogTitle>
            <DialogDescription>
              {update && (
                <span>{t("settings.newVersionAvailable", { version: update.version })}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          {update?.notes && (
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              <p className="whitespace-pre-wrap text-muted-foreground">{update.notes}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t("settings.later")}
            </Button>
            <Button onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              {t("settings.downloadUpdate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogType === "upToDate"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-600" />
              {t("settings.upToDate")}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={closeDialog}>{t("settings.ok")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogType === "error"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
              {t("settings.updateError")}
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error || t("settings.updateErrorMessage")}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t("settings.dismiss")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tech Stack */}
      <div className="mb-6 w-full max-w-md">
        <h2 className="mb-3 text-sm font-medium text-foreground">{t("settings.techStack")}</h2>
        <div className="grid grid-cols-2 gap-2">
          {TECH_STACK.map(({ name, descKey, icon: Icon }) => (
            <div key={name} className="flex items-center gap-3 rounded-lg bg-muted/60 p-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">{name}</div>
                <div className="text-xs text-muted-foreground">{t(descKey)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Links */}
      <div className="w-full max-w-md space-y-2">
        <a
          href="https://github.com/codedogQBY/ReadAny"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-lg bg-muted/60 p-3 transition-colors hover:bg-muted"
        >
          <div className="flex items-center gap-3">
            <Github className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">GitHub</span>
          </div>
          <ExternalLink className="h-4 w-4 text-muted-foreground" />
        </a>

        <a
          href="https://github.com/codedogQBY/ReadAny/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-lg bg-muted/60 p-3 transition-colors hover:bg-muted"
        >
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{t("settings.feedback")}</span>
          </div>
          <ExternalLink className="h-4 w-4 text-muted-foreground" />
        </a>
      </div>

      {/* Copyright */}
      <div className="mt-8 text-center text-xs text-muted-foreground/60">
        <p>© 2026 codedogQBY. All rights reserved.</p>
        <p className="mt-1">{t("settings.license")}</p>
      </div>
    </div>
  );
}
