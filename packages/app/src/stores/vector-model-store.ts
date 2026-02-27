/**
 * Vector Model Store — manages embedding/vector model configurations
 * Supports:
 * - Remote API endpoints (OpenAI-compatible, Ollama, etc.)
 * - Built-in local models via Transformers.js (downloaded & cached automatically)
 */
import type { VectorModelConfig } from "@/types";
import { create } from "zustand";
import { withPersist } from "./persist";

/** Status of a built-in model download */
export type BuiltinModelStatus = "idle" | "downloading" | "ready" | "error";

export interface BuiltinModelState {
  status: BuiltinModelStatus;
  progress?: number; // 0-100
  error?: string;
}

export interface VectorModelState {
  /** All configured remote vector models */
  vectorModels: VectorModelConfig[];
  /** Currently selected remote vector model ID */
  selectedVectorModelId: string | null;
  /** Whether vector model feature is enabled */
  vectorModelEnabled: boolean;

  /** Which mode is active: "remote" (API) or "builtin" (local Transformers.js) */
  vectorModelMode: "remote" | "builtin";
  /** Selected built-in model ID (from BUILTIN_EMBEDDING_MODELS) */
  selectedBuiltinModelId: string | null;
  /** Status of each built-in model keyed by model id */
  builtinModelStates: Record<string, BuiltinModelState>;

  // Actions — general
  setVectorModelEnabled: (enabled: boolean) => void;
  setVectorModelMode: (mode: "remote" | "builtin") => void;

  // Actions — remote models
  addVectorModel: (model: VectorModelConfig) => void;
  updateVectorModel: (id: string, updates: Partial<VectorModelConfig>) => void;
  deleteVectorModel: (id: string) => void;
  setSelectedVectorModelId: (id: string | null) => void;
  getSelectedVectorModel: () => VectorModelConfig | null;

  // Actions — builtin models
  setSelectedBuiltinModelId: (id: string | null) => void;
  updateBuiltinModelState: (id: string, state: Partial<BuiltinModelState>) => void;

  // Computed
  hasVectorCapability: () => boolean;
}

/** Sanitize builtin model states on load: reset transient statuses */
function sanitizeBuiltinStates(
  states: Record<string, BuiltinModelState>,
): Record<string, BuiltinModelState> {
  const result: Record<string, BuiltinModelState> = {};
  for (const [id, s] of Object.entries(states)) {
    if (s.status === "downloading") {
      // Download was interrupted — reset to idle
      result[id] = { status: "idle" };
    } else {
      result[id] = { ...s, error: undefined };
    }
  }
  return result;
}

export const useVectorModelStore = create<VectorModelState>()(
  withPersist("vector-model", (set, get, _api) => ({
  vectorModels: [],
  selectedVectorModelId: null,
  vectorModelEnabled: true,
  vectorModelMode: "builtin",
  selectedBuiltinModelId: null,
  builtinModelStates: {},

  setVectorModelEnabled: (vectorModelEnabled) => set({ vectorModelEnabled }),
  setVectorModelMode: (vectorModelMode) => set({ vectorModelMode }),

  // --- Remote models ---
  addVectorModel: (model) => {
    const { vectorModels } = get();
    set({ vectorModels: [...vectorModels, model] });
  },

  updateVectorModel: (id, updates) => {
    const { vectorModels } = get();
    set({
      vectorModels: vectorModels.map((m) =>
        m.id === id ? { ...m, ...updates } : m,
      ),
    });
  },

  deleteVectorModel: (id) => {
    const { vectorModels, selectedVectorModelId } = get();
    const newModels = vectorModels.filter((m) => m.id !== id);
    const newSelected = selectedVectorModelId === id ? null : selectedVectorModelId;
    set({ vectorModels: newModels, selectedVectorModelId: newSelected });
  },

  setSelectedVectorModelId: (selectedVectorModelId) =>
    set({ selectedVectorModelId }),

  getSelectedVectorModel: () => {
    const { vectorModels, selectedVectorModelId } = get();
    return vectorModels.find((m) => m.id === selectedVectorModelId) || null;
  },

  // --- Builtin models ---
  setSelectedBuiltinModelId: (selectedBuiltinModelId) =>
    set({ selectedBuiltinModelId }),

  updateBuiltinModelState: (id, state) =>
    set((s) => ({
      builtinModelStates: {
        ...s.builtinModelStates,
        [id]: { ...s.builtinModelStates[id], ...state } as BuiltinModelState,
      },
    })),

  // --- Computed ---
  hasVectorCapability: () => {
    const { vectorModelEnabled, vectorModelMode } = get();
    if (!vectorModelEnabled) return false;
    if (vectorModelMode === "builtin") {
      const { selectedBuiltinModelId, builtinModelStates } = get();
      if (!selectedBuiltinModelId) return false;
      return builtinModelStates[selectedBuiltinModelId]?.status === "ready";
    }
    const selected = get().getSelectedVectorModel();
    return selected != null;
  },
})),
);

// After rehydration, sanitize builtin model states (reset interrupted downloads)
setTimeout(() => {
  const state = useVectorModelStore.getState();
  const sanitized = sanitizeBuiltinStates(state.builtinModelStates);
  const needsUpdate = Object.keys(sanitized).some(
    (id) => sanitized[id].status !== state.builtinModelStates[id]?.status,
  );
  if (needsUpdate) {
    useVectorModelStore.setState({ builtinModelStates: sanitized });
  }
}, 1000);
