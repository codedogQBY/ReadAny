import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  loadWorkspaceConfig,
  resolveInputPath,
  workspaceDesktopSettingsPath,
} from "./acceptance-workspace.mjs";

function parseArgs(argv) {
  const options = {
    snapshotPath: undefined,
    evidencePath: undefined,
    workspacePath: undefined,
    screenshot: undefined,
    reviewer: undefined,
    notes: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--snapshot") {
      options.snapshotPath = next;
      index += 1;
    } else if (arg === "--evidence") {
      options.evidencePath = next;
      index += 1;
    } else if (arg === "--workspace") {
      options.workspacePath = next;
      index += 1;
    } else if (arg === "--screenshot") {
      options.screenshot = next;
      index += 1;
    } else if (arg === "--reviewer") {
      options.reviewer = next;
      index += 1;
    } else if (arg === "--notes") {
      options.notes = next;
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
  return `ReadAny desktop External AI settings acceptance helper

Usage:
  pnpm --filter @readany/cli acceptance:desktop -- --snapshot <copied-settings-snapshot.json> [options]

Options:
  --evidence <path>       Write JSON evidence to this path.
  --workspace <path>      Acceptance workspace root or workspace.json.
  --screenshot <path>     Optional screenshot or screen recording path for manual review.
  --reviewer <name>      Reviewer name.
  --notes <text>         Short manual validation note.
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

function summarizeTools(tools) {
  return Array.isArray(tools)
    ? {
        count: tools.length,
        names: tools.map((tool) => tool.name).filter(Boolean).slice(0, 50),
        riskValues: Array.from(new Set(tools.map((tool) => tool.risk).filter(Boolean))).sort(),
      }
    : { count: 0, names: [], riskValues: [] };
}

function createChecks(snapshot) {
  const tools = summarizeTools(snapshot.tools);
  return [
    { name: "cli.available", ok: snapshot.cli?.available === true },
    { name: "doctor.present", ok: Boolean(snapshot.doctor) },
    { name: "doctor.distribution", ok: typeof snapshot.doctor?.distribution?.builtBundle === "boolean" },
    { name: "skill.status", ok: Boolean(snapshot.skill) },
    { name: "mcp.config", ok: Boolean(snapshot.mcp?.config) && /readany/i.test(JSON.stringify(snapshot.mcp.config)) },
    { name: "tools.list", ok: tools.count > 0 },
    { name: "last.action", ok: Boolean(snapshot.lastAction?.action) },
  ];
}

function validateSnapshot(snapshot) {
  assertOption(snapshot && typeof snapshot === "object", "Desktop snapshot must be a JSON object.");
  assertOption(typeof snapshot.generatedAt === "string", "Desktop snapshot generatedAt is required.");
  assertOption(snapshot.cli?.available === true, "Desktop snapshot must show CLI available.");
  assertOption(typeof snapshot.cli?.version === "string" && snapshot.cli.version.length > 0, "Desktop snapshot CLI version is required.");
  assertOption(snapshot.doctor && typeof snapshot.doctor.version === "string", "Desktop snapshot doctor report is required.");
  assertOption(typeof snapshot.doctor?.distribution?.builtBundle === "boolean", "Desktop snapshot doctor distribution flags are required.");
  assertOption(typeof snapshot.doctor?.distribution?.desktopResourceBundle === "boolean", "Desktop snapshot desktopResourceBundle flag is required.");
  assertOption(snapshot.skill && typeof snapshot.skill.installed === "boolean", "Desktop snapshot skill status is required.");
  assertOption(snapshot.mcp && typeof snapshot.mcp.profile === "string", "Desktop snapshot MCP profile is required.");
  assertOption(snapshot.mcp?.config, "Desktop snapshot MCP config is required.");
  assertOption(Array.isArray(snapshot.tools) && snapshot.tools.length > 0, "Desktop snapshot tools list is required.");
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

  assertOption(options.snapshotPath, "Pass --snapshot <path>.");
  const outputPath = options.evidencePath
    ? resolveInputPath(options.evidencePath)
    : workspaceDesktopSettingsPath(workspace);
  assertOption(outputPath, "Pass --evidence <path> or use --workspace <path>.");

  const snapshotPath = resolveInputPath(options.snapshotPath);
  const snapshotText = await readFile(snapshotPath, "utf8");
  assertOption(!hasObviousSecret(snapshotText), "Desktop snapshot appears to contain an unredacted secret; redact it before recording.");
  const snapshot = JSON.parse(snapshotText);
  validateSnapshot(snapshot);

  const tools = summarizeTools(snapshot.tools);
  const checks = createChecks(snapshot);
  const evidence = {
    ok: checks.every((check) => check.ok),
    generatedAt: new Date().toISOString(),
    environment: {
      evidenceType: "desktop-settings",
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      snapshotPath,
    },
    reviewer: options.reviewer,
    notes: options.notes,
    screenshot: options.screenshot,
    snapshot: {
      generatedAt: snapshot.generatedAt,
      cli: snapshot.cli,
      doctor: snapshot.doctor,
      skill: snapshot.skill,
      mcp: {
        profile: snapshot.mcp.profile,
        client: snapshot.mcp.client,
        hasConfig: Boolean(snapshot.mcp.config),
      },
      tools,
      lastAction: snapshot.lastAction,
    },
    checks,
    summary: {
      completed: checks.every((check) => check.ok),
      cliAvailable: snapshot.cli?.available === true,
      skillInstalled: snapshot.skill?.installed === true,
      mcpProfile: snapshot.mcp?.profile,
      mcpClient: snapshot.mcp?.client,
      toolCount: tools.count,
      commandSource: snapshot.cli?.source ?? snapshot.lastAction?.command_source,
      builtBundle: snapshot.doctor?.distribution?.builtBundle === true,
      desktopResourceBundle: snapshot.doctor?.distribution?.desktopResourceBundle === true,
      nativeBinary: snapshot.doctor?.distribution?.nativeBinary === true,
      usesNodeRuntime: snapshot.doctor?.distribution?.usesNodeRuntime === true,
    },
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: evidence.ok, workspaceFile, outputPath, summary: evidence.summary }, null, 2)}\n`);
  if (!evidence.ok) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
