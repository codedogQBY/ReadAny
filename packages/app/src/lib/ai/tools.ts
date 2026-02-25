/**
 * AI Tool registration — conditional tool registration based on book state
 */
import type { Skill } from "@/types";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

interface ToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

/** Built-in RAG tools — only registered when book is vectorized */
const ragSearchTool: ToolDefinition = {
  name: "ragSearch",
  description: "Search book content using semantic or keyword search",
  parameters: {
    query: { type: "string", description: "Search query", required: true },
    mode: { type: "string", description: "Search mode: hybrid | vector | bm25" },
    topK: { type: "number", description: "Number of results to return" },
  },
  execute: async (_args) => {
    // TODO: Invoke RAG search pipeline
    return { results: [] };
  },
};

const ragTocTool: ToolDefinition = {
  name: "ragToc",
  description: "Get the table of contents of the current book",
  parameters: {},
  execute: async () => {
    // TODO: Return TOC structure
    return { chapters: [] };
  },
};

const ragContextTool: ToolDefinition = {
  name: "ragContext",
  description: "Get surrounding text context for a specific position",
  parameters: {
    cfi: { type: "string", description: "EPUB CFI position", required: true },
    range: { type: "number", description: "Number of surrounding chunks" },
  },
  execute: async (_args) => {
    // TODO: Retrieve context around position
    return { context: "" };
  },
};

/** Get available tools based on current state */
export function getAvailableTools(options: {
  isVectorized: boolean;
  enabledSkills: Skill[];
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  if (options.isVectorized) {
    tools.push(ragSearchTool, ragTocTool, ragContextTool);
  }

  for (const skill of options.enabledSkills) {
    tools.push(skillToTool(skill));
  }

  return tools;
}

/** Convert a Skill to a ToolDefinition */
function skillToTool(skill: Skill): ToolDefinition {
  const parameters: Record<string, ToolParameter> = {};
  for (const param of skill.parameters) {
    parameters[param.name] = {
      type: param.type,
      description: param.description,
      required: param.required,
    };
  }

  return {
    name: skill.name,
    description: skill.description,
    parameters,
    execute: async (_args) => {
      // TODO: Execute skill with args
      return {};
    },
  };
}
