import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  clearDesktopLibraryRoot,
  getDefaultDesktopLibraryRoot,
  getDesktopLibraryRoot,
  migrateDesktopLibraryRoot,
} from "@/lib/storage/desktop-library-root";
import { Coffee, FolderOpen, HardDrive, Moon, RotateCcw, Sun } from "lucide-react";
/**
 * GeneralSettings — app-level settings
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type ThemeMode = "light" | "dark" | "sepia";

const THEME_CONFIG: Record<ThemeMode, { icon: typeof Sun; labelKey: string }> = {
  light: { icon: Sun, labelKey: "settings.light" },
  dark: { icon: Moon, labelKey: "settings.dark" },
  sepia: { icon: Coffee, labelKey: "settings.sepia" },
};

export function GeneralSettings() {
  const { t, i18n } = useTranslation();
  const [theme, setThemeState] = useState<ThemeMode>("dark");
  const [currentLibraryRoot, setCurrentLibraryRoot] = useState("");
  const [defaultLibraryRoot, setDefaultLibraryRoot] = useState("");
  const [targetLibraryRoot, setTargetLibraryRoot] = useState("");
  const [migratingLibrary, setMigratingLibrary] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("readany-theme") as ThemeMode | null;
    if (saved && THEME_CONFIG[saved]) {
      setThemeState(saved);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadLibraryRoot = async () => {
      const [currentRoot, defaultRoot] = await Promise.all([
        getDesktopLibraryRoot(),
        getDefaultDesktopLibraryRoot(),
      ]);
      if (cancelled) return;
      setCurrentLibraryRoot(currentRoot);
      setDefaultLibraryRoot(defaultRoot);
      setTargetLibraryRoot(currentRoot);
    };

    void loadLibraryRoot();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLanguageChange = async (lang: string) => {
    const { changeAndPersistLanguage } = await import("@readany/core/i18n");
    await changeAndPersistLanguage(lang);
  };

  const handleThemeChange = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("readany-theme", newTheme);
  };

  const handleChooseLibraryFolder = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: targetLibraryRoot || currentLibraryRoot || defaultLibraryRoot || undefined,
    });

    if (typeof selected === "string" && selected.trim()) {
      setTargetLibraryRoot(selected);
    }
  };

  const restartAfterMigration = async () => {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    window.setTimeout(() => {
      void relaunch();
    }, 500);
  };

  const handleMigrateLibrary = async () => {
    if (!targetLibraryRoot) {
      toast.error(t("settings.storageChooseFolderFirst"));
      return;
    }

    if (targetLibraryRoot === currentLibraryRoot) {
      toast.message(t("settings.storageNoChange"));
      return;
    }

    setMigratingLibrary(true);
    try {
      const result = await migrateDesktopLibraryRoot(targetLibraryRoot);
      setCurrentLibraryRoot(result.to);
      setTargetLibraryRoot(result.to);
      toast.success(
        t("settings.storageMigrationSuccess", {
          count: result.movedFiles,
        }),
      );
      await restartAfterMigration();
    } catch (error) {
      console.error("[GeneralSettings] Failed to migrate library root:", error);
      toast.error(
        t("settings.storageMigrationFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setMigratingLibrary(false);
    }
  };

  const handleResetLibrary = async () => {
    if (!currentLibraryRoot || currentLibraryRoot === defaultLibraryRoot) {
      toast.message(t("settings.storageAlreadyDefault"));
      return;
    }

    setMigratingLibrary(true);
    try {
      const result = await migrateDesktopLibraryRoot(defaultLibraryRoot);
      await clearDesktopLibraryRoot();
      setCurrentLibraryRoot(defaultLibraryRoot);
      setTargetLibraryRoot(defaultLibraryRoot);
      toast.success(
        t("settings.storageMigrationSuccess", {
          count: result.movedFiles,
        }),
      );
      await restartAfterMigration();
    } catch (error) {
      console.error("[GeneralSettings] Failed to reset library root:", error);
      toast.error(
        t("settings.storageMigrationFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setMigratingLibrary(false);
    }
  };

  return (
    <div className="space-y-6 p-4 pt-3">
      {/* Theme Section */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-foreground">{t("settings.theme")}</h2>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">{t("settings.theme")}</span>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.themeDesc")}</p>
          </div>
          <div className="flex gap-2">
            {(Object.keys(THEME_CONFIG) as ThemeMode[]).map((mode) => {
              const config = THEME_CONFIG[mode];
              const Icon = config.icon;
              const isActive = theme === mode;
              return (
                <button
                  key={mode}
                  onClick={() => handleThemeChange(mode)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t(config.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Language Section */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-foreground">{t("settings.language")}</h2>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">{t("settings.language")}</span>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.languageDesc")}</p>
          </div>
          <Select value={i18n.language} onValueChange={handleLanguageChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="zh">{t("settings.simplifiedChinese", "中文")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="rounded-lg bg-muted/60 p-4">
        <div className="mb-4 flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-background p-2 text-primary shadow-sm">
            <HardDrive className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">{t("settings.storageLocation")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.storageLocationDesc")}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.storageCurrentPath")}
            </label>
            <Input value={currentLibraryRoot} readOnly />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.storageTargetPath")}
            </label>
            <div className="flex gap-2">
              <Input
                value={targetLibraryRoot}
                onChange={(e) => setTargetLibraryRoot(e.target.value)}
                placeholder={t("settings.storageTargetPath")}
              />
              <Button
                variant="outline"
                onClick={handleChooseLibraryFolder}
                disabled={migratingLibrary}
              >
                <FolderOpen className="h-4 w-4" />
                {t("settings.storageChooseFolder")}
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border/60 bg-background/80 p-3">
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.storageMigrationNote")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleMigrateLibrary} disabled={migratingLibrary}>
              {migratingLibrary ? t("settings.storageMigrating") : t("settings.storageMigrate")}
            </Button>
            <Button
              variant="outline"
              onClick={handleResetLibrary}
              disabled={migratingLibrary || currentLibraryRoot === defaultLibraryRoot}
            >
              <RotateCcw className="h-4 w-4" />
              {t("settings.storageResetDefault")}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
