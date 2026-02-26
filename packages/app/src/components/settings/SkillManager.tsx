import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { Skill } from "@/types";
import { Plus, Puzzle } from "lucide-react";
/**
 * SkillManager — manage AI skills/tools using shadcn components
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function SkillManager() {
  const { t } = useTranslation();
  const [skills] = useState<Skill[]>([]); // TODO: Load from store/db

  return (
    <div className="space-y-6 p-4 pt-3">
      <section className="rounded-lg bg-muted/60 p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-neutral-900">{t("settings.skills_title")}</h2>
            <p className="mt-1 text-xs text-neutral-500">{t("settings.skills_desc")}</p>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            {t("settings.addSkill")}
          </Button>
        </div>

        {skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 py-12 text-center">
            <Puzzle className="mb-3 h-8 w-8 text-neutral-300" />
            <p className="text-sm text-neutral-500">{t("settings.noSkills")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-center justify-between rounded-lg bg-background p-3 shadow-sm"
              >
                <div>
                  <p className="text-sm font-medium text-neutral-800">{skill.name}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">{skill.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {skill.builtIn && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
                      {t("settings.builtIn")}
                    </span>
                  )}
                  <Switch checked={skill.enabled} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
