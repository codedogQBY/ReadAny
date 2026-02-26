/**
 * GeneralSettings — app-level settings using shadcn components
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

export function GeneralSettings() {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("readany-lang", lang);
  };

  return (
    <div className="space-y-6 p-4 pt-3">
      {/* Language Section */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-neutral-900">{t("settings.language")}</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-neutral-800">{t("settings.language")}</span>
              <p className="mt-1 text-xs text-neutral-500">{t("settings.languageDesc")}</p>
            </div>
            <Select value={i18n.language} onValueChange={handleLanguageChange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh">中文</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* Appearance Section */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-neutral-900">{t("settings.theme")}</h2>
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-sm text-neutral-800">{t("settings.theme")}</span>
              <p className="mt-1 text-xs text-neutral-500">{t("settings.themeDesc")}</p>
            </div>
            <Select defaultValue="light">
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t("settings.light")}</SelectItem>
                <SelectItem value="dark">{t("settings.dark")}</SelectItem>
                <SelectItem value="sepia">{t("settings.sepia")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-start justify-between">
            <div>
              <span className="text-sm text-neutral-800">{t("settings.autoSave")}</span>
              <p className="mt-1 text-xs text-neutral-500">{t("settings.autoSaveDesc")}</p>
            </div>
            <Select defaultValue="15000">
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15000">15s</SelectItem>
                <SelectItem value="30000">30s</SelectItem>
                <SelectItem value="60000">1min</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>
    </div>
  );
}
