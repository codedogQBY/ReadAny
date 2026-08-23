import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { listTools } from "./tool-registry.js";

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(new URL(`../../../${relativePath}`, import.meta.url), "utf8");
}

function extractBacktickedToolListAfter(content: string, marker: string): string[] {
  const markerIndex = content.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const line = content.slice(markerIndex).split(/\r?\n/, 1)[0] ?? "";
  return [...line.matchAll(/`([a-z]+\.[a-z.]+)`/g)].map((match) => match[1]);
}

function extractFencedToolListAfter(content: string, marker: string): string[] {
  const markerIndex = content.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const match = content.slice(markerIndex).match(/```text\r?\n([\s\S]*?)\r?\n```/);
  expect(match).toBeTruthy();
  return match![1].split(/\r?\n/).filter(Boolean);
}

describe("tool registry", () => {
  it("registers the first readonly tools", () => {
    const tools = listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "books.list",
      "books.search",
      "books.get",
      "chapters.list",
      "chapters.get",
      "context.get",
      "bookmarks.list",
      "skills.list",
      "notes.search",
      "notes.export",
      "knowledge.export",
      "knowledge.search",
      "highlights.search",
      "rag.search",
      "epub.inspect",
      "epub.draft.create",
      "epub.draft.discard",
      "epub.chapter.read",
      "epub.chapter.patch",
      "epub.chapters.patch",
      "epub.metadata.patch",
      "epub.toc.rebuild",
      "epub.history",
      "epub.diff",
      "epub.undo",
      "epub.validate",
      "epub.export",
    ]);
  });

  it("keeps write and inspect risk levels explicit", () => {
    const tools = listTools();
    expect(
      tools
        .filter(
          (tool) =>
            !tool.name.startsWith("epub.") &&
            tool.name !== "notes.export" &&
            tool.name !== "knowledge.export",
        )
        .every((tool) => tool.risk === "low"),
    ).toBe(true);
    expect(tools.find((tool) => tool.name === "epub.inspect")?.risk).toBe("medium");
    expect(tools.find((tool) => tool.name === "epub.draft.create")?.risk).toBe("medium");
    expect(tools.find((tool) => tool.name === "epub.draft.discard")?.risk).toBe("medium");
    expect(tools.find((tool) => tool.name === "epub.chapter.read")?.risk).toBe("medium");
    expect(tools.find((tool) => tool.name === "epub.chapter.patch")?.risk).toBe("medium");
    expect(tools.find((tool) => tool.name === "epub.chapters.patch")?.risk).toBe("high");
    expect(tools.find((tool) => tool.name === "epub.metadata.patch")?.risk).toBe("medium");
    expect(tools.find((tool) => tool.name === "epub.toc.rebuild")?.risk).toBe("medium");
    expect(tools.find((tool) => tool.name === "epub.history")?.risk).toBe("medium");
    expect(tools.find((tool) => tool.name === "epub.diff")?.risk).toBe("medium");
    expect(tools.find((tool) => tool.name === "epub.undo")?.risk).toBe("medium");
    expect(tools.find((tool) => tool.name === "notes.export")?.risk).toBe("high");
    expect(tools.find((tool) => tool.name === "knowledge.export")?.risk).toBe("high");
    expect(tools.find((tool) => tool.name === "epub.validate")?.risk).toBe("high");
    expect(tools.find((tool) => tool.name === "epub.export")?.risk).toBe("high");
  });

  it("declares input schemas for every exposed tool", () => {
    expect(
      listTools().every(
        (tool) =>
          tool.inputSchema.type === "object" &&
          tool.inputSchema.additionalProperties === false,
      ),
    ).toBe(true);
  });

  it("requires query input for search tools", () => {
    const searchTools = listTools().filter((tool) => tool.name.endsWith(".search"));
    expect(searchTools.every((tool) => tool.inputSchema.required?.includes("query"))).toBe(true);
  });

  it("declares discovery tools for bookmarks and skills", () => {
    expect(listTools().find((tool) => tool.name === "bookmarks.list")).toMatchObject({
      scopes: ["note.read"],
      risk: "low",
      inputSchema: {
        required: ["bookId"],
        additionalProperties: false,
      },
    });
    expect(listTools().find((tool) => tool.name === "skills.list")).toMatchObject({
      scopes: ["stats.read"],
      risk: "low",
      inputSchema: {
        additionalProperties: false,
      },
    });
  });

  it("exposes include controls for reader context", () => {
    const contextTool = listTools().find((tool) => tool.name === "context.get");
    expect(contextTool?.inputSchema.properties).toMatchObject({
      includeSelection: expect.any(Object),
      includeSurroundingText: expect.any(Object),
      includeHighlights: expect.any(Object),
      contentLimit: expect.any(Object),
    });
  });

  it("declares all implemented RAG search modes", () => {
    const ragTool = listTools().find((tool) => tool.name === "rag.search");
    expect(ragTool?.inputSchema.properties).toMatchObject({
      mode: {
        enum: ["bm25", "hybrid", "vector"],
      },
    });
  });

  it("exposes range controls for chapter reads", () => {
    const chapterTool = listTools().find((tool) => tool.name === "chapters.get");
    expect(chapterTool?.inputSchema.properties).toMatchObject({
      chunkStart: expect.any(Object),
      chunkCount: expect.any(Object),
      contentLimit: expect.any(Object),
    });
  });

  it("declares bounded output controls for content-returning tools", () => {
    const tools = new Map(listTools().map((tool) => [tool.name, tool]));
    const boundedTools = [
      "chapters.get",
      "context.get",
      "knowledge.search",
      "rag.search",
      "epub.chapter.read",
    ];

    for (const toolName of boundedTools) {
      const properties = tools.get(toolName)?.inputSchema.properties ?? {};
      const boundedProperty = Object.entries(properties).find(([key, schema]) => {
        if (!["limit", "contentLimit", "chunkCount", "scanLimit"].includes(key)) return false;
        return (
          typeof schema === "object" &&
          schema !== null &&
          "maximum" in schema &&
          typeof (schema as { maximum?: unknown }).maximum === "number"
        );
      });

      expect(boundedProperty, toolName).toBeTruthy();
    }
  });

  it("keeps documented MCP tool lists in sync with the registry", async () => {
    const registeredTools = listTools().map((tool) => tool.name);
    const [readme, playbook, commandSpec] = await Promise.all([
      readRepoFile("docs/readany-cli/README.md"),
      readRepoFile("docs/readany-cli/07-delivery-playbook.md"),
      readRepoFile("docs/readany-cli/05-command-and-tool-spec.md"),
    ]);

    expect(
      extractBacktickedToolListAfter(readme, "MCP 当前只暴露真实实现的工具"),
    ).toEqual(registeredTools);
    expect(extractBacktickedToolListAfter(playbook, "MCP 当前只暴露")).toEqual(
      registeredTools,
    );
    expect(extractFencedToolListAfter(commandSpec, "当前 `tools/list` 只允许返回")).toEqual(
      registeredTools,
    );
  });
});
