import { Progress } from "@/components/ui/progress";
/**
 * ChapterTranslationMenu — dropdown menu attached to the toolbar Languages button.
 *
 * States:  idle → language selector + translate button
 *          extracting / translating → progress + cancel
 *          complete → toggle original / translation visibility + clear
 *          error → message + retry + clear
 */

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settings-store";
import type { ChapterTranslationState } from "@readany/core/hooks";
import type { TranslationTargetLang } from "@readany/core/types/translation";
import { TRANSLATOR_LANGS } from "@readany/core/types/translation";
import { Check, Eye, EyeOff, Languages, Loader2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface ChapterTranslationMenuProps {
  state: ChapterTranslationState;
  onStart: (targetLang?: string) => void;
  onCancel: () => void;
  onToggleOriginalVisible: () => void;
  onToggleTranslationVisible: () => void;
  onReset: () => void;
}

export function ChapterTranslationMenu({
  state,
  onStart,
  onCancel,
  onToggleOriginalVisible,
  onToggleTranslationVisible,
  onReset,
}: ChapterTranslationMenuProps) {
  const { t } = useTranslation();
  const defaultLang = useSettingsStore((s) => s.translationConfig.targetLang);
  const setTranslationLang = useSettingsStore((s) => s.setTranslationLang);
  const [selectedLang, setSelectedLang] = useState<TranslationTargetLang>(defaultLang);

  const isActive = state.status !== "idle";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${isActive ? "bg-primary/10 text-primary" : ""}`}
          title={t("translation.translateChapter")}
        >
          <Languages className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {/* ── idle: language picker + translate ── */}
        {state.status === "idle" && (
          <>
            <div className="px-2 py-1.5">
              <Select
                value={selectedLang}
                onValueChange={(v) => setSelectedLang(v as TranslationTargetLang)}
              >
                <SelectTrigger className="h-7 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRANSLATOR_LANGS).map(([code, name]) => (
                    <SelectItem key={code} value={code} className="text-xs">
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DropdownMenuItem
              className="gap-2 text-xs"
              onSelect={(e) => {
                e.preventDefault();
                setTranslationLang(selectedLang);
                onStart(selectedLang);
              }}
            >
              <Languages className="h-3.5 w-3.5" />
              {t("translation.translateChapter")}
            </DropdownMenuItem>
          </>
        )}

        {/* ── extracting ── */}
        {state.status === "extracting" && (
          <div className="flex items-center gap-2 px-2 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
          </div>
        )}

        {/* ── translating: progress + cancel ── */}
        {state.status === "translating" && (() => {
          const { translatedChars, totalChars } = state.progress;
          const pct = totalChars > 0 ? Math.round((translatedChars / totalChars) * 100) : 0;
          return (
            <>
              <div className="px-2 py-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    {t("translation.translatingProgress", {
                      count: Math.round(translatedChars / 100),
                      total: Math.round(totalChars / 100),
                    })}
                  </span>
                </div>
                <Progress
                  className="h-1.5"
                  value={pct}
                  aria-label={t("translation.translatingProgress", {
                    count: Math.round(translatedChars / 100),
                    total: Math.round(totalChars / 100),
                  })}
                />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 text-xs text-destructive"
                onSelect={onCancel}
              >
                <X className="h-3.5 w-3.5" />
                {t("translation.cancelTranslation")}
              </DropdownMenuItem>
            </>
          );
        })()}

        {/* ── complete: toggle original / translation + clear ── */}
        {state.status === "complete" && (
          <>
            <div className="flex items-center gap-1 px-2 py-1">
              <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
              <span className="text-xs text-green-600 dark:text-green-400">
                {t("translation.chapterTranslated")}
              </span>
            </div>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <Select
                value={selectedLang}
                onValueChange={(v) => setSelectedLang(v as TranslationTargetLang)}
              >
                <SelectTrigger className="h-7 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRANSLATOR_LANGS).map(([code, name]) => (
                    <SelectItem key={code} value={code} className="text-xs">
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DropdownMenuItem
              className="gap-2 text-xs"
              onSelect={(e) => {
                e.preventDefault();
                setTranslationLang(selectedLang);
                onStart(selectedLang);
              }}
            >
              <Languages className="h-3.5 w-3.5" />
              {t("translation.translateChapter")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-xs"
              onSelect={(e) => {
                e.preventDefault();
                onToggleOriginalVisible();
              }}
            >
              {state.originalVisible ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="flex-1">{t("translation.original")}</span>
              {state.originalVisible && <Check className="h-3 w-3 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-xs"
              onSelect={(e) => {
                e.preventDefault();
                onToggleTranslationVisible();
              }}
            >
              {state.translationVisible ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="flex-1">{t("translation.translationLabel")}</span>
              {state.translationVisible && <Check className="h-3 w-3 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-xs text-destructive"
              onSelect={(e) => {
                e.preventDefault();
                onReset();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("common.remove")}
            </DropdownMenuItem>
          </>
        )}

        {/* ── error: message + retry + clear ── */}
        {state.status === "error" && (
          <>
            <div className="px-2 py-1.5">
              <span className="text-xs text-destructive">{state.message}</span>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-xs"
              onSelect={(e) => {
                e.preventDefault();
                setTranslationLang(selectedLang);
                onStart(selectedLang);
              }}
            >
              <Languages className="h-3.5 w-3.5" />
              {t("common.retry")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-xs text-destructive"
              onSelect={(e) => {
                e.preventDefault();
                onReset();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("common.remove")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
