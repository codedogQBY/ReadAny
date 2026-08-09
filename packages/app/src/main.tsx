import "./polyfills";
import { i18nReady } from "@readany/core/i18n";
import { initI18nLanguage } from "@readany/core/i18n";
/**
 * Entry point — mount React app + beforeunload protection
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { setEmbeddingWorkerFactory, setStreamingFetch } from "@readany/core/ai";
import { onLibraryChanged } from "@readany/core/events/library-events";
import { installFeedbackLogCapture, setFeedbackWorkerUrl } from "@readany/core/feedback";
import {
  createBuiltinEmbeddingService,
  EmbeddingService,
  normalizeEmbeddingEndpoint,
  clearSearchConfiguration,
  configureSearch,
  setVectorDB,
} from "@readany/core/rag";
import { setPlatformService } from "@readany/core/services";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { TauriPlatformService } from "./lib/platform/tauri-platform-service";
import { syncLegacyDesktopLibraryRootConfig } from "./lib/storage/desktop-library-root";
import { TauriVectorDB } from "./lib/tauri-vector-db";
import { registerDesktopFallbackContentProvider } from "./lib/rag/fallback-content-provider";
import { useLibraryStore } from "./stores/library-store";
import { flushAllWrites } from "./stores/persist";
import { useVectorModelStore } from "./stores/vector-model-store";

installFeedbackLogCapture();

const FEEDBACK_WORKER_FALLBACK = "https://feedback.readany.top";
const feedbackWorkerUrl = import.meta.env.VITE_FEEDBACK_WORKER_URL?.trim() || FEEDBACK_WORKER_FALLBACK;
setFeedbackWorkerUrl(feedbackWorkerUrl);

// Register platform service before any database/core operations
const tauriPlatform = new TauriPlatformService();
tauriPlatform.initSync().catch(console.error);
setPlatformService(tauriPlatform);
registerDesktopFallbackContentProvider();

// Set Tauri fetch for streaming AI requests (avoids CORS issues)
setStreamingFetch(tauriFetch as typeof globalThis.fetch);

// Register embedding worker factory for Vite/Tauri
// Must use `new URL(...)` + explicit `{ type: "module" }` so that
// import.meta.url is available inside the worker (needed by @huggingface/transformers / onnxruntime-web)
setEmbeddingWorkerFactory(
  () =>
    new Worker(new URL("@readany/core/ai/embedding-worker", import.meta.url), { type: "module" }),
);

/**
 * The vectorization pipeline configures its embedding source independently from
 * search. Keep the query-side service aligned with the active vector-model setting
 * so Reader Agent ragSearch can generate query embeddings as well.
 */
function configureRagSearchFromVectorModelStore(): void {
  const state = useVectorModelStore.getState();
  if (!state.vectorModelEnabled) {
    clearSearchConfiguration();
    return;
  }

  if (state.vectorModelMode === "builtin" && state.selectedBuiltinModelId) {
    configureSearch(createBuiltinEmbeddingService(state.selectedBuiltinModelId));
    return;
  }

  const remoteModel = state.getSelectedVectorModel();
  if (state.vectorModelMode === "remote" && remoteModel) {
    configureSearch(
      new EmbeddingService({
        model: {
          id: remoteModel.modelId,
          name: remoteModel.name || remoteModel.modelId,
          dimensions: remoteModel.dimension ?? 0,
          maxTokens: 8192,
          provider: "openai",
        },
        apiKey: remoteModel.apiKey || "local",
        baseUrl: remoteModel.url,
      }),
      {
        kind: "remote",
        modelId: remoteModel.modelId,
        endpoint: normalizeEmbeddingEndpoint(remoteModel.url),
        dimensions: remoteModel.dimension ?? 0,
      },
    );
    return;
  }

  clearSearchConfiguration();
}

configureRagSearchFromVectorModelStore();
useVectorModelStore.subscribe(configureRagSearchFromVectorModelStore);

// Set vector database reference (initialized in Rust setup)
const tauriVectorDB = new TauriVectorDB();
setVectorDB(tauriVectorDB);
console.log("[VectorDB] TauriVectorDB reference set");

const desktopDataRootReady = syncLegacyDesktopLibraryRootConfig().catch(console.error);

// Ensure i18n is fully initialized before rendering
i18nReady.then(() => {
  desktopDataRootReady.catch(console.error);

  // Restore saved theme from localStorage
  const savedTheme = localStorage.getItem("readany-theme");
  if (savedTheme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } else if (savedTheme && ["light", "dark", "sepia"].includes(savedTheme)) {
    document.documentElement.setAttribute("data-theme", savedTheme);
  } else {
    // Default to sepia theme
    document.documentElement.setAttribute("data-theme", "sepia");
  }

  // Restore saved language from platform KV storage
  initI18nLanguage().catch(console.error);

  // Flush pending state writes before window closes
  window.addEventListener("beforeunload", () => {
    flushAllWrites();
  });

  // Initialize database and load books
  desktopDataRootReady.then(() => {
    useLibraryStore.getState().loadBooks();
  });

  // Refresh library store when AI tools modify books/tags
  onLibraryChanged((deletedTags) => useLibraryStore.getState().loadBooks(deletedTags));

  // Fire-and-forget: preload foliate-js core modules so they're cached for later use
  import("foliate-js/view.js").catch(() => {});
  import("foliate-js/paginator.js").catch(() => {});

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Root element not found");
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
