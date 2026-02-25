/**
 * AISettings — AI model and API configuration
 */
import { useSettingsStore } from "@/stores/settings-store";
import { Input } from "@/components/ui/input";
import type { AIModel } from "@/types";

const MODELS: Array<{ id: AIModel; label: string }> = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-haiku-4-20250414", label: "Claude Haiku 4" },
];

export function AISettings() {
  const { aiConfig, setAIModel, setAPIKey, updateAIConfig } = useSettingsStore();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">AI Configuration</h3>
        <p className="text-sm text-muted-foreground">Configure AI model and API settings</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Model</label>
          <select
            value={aiConfig.model}
            onChange={(e) => setAIModel(e.target.value as AIModel)}
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">API Key</label>
          <Input
            type="password"
            value={aiConfig.apiKey}
            onChange={(e) => setAPIKey(e.target.value)}
            placeholder="sk-..."
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Base URL (optional)</label>
          <Input
            value={aiConfig.baseUrl ?? ""}
            onChange={(e) => updateAIConfig({ baseUrl: e.target.value || undefined })}
            placeholder="https://api.openai.com/v1"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Temperature: {aiConfig.temperature}</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={aiConfig.temperature}
            onChange={(e) => updateAIConfig({ temperature: Number(e.target.value) })}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}
