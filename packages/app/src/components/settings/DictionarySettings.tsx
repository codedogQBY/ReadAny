import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useDictionaryStore } from "@/stores/dictionary-store";
import type { DictionaryLanguage } from "@readany/core/dictionary";
import { Download, Loader2, RefreshCw, Trash2, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function DictionarySettings() {
  const { t } = useTranslation();
  const { manifest, packs, initialize, install, remove } = useDictionaryStore();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<DictionaryLanguage | null>(null);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(false);
    try {
      await operation();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    void initialize().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
    };
  }, [initialize]);
  return (
    <div className="space-y-6 p-4 pt-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t("dictionary.error")}
        </p>
      )}
      {(["en", "zh"] as const).map((language) => {
        const descriptor = manifest?.packs[language];
        const status = packs[language];
        const name = t(`dictionary.${language === "en" ? "english" : "chinese"}`);
        const installed =
          status.state === "installed" ||
          status.state === "update-available" ||
          (status.state === "error" && status.hasActivePack);
        const downloading = status.state === "downloading";
        const installing = downloading || status.state === "verifying";
        const action =
          status.state === "update-available"
            ? "update"
            : status.state === "error"
              ? "repair"
              : "download";
        const ActionIcon = installing
          ? Loader2
          : action === "update"
            ? RefreshCw
            : action === "repair"
              ? Wrench
              : Download;
        const statusText = t(
          `dictionary.${status.state === "not-installed" ? "notDownloaded" : status.state === "update-available" ? "updateAvailable" : status.state}`,
          { progress: downloading ? Math.round(status.progress * 100) : 0 },
        );
        return (
          <section key={language} className="space-y-4 rounded-lg bg-muted/60 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-foreground">{name}</h2>
                <output className="text-xs text-muted-foreground">{statusText}</output>
              </div>
              <div className="flex gap-2">
                {status.state !== "installed" && (
                  <Button
                    size="sm"
                    disabled={busy || installing || !descriptor}
                    aria-label={t("dictionary.actionLabel", {
                      action: t(`dictionary.${action}`),
                      language: name,
                    })}
                    onClick={() => void run(() => install(language))}
                  >
                    <ActionIcon
                      className={`h-3.5 w-3.5 ${installing ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    {t(`dictionary.${action}`)}
                  </Button>
                )}
                {installed && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || installing}
                    aria-label={t("dictionary.actionLabel", {
                      action: t("dictionary.remove"),
                      language: name,
                    })}
                    onClick={() => setRemoving(language)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("dictionary.remove")}
                  </Button>
                )}
              </div>
            </div>
            {downloading && (
              <Progress
                value={status.progress * 100}
                aria-label={t("dictionary.downloadingAccessibility", { language: name })}
              />
            )}
            {descriptor && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>
                  {t("dictionary.version", {
                    version:
                      status.state === "installed"
                        ? status.version
                        : status.state === "update-available"
                          ? status.installedVersion
                          : descriptor.version,
                  })}{" "}
                  /{" "}
                  {t("dictionary.size", {
                    size: `${((status.state === "installed" ? status.sizeBytes : descriptor.sizeBytes) / 1024 / 1024).toFixed(1)} MB`,
                  })}
                </p>
                <p>
                  {descriptor.sourceEdition} / {descriptor.sourceDumpDate}
                </p>
                <p>
                  {t("dictionary.licenseDetail", {
                    label: t("dictionary.license"),
                    license: descriptor.license,
                  })}
                </p>
                <a
                  className="inline-block text-primary underline underline-offset-4"
                  href={descriptor.attributionUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      const { openUrl } = await import("@tauri-apps/plugin-opener");
                      await openUrl(descriptor.attributionUrl);
                    });
                  }}
                >
                  {t("dictionary.attribution")}
                </a>
              </div>
            )}
          </section>
        );
      })}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {t("dictionary.removeTitle", {
              language: t(`dictionary.${removing === "en" ? "english" : "chinese"}`),
            })}
          </DialogTitle>
          <DialogDescription>
            {t("dictionary.removeMessage", {
              language: t(`dictionary.${removing === "en" ? "english" : "chinese"}`),
            })}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRemoving(null)}>
              {t("dictionary.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const language = removing;
                setRemoving(null);
                if (language) void run(() => remove(language));
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t("dictionary.remove")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
