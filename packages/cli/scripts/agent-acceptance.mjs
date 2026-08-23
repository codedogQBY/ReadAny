import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  loadWorkspaceConfig,
  resolveInputPath,
  workspaceAgentEvidencePath,
} from "./acceptance-workspace.mjs";

function parseArgs(argv) {
  const options = {
    client: undefined,
    clientVersion: undefined,
    profile: undefined,
    usesMcp: false,
    mcpConfig: undefined,
    mcpConfigText: undefined,
    toolsList: undefined,
    toolsListSummary: undefined,
    toolCount: undefined,
    readFlow: undefined,
    readonlyDenial: undefined,
    draftExportFlow: undefined,
    evidencePath: undefined,
    workspacePath: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--client") {
      options.client = next;
      index += 1;
    } else if (arg === "--client-version") {
      options.clientVersion = next;
      index += 1;
    } else if (arg === "--profile") {
      options.profile = next;
      index += 1;
    } else if (arg === "--uses-mcp") {
      options.usesMcp = true;
    } else if (arg === "--mcp-config") {
      options.mcpConfig = next;
      index += 1;
    } else if (arg === "--mcp-config-text") {
      options.mcpConfigText = next;
      index += 1;
    } else if (arg === "--tools-list") {
      options.toolsList = next;
      index += 1;
    } else if (arg === "--tools-list-summary") {
      options.toolsListSummary = next;
      index += 1;
    } else if (arg === "--tool-count") {
      options.toolCount = Number(next);
      index += 1;
    } else if (arg === "--read-flow") {
      options.readFlow = next;
      index += 1;
    } else if (arg === "--readonly-denial") {
      options.readonlyDenial = next;
      index += 1;
    } else if (arg === "--draft-export-flow") {
      options.draftExportFlow = next;
      index += 1;
    } else if (arg === "--evidence") {
      options.evidencePath = next;
      index += 1;
    } else if (arg === "--workspace") {
      options.workspacePath = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return `ReadAny external agent acceptance helper

Usage:
  pnpm --filter @readany/cli acceptance:agent -- --client <name> --client-version <version> --profile <profile> [options]

Required flow evidence:
  --read-flow <summary>          Real client read/search/RAG flow summary.
  --readonly-denial <summary>    Real readonly write-denial summary.
  --draft-export-flow <summary>  Real editor draft and publisher export summary.

MCP evidence:
  --uses-mcp                     Mark this client evidence as MCP-backed.
  --mcp-config <file>            Redacted MCP config snippet captured from the client.
  --mcp-config-text <text>       Redacted MCP config snippet inline.
  --tools-list <file>            Captured tools/list output or summary.
  --tools-list-summary <text>    Human summary of tools/list.
  --tool-count <number>          Number of tools visible to the client.
  --evidence <path>              Write JSON evidence to this path.
  --workspace <path>             Acceptance workspace root or workspace.json.
`;
}

function assertOption(condition, message) {
  if (!condition) throw new Error(message);
}

function hasObviousSecret(text) {
  return [
    /sk-[A-Za-z0-9_-]{12,}/,
    /api[_-]?key["'\s:=]+[A-Za-z0-9_-]{12,}/i,
    /authorization["'\s:=]+bearer\s+[A-Za-z0-9._-]{12,}/i,
    /password["'\s:=]+[^"',\s]{8,}/i,
    /token["'\s:=]+[A-Za-z0-9._-]{12,}/i,
  ].some((pattern) => pattern.test(text));
}

function redactLongText(text) {
  return text.length > 4000 ? `${text.slice(0, 4000)}...` : text;
}

async function readOptionalText(path) {
  return path ? readFile(resolveInputPath(path), "utf8") : undefined;
}

function createFlow(summary) {
  return {
    ok: true,
    summary,
  };
}

function validateOptions(options, outputPath) {
  assertOption(options.client, "Pass --client <name>.");
  assertOption(options.clientVersion, "Pass --client-version <version>.");
  assertOption(options.profile, "Pass --profile <readonly|editor|publisher|...>.");
  assertOption(outputPath, "Pass --evidence <path> or use --workspace <path>.");
  assertOption(options.readFlow, "Pass --read-flow <summary>.");
  assertOption(options.readonlyDenial, "Pass --readonly-denial <summary>.");
  assertOption(options.draftExportFlow, "Pass --draft-export-flow <summary>.");
  if (options.usesMcp) {
    assertOption(options.mcpConfig || options.mcpConfigText, "Pass --mcp-config <file> or --mcp-config-text <text> with --uses-mcp.");
    assertOption(options.toolsList || options.toolsListSummary, "Pass --tools-list <file> or --tools-list-summary <text> with --uses-mcp.");
    assertOption(Number.isFinite(options.toolCount) && options.toolCount > 0, "Pass --tool-count <number> with --uses-mcp.");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  let workspaceFile;
  let workspace;
  if (options.workspacePath) {
    const loaded = await loadWorkspaceConfig(options.workspacePath);
    workspaceFile = loaded.workspaceFile;
    workspace = loaded.workspace;
  }

  const outputPath = options.evidencePath
    ? resolveInputPath(options.evidencePath)
    : workspaceAgentEvidencePath(workspace, options.client);
  validateOptions(options, outputPath);

  const mcpConfigRaw = options.mcpConfigText ?? await readOptionalText(options.mcpConfig);
  const toolsListRaw = await readOptionalText(options.toolsList);
  const toolsListSummary = options.toolsListSummary ?? toolsListRaw;
  const secretText = [mcpConfigRaw, toolsListSummary].filter(Boolean).join("\n");
  assertOption(!hasObviousSecret(secretText), "Evidence appears to contain an unredacted secret; redact it before recording.");
  if (options.usesMcp) {
    assertOption(/readany/i.test(mcpConfigRaw ?? ""), "MCP config evidence must include the readany server entry.");
    assertOption(/readany|tools/i.test(toolsListSummary ?? ""), "MCP tools/list evidence must mention readany or tools.");
  }

  const evidence = {
    ok: true,
    generatedAt: new Date().toISOString(),
    environment: {
      evidenceType: "external-agent",
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    client: {
      name: options.client,
      version: options.clientVersion,
      profile: options.profile,
      usesMcp: options.usesMcp,
    },
    mcp: {
      configRedacted: mcpConfigRaw ? redactLongText(mcpConfigRaw.trim()) : undefined,
      toolsListSummary: toolsListSummary ? redactLongText(toolsListSummary.trim()) : undefined,
      toolCount: Number.isFinite(options.toolCount) ? options.toolCount : undefined,
    },
    flows: {
      read: createFlow(options.readFlow),
      readonlyDenial: createFlow(options.readonlyDenial),
      draftExport: createFlow(options.draftExportFlow),
    },
    summary: {
      completed: true,
      usesMcp: options.usesMcp,
      client: options.client,
      profile: options.profile,
    },
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    workspaceFile,
    outputPath,
    client: options.client,
    usesMcp: options.usesMcp,
  }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
