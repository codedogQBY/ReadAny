import { Button } from "@/components/ui/button";
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
 * AISettings — multi-endpoint, multi-provider AI configuration
 * Supports OpenAI-compatible, Anthropic Claude, Google Gemini
 */
import { useSettingsStore } from "@/stores/settings-store";
import type { AIEndpoint, AIProviderType } from "@/types";
import { Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

function createEndpointId(): string {
  return `ep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Default base URLs per provider */
const PROVIDER_DEFAULTS: Record<AIProviderType, { baseUrl: string; placeholder: string; keyPlaceholder: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", placeholder: "https://api.openai.com/v1", keyPlaceholder: "sk-..." },
  anthropic: { baseUrl: "", placeholder: "https://api.anthropic.com", keyPlaceholder: "sk-ant-..." },
  google: { baseUrl: "", placeholder: "https://generativelanguage.googleapis.com", keyPlaceholder: "AIza..." },
};

function EndpointCard({
  endpoint,
  isActive,
  onUpdate,
  onRemove,
  onFetchModels,
  onSetActive,
}: {
  endpoint: AIEndpoint;
  isActive: boolean;
  onUpdate: (id: string, updates: Partial<AIEndpoint>) => void;
  onRemove: (id: string) => void;
  onFetchModels: (id: string) => void;
  onSetActive: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [newModelName, setNewModelName] = useState("");

  const handleAddModel = useCallback(() => {
    const name = newModelName.trim();
    if (!name || endpoint.models.includes(name)) return;
    onUpdate(endpoint.id, { models: [...endpoint.models, name] });
    setNewModelName("");
  }, [newModelName, endpoint.id, endpoint.models, onUpdate]);

  const handleRemoveModel = useCallback(
    (model: string) => {
      onUpdate(endpoint.id, {
        models: endpoint.models.filter((m) => m !== model),
      });
    },
    [endpoint.id, endpoint.models, onUpdate],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddModel();
      }
    },
    [handleAddModel],
  );

  return (
    <div
      className={`rounded-lg border p-3 space-y-3 transition-colors ${
        isActive ? "border-primary/50 bg-primary/5" : "border-border bg-muted/30"
      }`}
    >
      {/* Header: name + active toggle + delete */}
      <div className="flex items-center gap-2">
        <Input
          value={endpoint.name}
          onChange={(e) => onUpdate(endpoint.id, { name: e.target.value })}
          placeholder={t("settings.ai_endpointNamePlaceholder")}
          className="h-8 text-sm font-medium flex-1"
        />
        {!isActive && (
          <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => onSetActive(endpoint.id)}>
            {t("settings.ai_activeEndpoint")}
          </Button>
        )}
        {isActive && (
          <span className="text-xs text-primary font-medium px-2 shrink-0">✓ Active</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(endpoint.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Provider selector */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">{t("settings.ai_provider")}</label>
        <Select
          value={endpoint.provider || "openai"}
          onValueChange={(v) => {
            const provider = v as AIProviderType;
            const defaults = PROVIDER_DEFAULTS[provider];
            onUpdate(endpoint.id, {
              provider,
              baseUrl: defaults.baseUrl,
              models: [],
              modelsFetched: false,
            });
          }}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">{t("settings.ai_provider_openai")}</SelectItem>
            <SelectItem value="anthropic">{t("settings.ai_provider_anthropic")}</SelectItem>
            <SelectItem value="google">{t("settings.ai_provider_google")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* API Key */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">{t("settings.ai_apiKey")}</label>
        <Input
          type="password"
          value={endpoint.apiKey}
          onChange={(e) => onUpdate(endpoint.id, { apiKey: e.target.value })}
          placeholder={PROVIDER_DEFAULTS[endpoint.provider || "openai"].keyPlaceholder}
          className="h-8 text-sm"
        />
      </div>

      {/* Base URL */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          {endpoint.provider === "openai" ? t("settings.ai_baseUrl") : t("settings.ai_baseUrlOptional")}
        </label>
        <Input
          value={endpoint.baseUrl}
          onChange={(e) => onUpdate(endpoint.id, { baseUrl: e.target.value })}
          placeholder={PROVIDER_DEFAULTS[endpoint.provider || "openai"].placeholder}
          className="h-8 text-sm"
        />
      </div>

      {/* Fetch models */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={!endpoint.apiKey || endpoint.modelsFetching}
          onClick={() => onFetchModels(endpoint.id)}
        >
          {endpoint.modelsFetching ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {endpoint.modelsFetching ? t("settings.ai_fetchingModels") : t("settings.ai_fetchModels")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {endpoint.models.length > 0
            ? t("settings.ai_modelsLoaded", { count: endpoint.models.length })
            : ""}
        </span>
      </div>

      {/* Models list + manual add */}
      <div>
        <label className="mb-1.5 block text-xs text-muted-foreground">{t("settings.ai_modelsList")}</label>

        {/* Manual add input */}
        <div className="flex items-center gap-1.5 mb-2">
          <Input
            value={newModelName}
            onChange={(e) => setNewModelName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("settings.ai_addModelPlaceholder")}
            className="h-7 text-xs flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1 shrink-0"
            disabled={!newModelName.trim()}
            onClick={handleAddModel}
          >
            <Plus className="h-3 w-3" />
            {t("settings.ai_addModel")}
          </Button>
        </div>

        {/* Model tags */}
        {endpoint.models.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {endpoint.models.map((model) => (
              <span
                key={model}
                className="inline-flex items-center gap-1 rounded-md bg-background border px-2 py-0.5 text-xs text-foreground"
              >
                {model}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => handleRemoveModel(model)}
                  title={t("settings.ai_removeModel")}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("settings.ai_noModels")}</p>
        )}
      </div>
    </div>
  );
}

export function AISettings() {
  const { t } = useTranslation();
  const {
    aiConfig,
    addEndpoint,
    updateEndpoint,
    removeEndpoint,
    setActiveEndpoint,
    setActiveModel,
    updateAIConfig,
    fetchModels,
  } = useSettingsStore();

  const [fetchError, setFetchError] = useState<string | null>(null);

  const activeEndpoint = aiConfig.endpoints.find((ep) => ep.id === aiConfig.activeEndpointId);

  const handleAddEndpoint = useCallback(() => {
    const ep: AIEndpoint = {
      id: createEndpointId(),
      name: "",
      provider: "openai",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      models: [],
      modelsFetched: false,
    };
    addEndpoint(ep);
  }, [addEndpoint]);

  const handleFetchModels = useCallback(
    async (endpointId: string) => {
      setFetchError(null);
      try {
        const models = await fetchModels(endpointId);
        if (models.length === 0) {
          setFetchError("No models returned. Check your API key and URL.");
        }
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Failed to fetch models");
      }
    },
    [fetchModels],
  );

  return (
    <div className="space-y-6 p-4 pt-3">
      {/* Endpoint Management */}
      <section className="rounded-lg bg-muted/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-medium text-foreground">{t("settings.ai_endpoints")}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t("settings.ai_desc")}</p>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleAddEndpoint}>
            <Plus className="h-3 w-3" />
            {t("settings.ai_addEndpoint")}
          </Button>
        </div>

        <div className="space-y-3">
          {aiConfig.endpoints.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">{t("settings.ai_noEndpoints")}</p>
          )}
          {aiConfig.endpoints.map((ep) => (
            <EndpointCard
              key={ep.id}
              endpoint={ep}
              isActive={ep.id === aiConfig.activeEndpointId}
              onUpdate={updateEndpoint}
              onRemove={removeEndpoint}
              onFetchModels={handleFetchModels}
              onSetActive={setActiveEndpoint}
            />
          ))}
        </div>

        {fetchError && (
          <p className="mt-2 text-xs text-destructive">{fetchError}</p>
        )}
      </section>

      {/* Active Model Selection */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-3 text-sm font-medium text-foreground">{t("settings.ai_activeModel")}</h2>

        {/* Endpoint selector */}
        {aiConfig.endpoints.length > 1 && (
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-muted-foreground">{t("settings.ai_activeEndpoint")}</span>
            <Select value={aiConfig.activeEndpointId} onValueChange={setActiveEndpoint}>
              <SelectTrigger className="w-[200px] h-8 text-sm">
                <SelectValue placeholder={t("settings.ai_selectEndpoint")} />
              </SelectTrigger>
              <SelectContent>
                {aiConfig.endpoints.map((ep) => (
                  <SelectItem key={ep.id} value={ep.id}>
                    {ep.name || ep.baseUrl}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Model selector */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t("settings.model")}</span>
          {activeEndpoint && activeEndpoint.models.length > 0 ? (
            <Select value={aiConfig.activeModel} onValueChange={setActiveModel}>
              <SelectTrigger className="w-[260px] h-8 text-sm">
                <SelectValue placeholder={t("settings.ai_selectModel")} />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {activeEndpoint.models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={aiConfig.activeModel}
                onChange={(e) => setActiveModel(e.target.value)}
                placeholder={t("settings.ai_selectModel")}
                className="w-[260px] h-8 text-sm"
              />
            </div>
          )}
        </div>
        {activeEndpoint && activeEndpoint.models.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">{t("settings.ai_noModels")}</p>
        )}
      </section>

      {/* Parameters */}
      <section className="rounded-lg bg-muted/60 p-4 space-y-5">
        <h2 className="text-sm font-medium text-foreground">{t("settings.parameters")}</h2>

        {/* Temperature */}
        <div>
          <h3 className="mb-2 text-xs text-muted-foreground">
            {t("settings.temperature", { value: aiConfig.temperature })}
          </h3>
          <Slider
            min={0}
            max={1}
            step={0.1}
            value={[aiConfig.temperature]}
            onValueChange={([v]) => updateAIConfig({ temperature: v })}
          />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>0</span>
            <span>0.5</span>
            <span>1</span>
          </div>
        </div>

        {/* Max Tokens */}
        <div>
          <h3 className="mb-2 text-xs text-muted-foreground">
            {t("settings.maxTokens", { value: aiConfig.maxTokens ?? 4096 })}
          </h3>
          <Slider
            min={1024}
            max={32768}
            step={1024}
            value={[aiConfig.maxTokens ?? 4096]}
            onValueChange={([v]) => updateAIConfig({ maxTokens: v })}
          />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>1024</span>
            <span>16384</span>
            <span>32768</span>
          </div>
        </div>

        {/* Sliding Window Size */}
        <div>
          <h3 className="mb-2 text-xs text-muted-foreground">
            {t("settings.slidingWindowSize", { value: aiConfig.slidingWindowSize ?? 8 })}
          </h3>
          <Slider
            min={2}
            max={30}
            step={2}
            value={[aiConfig.slidingWindowSize ?? 8]}
            onValueChange={([v]) => updateAIConfig({ slidingWindowSize: v })}
          />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>2</span>
            <span>16</span>
            <span>30</span>
          </div>
        </div>
      </section>
    </div>
  );
}
