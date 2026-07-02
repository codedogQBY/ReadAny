import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import { useVectorModelStore } from "@/stores/vector-model-store";
import { BUILTIN_EMBEDDING_MODELS } from "@readany/core/ai/builtin-embedding-models";
import { loadEmbeddingPipeline } from "@readany/core/ai/local-embedding-service";
import type { VectorModelConfig } from "@readany/core/types";
import { normalizeEmbeddingEndpointUrl, testEmbeddingEndpoint } from "@readany/core/utils/api";
import { Check, Download, Loader2, Plus, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { OnboardingLayout } from "../OnboardingLayout";

interface EmbeddingPageProps {
  onNext: () => void;
  onPrev: () => void;
  step: number;
  totalSteps: number;
}

export function EmbeddingPage({ onNext, onPrev, step, totalSteps }: EmbeddingPageProps) {
  const { t } = useTranslation();
  const {
    vectorModelMode,
    setVectorModelMode,
    builtinModelStates,
    setSelectedBuiltinModelId,
    updateBuiltinModelState,
    vectorModels,
    selectedVectorModelId,
    addVectorModel,
    deleteVectorModel,
    updateVectorModel,
    setSelectedVectorModelId,
  } = useVectorModelStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Omit<VectorModelConfig, "id">>({
    name: "",
    url: "",
    modelId: "",
    apiKey: "",
    description: "",
  });

  const handleLoadModel = useCallback(
    async (modelId: string) => {
      updateBuiltinModelState(modelId, { status: "downloading", progress: 0, error: undefined });
      setSelectedBuiltinModelId(modelId);
      try {
        await loadEmbeddingPipeline(modelId, (progress) => {
          updateBuiltinModelState(modelId, { progress });
        });
        updateBuiltinModelState(modelId, { status: "ready", progress: 100 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateBuiltinModelState(modelId, { status: "error", error: message });
        setSelectedBuiltinModelId(null);
      }
    },
    [updateBuiltinModelState, setSelectedBuiltinModelId],
  );

  const handleAddModel = useCallback(() => {
    if (!formData.name.trim() || !formData.url.trim() || !formData.modelId.trim()) return;
    const newModel: VectorModelConfig = {
      id: `vm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: formData.name.trim(),
      url: normalizeEmbeddingEndpointUrl(formData.url),
      modelId: formData.modelId.trim(),
      apiKey: formData.apiKey.trim(),
      description: formData.description?.trim() || "",
    };
    addVectorModel(newModel);
    setFormData({ name: "", url: "", modelId: "", apiKey: "", description: "" });
    setShowAddForm(false);
  }, [formData, addVectorModel]);

  const testRemoteModel = useCallback(
    async (model: VectorModelConfig) => {
      setTestingId(model.id);
      try {
        const result = await testEmbeddingEndpoint({
          url: model.url,
          modelId: model.modelId,
          apiKey: model.apiKey,
        });
        updateVectorModel(model.id, { dimension: result.dimension, url: result.url });
        setSelectedVectorModelId(model.id);
      } catch (err) {
        console.warn("[Onboarding] Embedding model test failed:", err);
      } finally {
        setTestingId(null);
      }
    },
    [setSelectedVectorModelId, updateVectorModel],
  );

  const model = BUILTIN_EMBEDDING_MODELS[0];
  const state = builtinModelStates[model.id];
  const isReady = state?.status === "ready";
  const isDownloading = state?.status === "downloading";
  const hasError = state?.status === "error";

  return (
    <OnboardingLayout
      illustration="/illustrations/search.svg"
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
              onClick={onNext}
              className="rounded-full px-8 shadow-md"
              disabled={vectorModelMode === "builtin" && isDownloading}
            >
              {t("common.next", "Next")} →
            </Button>
          </div>
        </>
      }
    >
      <div className="animate-in fade-in slide-in-from-right-4 duration-500 flex-1 overflow-y-auto invisible-scrollbar flex flex-col justify-center">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-bold tracking-tight">
            {t("onboarding.embedding.title", "Smart Search")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "onboarding.embedding.desc",
              "Enable semantic search by configuring an embedding model.",
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-6">
          <div
            className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${vectorModelMode === "remote" ? "border-primary bg-primary/5" : "border-border bg-muted/30"}`}
          >
            <button
              type="button"
              className="flex-1 appearance-none border-0 bg-transparent p-0 text-left text-foreground"
              onClick={() => setVectorModelMode("remote")}
            >
              <h3 className="text-sm font-medium">
                {t("onboarding.embedding.remoteMode", "Remote API Mode")}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {t("onboarding.embedding.remoteDesc", "Connect to external embedding API.")}
              </p>
            </button>
            <Switch
              checked={vectorModelMode === "remote"}
              onCheckedChange={(c) => setVectorModelMode(c ? "remote" : "builtin")}
            />
          </div>

          <div
            className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${vectorModelMode === "builtin" ? "border-primary bg-primary/5" : "border-border bg-muted/30"}`}
          >
            <button
              type="button"
              className="flex-1 appearance-none border-0 bg-transparent p-0 text-left text-foreground"
              onClick={() => setVectorModelMode("builtin")}
            >
              <h3 className="text-sm font-medium">
                {t("onboarding.embedding.localMode", "Local Built-in Mode")}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {t("onboarding.embedding.localDesc", "Run embeddings safely on your device.")}
              </p>
            </button>
            <Switch
              checked={vectorModelMode === "builtin"}
              onCheckedChange={(c) => setVectorModelMode(c ? "builtin" : "remote")}
            />
          </div>
        </div>

        {vectorModelMode === "remote" && (
          <div className="mt-4 space-y-3">
            {!showAddForm && (
              <Button
                variant="outline"
                onClick={() => setShowAddForm(true)}
                className="w-full gap-2"
              >
                <Plus className="h-4 w-4" />
                {t("settings.vm_addModel", "Add Remote Model")}
              </Button>
            )}

            {showAddForm && (
              <div className="rounded-lg border border-border bg-background p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">
                    {t("settings.vm_addModelTitle", "Add Model")}
                  </h4>
                  <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="onboarding-vector-model-name"
                      className="text-xs text-muted-foreground mb-1 block"
                    >
                      {t("settings.vm_name", "Name")} *
                    </label>
                    <Input
                      id="onboarding-vector-model-name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="OpenAI Embedding"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="onboarding-vector-model-id"
                      className="text-xs text-muted-foreground mb-1 block"
                    >
                      {t("settings.vm_modelId", "Model ID")} *
                    </label>
                    <Input
                      id="onboarding-vector-model-id"
                      value={formData.modelId}
                      onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
                      placeholder="text-embedding-3-small"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="onboarding-vector-model-url"
                    className="text-xs text-muted-foreground mb-1 block"
                  >
                    {t("settings.vm_url", "URL")} *
                  </label>
                  <Input
                    id="onboarding-vector-model-url"
                    value={formData.url}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{t("settings.vm_urlHint")}</p>
                </div>

                <div>
                  <label
                    htmlFor="onboarding-vector-model-api-key"
                    className="text-xs text-muted-foreground mb-1 block"
                  >
                    {t("settings.vm_apiKey", "API Key")}
                  </label>
                  <PasswordInput
                    id="onboarding-vector-model-api-key"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleAddModel}
                    disabled={!formData.name || !formData.url || !formData.modelId}
                    size="sm"
                  >
                    {t("common.save", "Save")}
                  </Button>
                </div>
              </div>
            )}

            {vectorModels.map((m) => (
              <div
                key={m.id}
                className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${selectedVectorModelId === m.id ? "border-primary bg-primary/5" : "border-border bg-background"}`}
              >
                <div>
                  <h4 className="text-sm font-medium">{m.name}</h4>
                  <p className="text-xs text-muted-foreground">{m.modelId}</p>
                </div>
                <div className="flex items-center gap-2">
                  {testingId === m.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => testRemoteModel(m)}
                      className={selectedVectorModelId === m.id ? "text-green-500" : ""}
                    >
                      {selectedVectorModelId === m.id ? <Check className="h-4 w-4 mr-1" /> : null}
                      {t("settings.vm_test", "Test")}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => deleteVectorModel(m.id)}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}

            {vectorModels.length === 0 && !showAddForm && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t("settings.vm_noRemoteModels", "No remote models configured yet.")}
              </p>
            )}
          </div>
        )}

        {vectorModelMode === "builtin" && (
          <div
            className={`mt-4 rounded-lg border p-4 transition-colors ${isReady ? "border-primary/50 bg-primary/5" : "border-border bg-background"}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium">{model.name}</h4>
                <p className="text-xs text-muted-foreground">
                  {model.size} · {t("settings.vm_recommended", "Recommended")}
                </p>
              </div>
              <div>
                {isDownloading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="animate-spin h-4 w-4 text-primary" />
                    <span className="text-xs">{state.progress ?? 0}%</span>
                  </div>
                ) : isReady ? (
                  <span className="flex items-center text-xs text-green-500 gap-1">
                    <Check className="h-4 w-4" /> {t("settings.vm_loaded", "Loaded")}
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleLoadModel(model.id)}
                    className="h-7 text-xs gap-1"
                  >
                    <Download className="h-3 w-3" /> {t("settings.vm_download", "Download")}
                  </Button>
                )}
              </div>
            </div>
            {hasError && <p className="mt-2 text-xs text-destructive">{state.error}</p>}
          </div>
        )}
      </div>
    </OnboardingLayout>
  );
}
