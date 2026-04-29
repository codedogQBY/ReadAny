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
  const [hasShownDialog, setHasShownDialog] = useState(false);

  const isSocraticEnabled = aiConfig.chatMode === "socratic" && socraticSettings.enabled;

  useEffect(() => {
    if (!isSocraticEnabled || !book) {
      setShouldShowPreheatingDialog(false);
      setHasShownDialog(false);
      return;
    }

    if (!socraticSettings.enablePreheating) {
      onPreheatingSkip();
      return;
    }

    const shouldAutoShow =
      socraticSettings.preheatingStrategy === "auto" ||
      (socraticSettings.preheatingStrategy === "smart" && !hasShownDialog);

    if (shouldAutoShow) {
      setShouldShowPreheatingDialog(true);
    }
  }, [
    isSocraticEnabled,
    book,
    socraticSettings.enablePreheating,
    socraticSettings.preheatingStrategy,
    hasShownDialog,
    onPreheatingSkip,
  ]);

  const showPreheatingDialog = useCallback(() => {
    setShouldShowPreheatingDialog(true);
  }, []);

  const hidePreheatingDialog = useCallback(() => {
    setShouldShowPreheatingDialog(false);
  }, []);

  const startPreheating = useCallback(() => {
    setIsPreheating(true);
    setCurrentPhase("opening");
    setShouldShowPreheatingDialog(false);
    setHasShownDialog(true);
  }, []);

  const skipPreheating = useCallback(() => {
    setIsPreheating(false);
    setCurrentPhase("reading");
    setShouldShowPreheatingDialog(false);
    setHasShownDialog(true);
    onPreheatingSkip();
  }, [onPreheatingSkip]);

  const completePreheating = useCallback(() => {
    setIsPreheating(false);
    setCurrentPhase("reading");
    setHasShownDialog(true);
    onPreheatingComplete();
  }, [onPreheatingComplete]);

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
