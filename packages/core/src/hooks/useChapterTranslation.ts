/**
 * useChapterTranslation Hook
 *
 * State-machine hook that orchestrates whole-chapter translation:
 * idle → extracting → translating → complete | error
 *
 * Supports progressive injection, cancellation, and visibility toggle.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { getFromCache } from "../translation/cache";
import {
  clearChapterCache,
  isChapterFullyCached,
  markChapterFullyCached,
} from "../translation/chapter-cache";
import type {
  ChapterParagraph,
  ChapterTranslationProgress,
  ChapterTranslationResult,
} from "../translation/chapter-translator";
import { translateChapter } from "../translation/chapter-translator";
import type { AIConfig } from "../types";
import type { TranslationConfig } from "../types/translation";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type ChapterTranslationState =
  | { status: "idle" }
  | { status: "extracting" }
  | { status: "translating"; progress: ChapterTranslationProgress }
  | { status: "complete"; originalVisible: boolean; translationVisible: boolean }
  | { status: "error"; message: string };

export interface UseChapterTranslationOptions {
  bookId: string;
  sectionIndex: number;
  aiConfig?: AIConfig;
  translationConfig?: TranslationConfig;
  /** Whether the reader is ready (DOM loaded) — auto-restore waits for this */
  ready?: boolean;
  /** Extract paragraphs from the current section DOM */
  getParagraphs: () => Promise<ChapterParagraph[]> | ChapterParagraph[];
  /** Inject translated paragraphs into the DOM */
  injectTranslations: (results: ChapterTranslationResult[]) => void;
  /** Remove all injected translations from the DOM */
  removeTranslations: () => void;
  /** Apply visibility settings to the DOM */
  applyVisibility?: (originalVisible: boolean, translationVisible: boolean) => void;
}

