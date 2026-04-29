/**
 * usePreheating - 预热流程状态管理 Hook
 *
 * 功能：
 * - 管理预热对话框的显示/隐藏
 * - 处理预热流程状态
 * - 与书籍打开流程集成
 */

import { useSettingsStore } from "@/stores/settings-store";
import type { Book } from "@readany/core/types";
import { useCallback, useEffect, useState } from "react";

export interface UsePreheatingOptions {
  book: Book | null;
  onPreheatingComplete: () => void;
  onPreheatingSkip: () => void;
}

export interface UsePreheatingReturn {
  shouldShowPreheatingDialog: boolean;
  isPreheating: boolean;
  currentPhase: "idle" | "opening" | "connection" | "transition" | "reading" | "review";
  showPreheatingDialog: () => void;
  hidePreheatingDialog: () => void;
  startPreheating: () => void;
  skipPreheating: () => void;
  completePreheating: () => void;
}

export function usePreheating({
  book,
  onPreheatingComplete,
  onPreheatingSkip,
}: UsePreheatingOptions): UsePreheatingReturn {
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const hasShownPreheatingDialog = useSettingsStore((s) => s.hasShownPreheatingDialog);
  const markPreheatingDialogShown = useSettingsStore((s) => s.markPreheatingDialogShown);
  
  console.log('[usePreheating] hasShownPreheatingDialog:', hasShownPreheatingDialog);
  
  const socraticSettings = aiConfig.socraticSettings || {
    enabled: false,
    mode: "socratic" as const,
    knowledgeScope: "current_chapter" as const,
    questionComplexity: "medium" as const,
    enablePreheating: true,
    preheatingStrategy: "smart" as const,
    enableWebSearch: false,
  };

  const [shouldShowPreheatingDialog, setShouldShowPreheatingDialog] = useState(false);
  const [isPreheating, setIsPreheating] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<
    "idle" | "opening" | "connection" | "transition" | "reading" | "review"
  >("idle");

  const isSocraticEnabled = aiConfig.chatMode === "socratic" && socraticSettings.enabled;

  useEffect(() => {
    if (!isSocraticEnabled || !book) {
      setShouldShowPreheatingDialog(false);
      return;
    }

    if (!socraticSettings.enablePreheating) {
      onPreheatingSkip();
      return;
    }

    // 智能策略：首次启动时显示一次，之后不再自动显示
    const shouldAutoShow =
      socraticSettings.preheatingStrategy === "auto" ||
      (socraticSettings.preheatingStrategy === "smart" && !hasShownPreheatingDialog);

    console.log('[usePreheating] Strategy:', socraticSettings.preheatingStrategy, 'shouldAutoShow:', shouldAutoShow);

    if (shouldAutoShow) {
      setShouldShowPreheatingDialog(true);
    }
  }, [
    isSocraticEnabled,
    book,
    socraticSettings.enablePreheating,
    socraticSettings.preheatingStrategy,
    hasShownPreheatingDialog,
    onPreheatingSkip,
  ]);

  const showPreheatingDialog = useCallback(() => {
    setShouldShowPreheatingDialog(true);
  }, []);

  const hidePreheatingDialog = useCallback(() => {
    setShouldShowPreheatingDialog(false);
  }, []);

  const startPreheating = useCallback(() => {
    console.log('[usePreheating] startPreheating called');
    setIsPreheating(true);
    setCurrentPhase("opening");
    setShouldShowPreheatingDialog(false);
    markPreheatingDialogShown();  // 标记已显示
    console.log('[usePreheating] markPreheatingDialogShown called');
  }, [markPreheatingDialogShown]);

  const skipPreheating = useCallback(() => {
    console.log('[usePreheating] skipPreheating called');
    setIsPreheating(false);
    setCurrentPhase("reading");
    setShouldShowPreheatingDialog(false);
    markPreheatingDialogShown();  // 标记已显示
    console.log('[usePreheating] markPreheatingDialogShown called');
    onPreheatingSkip();
  }, [onPreheatingSkip, markPreheatingDialogShown]);

  const completePreheating = useCallback(() => {
    console.log('[usePreheating] completePreheating called');
    setIsPreheating(false);
    setCurrentPhase("reading");
    markPreheatingDialogShown();  // 标记已显示
    console.log('[usePreheating] markPreheatingDialogShown called');
    onPreheatingComplete();
  }, [onPreheatingComplete, markPreheatingDialogShown]);

  return {
    shouldShowPreheatingDialog,
    isPreheating,
    currentPhase,
    showPreheatingDialog,
    hidePreheatingDialog,
    startPreheating,
    skipPreheating,
    completePreheating,
  };
}
