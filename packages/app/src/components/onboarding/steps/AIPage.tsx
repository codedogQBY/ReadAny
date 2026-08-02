import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { testAIEndpoint } from "@readany/core/ai";
import { useSettingsStore } from "@readany/core/stores/settings-store";
import type { AIProviderType } from "@readany/core/types";
import { getDefaultBaseUrl, PROVIDER_CONFIGS, providerRequiresApiKey } from "@readany/core/utils";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { OnboardingLayout } from "../OnboardingLayout";

const ONBOARDING_ENDPOINT_ID = "onboarding-ai-endpoint";

const PROVIDER_OPTIONS: { id: AIProviderType; name: string }[] = [
  { id: "openai", name: "OpenAI" },
  { id: "atlascloud", name: "Atlas Cloud" },
  { id: "anthropic", name: "Anthropic" },
  { id: "google", name: "Google Gemini" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "ollama", name: "Ollama" },
  { id: "lmstudio", name: "LM Studio" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "siliconflow", name: "SiliconFlow" },
  { id: "custom", name: "Custom" },
];

export function AIPage({ onNext, onPrev, step, totalSteps }: any) {
  const { t } = useTranslation();
  const { addEndpoint, updateEndpoint, setActiveEndpoint, aiConfig, _hasHydrated } =
    useSettingsStore();

  const [provider, setProvider] = useState<AIProviderType>("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(getDefaultBaseUrl("openai"));
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [showApiKey, setShowApiKey] = useState(false);

  const syncEndpointId =
    aiConfig.endpoints.find((ep) => ep.apiKey && ep.apiKey.length > 0)?.id ||
    aiConfig.activeEndpointId ||
    aiConfig.endpoints[0]?.id ||
    ONBOARDING_ENDPOINT_ID;

  useEffect(() => {
    if (!_hasHydrated || aiConfig.endpoints.length === 0) return;

    const endpointWithKey = aiConfig.endpoints.find((ep) => ep.apiKey && ep.apiKey.length > 0);
    const activeEndpoint = aiConfig.endpoints.find((ep) => ep.id === aiConfig.activeEndpointId);
    const endpointToUse = endpointWithKey || activeEndpoint || aiConfig.endpoints[0];

    if (endpointToUse) {
      const newProvider = endpointToUse.provider || "openai";
      const newApiKey = endpointToUse.apiKey || "";
      const newBaseUrl = endpointToUse.baseUrl || getDefaultBaseUrl(newProvider);

      setProvider((prev) => (prev === newProvider ? prev : newProvider));
      setApiKey((prev) => (prev === newApiKey ? prev : newApiKey));
      setBaseUrl((prev) => (prev === newBaseUrl ? prev : newBaseUrl));
    }
  }, [aiConfig.endpoints.length, aiConfig.activeEndpointId, _hasHydrated]);

  const syncToStore = (p: AIProviderType, key: string, url: string) => {
    const config = PROVIDER_CONFIGS[p];
    const existingEndpoint = aiConfig.endpoints.find((ep) => ep.id === syncEndpointId);
    const endpointId = existingEndpoint ? syncEndpointId : ONBOARDING_ENDPOINT_ID;

    if (existingEndpoint) {
      updateEndpoint(endpointId, {
        provider: p,
        name: existingEndpoint.name || config?.name || p,
        apiKey: key,
        baseUrl: url,
      });
    } else {
      addEndpoint({
        id: endpointId,
        name: config?.name || p,
        provider: p,
        apiKey: key,
        baseUrl: url,
        models: [],
        modelsFetched: false,
      });
    }
    setActiveEndpoint(endpointId);
  };

  const handleProviderChange = (val: string) => {
    const newProvider = val as AIProviderType;
    setProvider(newProvider);
    const newUrl = getDefaultBaseUrl(newProvider);
    setBaseUrl(newUrl);
    setApiKey("");
    setStatus("idle");
    syncToStore(newProvider, "", newUrl);
  };

  const handleApiKeyChange = (key: string) => {
    setApiKey(key);
    syncToStore(provider, key, baseUrl);
  };

  const handleBaseUrlChange = (url: string) => {
    setBaseUrl(url);
    syncToStore(provider, apiKey, url);
  };

  const testConnection = async () => {
    setStatus("testing");
    try {
      await testAIEndpoint({
        id: ONBOARDING_ENDPOINT_ID,
        name: PROVIDER_CONFIGS[provider]?.name || provider,
        provider,
        apiKey,
        baseUrl,
        models: [],
        modelsFetched: false,
      });
      setStatus("success");
    } catch (err) {
      console.warn("[Onboarding] AI connection test failed:", err);
      setStatus("error");
    }
  };

  const handleNext = () => {
    if (apiKey.trim()) {
      syncToStore(provider, apiKey, baseUrl);
    }
    if (!aiConfig.activeEndpointId) {
      setActiveEndpoint(ONBOARDING_ENDPOINT_ID);
    }
    onNext();
  };

  return (
    <OnboardingLayout
      illustration="/illustrations/ai_assistant.svg"
      step={step}
      totalSteps={totalSteps}
      footer={
        <>
          <Button variant="ghost" onClick={onPrev}>
            {t("common.back", "Back")}
          </Button>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onNext} className="text-muted-foreground">
              {t("onboarding.skipForNow", "Skip for now")}
            </Button>
            <Button
              onClick={handleNext}
              disabled={status === "testing"}
              className="rounded-full px-8 shadow-md"
            >
              {t("common.next", "Next")} →
            </Button>
          </div>
        </>
      }
    >
      <div className="animate-in fade-in slide-in-from-right-4 duration-500 flex-1 flex flex-col justify-center">
        <div className="space-y-2 text-center mb-6">
          <h2 className="text-2xl font-bold tracking-tight">
            {t("onboarding.ai.title", "AI Configuration")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "onboarding.ai.desc",
              "Set up your AI provider to enable smart chat and summarization.",
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.aiProvider", "Provider")}
            </label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.apiKey", "API Key")}
            </label>
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                placeholder={provider === "ollama" ? "Not required" : "sk-..."}
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                disabled={provider === "ollama"}
                className="h-9 text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-1.5 mt-4">
          <label className="text-xs font-medium text-muted-foreground">
            {t("settings.baseUrl", "Base URL")}
          </label>
          <Input
            value={baseUrl}
            onChange={(e) => handleBaseUrlChange(e.target.value)}
            placeholder={PROVIDER_CONFIGS[provider]?.placeholder || "https://api.example.com"}
            className="h-9 text-sm"
          />
          {PROVIDER_CONFIGS[provider]?.needsV1Suffix && (
            <p className="text-[11px] text-muted-foreground">
              {t(
                "settings.ai_baseUrlHint",
                "OpenAI-compatible endpoints append /v1 by default. End the URL with / to use your custom path as-is.",
              )}
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={testConnection}
            disabled={status === "testing" || (providerRequiresApiKey(provider) && !apiKey)}
            className="relative overflow-hidden"
          >
            {status === "testing" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {status === "success" && <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-emerald-500" />}
            {status === "error" && <AlertCircle className="mr-2 h-3.5 w-3.5 text-destructive" />}
            {t("onboarding.ai.test", "Test Connection")}
            {status === "success" && (
              <div className="absolute inset-0 bg-emerald-500/10 animate-pulse pointer-events-none" />
            )}
          </Button>
          {status === "error" && <p className="text-xs text-destructive">Connection failed</p>}
          {status === "success" && <p className="text-xs text-emerald-600">Connected!</p>}
        </div>
      </div>
    </OnboardingLayout>
  );
}
