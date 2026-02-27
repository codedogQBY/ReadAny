/**
 * Skill Executor
 * 
 * Executes skills by combining their prompts with context and calling the LLM.
 * Skills can be built-in or custom user-defined.
 */
import type { AIConfig, Skill } from "@/types";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createChatModel } from "../llm-provider";
import { getBuiltinSkill } from "./builtin-skills";

export interface SkillExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
  skillId: string;
  skillName: string;
}

export interface SkillExecutionContext {
  bookId?: string;
  bookTitle?: string;
  currentChapter?: string;
  surroundingText?: string;
  highlights?: Array<{ text: string; note?: string }>;
  notes?: Array<{ title: string; content: string }>;
}

/**
 * Skill Executor class
 */
export class SkillExecutor {
  private llm: BaseChatModel | null = null;
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  /**
   * Initialize the LLM if not already initialized
   */
  private async getLLM(): Promise<BaseChatModel> {
    if (!this.llm) {
      this.llm = await createChatModel(this.config, {
        temperature: 0.7,
        maxTokens: 4096,
        streaming: false,
      });
    }
    return this.llm;
  }

  /**
   * Execute a skill with the given arguments
   */
  async execute(
    skill: Skill,
    args: Record<string, unknown>,
    context?: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    const startTime = Date.now();

    try {
      const llm = await this.getLLM();

      // Build the prompt
      const messages = this.buildMessages(skill, args, context);

      // Execute
      const response = await llm.invoke(messages);
      const output = typeof response.content === "string" ? response.content : "";

      return {
        success: true,
        output,
        duration: Date.now() - startTime,
        skillId: skill.id,
        skillName: skill.name,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        duration: Date.now() - startTime,
        skillId: skill.id,
        skillName: skill.name,
      };
    }
  }

  /**
   * Build messages for the LLM
   */
  private buildMessages(
    skill: Skill,
    args: Record<string, unknown>,
    context?: SkillExecutionContext,
  ): Array<SystemMessage | HumanMessage> {
    const messages: Array<SystemMessage | HumanMessage> = [];

    // System message with skill prompt
    let systemContent = skill.prompt;

    // Add context if available
    if (context) {
      const contextParts: string[] = [];

      if (context.bookTitle) {
        contextParts.push(`当前书籍: ${context.bookTitle}`);
      }
      if (context.currentChapter) {
        contextParts.push(`当前章节: ${context.currentChapter}`);
      }
      if (context.surroundingText) {
        contextParts.push(`周围文本:\n${context.surroundingText.slice(0, 1000)}`);
      }
      if (context.highlights && context.highlights.length > 0) {
        contextParts.push(
          `用户标注:\n${context.highlights
            .map((h) => `- ${h.text}${h.note ? ` (笔记: ${h.note})` : ""}`)
            .join("\n")}`,
        );
      }

      if (contextParts.length > 0) {
        systemContent += `\n\n## 上下文信息\n${contextParts.join("\n")}`;
      }
    }

    messages.push(new SystemMessage(systemContent));

    // Human message with skill invocation
    const argsDescription = skill.parameters
      .filter((p) => args[p.name] !== undefined)
      .map((p) => `- ${p.name}: ${args[p.name]}`)
      .join("\n");

    const humanContent = argsDescription
      ? `执行技能: ${skill.name}\n\n参数:\n${argsDescription}`
      : `执行技能: ${skill.name}`;

    messages.push(new HumanMessage(humanContent));

    return messages;
  }

  /**
   * Execute a built-in skill by ID
   */
  async executeBuiltin(
    skillId: string,
    args: Record<string, unknown>,
    context?: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    const skill = getBuiltinSkill(skillId);
    if (!skill) {
      return {
        success: false,
        error: `Built-in skill not found: ${skillId}`,
        duration: 0,
        skillId,
        skillName: skillId,
      };
    }

    return this.execute(skill, args, context);
  }
}

/**
 * Create a skill executor instance
 */
export function createSkillExecutor(config: AIConfig): SkillExecutor {
  return new SkillExecutor(config);
}

/**
 * Quick execution helper for built-in skills
 */
export async function executeSkill(
  config: AIConfig,
  skillId: string,
  args: Record<string, unknown>,
  context?: SkillExecutionContext,
): Promise<SkillExecutionResult> {
  const executor = new SkillExecutor(config);
  return executor.executeBuiltin(skillId, args, context);
}
