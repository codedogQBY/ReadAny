/**
 * useChapterTranslation Hook
 *
 * State-machine hook that orchestrates whole-chapter translation:
 * idle → extracting → translating → complete | error
 *
 * Supports progressive injection, cancellation, and visibility toggle.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeChapterSourceHash,
  getChapterTranslation,
  updateChapterTranslationVisibility,
  upsertChapterTranslation,
} from "../db";
import { useSettingsStore } from "../stores/settings-store";
import { getFromCache } from "../translation/cache";
import {
  clearChapterCache,
  getChapterTranslationSettings,
  isChapterFullyCached,
  markChapterFullyCached,
  updateChapterTranslationSettings,
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
  injectTranslations: (
    results: ChapterTranslationResult[],
    visibility?: { originalVisible: boolean; translationVisible: boolean },
  ) => void | Promise<void>;
  /** Remove all injected translations from the DOM */
  removeTranslations: () => void;
  /** Apply visibility settings to the DOM */
  applyVisibility?: (originalVisible: boolean, translationVisible: boolean) => void;
  /** Get current reader position (CFI) — used to restore position after translation injection */
  getCurrentCfi?: () => string | undefined;
  /** Navigate to a CFI — used to restore position after translation injection */
  goToCfi?: (cfi: string) => void | Promise<void>;
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
    getCurrentCfi,
    goToCfi,
  } = options;

  const [state, setState] = useState<ChapterTranslationState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const startTranslationRef = useRef<() => void>(() => {});
  const getParagraphsRef = useRef(getParagraphs);
  const injectTranslationsRef = useRef(injectTranslations);
  const getCurrentCfiRef = useRef(getCurrentCfi);
  const goToCfiRef = useRef(goToCfi);
  const visibilityRef = useRef({ originalVisible: true, translationVisible: true });
  const activeTargetLangRef = useRef<string | undefined>(translationConfigOverride?.targetLang);

  const translationConfigFromStore = useSettingsStore((s) => s.translationConfig);
  const aiConfigFromStore = useSettingsStore((s) => s.aiConfig);
  const translationConfig = translationConfigOverride || translationConfigFromStore;
  const aiConfig = aiConfigOverride || aiConfigFromStore;
  activeTargetLangRef.current ??= translationConfig.targetLang;

  getParagraphsRef.current = getParagraphs;
  injectTranslationsRef.current = injectTranslations;
  getCurrentCfiRef.current = getCurrentCfi;
  goToCfiRef.current = goToCfi;

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
        const sourceHash = computeSourceHashFromParagraphs(paragraphs);
        activeTargetLangRef.current = config.targetLang;

        const persisted = await getChapterTranslation(
          bookId,
          sectionIndex,
          "AUTO",
          config.targetLang,
          sourceHash,
        );
        if (persisted) {
          const visibility = {
            originalVisible: persisted.originalVisible,
            translationVisible: persisted.translationVisible,
          };
          visibilityRef.current = visibility;
          await injectTranslations(persisted.paragraphs, visibility);
          setState({ status: "complete", ...visibility });
          return;
        }

        const abortController = new AbortController();
        abortRef.current = abortController;

        const totalChars = paragraphs.reduce((sum, p) => sum + p.text.length, 0);
        setState({
          status: "translating",
          progress: { totalChars, translatedChars: 0 },
        });

        const results = await translateChapter({
          paragraphs,
          sourceLang: "AUTO",
          targetLang: config.targetLang,
          config,
          onProgress: (progress) => {
            setState({ status: "translating", progress });
          },
          onChunkComplete: (results) => {
            void injectTranslations(results, visibilityRef.current);
          },
          signal: abortController.signal,
        });

        if (!abortController.signal.aborted) {
          const orderedResults = orderResultsByParagraphs(paragraphs, results);
          await upsertChapterTranslation({
            bookId,
            sectionIndex,
            sourceLang: "AUTO",
            targetLang: config.targetLang,
            provider: config.provider.id,
            model: config.provider.model,
            sourceHash,
            paragraphs: orderedResults,
            ...visibilityRef.current,
          });

          // Keep the old marker for compatibility with legacy paragraph cache.
          markChapterFullyCached(bookId, sectionIndex, config.targetLang).catch((err) =>
            console.warn("[Translation] Failed to mark chapter cached:", err),
          );
        }

        setState({ status: "complete", ...visibilityRef.current });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          // Cancelled — keep whatever was already injected, go to complete
          setState({ status: "complete", ...visibilityRef.current });
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
      visibilityRef.current = {
        originalVisible: newVisible,
        translationVisible: prev.translationVisible,
      };
      // Persist visibility preference
      updateChapterTranslationSettings(bookId, sectionIndex, visibilityRef.current).catch(() => {});
      updateChapterTranslationVisibility(
        bookId,
        sectionIndex,
        "AUTO",
        activeTargetLangRef.current || translationConfig.targetLang,
        visibilityRef.current,
      ).catch(() => {});
      return { ...prev, ...visibilityRef.current };
    });
  }, [applyVisibility, bookId, sectionIndex, translationConfig.targetLang]);

  // ---- Toggle Translation Visibility ----------------------------------------
  const toggleTranslationVisible = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "complete") return prev;
      const newVisible = !prev.translationVisible;
      // Apply to DOM
      applyVisibility?.(prev.originalVisible, newVisible);
      visibilityRef.current = {
        originalVisible: prev.originalVisible,
        translationVisible: newVisible,
      };
      // Persist visibility preference
      updateChapterTranslationSettings(bookId, sectionIndex, visibilityRef.current).catch(() => {});
      updateChapterTranslationVisibility(
        bookId,
        sectionIndex,
        "AUTO",
        activeTargetLangRef.current || translationConfig.targetLang,
        visibilityRef.current,
      ).catch(() => {});
      return { ...prev, ...visibilityRef.current };
    });
  }, [applyVisibility, bookId, sectionIndex, translationConfig.targetLang]);

  // ---- Reset (e.g. on chapter change) ---------------------------------------
  const reset = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    removeTranslations();
    setState({ status: "idle" });
    // Note: we do NOT clear the persistent chapter cache here.
    // This allows auto-restore to work when the user returns to this chapter.
  }, [removeTranslations]);

  // ---- Auto-restore cached translations on section load -----------------------
  useEffect(() => {
    if (!ready || state.status !== "idle") return;

    let cancelled = false;
    async function restoreCachedTranslations() {
      try {
        const paragraphs = await getParagraphsRef.current();
        if (cancelled || !paragraphs || paragraphs.length === 0) return;
        const sourceHash = computeSourceHashFromParagraphs(paragraphs);

        const persisted = await getChapterTranslation(
          bookId,
          sectionIndex,
          "AUTO",
          translationConfig.targetLang,
          sourceHash,
        );
        if (persisted && !cancelled) {
          const visibility = {
            originalVisible: persisted.originalVisible,
            translationVisible: persisted.translationVisible,
          };
          visibilityRef.current = visibility;
          activeTargetLangRef.current = persisted.targetLang;

          const cfiBeforeInject = getCurrentCfiRef.current?.();
          await injectTranslationsRef.current(persisted.paragraphs, visibility);
          if (cancelled) return;

          if (cfiBeforeInject && goToCfiRef.current) {
            await goToCfiRef.current(cfiBeforeInject);
          }
          if (cancelled) return;

          setState({ status: "complete", ...visibility });
          return;
        }

        const cached = await isChapterFullyCached(
          bookId,
          sectionIndex,
          translationConfig.targetLang,
        );
        if (!cached || cancelled) return;

        // Load saved visibility preferences
        const savedSettings = await getChapterTranslationSettings(bookId, sectionIndex);
        const visibility = {
          originalVisible: savedSettings?.originalVisible ?? true,
          translationVisible: savedSettings?.translationVisible ?? true,
        };
        visibilityRef.current = visibility;

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

        if (results.length > 0 && !cancelled) {
          // Remember position before injection
          const cfiBeforeInject = getCurrentCfiRef.current?.();
          const visibility = visibilityRef.current;

          await injectTranslationsRef.current(results, visibility);
          if (cancelled) return;

          await upsertChapterTranslation({
            bookId,
            sectionIndex,
            sourceLang: "AUTO",
            targetLang: translationConfig.targetLang,
            provider: providerId,
            model: translationConfig.provider.model,
            sourceHash,
            paragraphs: orderResultsByParagraphs(paragraphs, results),
            ...visibility,
          });
          if (cancelled) return;

          // Restore position after translation content changes layout.
          if (cfiBeforeInject && goToCfiRef.current) {
            await goToCfiRef.current(cfiBeforeInject);
          }
          if (cancelled) return;

          setState({
            status: "complete",
            ...visibility,
          });
        }
      } catch (err) {
        console.warn("[Translation] Auto-restore translation failed:", err);
      }
    }

    restoreCachedTranslations();

    return () => {
      cancelled = true;
    };
  }, [
    ready,
    state.status,
    bookId,
    sectionIndex,
    translationConfig.targetLang,
    translationConfig.provider.id,
    translationConfig.provider.model,
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

function computeSourceHashFromParagraphs(paragraphs: ChapterParagraph[]): string {
  return computeChapterSourceHash(
    paragraphs.map((paragraph) => ({
      paragraphId: paragraph.id,
      originalText: paragraph.text,
    })),
  );
}

function orderResultsByParagraphs(
  paragraphs: ChapterParagraph[],
  results: ChapterTranslationResult[],
): ChapterTranslationResult[] {
  const byId = new Map(results.map((result) => [result.paragraphId, result]));
  return paragraphs
    .map((paragraph) => byId.get(paragraph.id))
    .filter((result): result is ChapterTranslationResult => !!result);
}
