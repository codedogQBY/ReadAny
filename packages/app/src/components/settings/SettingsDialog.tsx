/**
 * SettingsDialog — main settings modal
 */
import { useState } from "react";
import { GeneralSettings } from "./GeneralSettings";
import { ReadSettingsPanel } from "./ReadSettings";
import { AISettings } from "./AISettings";
import { TranslationSettings } from "./TranslationSettings";
import { SkillManager } from "./SkillManager";

type SettingsTab = "general" | "reading" | "ai" | "translation" | "skills";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "reading", label: "Reading" },
  { id: "ai", label: "AI" },
  { id: "translation", label: "Translation" },
  { id: "skills", label: "Skills" },
];

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex h-[70vh] w-[640px] overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="w-44 border-r border-border bg-muted/30 p-3">
          <h2 className="mb-3 px-2 text-sm font-semibold">Settings</h2>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                activeTab === tab.id ? "bg-muted font-medium" : "hover:bg-muted/50"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "general" && <GeneralSettings />}
          {activeTab === "reading" && <ReadSettingsPanel />}
          {activeTab === "ai" && <AISettings />}
          {activeTab === "translation" && <TranslationSettings />}
          {activeTab === "skills" && <SkillManager />}
        </div>
      </div>
    </div>
  );
}
