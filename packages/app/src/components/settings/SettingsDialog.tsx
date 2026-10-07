/**
 * SettingsDialog — main settings modal using shadcn Dialog
 */
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { type SettingsTab, useAppStore } from "@/stores/app-store";
import { refreshAndCountUnreadFeedback } from "@readany/core/feedback";
import { cn } from "@readany/core/utils";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AISettings } from "./AISettings";
import { AboutSettings } from "./AboutSettings";
import { DictionarySettings } from "./DictionarySettings";
import { ExternalAISettings } from "./ExternalAISettings";
import { FeedbackSettings } from "./FeedbackSettings";
import { FontSettings } from "./FontSettings";
import { GeneralSettings } from "./GeneralSettings";
import { ReadSettingsPanel } from "./ReadSettings";
import { SyncSettings } from "./SyncSettings";
import { TTSSettings } from "./TTSSettings";
import { TranslationSettings } from "./TranslationSettings";
import { VectorModelSettings } from "./VectorModelSettings";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const TAB_IDS: SettingsTab[] = [
  "general",
  "reading",
  "fonts",
  "dictionaries",
  "ai",
  "vectorModel",
  "tts",
  "translation",
  "sync",
  "externalAi",
  "feedback",
  "about",
];
const TAB_KEYS: Record<SettingsTab, string> = {
  general: "settings.general",
  reading: "settings.reading",
  fonts: "settings.fonts",
  dictionaries: "dictionary.dictionaries",
  ai: "settings.ai",
  vectorModel: "settings.vectorModel",
  tts: "settings.tts",
  translation: "settings.translationTab",
  sync: "settings.sync",
  externalAi: "settings.externalAi",
  feedback: "feedback.title",
  about: "settings.about",
};

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useTranslation();
  const settingsTab = useAppStore((s) => s.settingsTab);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const [unreadFeedback, setUnreadFeedback] = useState(0);

  // Refresh unread feedback count whenever the dialog opens or the user
  // switches into the feedback tab (the screen also marks replies as seen,
  // so we re-fetch when leaving the tab too).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    refreshAndCountUnreadFeedback()
      .then((count) => {
        if (!cancelled) setUnreadFeedback(count);
      })
      .catch((err) => console.warn("[SettingsDialog] feedback unread refresh:", err));
    return () => {
      cancelled = true;
    };
  }, [open, settingsTab]);

  const setActiveTab = (tab: SettingsTab) => {
    setShowSettings(true, tab);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex min-h-[80vh] max-h-[80vh] w-[800px] max-w-[800px] flex-col overflow-hidden p-0">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-border px-4 py-3.5">
          <DialogTitle className="text-base font-semibold">{t("settings.title")}</DialogTitle>
          <p className="mt-0.5 text-xs text-muted-foreground/60">{t("settings.realtimeHint")}</p>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Sidebar */}
          <div className="w-48 flex-shrink-0 overflow-y-auto border-r border-border p-2.5">
            <nav className="space-y-0.5">
              {TAB_IDS.map((id) => (
                <button
                  key={id}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                    settingsTab === id
                      ? "bg-muted/80 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50",
                  )}
                  onClick={() => setActiveTab(id)}
                >
                  <span>{t(TAB_KEYS[id])}</span>
                  {id === "feedback" && unreadFeedback > 0 ? (
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full bg-destructive"
                      aria-label={t("feedback.hasNewReply", "有新回复")}
                    />
                  ) : null}
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1 overflow-y-auto">
            {settingsTab === "general" && <GeneralSettings />}
            {settingsTab === "reading" && <ReadSettingsPanel />}
            {settingsTab === "fonts" && <FontSettings />}
            {settingsTab === "dictionaries" && <DictionarySettings />}
            {settingsTab === "ai" && <AISettings />}
            {settingsTab === "vectorModel" && <VectorModelSettings />}
            {settingsTab === "tts" && <TTSSettings />}
            {settingsTab === "translation" && <TranslationSettings />}
            {settingsTab === "sync" && <SyncSettings />}
            {settingsTab === "externalAi" && <ExternalAISettings />}
            {settingsTab === "feedback" && <FeedbackSettings />}
            {settingsTab === "about" && <AboutSettings />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
