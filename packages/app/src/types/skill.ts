/** Skill types for AI tool extensions */

export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  default?: unknown;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon?: string;
  enabled: boolean;
  parameters: SkillParameter[];
  prompt: string; // system prompt fragment
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SkillExecution {
  skillId: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  duration: number; // ms
}
