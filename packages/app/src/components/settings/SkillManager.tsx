import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getSkills, updateSkill } from "@/lib/db/database";
import { builtinSkills } from "@/lib/ai/skills/builtin-skills";
import type { Skill } from "@/types";
import { BookOpen, Compass, FileText, GitBranch, Languages, Lightbulb, Plus, Puzzle, Quote, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText,
  Lightbulb,
  GitBranch,
  Users,
  Quote,
  Compass,
  Languages,
  BookOpen,
};

function SkillIcon({ name }: { name?: string }) {
  const IconComponent = name && iconMap[name] ? iconMap[name] : Puzzle;
  return <IconComponent className="h-4 w-4 text-neutral-500" />;
}

export function SkillManager() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSkills();
  }, []);

  async function loadSkills() {
    try {
      const dbSkills = await getSkills();

      // Merge built-in skills with database skills
      const mergedSkills = builtinSkills.map((builtin) => {
        const dbSkill = dbSkills.find((s) => s.id === builtin.id);
        return dbSkill ? { ...builtin, enabled: dbSkill.enabled } : builtin;
      });

      // Add custom skills from database
      const customSkills = dbSkills.filter((s) => !s.builtIn);

      setSkills([...mergedSkills, ...customSkills]);
    } catch (error) {
      console.error("Failed to load skills:", error);
      // Fallback to built-in skills only
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

  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div className="space-y-6 p-4 pt-3">
      <section className="rounded-lg bg-muted/60 p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-neutral-900">
              {t("settings.skills_title")}
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              {t("settings.skills_desc")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">
              {enabledCount}/{skills.length} {t("settings.enabled")}
            </span>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              {t("settings.addSkill")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 py-12 text-center">
            <Puzzle className="mb-3 h-8 w-8 text-neutral-300" />
            <p className="text-sm text-neutral-500">{t("settings.noSkills")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-center justify-between rounded-lg bg-background p-3 shadow-sm transition-colors hover:bg-neutral-50"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-md bg-neutral-100 p-1.5">
                    <SkillIcon name={skill.icon} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-800">
                      {skill.name}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {skill.description}
                    </p>
                    {skill.parameters.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {skill.parameters.slice(0, 3).map((p) => (
                          <span
                            key={p.name}
                            className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-400"
                          >
                            {p.name}
                          </span>
                        ))}
                        {skill.parameters.length > 3 && (
                          <span className="text-[10px] text-neutral-400">
                            +{skill.parameters.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {skill.builtIn && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                      {t("settings.builtIn")}
                    </span>
                  )}
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={(checked) => toggleSkill(skill.id, checked)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg bg-muted/60 p-4">
        <h3 className="mb-3 text-sm font-medium text-neutral-900">
          {t("settings.skillUsage")}
        </h3>
        <div className="space-y-2 text-xs text-neutral-600">
          <p>
            <strong>{t("settings.skillUsageSummary")}:</strong>{" "}
            {t("settings.skillUsageSummaryDesc")}
          </p>
          <p>
            <strong>{t("settings.skillUsageCharacter")}:</strong>{" "}
            {t("settings.skillUsageCharacterDesc")}
          </p>
          <p>
            <strong>{t("settings.skillUsageQuote")}:</strong>{" "}
            {t("settings.skillUsageQuoteDesc")}
          </p>
          <p>
            <strong>{t("settings.skillUsageAnalysis")}:</strong>{" "}
            {t("settings.skillUsageAnalysisDesc")}
          </p>
        </div>
      </section>
    </div>
  );
}
