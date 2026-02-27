import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Skill } from "@/types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface SkillEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  skill: Skill | null;
  onSave?: (skill: Skill) => void;
}

export default function SkillEditorDialog({ isOpen, onClose, skill, onSave }: SkillEditorDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");

  const isEditing = !!skill;
  const isBuiltin = !!skill?.builtIn;

  useEffect(() => {
    if (isOpen && skill) {
      setName(skill.name);
      setDescription(skill.description);
      setPrompt(skill.prompt);
    } else if (isOpen) {
      setName("");
      setDescription("");
      setPrompt("");
    }
  }, [isOpen, skill]);

  const handleSave = () => {
    if (!name.trim() || !prompt.trim()) return;

    const updatedSkill: Skill = {
      ...skill!,
      name: isBuiltin ? skill!.name : name.trim(),
      description: description.trim(),
      prompt: prompt.trim(),
      updatedAt: Date.now(),
    };

    onSave?.(updatedSkill);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[650px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? isBuiltin
                ? t("settings.viewSkill")
                : t("settings.editSkill")
              : t("settings.addSkill")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-1 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700">{t("settings.skillName")}</label>
            <Input
              placeholder={t("settings.skillNamePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isBuiltin}
              className={isBuiltin ? "cursor-not-allowed opacity-60" : ""}
            />
            {isBuiltin && (
              <p className="text-xs text-neutral-400">{t("settings.builtinNameReadOnly")}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700">{t("settings.skillDescription")}</label>
            <Input
              placeholder={t("settings.skillDescriptionPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700">{t("settings.skillPrompt")}</label>
            <Textarea
              placeholder={t("settings.skillPromptPlaceholder")}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="h-[320px] resize-none font-mono text-sm"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!name.trim() || !prompt.trim()}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
