import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SUPPORTED_LANGUAGES } from "@/lib/translation/translator";
/**
 * TranslationSettings — translation provider and language config using shadcn components
 */
import { useSettingsStore } from "@/stores/settings-store";
import type { TranslationTargetLang } from "@/types";
import { useTranslation } from "react-i18next";

export function TranslationSettings() {
  const { t } = useTranslation();
  const {
    readSettings,
    translationConfig,
    updateReadSettings,
    updateTranslationConfig,
    setTranslationLang,
  } = useSettingsStore();

  return (
    <div className="space-y-6 p-4 pt-3">
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-neutral-900">{t("settings.translation_title")}</h2>
        <p className="mb-4 text-xs text-neutral-500">{t("settings.translation_desc")}</p>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-neutral-800">{t("settings.enableTranslation")}</span>
              <p className="mt-1 text-xs text-neutral-500">{t("settings.enableTranslationDesc")}</p>
            </div>
            <Switch
              checked={readSettings.enableTranslation}
              onCheckedChange={(checked) => updateReadSettings({ enableTranslation: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-800">{t("settings.targetLanguage")}</span>
            <Select
              value={translationConfig.targetLang}
              onValueChange={(v) => setTranslationLang(v as TranslationTargetLang)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.nativeName} ({lang.name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-neutral-800">{t("settings.showOriginal")}</span>
              <p className="mt-1 text-xs text-neutral-500">{t("settings.showOriginalDesc")}</p>
            </div>
            <Switch
              checked={translationConfig.showOriginal}
              onCheckedChange={(checked) => updateTranslationConfig({ showOriginal: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-neutral-800">{t("settings.autoTranslate")}</span>
              <p className="mt-1 text-xs text-neutral-500">{t("settings.autoTranslateDesc")}</p>
            </div>
            <Switch
              checked={translationConfig.autoTranslate}
              onCheckedChange={(checked) => updateTranslationConfig({ autoTranslate: checked })}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
