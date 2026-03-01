/**
 * GeneralSettings — app-level settings
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
        <h2 className="mb-4 text-sm font-medium text-neutral-900">{t("settings.language", "语言")}</h2>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-neutral-800">{t("settings.language", "语言")}</span>
            <p className="mt-1 text-xs text-neutral-500">{t("settings.languageDesc", "选择应用显示语言")}</p>
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
      </section>
    </div>
  );
}