import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
/**
 * AISettings — AI model and API configuration using shadcn components
 */
import { useSettingsStore } from "@/stores/settings-store";
import type { AIModel } from "@/types";
import { useTranslation } from "react-i18next";

const MODELS: Array<{ id: AIModel; label: string }> = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-haiku-4-20250414", label: "Claude Haiku 4" },
];

export function AISettings() {
  const { t } = useTranslation();
  const { aiConfig, setAIModel, setAPIKey, updateAIConfig } = useSettingsStore();

  return (
    <div className="space-y-6 p-4 pt-3">
      {/* Model Selection */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-neutral-900">{t("settings.ai_title")}</h2>
        <p className="mb-4 text-xs text-neutral-500">{t("settings.ai_desc")}</p>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-800">{t("settings.model")}</span>
            <Select value={aiConfig.model} onValueChange={(v) => setAIModel(v as AIModel)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* API Configuration */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-neutral-900">API</h2>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-neutral-800">{t("settings.apiKey")}</label>
            <Input
              type="password"
              value={aiConfig.apiKey}
              onChange={(e) => setAPIKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-neutral-800">{t("settings.baseUrl")}</label>
            <Input
              value={aiConfig.baseUrl ?? ""}
              onChange={(e) => updateAIConfig({ baseUrl: e.target.value || undefined })}
              placeholder="https://api.openai.com/v1"
            />
          </div>
        </div>
      </section>

      {/* Parameters */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-neutral-900">
          {t("settings.temperature", { value: aiConfig.temperature })}
        </h2>
        <Slider
          min={0}
          max={1}
          step={0.1}
          value={[aiConfig.temperature]}
          onValueChange={([v]) => updateAIConfig({ temperature: v })}
        />
        <div className="mt-2 flex justify-between text-xs text-neutral-400">
          <span>0</span>
          <span>0.5</span>
          <span>1</span>
        </div>
      </section>
    </div>
  );
}
