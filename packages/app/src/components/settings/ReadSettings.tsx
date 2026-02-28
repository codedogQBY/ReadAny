/**
 * ReadSettings — reading view settings using shadcn components
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useSettingsStore } from "@/stores/settings-store";
import { useTranslation } from "react-i18next";

export function ReadSettingsPanel() {
  const { t } = useTranslation();
  const { readSettings, updateReadSettings } = useSettingsStore();

  return (
    <div className="space-y-6 p-4 pt-3">
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-neutral-900">{t("settings.reading_title")}</h2>
        <p className="mb-4 text-xs text-neutral-500">{t("settings.reading_desc")}</p>

        <div className="space-y-5">
          {/* Font Size */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-neutral-800">{t("settings.fontSize", { size: readSettings.fontSize })}</span>
              <span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-neutral-600">{readSettings.fontSize}px</span>
            </div>
            <Slider
              min={12}
              max={32}
              step={1}
              value={[readSettings.fontSize]}
              onValueChange={([v]) => updateReadSettings({ fontSize: v })}
            />
          </div>

          {/* Line Height */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-neutral-800">{t("settings.lineHeight", { height: readSettings.lineHeight })}</span>
              <span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-neutral-600">{readSettings.lineHeight}</span>
            </div>
            <Slider
              min={1.2}
              max={2.5}
              step={0.1}
              value={[readSettings.lineHeight]}
              onValueChange={([v]) => updateReadSettings({ lineHeight: v })}
            />
          </div>

          {/* Font Family */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-800">{t("settings.fontFamily")}</span>
            <Select
              value={readSettings.fontFamily}
              onValueChange={(v) => updateReadSettings({ fontFamily: v as "sans" | "serif" | "mono" })}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sans">{t("settings.sansSerif")}</SelectItem>
                <SelectItem value="serif">{t("settings.serif")}</SelectItem>
                <SelectItem value="mono">{t("settings.monospace")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

        </div>
      </section>
    </div>
  );
}
