import { Button } from "@/components/ui/button";
import { getSkills, updateSkill, insertSkill, deleteSkill } from "@/lib/db/database";
import { builtinSkills } from "@/lib/ai/skills/builtin-skills";
import type { Skill } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import SkillEditorDialog from "./SkillEditorDialog";

export default function SkillsPage() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  useEffect(() => {
    loadSkills();
  }, []);

  async function loadSkills() {
    try {
      const dbSkills = await getSkills();
      const mergedSkills = builtinSkills.map((builtin) => {
        const dbSkill = dbSkills.find((s) => s.id === builtin.id);
        return dbSkill ? { ...builtin, enabled: dbSkill.enabled } : builtin;
      });
      const customSkills = dbSkills.filter((s) => !s.builtIn);
      setSkills([...mergedSkills, ...customSkills]);
    } catch {
      setSkills(builtinSkills);
    } finally {
      setLoading(false);
    }
  }

  async function toggleSkill(skillId: string, enabled: boolean) {
    try {
      await updateSkill(skillId, { enabled });
      setSkills((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, enabled } : s)),
      );
    } catch (error) {
      console.error("Failed to update skill:", error);
    }
  }

  async function handleSaveSkill(skill: Skill) {
    try {
      const exists = skills.some((s) => s.id === skill.id);
      if (exists) {
        await updateSkill(skill.id, {
          name: skill.name,
          description: skill.description,
          prompt: skill.prompt,
        });
        setSkills((prev) =>
          prev.map((s) => (s.id === skill.id ? { ...s, ...skill } : s)),
        );
      } else {
        await insertSkill(skill);
        setSkills((prev) => [...prev, skill]);
      }
    } catch (error) {
      console.error("Failed to save skill:", error);
    }
  }

  async function handleDeleteSkill(skillId: string) {
    try {
      await deleteSkill(skillId);
      setSkills((prev) => prev.filter((s) => s.id !== skillId));
    } catch (error) {
      console.error("Failed to delete skill:", error);
    }
  }

  function handleEdit(skill: Skill) {
    setEditingSkill(skill);
    setIsEditorOpen(true);
  }

  function handleCreate() {
    setEditingSkill(null);
    setIsEditorOpen(true);
  }

  function handleCloseEditor() {
    setIsEditorOpen(false);
    setEditingSkill(null);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-4 flex items-start justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">{t("settings.skills_title")}</h1>
          <p className="text-neutral-500">{t("settings.skills_desc")}</p>
        </div>
        <Button variant="soft" size="sm" onClick={handleCreate}>
          <Plus className="size-4" />
          {t("settings.addSkill")}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {skills.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="mb-4 text-neutral-400">{t("settings.noSkills")}</p>
              <Button onClick={handleCreate}>
                <Plus className="mr-2 size-4" />
                {t("settings.addSkill")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {skills.map((skill) => (
              <SkillItem
                key={skill.id}
                skill={skill}
                onToggle={toggleSkill}
                onEdit={handleEdit}
                onDelete={handleDeleteSkill}
              />
            ))}
          </div>
        )}
      </div>

      <SkillEditorDialog
        isOpen={isEditorOpen}
        onClose={handleCloseEditor}
        skill={editingSkill}
        onSave={handleSaveSkill}
      />
    </div>
  );
}

interface SkillItemProps {
  skill: Skill;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (skill: Skill) => void;
  onDelete: (id: string) => void;
}

function SkillItem({ skill, onToggle, onEdit, onDelete }: SkillItemProps) {
  const { t } = useTranslation();

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="group relative select-auto rounded-xl bg-muted p-3 shadow-around">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex-1 text-lg font-medium">{skill.name}</span>
        <div className="flex items-center gap-2">
          {!skill.builtIn && (
            <button
              type="button"
              onClick={() => onToggle(skill.id, !skill.enabled)}
              className={`relative h-5 w-9 rounded-full transition-colors ${
                skill.enabled ? "bg-neutral-900" : "bg-neutral-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                  skill.enabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          )}
          <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(skill)}>
            <Pencil className="size-3.5" />
          </Button>
          {!skill.builtIn && (
            <Button variant="ghost" size="icon" className="size-7 hover:text-red-500" onClick={() => onDelete(skill.id)}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <p className="mb-3 line-clamp-2 text-sm text-neutral-500">{skill.description}</p>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          {skill.builtIn && <Badge variant="outline">{t("settings.builtIn")}</Badge>}
          <Badge variant={skill.enabled ? "default" : "secondary"}>
            {skill.enabled ? t("settings.enabled") : t("settings.disabled")}
          </Badge>
        </div>
        <span className="text-neutral-400">{formatDate(skill.updatedAt)}</span>
      </div>
    </div>
  );
}
