import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
/**
 * TranslationSettings — translation provider config
 * AI translation uses existing AI config from AI settings
 * Target language is selected in the translation popup
 */
import { useSettingsStore } from "@/stores/settings-store";
import { TRANSLATOR_PROVIDERS } from "@readany/core/types/translation";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function TranslationSettings() {
  const { t } = useTranslation();
  const { translationConfig, updateTranslationConfig, aiConfig } = useSettingsStore();

  const [modelOpen, setModelOpen] = useState(false);
  const modelPopoverRef = useRef<HTMLDivElement>(null);

  const isAIProvider = translationConfig.provider.id === "ai";

  // Get all endpoints with models
  const endpointsWithModels = aiConfig.endpoints.filter((e) => e.models.length > 0);
  const totalModels = endpointsWithModels.reduce((sum, ep) => sum + ep.models.length, 0);
  const multipleEndpoints = endpointsWithModels.length > 1;

  // Find selected model
  const selectedEndpointId = translationConfig.provider.endpointId || aiConfig.activeEndpointId;
  const selectedModel = translationConfig.provider.model || aiConfig.activeModel;

  // Close on outside click
  useEffect(() => {
    if (!modelOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelPopoverRef.current && !modelPopoverRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelOpen]);

  const handleProviderChange = (providerId: string) => {
    updateTranslationConfig({
      provider: {
        ...translationConfig.provider,
        id: providerId as "ai" | "deepl",
        name: TRANSLATOR_PROVIDERS.find((p) => p.id === providerId)?.name || "",
      },
    });
  };

  const handleModelSelect = (endpointId: string, model: string) => {
    updateTranslationConfig({
      provider: {
        ...translationConfig.provider,
        model,
        endpointId,
      },
    });
    setModelOpen(false);
  };

  const handleApiKeyChange = (apiKey: string) => {
    updateTranslationConfig({
      provider: {
        ...translationConfig.provider,
        apiKey,
      },
    });
  };

  const handleBaseUrlChange = (baseUrl: string) => {
    updateTranslationConfig({
      provider: {
        ...translationConfig.provider,
        baseUrl,
      },
    });
  };

  // Provider dropdown
  const [providerOpen, setProviderOpen] = useState(false);
  const providerPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!providerOpen) return;
    const handler = (e: MouseEvent) => {
      if (providerPopoverRef.current && !providerPopoverRef.current.contains(e.target as Node)) {
        setProviderOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [providerOpen]);

  const currentProvider = TRANSLATOR_PROVIDERS.find((p) => p.id === translationConfig.provider.id);

  return (
    <div className="space-y-4 p-4 pt-3">
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-foreground">
          {t("settings.translation_title")}
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">{t("settings.translation_desc")}</p>

        <div className="space-y-4">
          {/* 翻译引擎选择 */}
          <div className="space-y-2">
            <label className="text-sm text-foreground">{t("settings.translationProvider")}</label>
            <div className="relative" ref={providerPopoverRef}>
              <button
                type="button"
                onClick={() => setProviderOpen(!providerOpen)}
                className="flex w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm hover:bg-muted"
              >
                <span>{currentProvider?.name || t("settings.selectEngine")}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
              {providerOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border bg-background p-1 shadow-lg">
                  {TRANSLATOR_PROVIDERS.map((provider) => {
                    const isActive = provider.id === translationConfig.provider.id;
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => {
                          handleProviderChange(provider.id);
                          setProviderOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                          isActive ? "bg-primary/10 text-primary" : "hover:bg-muted"
                        }`}
                      >
                        <span>{provider.name}</span>
                        {isActive && <Check className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* AI 模型选择 (only show for AI provider) */}
          {isAIProvider && (
            <div className="space-y-2">
              <label className="text-sm text-foreground">{t("settings.translationModel")}</label>
              {endpointsWithModels.length > 0 ? (
                <div className="relative" ref={modelPopoverRef}>
                  <button
                    type="button"
                    onClick={() => totalModels > 1 && setModelOpen(!modelOpen)}
                    className={`flex w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm ${
                      totalModels > 1 ? "hover:bg-muted" : ""
                    }`}
                  >
                    <span className="truncate">{selectedModel || t("settings.selectModel")}</span>
                    {totalModels > 1 && (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                  {modelOpen && totalModels > 1 && (
                    <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border bg-background p-1 shadow-lg">
                      <div className="max-h-60 overflow-y-auto">
                        {endpointsWithModels.map((ep) => (
                          <div key={ep.id}>
                            {multipleEndpoints && (
                              <div className="px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground first:pt-1">
                                {ep.name || ep.baseUrl}
                              </div>
                            )}
                            {ep.models.map((model) => {
                              const isActive =
                                model === selectedModel && ep.id === selectedEndpointId;
                              return (
                                <button
                                  key={`${ep.id}-${model}`}
                                  type="button"
                                  onClick={() => handleModelSelect(ep.id, model)}
                                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                                    isActive ? "bg-primary/10 text-primary" : "hover:bg-muted"
                                  }`}
                                >
                                  <span className="truncate">{model}</span>
                                  {isActive && <Check className="h-4 w-4 shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
                  {t("settings.noModelsFetched")}
                </div>
              )}
            </div>
          )}

          {/* DeepL API Key (only show for DeepL) */}
          {!isAIProvider && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-foreground">{t("settings.apiKey")}</label>
                <PasswordInput
                  placeholder={t("settings.apiKeyPlaceholder")}
                  value={translationConfig.provider.apiKey || ""}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("settings.deeplKeyHint")}</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-foreground">{t("translation.deeplBaseUrl")}</label>
                <Input
                  placeholder={t("translation.deeplBaseUrlPlaceholder")}
                  value={translationConfig.provider.baseUrl || ""}
                  onChange={(e) => handleBaseUrlChange(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("translation.deeplBaseUrlHint")}</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
