/**
 * PreheatingDialog - 苏格拉底模式预热对话框
 *
 * 功能：
 * - 在书籍打开前显示预热对话框
 * - 展示预热阶段和 AI 首个问题
 * - 支持跳过预热或开始阅读
 * - 显示当前预热策略（自动/手动/智能）
 */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSettingsStore } from "@/stores/settings-store";
import type { Book } from "@readany/core/types";
import { ArrowRight, BookOpen, Lightbulb, SkipForward, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface PreheatingDialogProps {
  open: boolean;
  book: Book | null;
  onStartPreheating: () => void;
  onSkipPreheating: () => void;
  onClose: () => void;
}

export function PreheatingDialog({
  open,
  book,
  onStartPreheating,
  onSkipPreheating,
  onClose,
}: PreheatingDialogProps) {
  const { t } = useTranslation();
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

  const [isLoading, setIsLoading] = useState(false);

  const getStrategyLabel = () => {
    switch (socraticSettings.preheatingStrategy) {
      case "auto":
        return t("preheating.strategyAuto", "自动预热");
      case "manual":
        return t("preheating.strategyManual", "手动预热");
      case "smart":
        return t("preheating.strategySmart", "智能预热");
      default:
        return t("preheating.strategyAuto", "自动预热");
    }
  };

  const getModeLabel = () => {
    switch (socraticSettings.mode) {
      case "socratic":
        return t("preheating.modeSocratic", "苏格拉底式提问");
      case "feynman":
        return t("preheating.modeFeynman", "费曼讲解法");
      case "critical":
        return t("preheating.modeCritical", "批判性思维");
      case "associative":
        return t("preheating.modeAssociative", "跨界联想");
      default:
        return t("preheating.modeSocratic", "苏格拉底式提问");
    }
  };

  const handleStartPreheating = async () => {
    setIsLoading(true);
    try {
      await onStartPreheating();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = async () => {
    setIsLoading(true);
    try {
      await onSkipPreheating();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle className="text-lg">{t("preheating.title", "开启思维预热")}</DialogTitle>
          </div>
          <DialogDescription className="text-sm">
            {book
              ? t(
                  "preheating.description",
                  "在你翻开《{{bookTitle}}》之前，让我们先进行一点思维热身。",
                  { bookTitle: book.meta.title },
                )
              : t("preheating.descriptionNoBook", "在开始阅读之前，让我们先进行一点思维热身。")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Book info */}
          {book && (
            <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
              <div className="flex h-12 w-9 items-center justify-center rounded bg-primary/10">
                <BookOpen className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{book.meta.title}</p>
                {book.meta.author && (
                  <p className="truncate text-xs text-muted-foreground">{book.meta.author}</p>
                )}
              </div>
            </div>
          )}

          {/* Preheating info */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-primary" />
              <span className="font-medium">
                {t("preheating.currentMode", "当前模式")}: {getModeLabel()}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              <span className="text-muted-foreground">
                {t("preheating.strategy", "预热策略")}: {getStrategyLabel()}
              </span>
            </div>
          </div>

          {/* What to expect */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("preheating.whatToExpect", "预热内容")}
            </h4>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-primary">1.</span>
                <span>{t("preheating.step1", "AI 会根据书籍主题提出 1-3 个引导性问题")}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">2.</span>
                <span>{t("preheating.step2", "根据你的回答，联结书中的核心观点")}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">3.</span>
                <span>{t("preheating.step3", "准备好后，点击「开始阅读」进入精读模式")}</span>
              </li>
            </ul>
          </div>

          {/* Time estimate */}
          <p className="text-xs text-muted-foreground">
            {t("preheating.timeEstimate", "⏱️ 预热通常需要 1-3 分钟，可以随时跳过")}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleSkip} disabled={isLoading} className="gap-1.5">
            <SkipForward className="h-4 w-4" />
            {t("preheating.skip", "跳过预热")}
          </Button>
          <Button onClick={handleStartPreheating} disabled={isLoading} className="gap-1.5">
            <Sparkles className="h-4 w-4" />
            {t("preheating.start", "开始预热")}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