export function useChapterTranslation(options: UseChapterTranslationOptions) {
  const {
    bookId,
    sectionIndex,
    aiConfig: aiConfigOverride,
    ready = true,
    translationConfig: translationConfigOverride,
    getParagraphs,
    injectTranslations,
    removeTranslations,
    applyVisibility,
  } = options;

  const [state, setState] = useState<ChapterTranslationState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const autoRestoreAttemptedRef = useRef<string>("");
  const startTranslationRef = useRef<() => void>(() => {});

  const translationConfigFromStore = useSettingsStore((s) => s.translationConfig);
  const aiConfigFromStore = useSettingsStore((s) => s.aiConfig);
  const translationConfig = translationConfigOverride || translationConfigFromStore;
  const aiConfig = aiConfigOverride || aiConfigFromStore;

  // ---- Start Translation ---------------------------------------------------
  /** @param overrideTargetLang — if provided, overrides the settings targetLang for this run */
  const startTranslation = useCallback(
    async (overrideTargetLang?: string) => {
      // Clear previous translation if any
      if (state.status !== "idle") {
        abortRef.current?.abort();
        abortRef.current = null;
        removeTranslations();
        await clearChapterCache(bookId, sectionIndex);
      }

      // Build effective config (resolve AI endpoint)
      const config = { ...translationConfig };
      if (overrideTargetLang) {
        config.targetLang = overrideTargetLang as typeof config.targetLang;
      }
      if (config.provider.id === "ai") {
        const endpointId = config.provider.endpointId || aiConfig.activeEndpointId;
        const endpoint = aiConfig.endpoints.find((e) => e.id === endpointId);
        if (endpoint) {
          config.provider = {
            ...config.provider,
            apiKey: endpoint.apiKey,
            baseUrl: endpoint.baseUrl,
            useExactRequestUrl: endpoint.useExactRequestUrl,
            model: config.provider.model || aiConfig.activeModel,
          };
        }
      }

      setState({ status: "extracting" });

      try {
        const paragraphs = await getParagraphs();

        if (!paragraphs || paragraphs.length === 0) {
          setState({ status: "error", message: "No text to translate" });
          return;
        }

        const abortController = new AbortController();
        abortRef.current = abortController;

        const totalChars = paragraphs.reduce((sum, p) => sum + p.text.length, 0);
        setState({
          status: "translating",
          progress: { totalChars, translatedChars: 0 },
        });

        await translateChapter({
          paragraphs,
          sourceLang: "AUTO",
          targetLang: config.targetLang,
          config,
          onProgress: (progress) => {
            setState({ status: "translating", progress });
          },
          onChunkComplete: (results) => {
            injectTranslations(results);
          },
          signal: abortController.signal,
        });

        // Mark chapter fully cached
        markChapterFullyCached(bookId, sectionIndex, config.targetLang).catch(() => {});

        setState({ status: "complete", originalVisible: true, translationVisible: true });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          // Cancelled — keep whatever was already injected, go to complete
          setState({ status: "complete", originalVisible: true, translationVisible: true });
        } else {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        abortRef.current = null;
      }
    },
    [
      state.status,
      translationConfig,
      aiConfig,
      bookId,
      sectionIndex,
      getParagraphs,
      injectTranslations,
      removeTranslations,
    ],
  );

  // Keep ref in sync so auto-restore effect doesn't depend on startTranslation identity
  startTranslationRef.current = startTranslation;

  // ---- Cancel ---------------------------------------------------------------
  const cancelTranslation = useCallback(() => {
    abortRef.current?.abort();
    // State will be set to complete in the catch block above
  }, []);

  // ---- Toggle Original Visibility -------------------------------------------
  const toggleOriginalVisible = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "complete") return prev;
      const newVisible = !prev.originalVisible;
      // Apply to DOM
      applyVisibility?.(newVisible, prev.translationVisible);
      return { ...prev, originalVisible: newVisible };
    });
  }, [applyVisibility]);

  // ---- Toggle Translation Visibility ----------------------------------------
  const toggleTranslationVisible = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "complete") return prev;
      const newVisible = !prev.translationVisible;
      // Apply to DOM
      applyVisibility?.(prev.originalVisible, newVisible);
      return { ...prev, translationVisible: newVisible };
    });
  }, [applyVisibility]);

  // ---- Reset (e.g. on chapter change) ---------------------------------------
  const reset = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    autoRestoreAttemptedRef.current = "";
    removeTranslations();
    setState({ status: "idle" });
    await clearChapterCache(bookId, sectionIndex);
  }, [removeTranslations, bookId, sectionIndex]);

  // ---- Auto-restore cached translations on section load -----------------------
  useEffect(() => {
    const key = `${bookId}_${sectionIndex}_${translationConfig.targetLang}`;
    // Only attempt once per section+lang combo, and only when idle+ready
    if (!ready || state.status !== "idle" || autoRestoreAttemptedRef.current === key) return;
    autoRestoreAttemptedRef.current = key;

    let cancelled = false;
    // Small delay to ensure DOM is fully stable after navigation
    const timer = setTimeout(async () => {
      try {
        const cached = await isChapterFullyCached(
          bookId,
          sectionIndex,
          translationConfig.targetLang,
        );
        if (cached && !cancelled) {
          // Get paragraphs and restore translations from cache
          const paragraphs = await getParagraphs();
          const providerId = translationConfig.provider.id;
          const results: ChapterTranslationResult[] = [];

          for (const p of paragraphs) {
            const translation = await getFromCache(
              p.text,
              "AUTO",
              translationConfig.targetLang,
              providerId,
            );
            if (translation) {
              results.push({
                paragraphId: p.id,
                originalText: p.text,
                translatedText: translation,
              });
            }
          }

          // Inject translations to DOM
          if (results.length > 0) {
            injectTranslations(results);
          }

          // Always show both original and translation by default
          setState({
            status: "complete",
            originalVisible: true,
            translationVisible: true,
          });
        }
      } catch {
        // Ignore errors
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    ready,
    bookId,
    sectionIndex,
    translationConfig.targetLang,
    state.status,
    getParagraphs,
    injectTranslations,
    translationConfig.provider.id,
  ]);

  return {
    state,
    startTranslation,
    cancelTranslation,
    toggleOriginalVisible,
    toggleTranslationVisible,
    reset,
  };
}
