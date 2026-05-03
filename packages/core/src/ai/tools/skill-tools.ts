/**
 * Skill Tools — getSkills, skillToTool
 */
import { getSkills as getDbSkills } from "../../db/database";
import type { Skill } from "../../types";
import { getBuiltinSkills } from "../skills/builtin-skills";
import type { ToolDefinition, ToolParameter } from "./tool-types";

/** Query available skills/SOPs */
export function createGetSkillsTool(): ToolDefinition {
  return {
    name: "getSkills",
    description:
      "Query the available skills (SOPs / standard operating procedures) that define how to perform specific tasks. Use this when you need guidance on how to execute a complex task like generating a mindmap, writing a summary, analyzing arguments, etc.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      task: {
        type: "string",
        description: "The task type or keyword to search for (e.g. '思维导图', '摘要', 'summary')",
        required: true,
      },
    },
    execute: async (args) => {
      const task = (args.task as string)?.toLowerCase() || "";

      // Merge builtin and custom skills
      const builtins = getBuiltinSkills();
      let dbSkills: Skill[] = [];
      try {
        dbSkills = await getDbSkills();
      } catch {
        /* ignore */
      }

      const mergedBuiltins = builtins
        .map((builtin) => {
          const dbSkill = dbSkills.find((s) => s.id === builtin.id);
          return dbSkill
            ? {
                ...builtin,
                description: dbSkill.description,
                enabled: dbSkill.enabled,
                prompt: dbSkill.prompt,
                updatedAt: dbSkill.updatedAt,
              }
            : builtin;
        })
        .filter((s) => s.enabled);
      const allSkills = [...mergedBuiltins, ...dbSkills.filter((s) => !s.builtIn && s.enabled)];

      // Fuzzy match by name or description
      const matched = allSkills.filter(
        (s) =>
          s.name?.toLowerCase().includes(task) ||
          s.description?.toLowerCase().includes(task) ||
          s.id?.toLowerCase().includes(task),
      );

      if (matched.length > 0) {
        return {
          found: matched.length,
          skills: matched.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            prompt: s.prompt,
            parameters: s.parameters.map((p) => ({
              name: p.name,
              type: p.type,
              description: p.description,
              required: p.required,
            })),
          })),
        };
      }

      // No match — return all available skill names
      return {
        found: 0,
        message: `No skill matched "${task}". Available skills:`,
        availableSkills: allSkills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
        })),
      };
    },
  };
}

/** Convert a Skill to a ToolDefinition */
export function skillToTool(skill: Skill): ToolDefinition {
  const parameters: Record<string, ToolParameter> = {
    reasoning: {
      type: "string",
      description: "Brief explanation of why you are calling this skill",
      required: true,
    },
  };
  for (const param of skill.parameters) {
    parameters[param.name] = {
      type: param.type,
      description: param.description,
      required: param.required,
    };
  }

  return {
    name: skill.id,
    description: `[${skill.name}] ${skill.description}`,
    parameters,
    execute: async (args) => {
      // Return the skill's prompt + args so the agent can use the skill's SOP
      // The LLM will use the skill prompt as guidance for its response
      return {
        skillId: skill.id,
        skillName: skill.name,
        skillPrompt: skill.prompt,
        args,
        instruction:
          "Follow the skill prompt above to complete this task. Use the provided parameters and context.",
      };
    },
  };
}
