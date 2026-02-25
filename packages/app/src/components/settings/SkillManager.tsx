/**
 * SkillManager — manage AI skills/tools
 */
import { useState } from "react";
import type { Skill } from "@/types";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function SkillManager() {
  const [skills] = useState<Skill[]>([]); // TODO: Load from store/db

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Skills</h3>
          <p className="text-sm text-muted-foreground">Manage AI tool extensions</p>
        </div>
        <Button size="sm">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Skill
        </Button>
      </div>

      {skills.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No custom skills yet. Built-in skills are automatically available.
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <div>
                <p className="text-sm font-medium">{skill.name}</p>
                <p className="text-xs text-muted-foreground">{skill.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {skill.builtIn && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Built-in</span>
                )}
                <input type="checkbox" checked={skill.enabled} readOnly />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
