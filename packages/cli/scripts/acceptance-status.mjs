import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  filterExistingPaths,
  loadWorkspaceConfig,
  workspaceAgentEvidencePath,
  workspaceDesktopSettingsPath,
  workspacePackagedEvidencePath,
  workspaceRealSamplePath,
  resolveInputPath,
  workspaceEvidenceFiles,
  workspaceRelease,
  workspaceReviewer,
} from "./acceptance-workspace.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const validateScriptPath = resolve(scriptDir, "validate-acceptance.mjs");

function parseArgs(argv) {
  const options = {
    recordPath: undefined,
    evidencePaths: [],
    workspacePath: undefined,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--record") {
      options.recordPath = next;
      index += 1;
    } else if (arg === "--evidence") {
      options.evidencePaths.push(next);
      index += 1;
    } else if (arg === "--workspace") {
      options.workspacePath = next;
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return `ReadAny acceptance readiness status

Usage:
  pnpm --filter @readany/cli acceptance:status -- [options]

Options:
  --record <path>      Acceptance Markdown record to analyze.
  --evidence <path>    Acceptance evidence JSON; repeatable.
  --workspace <path>   Acceptance workspace root or workspace.json.
  --json               Print machine-readable output.
`;
}

function evidenceType(evidence) {
  return evidence?.environment?.evidenceType === "packaged-platform"
    ? "packaged-platform"
    : evidence?.environment?.evidenceType === "external-agent"
      ? "external-agent"
      : evidence?.environment?.evidenceType === "desktop-settings"
        ? "desktop-settings"
        : "real-sample";
}

function normalizePlatform(platform) {
  const normalized = String(platform ?? "").trim().toLowerCase();
  if (["macos", "mac", "darwin"].includes(normalized)) return "macos";
  if (["windows", "win32", "win"].includes(normalized)) return "windows";
  if (normalized === "linux") return "linux";
  return normalized;
}

function displayPlatform(platform) {
  if (platform === "macos") return "macOS";
  if (platform === "windows") return "Windows";
  if (platform === "linux") return "Linux";
  return platform || "unknown";
}

function normalizeClientName(name) {
  const normalized = String(name ?? "").trim().toLowerCase();
  if (/codex/.test(normalized)) return "codex";
  if (/claude/.test(normalized)) return "claude";
  if (/cursor/.test(normalized)) return "cursor";
  return normalized;
}

function parseJsonMaybe(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return undefined;
  const start = trimmed.indexOf("{");
  if (start < 0) return undefined;
  return JSON.parse(trimmed.slice(start));
}

function runValidate(options) {
  if (!options.recordPath && options.evidencePaths.length === 0) {
    return { status: 0, result: undefined };
  }
  const args = [validateScriptPath];
  if (options.recordPath) {
    args.push("--record", options.recordPath);
  }
  for (const evidencePath of options.evidencePaths) {
    args.push("--evidence", evidencePath);
  }
  if (options.strictM5) {
    args.push("--strict-m5");
  }
  args.push("--json");
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const parsed = parseJsonMaybe(result.stdout) ?? parseJsonMaybe(result.stderr);
  return {
    status: result.status ?? (parsed?.ok === true ? 0 : 1),
    result: parsed,
  };
}

function summarizeEvidences(evidenceEntries) {
  const summary = {
    evidenceCount: evidenceEntries.length,
    evidenceTypes: Array.from(new Set(evidenceEntries.map((entry) => entry.type))).sort(),
    realSampleCount: 0,
    desktopSettingsCount: 0,
    externalAgentCount: 0,
    packagedPlatformCount: 0,
    agentClients: [],
    usesMcpClients: [],
    packagedPlatforms: [],
  };

  const agentClients = new Set();
  const usesMcpClients = new Set();
  const packagedPlatforms = new Set();

  for (const entry of evidenceEntries) {
    if (entry.type === "real-sample") summary.realSampleCount += 1;
    if (entry.type === "desktop-settings") summary.desktopSettingsCount += 1;
    if (entry.type === "external-agent") {
      summary.externalAgentCount += 1;
      const client = normalizeClientName(entry.evidence.client?.name);
      if (client) agentClients.add(client);
      if (entry.evidence.client?.usesMcp === true && client) usesMcpClients.add(client);
    }
    if (entry.type === "packaged-platform") {
      summary.packagedPlatformCount += 1;
      const platform = normalizePlatform(entry.evidence.environment?.platform);
      if (platform) packagedPlatforms.add(platform);
    }
  }

  summary.agentClients = Array.from(agentClients).sort();
  summary.usesMcpClients = Array.from(usesMcpClients).sort();
  summary.packagedPlatforms = Array.from(packagedPlatforms).sort();
  return summary;
}

function collectMissing(summary) {
  const missing = [];
  if (summary.realSampleCount < 1) {
    missing.push("real-sample evidence");
  }
  if (summary.externalAgentCount < 2) {
    missing.push("at least two external-agent evidence files");
  }
  if (!summary.agentClients.includes("codex")) {
    missing.push("Codex external-agent evidence");
  }
  if (!summary.agentClients.some((client) => client === "claude" || client === "cursor")) {
    missing.push("Claude Desktop or Cursor external-agent evidence");
  }
  if (summary.usesMcpClients.length < 1) {
    missing.push("at least one MCP-backed external-agent evidence");
  }
  if (summary.desktopSettingsCount < 1) {
    missing.push("desktop-settings evidence");
  }
  for (const platform of ["macos", "windows", "linux"]) {
    if (!summary.packagedPlatforms.includes(platform)) {
      missing.push(`${displayPlatform(platform)} packaged-platform evidence`);
    }
  }
  return missing;
}

function quoteShellArg(value) {
  if (/^<.*>$/.test(value)) return value;
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildCommand(parts) {
  return parts.map((part) => quoteShellArg(part)).join(" ");
}

function workspaceClosureArgs(workspace) {
  const args = [];
  if (!workspaceRelease(workspace)) {
    args.push("--release", "<release-label>");
  }
  if (!workspaceReviewer(workspace)) {
    args.push("--reviewer", "<name>");
  }
  return args;
}

function firstEntry(entries, type, predicate = () => true) {
  return entries.find((entry) => entry.type === type && predicate(entry));
}

function agentEntry(entries, client) {
  return firstEntry(entries, "external-agent", (entry) => normalizeClientName(entry.evidence.client?.name) === client);
}

function packagedEntry(entries, platform) {
  return firstEntry(entries, "packaged-platform", (entry) => normalizePlatform(entry.evidence.environment?.platform) === platform);
}

function strictEvidencePaths(entries, workspace) {
  const paths = [];
  const realSample = firstEntry(entries, "real-sample");
  paths.push(realSample?.path ?? workspaceRealSamplePath(workspace) ?? "docs/readany-cli/acceptance/evidence/real-sample.json");

  const codex = agentEntry(entries, "codex");
  if (codex) paths.push(codex.path);
  else paths.push(workspaceAgentEvidencePath(workspace, "codex") ?? "docs/readany-cli/acceptance/evidence/agent-codex.json");

  const secondClient = agentEntry(entries, "claude") ?? agentEntry(entries, "cursor");
  if (secondClient) paths.push(secondClient.path);
  else paths.push(workspaceAgentEvidencePath(workspace, "claude") ?? "docs/readany-cli/acceptance/evidence/agent-second-client.json");

  const desktop = firstEntry(entries, "desktop-settings");
  paths.push(desktop?.path ?? workspaceDesktopSettingsPath(workspace) ?? "docs/readany-cli/acceptance/evidence/desktop-settings.json");

  for (const platform of ["macos", "windows", "linux"]) {
    const packaged = packagedEntry(entries, platform);
    paths.push(packaged?.path ?? workspacePackagedEvidencePath(workspace, platform) ?? `docs/readany-cli/acceptance/evidence/packaged-${platform}.json`);
  }

  return paths;
}

function recommendedCommands(summary, recordPath, evidenceEntries, { workspaceFile, workspace }) {
  const commands = [];
  if (summary.realSampleCount < 1) {
    if (workspaceFile) {
      commands.push(buildCommand([
        "pnpm",
        "--filter",
        "@readany/cli",
        "acceptance:real",
        "--",
        "--workspace",
        workspaceFile,
        "--book",
        "<book-id>",
        "--rag-query",
        "<query>",
      ]));
    } else {
      commands.push("pnpm --filter @readany/cli acceptance:real -- --book <book-id> --rag-query <query> --evidence docs/readany-cli/acceptance/evidence/real-sample.json");
    }
  }
  if (!summary.agentClients.includes("codex")) {
    if (workspaceFile) {
      commands.push(buildCommand([
        "pnpm",
        "--filter",
        "@readany/cli",
        "acceptance:agent",
        "--",
        "--workspace",
        workspaceFile,
        "--client",
        "Codex",
        "--client-version",
        "<version>",
        "--profile",
        "readonly/editor/publisher",
        "--uses-mcp",
        "--mcp-config",
        "<redacted-config>",
        "--tools-list-summary",
        "<summary>",
        "--tool-count",
        "<n>",
        "--read-flow",
        "<summary>",
        "--readonly-denial",
        "<summary>",
        "--draft-export-flow",
        "<summary>",
      ]));
    } else {
      commands.push("pnpm --filter @readany/cli acceptance:agent -- --client Codex --client-version <version> --profile readonly/editor/publisher --uses-mcp --mcp-config <redacted-config> --tools-list-summary \"<summary>\" --tool-count <n> --read-flow \"<summary>\" --readonly-denial \"<summary>\" --draft-export-flow \"<summary>\" --evidence docs/readany-cli/acceptance/evidence/agent-codex.json");
    }
  }
  if (!summary.agentClients.some((client) => client === "claude" || client === "cursor")) {
    if (workspaceFile) {
      commands.push(buildCommand([
        "pnpm",
        "--filter",
        "@readany/cli",
        "acceptance:agent",
        "--",
        "--workspace",
        workspaceFile,
        "--client",
        "<Claude Desktop|Cursor>",
        "--client-version",
        "<version>",
        "--profile",
        "readonly/editor/publisher",
        "--read-flow",
        "<summary>",
        "--readonly-denial",
        "<summary>",
        "--draft-export-flow",
        "<summary>",
      ]));
    } else {
      commands.push("pnpm --filter @readany/cli acceptance:agent -- --client <Claude Desktop|Cursor> --client-version <version> --profile readonly/editor/publisher --read-flow \"<summary>\" --readonly-denial \"<summary>\" --draft-export-flow \"<summary>\" --evidence docs/readany-cli/acceptance/evidence/agent-second-client.json");
    }
  }
  if (summary.desktopSettingsCount < 1) {
    if (workspaceFile) {
      commands.push(buildCommand([
        "pnpm",
        "--filter",
        "@readany/cli",
        "acceptance:desktop",
        "--",
        "--workspace",
        workspaceFile,
        "--snapshot",
        "<copied-settings-snapshot.json>",
        "--screenshot",
        "<screenshot-or-recording>",
      ]));
    } else {
      commands.push("pnpm --filter @readany/cli acceptance:desktop -- --snapshot <copied-settings-snapshot.json> --screenshot <screenshot-or-recording> --evidence docs/readany-cli/acceptance/evidence/desktop-settings.json");
    }
  }
  for (const platform of ["macos", "windows", "linux"]) {
    if (!summary.packagedPlatforms.includes(platform)) {
      if (workspaceFile) {
        commands.push(buildCommand([
          "pnpm",
          "--filter",
          "@readany/cli",
          "acceptance:packaged",
          "--",
          "--workspace",
          workspaceFile,
          "--package-source",
          "<artifact>",
          "--platform",
          displayPlatform(platform),
        ]));
      } else {
        commands.push(`pnpm --filter @readany/cli acceptance:packaged -- --package-source <artifact> --platform ${displayPlatform(platform)} --evidence docs/readany-cli/acceptance/evidence/packaged-${platform}.json`);
      }
    }
  }

  const strictPaths = strictEvidencePaths(evidenceEntries, workspace);
  if (!recordPath && summary.realSampleCount >= 1) {
    if (workspaceFile) {
      commands.push(buildCommand([
        "pnpm",
        "--filter",
        "@readany/cli",
        "acceptance:scaffold",
        "--",
        "--workspace",
        workspaceFile,
      ]));
    } else {
      const scaffoldParts = [
        "pnpm",
        "--filter",
        "@readany/cli",
        "acceptance:scaffold",
        "--",
        "--evidence",
        strictPaths[0],
      ];
      for (const path of strictPaths.slice(1)) {
        if (/agent-codex|agent-second-client/.test(path)) {
          scaffoldParts.push("--agent-evidence", path);
        } else if (/desktop-settings/.test(path)) {
          scaffoldParts.push("--desktop-evidence", path);
        } else if (/packaged-/.test(path)) {
          scaffoldParts.push("--packaged-evidence", path);
        }
      }
      scaffoldParts.push("--output", "docs/readany-cli/acceptance/<m5-record>.md");
      commands.push(buildCommand(scaffoldParts));
    }
  }

  if (recordPath) {
    if (workspaceFile) {
      commands.push(buildCommand([
        "pnpm",
        "--filter",
        "@readany/cli",
        "acceptance:validate",
        "--",
        "--workspace",
        workspaceFile,
        "--strict-m5",
      ]));
      commands.push(buildCommand([
        "pnpm",
        "--filter",
        "@readany/cli",
        "acceptance:assemble",
        "--",
        "--workspace",
        workspaceFile,
        ...workspaceClosureArgs(workspace),
      ]));
    } else {
      const validateParts = [
        "pnpm",
        "--filter",
        "@readany/cli",
        "acceptance:validate",
        "--",
        "--record",
        recordPath,
      ];
      for (const path of strictPaths) {
        validateParts.push("--evidence", path);
      }
      validateParts.push("--strict-m5");
      commands.push(buildCommand(validateParts));

      const assembleParts = [
        "pnpm",
        "--filter",
        "@readany/cli",
        "acceptance:assemble",
        "--",
        "--record",
        recordPath,
      ];
      for (const path of strictPaths) {
        assembleParts.push("--evidence", path);
      }
      assembleParts.push("--release", "<release-label>", "--reviewer", "<name>", "--output-dir", "<acceptance-bundle-dir>");
      commands.push(buildCommand(assembleParts));
    }
  }

  return commands;
}

function renderText(status) {
  const lines = [];
  lines.push(`strict M5 ready: ${status.readiness.strictM5Ready ? "yes" : "no"}`);
  lines.push(`record: ${status.recordPath ?? "not provided"}`);
  lines.push(`evidence files: ${status.summary.evidenceCount}`);
  lines.push(`evidence types: ${status.summary.evidenceTypes.join(", ") || "none"}`);
  if (status.summary.agentClients.length > 0) {
    lines.push(`agent clients: ${status.summary.agentClients.join(", ")}`);
  }
  if (status.summary.packagedPlatforms.length > 0) {
    lines.push(`packaged platforms: ${status.summary.packagedPlatforms.map(displayPlatform).join(", ")}`);
  }
  if (status.readiness.missing.length > 0) {
    lines.push("missing:");
    for (const item of status.readiness.missing) {
      lines.push(`- ${item}`);
    }
  }
  if (status.validation.strictM5.errors.length > 0) {
    lines.push("strict M5 validation errors:");
    for (const item of status.validation.strictM5.errors) {
      lines.push(`- ${item}`);
    }
  }
  if (status.nextSteps.length > 0) {
    lines.push("recommended next steps:");
    for (const item of status.nextSteps) {
      lines.push(`- ${item}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function defaultValidationResult({ performed, ok }) {
  return {
    ok,
    performed,
    errors: [],
    warnings: [],
  };
}

function normalizeValidationResult(result, performed, fallbackOk) {
  if (result) {
    return {
      ...result,
      performed,
    };
  }
  return defaultValidationResult({ performed, ok: fallbackOk });
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

  const recordPath = options.recordPath
    ? resolveInputPath(options.recordPath)
    : workspace?.paths?.recordPath;
  const evidencePathInputs = options.evidencePaths.length > 0
    ? options.evidencePaths
    : workspaceEvidenceFiles(workspace);
  const resolvedEvidencePaths = evidencePathInputs.map(resolveInputPath);
  const evidencePaths = options.evidencePaths.length > 0
    ? resolvedEvidencePaths
    : await filterExistingPaths(resolvedEvidencePaths);
  const evidenceEntries = await Promise.all(
    evidencePaths.map(async (path) => {
      const evidence = JSON.parse(await readFile(path, "utf8"));
      return {
        path,
        type: evidenceType(evidence),
        evidence,
      };
    }),
  );

  const summary = summarizeEvidences(evidenceEntries);
  const missing = collectMissing(summary);
  const structuralValidation = runValidate({ recordPath, evidencePaths, strictM5: false });
  const strictValidation = runValidate({ recordPath, evidencePaths, strictM5: true });
  const structuralPerformed = Boolean(recordPath) || evidencePaths.length > 0;
  const strictPerformed = Boolean(recordPath) && evidencePaths.length > 0;
  const strictReady = strictValidation.result?.ok === true && missing.length === 0;

  const output = {
    ok: true,
    workspaceFile,
    recordPath,
    summary,
    readiness: {
      strictM5Ready: strictReady,
      missing,
    },
    validation: {
      structural: normalizeValidationResult(structuralValidation.result, structuralPerformed, structuralValidation.status === 0),
      strictM5: normalizeValidationResult(strictValidation.result, strictPerformed, strictReady),
    },
    nextSteps: recommendedCommands(summary, recordPath, evidenceEntries, { workspaceFile, workspace }),
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write(renderText(output));
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
