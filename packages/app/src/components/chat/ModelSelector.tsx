/**
 * ModelSelector — inline model switcher for chat headers.
 * Shows all models across all endpoints, grouped by endpoint name.
 * Selecting a model from a different endpoint also switches the active endpoint.
 */
import { useSettingsStore } from "@/stores/settings-store";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function ModelSelector() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const { aiConfig, setActiveModel, setActiveEndpoint } = useSettingsStore();
  const currentModel = aiConfig.activeModel;
  const activeEndpointId = aiConfig.activeEndpointId;

  // Collect all endpoints that have models
  const endpointsWithModels = aiConfig.endpoints.filter(
    (ep) => ep.models.length > 0,
  );
  const totalModels = endpointsWithModels.reduce(
    (sum, ep) => sum + ep.models.length,
    0,
  );
  const multipleEndpoints = endpointsWithModels.length > 1;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Derive display name: truncate long model names
  const displayName = currentModel
    ? currentModel.length > 20
      ? `${currentModel.slice(0, 18)}...`
      : currentModel
    : t("chat.currentModel");

  const canSwitch = totalModels > 1;

  const handleSelect = (endpointId: string, model: string) => {
    if (endpointId !== activeEndpointId) {
      setActiveEndpoint(endpointId);
    }
    setActiveModel(model);
    setOpen(false);
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => canSwitch && setOpen(!open)}
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors ${
          canSwitch
            ? "cursor-pointer hover:bg-muted hover:text-foreground"
            : "cursor-default"
        }`}
        title={currentModel || t("chat.currentModel")}
      >
        <span className="max-w-[120px] truncate">{displayName}</span>
        {canSwitch && <ChevronDown className="size-3 shrink-0" />}
      </button>

      {open && canSwitch && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-xl border bg-background p-1 shadow-lg">
          <div className="max-h-72 overflow-y-auto">
            {endpointsWithModels.map((ep) => (
              <div key={ep.id}>
                {multipleEndpoints && (
                  <div className="px-2.5 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground first:pt-1">
                    {ep.name || ep.baseUrl}
                  </div>
                )}
                {ep.models.map((model) => {
                  const isActive =
                    model === currentModel && ep.id === activeEndpointId;
                  return (
                    <button
                      key={`${ep.id}-${model}`}
                      type="button"
                      onClick={() => handleSelect(ep.id, model)}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-neutral-700 hover:bg-muted"
                      }`}
                    >
                      <span className="truncate">{model}</span>
                      {isActive && <Check className="size-3 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
