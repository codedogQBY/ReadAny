/**
 * Skills Module
 * 
 * Provides skill management and execution capabilities.
 */
export { builtinSkills, getBuiltinSkill, getBuiltinSkills, isBuiltinSkill } from "./builtin-skills";
export {
  createSkillExecutor,
  executeSkill,
  type SkillExecutionContext,
  type SkillExecutionResult,
  SkillExecutor,
} from "./skill-executor";
