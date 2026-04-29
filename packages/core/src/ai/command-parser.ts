/**
 * 实时指令系统
 *
 * 支持的命令：
 * - /跳过 - 跳过当前问题
 * - /开始阅读 - 开始阅读
 * - /本章结束 - 结束当前章节
 * - /总结 - 生成摘要
 * - /重试 - 重试上一个问题
 * - /换个话题 - 换个话题
 * - /重读 - 重新阅读当前内容
 * - /引用 - 引用原文
 * - /角色 [角色名] - 切换角色
 * - /模式 [模式名] - 切换模式
 */

export type CommandType =
  | "skip"
  | "start_reading"
  | "end_chapter"
  | "summary"
  | "retry"
  | "change_topic"
  | "reread"
  | "quote"
  | "role"
  | "mode"
  | "help"
  | "unknown";

export interface ParsedCommand {
  type: CommandType;
  args: string[];
  raw: string;
}

export interface CommandDefinition {
  type: CommandType;
  aliases: string[];
  description: string;
  requiresArgs: boolean;
  example?: string;
}

const COMMAND_DEFINITIONS: CommandDefinition[] = [
  {
    type: "skip",
    aliases: ["跳过", "skip", "跳"],
    description: "跳过当前问题，继续下一话题",
    requiresArgs: false,
    example: "/跳过",
  },
  {
    type: "start_reading",
    aliases: ["开始阅读", "start", "阅读", "开始"],
    description: "从预热阶段切换到精读模式",
    requiresArgs: false,
    example: "/开始阅读",
  },
  {
    type: "end_chapter",
    aliases: ["本章结束", "end", "结束", "章末"],
    description: "结束当前章节，进入回顾模式",
    requiresArgs: false,
    example: "/本章结束",
  },
  {
    type: "summary",
    aliases: ["总结", "summary", "摘要"],
    description: "生成当前对话的摘要",
    requiresArgs: false,
    example: "/总结",
  },
  {
    type: "retry",
    aliases: ["重试", "retry", "重新", "再来"],
    description: "换个方式重新提问",
    requiresArgs: false,
    example: "/重试",
  },
  {
    type: "change_topic",
    aliases: ["换个话题", "topic", "新话题", "换话题"],
    description: "从新角度提问，换个话题",
    requiresArgs: false,
    example: "/换个话题",
  },
  {
    type: "reread",
    aliases: ["重读", "reread", "再读", "引用"],
    description: "引用并分析当前章节的原文",
    requiresArgs: false,
    example: "/重读",
  },
  {
    type: "quote",
    aliases: ["引用", "quote", "cite"],
    description: "选中文字后使用，引用原文并分析",
    requiresArgs: false,
    example: "/引用",
  },
  {
    type: "role",
    aliases: ["角色", "role", "扮演"],
    description: "切换 AI 角色（狂热读者、杠精、作者、专家等）",
    requiresArgs: true,
    example: "/角色 杠精",
  },
  {
    type: "mode",
    aliases: ["模式", "mode", "模式切换"],
    description: "切换问答风格（苏格拉底、费曼、批判性、联想）",
    requiresArgs: true,
    example: "/模式 费曼",
  },
  {
    type: "help",
    aliases: ["帮助", "help", "命令", "？"],
    description: "显示所有可用命令",
    requiresArgs: false,
    example: "/帮助",
  },
];

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const commandWord = parts[0].toLowerCase();
  const args = parts.slice(1);

  for (const def of COMMAND_DEFINITIONS) {
    if (def.aliases.some((alias) => alias.toLowerCase() === commandWord)) {
      return {
        type: def.type,
        args,
        raw: trimmed,
      };
    }
  }

  return {
    type: "unknown",
    args: [commandWord],
    raw: trimmed,
  };
}

export function getCommandDefinition(type: CommandType): CommandDefinition | undefined {
  return COMMAND_DEFINITIONS.find((def) => def.type === type);
}

export function getAllCommands(): CommandDefinition[] {
  return [...COMMAND_DEFINITIONS];
}

export function formatHelpText(): string {
  const lines: string[] = ["## 可用命令", "", "| 命令 | 说明 | 示例 |", "| --- | --- | --- |"];

  for (const def of COMMAND_DEFINITIONS) {
    lines.push(`| ${def.aliases.join(" / ")} | ${def.description} | ${def.example || "-"} |`);
  }

  return lines.join("\n");
}

export function isCommand(input: string): boolean {
  return input.trim().startsWith("/");
}

export function isPreheatingCommand(input: string): boolean {
  const parsed = parseCommand(input);
  if (!parsed) return false;
  return ["skip", "start_reading", "end_chapter", "help"].includes(parsed.type);
}

export function isReadingCommand(input: string): boolean {
  const parsed = parseCommand(input);
  if (!parsed) return false;
  return ["summary", "retry", "change_topic", "reread", "quote", "role", "mode", "help"].includes(
    parsed.type,
  );
}

export function getAvailableModes(): { value: string; label: string; description: string }[] {
  return [
    {
      value: "socratic",
      label: "苏格拉底式提问",
      description: "通过不断提问引导思考，不直接给答案",
    },
    {
      value: "feynman",
      label: "费曼讲解法",
      description: "用简单语言解释复杂概念，举生活化的例子",
    },
    {
      value: "critical",
      label: "批判性思维",
      description: "分析论证逻辑，找出谬误，形成独立判断",
    },
    {
      value: "associative",
      label: "跨界联想",
      description: "将书中概念与其他领域建立联系，激发创意",
    },
  ];
}

export function getAvailableRoles(): { value: string; label: string; description: string }[] {
  return [
    {
      value: "enthusiast",
      label: "狂热读者",
      description: "充满热情，分享阅读的激动时刻",
    },
    {
      value: "devil_advocate",
      label: "杠精",
      description: "故意提出反对意见，激发更深入的思考",
    },
    {
      value: "author",
      label: "作者",
      description: "扮演作者角度，解释创作意图和背景",
    },
    {
      value: "expert",
      label: "领域专家",
      description: "从专业角度分析书中的理论和概念",
    },
    {
      value: "beginner",
      label: "初学者",
      description: "从零开始提问，帮助打牢基础",
    },
  ];
}
