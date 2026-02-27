/**
 * VectorModelSettings — manage vector/embedding model configurations
 * Two modes:
 * 1. Built-in: local models via Transformers.js (auto-download from HuggingFace)
 * 2. Remote: external API endpoints (OpenAI-compatible, Ollama, etc.)
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { BUILTIN_EMBEDDING_MODELS } from "@/lib/ai/builtin-embedding-models";
import { loadEmbeddingPipeline } from "@/lib/ai/local-embedding-service";
import { useVectorModelStore } from "@/stores/vector-model-store";
import type { VectorModelConfig } from "@/types";
import { Check, Download, Edit2, Loader2, Plus, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

function normalizeEmbeddingsUrl(url: string): string {
  return url.replace(/\/$/, "");
}

/* ------------------------------------------------------------------ */
/*  Built-in Models Section                                           */
/* ------------------------------------------------------------------ */
function BuiltinModelsSection() {
  const { t } = useTranslation();
  const {
    selectedBuiltinModelId,
    builtinModelStates,
    setSelectedBuiltinModelId,
    updateBuiltinModelState,
  } = useVectorModelStore();

  const handleLoadModel = useCallback(
    async (modelId: string) => {
      updateBuiltinModelState(modelId, { status: "downloading", progress: 0, error: undefined });
      try {
        await loadEmbeddingPipeline(modelId, (progress) => {
          updateBuiltinModelState(modelId, { progress });
        });
        updateBuiltinModelState(modelId, { status: "ready", progress: 100 });
        setSelectedBuiltinModelId(modelId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateBuiltinModelState(modelId, { status: "error", error: message });
      }
    },
    [updateBuiltinModelState, setSelectedBuiltinModelId],
  );

  const handleSelect = useCallback(
    async (modelId: string, checked: boolean) => {
      if (!checked) {
        setSelectedBuiltinModelId(null);
        return;
      }
      const state = builtinModelStates[modelId];
      if (state?.status === "ready") {
        setSelectedBuiltinModelId(modelId);
      } else {
        await handleLoadModel(modelId);
      }
    },
    [builtinModelStates, setSelectedBuiltinModelId, handleLoadModel],
  );

  return (
    <section className="rounded-lg bg-muted/60 p-4">
      <div className="mb-3">
        <h2 className="text-sm font-medium text-foreground">{t("settings.vm_builtinModels")}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t("settings.vm_builtinDesc")}</p>
      </div>

      <div className="space-y-2">
        {BUILTIN_EMBEDDING_MODELS.map((model) => {
          const state = builtinModelStates[model.id];
          const isReady = state?.status === "ready";
          const isDownloading = state?.status === "downloading";
          const isSelected = selectedBuiltinModelId === model.id;
          const hasError = state?.status === "error";

          return (
            <div
              key={model.id}
              className={`rounded-lg border p-3 transition-colors ${
                isSelected ? "border-primary/50 bg-primary/5" : "border-border bg-background"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-sm font-medium">{model.name}</span>
                  <span className="text-xs text-muted-foreground">{model.size}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("settings.vm_dimension", { dim: model.dimension })}
                  </span>
                  {model.recommended && (
                    <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      {t("settings.vm_recommended")}
                    </span>
                  )}
                  {isReady && (
                    <span className="flex items-center gap-0.5 text-[10px] text-green-600 dark:text-green-400">
                      <Check className="h-3 w-3" />
                      {t("settings.vm_loaded")}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isDownloading ? (
                    <div className="flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      <span className="text-xs text-muted-foreground">
                        {state?.progress ?? 0}%
                      </span>
                    </div>
                  ) : isReady ? (
                    <Switch
                      checked={isSelected}
                      onCheckedChange={(checked) => handleSelect(model.id, checked)}
                    />
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => handleLoadModel(model.id)}
                    >
                      <Download className="h-3 w-3" />
                      {t("settings.vm_download")}
                    </Button>
                  )}
                </div>
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                {t(model.descriptionKey)} · {t(model.languagesKey)}
              </p>

              {hasError && state?.error && (
                <p className="mt-1 text-xs text-destructive">
                  {t("settings.vm_loadError", { error: state.error })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Remote Models Section                                             */
/* ------------------------------------------------------------------ */
function RemoteModelsSection() {
  const { t } = useTranslation();
  const {
    vectorModels,
    selectedVectorModelId,
    addVectorModel,
    updateVectorModel,
    deleteVectorModel,
    setSelectedVectorModelId,
  } = useVectorModelStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState<Omit<VectorModelConfig, "id">>({
    name: "",
    url: "",
    modelId: "",
    apiKey: "",
    description: "",
  });

  const resetForm = useCallback(() => {
    setFormData({ name: "", url: "", modelId: "", apiKey: "", description: "" });
    setShowAddForm(false);
    setEditingId(null);
  }, []);

  const handleAdd = useCallback(() => {
    if (!formData.name.trim() || !formData.url.trim() || !formData.modelId.trim()) return;
    const newModel: VectorModelConfig = {
      id: `vm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...formData,
    };
    addVectorModel(newModel);
    resetForm();
  }, [formData, addVectorModel, resetForm]);

  const startEdit = useCallback((model: VectorModelConfig) => {
    setFormData({
      name: model.name,
      url: model.url,
      modelId: model.modelId,
      apiKey: model.apiKey,
      description: model.description || "",
    });
    setEditingId(model.id);
    setShowAddForm(false);
  }, []);

  const handleEdit = useCallback(() => {
    if (!editingId || !formData.name.trim() || !formData.url.trim() || !formData.modelId.trim()) return;
    updateVectorModel(editingId, formData);
    resetForm();
  }, [editingId, formData, updateVectorModel, resetForm]);

  const handleDelete = useCallback(
    (id: string) => { deleteVectorModel(id); },
    [deleteVectorModel],
  );

  const detectModelDimension = useCallback(
    async (model: VectorModelConfig) => {
      setTestingId(model.id);
      setTestResults((prev) => ({ ...prev, [model.id]: t("settings.vm_testing") }));
      try {
        const testUrl = normalizeEmbeddingsUrl(model.url);
        const isOllama = testUrl.endsWith("/api/embed");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (model.apiKey.trim()) headers.Authorization = `Bearer ${model.apiKey}`;

        const requestBody = isOllama
          ? { model: model.modelId, input: "test" }
          : { input: ["test"], model: model.modelId, encoding_format: "float" };

        const res = await fetch(testUrl, { method: "POST", headers, body: JSON.stringify(requestBody) });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const json = await res.json();
        const len = isOllama
          ? (json?.embeddings?.[0]?.length ?? 0)
          : (json?.data?.[0]?.embedding?.length ?? 0);

        updateVectorModel(model.id, { dimension: len });
        setTestResults((prev) => ({ ...prev, [model.id]: t("settings.vm_testSuccess", { dimension: len }) }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setTestResults((prev) => ({ ...prev, [model.id]: t("settings.vm_testFailed", { error: message }) }));
      } finally {
        setTestingId(null);
      }
    },
    [t, updateVectorModel],
  );

  const handleModelSelect = useCallback(
    async (model: VectorModelConfig, checked: boolean) => {
      if (checked) {
        setSelectedVectorModelId(model.id);
        if (!model.dimension) await detectModelDimension(model);
      } else {
        setSelectedVectorModelId(null);
      }
    },
    [setSelectedVectorModelId, detectModelDimension],
  );

  return (
    <section className="rounded-lg bg-muted/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">{t("settings.vm_remoteModels")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t("settings.vm_remoteDesc")}</p>
        </div>
        {!showAddForm && !editingId && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => { setShowAddForm(true); setEditingId(null); }}
          >
            <Plus className="h-3 w-3" />
            {t("settings.vm_addModel")}
          </Button>
        )}
      </div>

      {/* Model cards */}
      {vectorModels.length === 0 && !showAddForm && !editingId && (
        <p className="text-xs text-muted-foreground text-center py-4">{t("settings.vm_noRemoteModels")}</p>
      )}

      <div className="space-y-2">
        {vectorModels.map((model) => (
          <div
            key={model.id}
            className={`rounded-lg border p-3 transition-colors ${
              selectedVectorModelId === model.id
                ? "border-primary/50 bg-primary/5"
                : "border-border bg-background"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-sm font-medium truncate">{model.name}</span>
                <span className="text-xs text-muted-foreground truncate">{model.modelId}</span>
                {model.dimension && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {t("settings.vm_dimension", { dim: model.dimension })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => detectModelDimension(model)}
                  disabled={testingId === model.id}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {testingId === model.id ? t("settings.vm_testing") : t("settings.vm_test")}
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(model)}
                  className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Edit2 className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(model.id)}
                  className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <Switch
                  checked={selectedVectorModelId === model.id}
                  onCheckedChange={(checked) => handleModelSelect(model, checked)}
                />
              </div>
            </div>
            {model.url && <p className="mt-1 text-xs text-muted-foreground truncate">{model.url}</p>}
            {model.description && <p className="mt-0.5 text-xs text-muted-foreground truncate">{model.description}</p>}
            {testResults[model.id] && (
              <p className={`mt-1 text-xs ${
                testResults[model.id].includes("✓") ? "text-green-600 dark:text-green-400"
                  : testResults[model.id].includes("✗") ? "text-destructive"
                    : "text-muted-foreground"
              }`}>{testResults[model.id]}</p>
            )}
          </div>
        ))}
      </div>

      {/* Add / Edit form */}
      {(showAddForm || editingId) && (
        <div className="mt-3 rounded-lg border border-border bg-background p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              {editingId ? t("settings.vm_editModel") : t("settings.vm_addModelTitle")}
            </h3>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={resetForm}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t("settings.vm_name")} *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="OpenAI Embedding"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t("settings.vm_modelId")} *</label>
              <Input
                value={formData.modelId}
                onChange={(e) => setFormData((p) => ({ ...p, modelId: e.target.value }))}
                placeholder="text-embedding-3-small"
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("settings.vm_url")} *</label>
            <Input
              value={formData.url}
              onChange={(e) => setFormData((p) => ({ ...p, url: e.target.value }))}
              placeholder="https://api.openai.com/v1/embeddings"
              className="h-8 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.vm_urlHint")}</p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("settings.vm_apiKey")}</label>
            <Input
              type="password"
              value={formData.apiKey}
              onChange={(e) => setFormData((p) => ({ ...p, apiKey: e.target.value }))}
              placeholder="sk-..."
              className="h-8 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("settings.vm_description")}</label>
            <Input
              value={formData.description}
              onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
              placeholder={t("settings.vm_descriptionPlaceholder")}
              className="h-8 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={resetForm}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!formData.name.trim() || !formData.url.trim() || !formData.modelId.trim()}
              onClick={editingId ? handleEdit : handleAdd}
            >
              {editingId ? t("common.save") : t("settings.vm_addModel")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */
export function VectorModelSettings() {
  const { t } = useTranslation();
  const {
    vectorModelEnabled,
    vectorModelMode,
    setVectorModelEnabled,
    setVectorModelMode,
  } = useVectorModelStore();

  return (
    <div className="space-y-6 p-4 pt-3">
      {/* Header + Enable switch */}
      <section className="rounded-lg bg-muted/60 p-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-sm font-medium text-foreground">{t("settings.vm_title")}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t("settings.vm_desc")}</p>
          </div>
          <Switch checked={vectorModelEnabled} onCheckedChange={setVectorModelEnabled} />
        </div>
      </section>

      {vectorModelEnabled && (
        <>
          {/* Mode toggle */}
          <section className="rounded-lg bg-muted/60 p-4">
            <h2 className="text-sm font-medium text-foreground mb-2">{t("settings.vm_modeTitle")}</h2>
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                  vectorModelMode === "builtin"
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-background hover:bg-muted/50"
                }`}
                onClick={() => setVectorModelMode("builtin")}
              >
                <div className="text-sm font-medium">{t("settings.vm_modeBuiltin")}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t("settings.vm_modeBuiltinDesc")}</div>
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                  vectorModelMode === "remote"
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-background hover:bg-muted/50"
                }`}
                onClick={() => setVectorModelMode("remote")}
              >
                <div className="text-sm font-medium">{t("settings.vm_modeRemote")}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t("settings.vm_modeRemoteDesc")}</div>
              </button>
            </div>
          </section>

          {/* Content based on mode */}
          {vectorModelMode === "builtin" ? <BuiltinModelsSection /> : <RemoteModelsSection />}
        </>
      )}
    </div>
  );
}
