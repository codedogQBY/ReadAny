/**
 * Mindmap Tools — mindmap generation with mermaid conversion fallback
 */
import type { ToolDefinition } from "./tool-types";

/** Generate a mindmap from content */
export function createMindmapTool(): ToolDefinition {
  return {
    name: "mindmap",
    description:
      "Generate a mindmap visualization from content. The output will be rendered as an interactive mindmap using markmap. Use this when the user asks you to create a mindmap, knowledge map, concept map, or visual structure of a topic, chapter, or book. IMPORTANT: The markdown parameter must use standard Markdown heading syntax (# ## ### etc.), NOT mermaid mindmap syntax.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      title: {
        type: "string",
        description: "The title of the mindmap",
        required: true,
      },
      markdown: {
        type: "string",
        description:
          "The mindmap content in standard Markdown heading format (NOT mermaid syntax). Use # for root topic, ## for main branches, ### for sub-branches, and - for leaf items. NEVER use mermaid 'mindmap' syntax. Example:\n# Main Topic\n## Branch 1\n### Sub-branch 1.1\n- Detail A\n- Detail B\n## Branch 2\n- Detail C\n- Detail D",
        required: true,
      },
    },
    execute: async (args) => {
      const title = args.title as string;
      let markdown = args.markdown as string;

      // Fallback: convert mermaid mindmap syntax to markmap Markdown if AI used wrong format
      if (markdown.trim().startsWith("mindmap") || markdown.trim().startsWith("```mermaid")) {
        markdown = convertMermaidMindmapToMarkdown(markdown, title);
      }

      // Count nodes and depth for stats
      const lines = markdown.split("\n").filter((l) => l.trim());
      const nodeCount = lines.length;
      const maxDepth = lines.reduce((max, line) => {
        const headingMatch = line.match(/^(#{1,6})\s/);
        const listMatch = line.match(/^(\s*)-\s/);
        if (headingMatch) return Math.max(max, headingMatch[1].length);
        if (listMatch) return Math.max(max, 7 + Math.floor(listMatch[1].length / 2));
        return max;
      }, 0);

      return {
        type: "mindmap",
        title,
        markdown,
        stats: { nodeCount, maxDepth },
      };
    },
  };
}

/** Convert mermaid mindmap syntax to markmap Markdown heading format */
export function convertMermaidMindmapToMarkdown(
  mermaidText: string,
  fallbackTitle: string,
): string {
  // Strip mermaid code fence markers
  const text = mermaidText
    .replace(/```mermaid\s*/g, "")
    .replace(/```\s*/g, "")
    .replace(/^mindmap\s*/m, "")
    .trim();

  const lines = text.split("\n");
  const result: string[] = [];

  // Find the minimum indentation (the root node)
  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.search(/\S/);
    if (indent >= 0 && indent < minIndent) minIndent = indent;
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = line.search(/\S/);
    // Calculate depth relative to root (each 2 spaces = 1 level)
    const depth = Math.floor((indent - minIndent) / 2);

    // Clean up mermaid-specific syntax: remove parentheses wrapping, brackets, etc.
    const cleanText = trimmed
      .replace(/^\((.+)\)$/, "$1") // (text) → text
      .replace(/^\[(.+)\]$/, "$1") // [text] → text
      .replace(/^\{(.+)\}$/, "$1") // {text} → text
      .replace(/^["'](.+)["']$/, "$1"); // "text" → text

    if (depth === 0) {
      result.push(`# ${cleanText}`);
    } else if (depth === 1) {
      result.push(`## ${cleanText}`);
    } else if (depth === 2) {
      result.push(`### ${cleanText}`);
    } else if (depth === 3) {
      result.push(`#### ${cleanText}`);
    } else {
      // Deeper levels use list items
      const listIndent = "  ".repeat(Math.max(0, depth - 4));
      result.push(`${listIndent}- ${cleanText}`);
    }
  }

  // If conversion produced nothing, return a simple fallback
  if (result.length === 0) {
    return `# ${fallbackTitle}`;
  }

  return result.join("\n");
}
