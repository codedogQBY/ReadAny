/**
 * TranslationSettings — translation provider and language config
 */
import { useSettingsStore } from "@/stores/settings-store";
import { SUPPORTED_LANGUAGES } from "@/lib/translation/translator";
import type { TranslationTargetLang } from "@/types";

export function TranslationSettings() {
  const { readSettings, translationConfig, updateReadSettings, updateTranslationConfig, setTranslationLang } =
    useSettingsStore();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Translation</h3>
        <p className="text-sm text-muted-foreground">Configure translation settings</p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Enable Translation</p>
            <p className="text-xs text-muted-foreground">Show translations for selected text</p>
          </div>
          <input
            type="checkbox"
            checked={readSettings.enableTranslation}
            onChange={(e) => updateReadSettings({ enableTranslation: e.target.checked })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Target Language</label>
          <select
            value={translationConfig.targetLang}
            onChange={(e) => setTranslationLang(e.target.value as TranslationTargetLang)}
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.nativeName} ({lang.name})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Show Original Text</p>
            <p className="text-xs text-muted-foreground">Display original alongside translation</p>
          </div>
          <input
            type="checkbox"
            checked={translationConfig.showOriginal}
            onChange={(e) => updateTranslationConfig({ showOriginal: e.target.checked })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Auto-translate</p>
            <p className="text-xs text-muted-foreground">Automatically translate pages</p>
          </div>
          <input
            type="checkbox"
            checked={translationConfig.autoTranslate}
            onChange={(e) => updateTranslationConfig({ autoTranslate: e.target.checked })}
          />
        </div>
      </div>
    </div>
  );
}
