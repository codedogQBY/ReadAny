import { useSettingsStore } from "@/stores";
import type { SettingsState } from "@/stores/settings-store";
import type { AIConfig, AIEndpoint } from "@readany/core/types";
import { providerRequiresApiKey } from "@readany/core/utils";

function canUseEndpoint(
  endpoint: AIEndpoint | undefined,
  model: string | undefined,
): endpoint is AIEndpoint {
  if (!endpoint || !model) return false;
  return !providerRequiresApiKey(endpoint.provider) || Boolean(endpoint.apiKey);
}

function resolvePreferredModel(endpoint: AIEndpoint | undefined, activeModel: string): string {
  if (!endpoint) return "";
  if (activeModel && endpoint.models.includes(activeModel)) return activeModel;
  return endpoint.models[0] || activeModel;
}

export async function resolveActiveAIConfig(state: SettingsState): Promise<AIConfig | null> {
  await state.loadApiKeys();

  const refreshedState = useSettingsStore.getState();
  const currentConfig = refreshedState.aiConfig;

  let endpoint = await refreshedState.getActiveEndpoint();
  let model = resolvePreferredModel(endpoint, currentConfig.activeModel);

  if (!canUseEndpoint(endpoint, model)) {
    for (const candidate of currentConfig.endpoints) {
      const hydratedCandidate = await refreshedState.getEndpointById(candidate.id);
      const candidateModel = resolvePreferredModel(hydratedCandidate, currentConfig.activeModel);
      if (canUseEndpoint(hydratedCandidate, candidateModel)) {
        endpoint = hydratedCandidate;
        model = candidateModel;
        break;
      }
    }
  }

  if (!canUseEndpoint(endpoint, model)) {
    return null;
  }

  if (currentConfig.activeEndpointId !== endpoint.id) {
    refreshedState.setActiveEndpoint(endpoint.id);
  }
  if (currentConfig.activeModel !== model) {
    refreshedState.setActiveModel(model);
  }

  return {
    ...currentConfig,
    activeEndpointId: endpoint.id,
    activeModel: model,
    endpoints: currentConfig.endpoints.map((candidate) =>
      candidate.id === endpoint.id ? { ...candidate, apiKey: endpoint.apiKey } : candidate,
    ),
  };
}
