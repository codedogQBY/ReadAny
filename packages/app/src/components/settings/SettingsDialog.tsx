/**
 * SettingsDialog — main settings modal using shadcn Dialog
 */
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AboutSettings } from "./AboutSettings";
import { AISettings } from "./AISettings";
import { GeneralSettings } from "./GeneralSettings";
import { ReadSettingsPanel } from "./ReadSettings";
import { TranslationSettings } from "./TranslationSettings";
import { VectorModelSettings } from "./VectorModelSettings";

type SettingsTab = "general" | "reading" | "ai" | "vectorModel" | "translation" | "about";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const TAB_IDS: SettingsTab[] = ["general", "reading", "ai", "vectorModel", "translation", "about"];
const TAB_KEYS: Record<SettingsTab, string> = {
  general: "settings.general",
  reading: "settings.reading",
  ai: "settings.ai",
  vectorModel: "settings.vectorModel",
  translation: "settings.translationTab",
  about: "settings.about",
};

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex min-h-[80vh] max-h-[80vh] w-[800px] max-w-[800px] flex-col overflow-hidden p-0">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-neutral-200 px-4 py-3.5">
          <DialogTitle className="text-base font-semibold">{t("settings.title")}</DialogTitle>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Sidebar */}
          <div className="w-48 flex-shrink-0 overflow-y-auto border-r border-neutral-200 p-2.5">
            <nav className="space-y-0.5">
              {TAB_IDS.map((id) => (
                <button
                  key={id}
                  className={cn(
                    "flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                    activeTab === id
                      ? "bg-muted/80 font-medium text-neutral-900"
                      : "text-neutral-600 hover:bg-muted/50",
                  )}
                  onClick={() => setActiveTab(id)}
                >
                  {t(TAB_KEYS[id])}
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1 overflow-y-auto">
            {activeTab === "general" && <GeneralSettings />}
            {activeTab === "reading" && <ReadSettingsPanel />}
            {activeTab === "ai" && <AISettings />}
            {activeTab === "vectorModel" && <VectorModelSettings />}
            {activeTab === "translation" && <TranslationSettings />}
            {activeTab === "about" && <AboutSettings />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
