import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterExistingPaths,
  loadWorkspaceConfig,
  resolveInputPath,
  workspaceEvidenceFiles,
  workspaceRecordPath,
} from "./acceptance-workspace.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

const KNOWN_MANUAL_REQUIREMENTS = [
  "sample-source",
  "external-agent-clients",
  "desktop-settings",
  "packaged-app-matrix",
  "reader-jumpback",
  "runtime-bundle",
];

const REQUIRED_RECORD_HEADINGS = [
  "## 基本信息",
  "## 本次验收范围",
  "## 本次明确不验收",
  "## 执行命令",
  "## 验收结果",
  "## 证据摘要",
  "## 安全边界证据",
  "## 当前可对外说明",
  "## 当前不能对外宣称",
  "## 已知问题",
  "## 是否允许进入下一阶段",
];

const STRICT_M5_HEADINGS = [
  "## 真实样本证据",
  "## 外部 Agent 证据",
  "## 打包 / 安装矩阵",
  "## Manual Acceptance Closure",
];

function parseArgs(argv) {
  const options = {
    recordPath: undefined,
    evidencePaths: [],
    workspacePath: undefined,
    strictM5: false,
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
    } else if (arg === "--strict-m5") {
      options.strictM5 = true;
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
  return `ReadAny acceptance validator

Usage:
  pnpm --filter @readany/cli acceptance:validate -- --record <acceptance.md> [options]
  pnpm --filter @readany/cli acceptance:validate -- --evidence <evidence.json> [options]

Options:
  --record <path>      Validate an acceptance Markdown record.
  --evidence <path>    Validate acceptance JSON evidence; repeatable.
  --workspace <path>   Acceptance workspace root or workspace.json.
  --strict-m5          Enforce full M5 record gates.
  --json               Print machine-readable result.
`;
}

function assertCondition(condition, errors, message) {
  if (!condition) errors.push(message);
}

function section(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const next = text.indexOf("\n## ", start + heading.length);
  return text.slice(start + heading.length, next < 0 ? text.length : next);
}

function nonPlaceholderBullets(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .filter((line) => line !== "-" && line !== "-  " && line !== "- -");
}

function hasValue(value) {
  const normalized = String(value ?? "")
    .replace(/`/g, "")
    .trim();
  return normalized.length > 0 && normalized !== "-" && !/^n\/a$/i.test(normalized);
}

function parseMarkdownTableRows(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*-+/.test(line))
    .slice(1)
    .map((line) => line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim()));
}

function validateStrictM5Tables(text, errors) {
  const agentRows = parseMarkdownTableRows(section(text, "## 外部 Agent 证据"));
  const completedAgentRows = agentRows.filter((row) => row.length >= 7 && row.slice(0, 7).every(hasValue));
  assertCondition(
    completedAgentRows.length >= 2,
    errors,
    "Strict M5 record must include at least two completed external agent rows.",
  );
  assertCondition(
    completedAgentRows.some((row) => /codex/i.test(row[0])),
    errors,
    "Strict M5 record must include a completed Codex external agent row.",
  );
  assertCondition(
    completedAgentRows.some((row) => /claude|cursor/i.test(row[0])),
    errors,
    "Strict M5 record must include a completed Claude Desktop or Cursor external agent row.",
  );

  const matrixRows = parseMarkdownTableRows(section(text, "## 打包 / 安装矩阵"));
  const requiredPlatforms = ["macOS", "Windows", "Linux"];
  for (const platform of requiredPlatforms) {
    const row = matrixRows.find((item) => item[0]?.toLowerCase() === platform.toLowerCase());
    assertCondition(Boolean(row), errors, `Strict M5 record must include ${platform} in the packaged app matrix.`);
    if (row) {
      assertCondition(
        row.length >= 8 && row.slice(0, 8).every(hasValue),
        errors,
        `Strict M5 packaged app matrix row for ${platform} has empty required cells.`,
      );
    }
  }

  const closureRows = parseMarkdownTableRows(section(text, "## Manual Acceptance Closure"));
  for (const id of KNOWN_MANUAL_REQUIREMENTS) {
    const row = closureRows.find((item) => item[0] === id);
    assertCondition(Boolean(row), errors, `Strict M5 record must close manual requirement: ${id}`);
    if (row) {
      assertCondition(
        row.length >= 4 && row.slice(0, 4).every(hasValue),
        errors,
        `Strict M5 manual requirement row for ${id} has empty required cells.`,
      );
      assertCondition(
        /resolved|pass|passed|done/i.test(row[1] ?? ""),
        errors,
        `Strict M5 manual requirement ${id} must be marked resolved/pass/done.`,
      );
    }
  }
}

function validateRecord(text, { strictM5 }) {
  const errors = [];
  const warnings = [];
  const requiredHeadings = strictM5
    ? [...REQUIRED_RECORD_HEADINGS, ...STRICT_M5_HEADINGS]
    : REQUIRED_RECORD_HEADINGS;

  for (const heading of requiredHeadings) {
    assertCondition(text.includes(heading), errors, `Missing acceptance section: ${heading}`);
  }

  if (strictM5) {
    const scope = section(text, "## 本次验收范围");
    const result = section(text, "## 验收结果");
    const cannotClaim = section(text, "## 当前不能对外宣称");

    assertCondition(!scope.includes("- [ ]"), errors, "Strict M5 record still has unchecked scope items.");
    assertCondition(!/部分通过|不通过/.test(result), errors, "Strict M5 record result is not a full pass.");
    assertCondition(
      nonPlaceholderBullets(cannotClaim).length === 0,
      errors,
      "Strict M5 record still lists claims that cannot be made externally.",
    );
    validateStrictM5Tables(text, errors);
  } else if (text.includes("部分通过")) {
    warnings.push("Record is marked partial; use --strict-m5 only for final M5 acceptance.");
  }

  return { errors, warnings };
}

function validateExternalAgentEvidence(evidence) {
  const errors = [];
  const warnings = [];

  assertCondition(evidence?.ok === true, errors, "Evidence ok must be true.");
  assertCondition(typeof evidence?.generatedAt === "string", errors, "Evidence generatedAt is required.");
  assertCondition(evidence?.environment?.evidenceType === "external-agent", errors, "External agent evidenceType is required.");
  assertCondition(typeof evidence?.client?.name === "string" && evidence.client.name.length > 0, errors, "External agent client.name is required.");
  assertCondition(typeof evidence?.client?.version === "string" && evidence.client.version.length > 0, errors, "External agent client.version is required.");
  assertCondition(typeof evidence?.client?.profile === "string" && evidence.client.profile.length > 0, errors, "External agent client.profile is required.");
  assertCondition(typeof evidence?.client?.usesMcp === "boolean", errors, "External agent client.usesMcp is required.");
  assertCondition(typeof evidence?.flows?.read?.summary === "string" && evidence.flows.read.summary.length > 0, errors, "External agent read flow summary is required.");
  assertCondition(typeof evidence?.flows?.readonlyDenial?.summary === "string" && evidence.flows.readonlyDenial.summary.length > 0, errors, "External agent readonly denial summary is required.");
  assertCondition(typeof evidence?.flows?.draftExport?.summary === "string" && evidence.flows.draftExport.summary.length > 0, errors, "External agent draft/export flow summary is required.");
  if (evidence?.client?.usesMcp) {
    assertCondition(typeof evidence?.mcp?.configRedacted === "string" && evidence.mcp.configRedacted.length > 0, errors, "External agent MCP config evidence is required.");
    assertCondition(typeof evidence?.mcp?.toolsListSummary === "string" && evidence.mcp.toolsListSummary.length > 0, errors, "External agent tools/list evidence is required.");
    assertCondition(typeof evidence?.mcp?.toolCount === "number" && evidence.mcp.toolCount > 0, errors, "External agent MCP toolCount is required.");
  }
  if (evidence?.mcp?.configRedacted) {
    assertCondition(!/sk-|authorization|api[_-]?key|password|token/i.test(evidence.mcp.configRedacted), errors, "External agent MCP config must be redacted.");
  }
  warnings.push("External agent evidence validates one client only; strict M5 still requires multiple completed client rows in the record.");
  return { errors, warnings };
}

function validateDesktopSettingsEvidence(evidence) {
  const errors = [];
  const warnings = [];

  assertCondition(evidence?.ok === true, errors, "Evidence ok must be true.");
  assertCondition(typeof evidence?.generatedAt === "string", errors, "Evidence generatedAt is required.");
  assertCondition(evidence?.environment?.evidenceType === "desktop-settings", errors, "Desktop settings evidenceType is required.");
  assertCondition(evidence?.summary?.completed === true, errors, "Desktop settings summary.completed must be true.");
  assertCondition(evidence?.summary?.cliAvailable === true, errors, "Desktop settings CLI availability is required.");
  assertCondition(typeof evidence?.summary?.toolCount === "number" && evidence.summary.toolCount > 0, errors, "Desktop settings toolCount is required.");
  assertCondition(typeof evidence?.summary?.mcpProfile === "string", errors, "Desktop settings MCP profile is required.");
  assertCondition(typeof evidence?.summary?.mcpClient === "string", errors, "Desktop settings MCP client is required.");
  assertCondition(typeof evidence?.snapshot?.doctor?.version === "string", errors, "Desktop settings doctor version is required.");
  assertCondition(typeof evidence?.snapshot?.doctor?.distribution?.builtBundle === "boolean", errors, "Desktop settings doctor distribution.builtBundle is required.");
  assertCondition(typeof evidence?.snapshot?.doctor?.distribution?.desktopResourceBundle === "boolean", errors, "Desktop settings doctor distribution.desktopResourceBundle is required.");
  assertCondition(typeof evidence?.snapshot?.skill?.installed === "boolean", errors, "Desktop settings skill status is required.");
  assertCondition(evidence?.snapshot?.mcp?.hasConfig === true, errors, "Desktop settings MCP config evidence is required.");
  assertCondition(Array.isArray(evidence?.checks), errors, "Desktop settings checks must be an array.");
  assertCondition((evidence?.checks ?? []).every((check) => check.ok === true), errors, "Desktop settings checks must all pass.");
  if (!evidence?.screenshot) {
    warnings.push("Desktop settings evidence has no screenshot path; strict M5 record still needs UI evidence or copied snapshot attachment.");
  }
  warnings.push("Desktop settings evidence validates the settings page snapshot only; strict M5 still requires final record closure.");
  return { errors, warnings };
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

function evidenceLabel(evidence) {
  const type = evidenceType(evidence);
  if (type === "external-agent") return `external-agent:${evidence.client?.name ?? "unknown"}`;
  if (type === "packaged-platform") return `packaged-platform:${evidence.environment?.platform ?? "unknown"}`;
  return type;
}

function normalizePlatform(platform) {
  const normalized = String(platform ?? "").trim().toLowerCase();
  if (["macos", "mac", "darwin"].includes(normalized)) return "macos";
  if (["windows", "win32", "win"].includes(normalized)) return "windows";
  if (normalized === "linux") return "linux";
  return normalized;
}

function displayPlatform(platform) {
  const normalized = normalizePlatform(platform);
  if (normalized === "macos") return "macOS";
  if (normalized === "windows") return "Windows";
  if (normalized === "linux") return "Linux";
  return String(platform ?? "unknown");
}

function normalizeClientName(name) {
  const normalized = String(name ?? "").trim().toLowerCase();
  if (/codex/.test(normalized)) return "codex";
  if (/claude/.test(normalized)) return "claude";
  if (/cursor/.test(normalized)) return "cursor";
  return normalized;
}

function validateDoctorEvidence(evidence, errors) {
  assertCondition(typeof evidence?.doctor?.version === "string", errors, "Doctor version is required.");
  assertCondition(typeof evidence?.doctor?.runtime?.node === "string", errors, "Doctor runtime.node is required.");
  assertCondition(
    typeof evidence?.doctor?.runtime?.executable === "string",
    errors,
    "Doctor runtime.executable is required.",
  );
  assertCondition(
    typeof evidence?.doctor?.runtime?.nativeSqliteAvailable === "boolean",
    errors,
    "Doctor runtime.nativeSqliteAvailable is required.",
  );
  assertCondition(evidence?.doctor?.distribution?.kind === "node-script", errors, "Doctor distribution.kind is required.");
  assertCondition(
    evidence?.doctor?.distribution?.usesNodeRuntime === true,
    errors,
    "Doctor distribution.usesNodeRuntime must be recorded.",
  );
  assertCondition(
    typeof evidence?.doctor?.distribution?.nativeBinary === "boolean",
    errors,
    "Doctor distribution.nativeBinary is required.",
  );
  assertCondition(
    typeof evidence?.doctor?.distribution?.builtBundle === "boolean",
    errors,
    "Doctor distribution.builtBundle is required.",
  );
  assertCondition(
    typeof evidence?.doctor?.distribution?.desktopResourceBundle === "boolean",
    errors,
    "Doctor distribution.desktopResourceBundle is required.",
  );
  assertCondition(evidence?.doctor?.mcp?.defaultProfile === "readonly", errors, "Doctor MCP default profile must be readonly.");
  assertCondition(Array.isArray(evidence?.doctor?.mcp?.serveArgs), errors, "Doctor MCP serveArgs are required.");
  assertCondition(typeof evidence?.doctor?.mcp?.toolCount === "number", errors, "Doctor MCP toolCount is required.");
}

function validateSummaryCounts(evidence, errors, warnings) {
  if (evidence?.summary) {
    assertCondition(
      evidence.summary.commandCount === evidence.commands?.length,
      errors,
      "Summary commandCount must match commands length.",
    );
    assertCondition(
      evidence.summary.checkCount === evidence.checks?.length,
      errors,
      "Summary checkCount must match checks length.",
    );
  } else {
    warnings.push("Evidence has no summary field.");
  }
}

function validatePackagedEvidence(evidence) {
  const errors = [];
  const warnings = [];

  assertCondition(evidence?.ok === true, errors, "Evidence ok must be true.");
  assertCondition(typeof evidence?.generatedAt === "string", errors, "Evidence generatedAt is required.");
  assertCondition(Array.isArray(evidence?.checks), errors, "Evidence checks must be an array.");
  assertCondition(Array.isArray(evidence?.commands), errors, "Evidence commands must be an array.");
  assertCondition(evidence?.environment?.evidenceType === "packaged-platform", errors, "Packaged evidenceType is required.");
  assertCondition(typeof evidence?.environment?.platform === "string", errors, "Packaged environment.platform is required.");
  assertCondition(typeof evidence?.environment?.packageSource === "string", errors, "Packaged packageSource is required.");
  assertCondition(typeof evidence?.environment?.cliPath === "string", errors, "Packaged cliPath is required.");
  validateDoctorEvidence(evidence, errors);
  validateSummaryCounts(evidence, errors, warnings);
  assertCondition(evidence?.mcp?.serverName === "readany", errors, "Packaged MCP initialize serverName is required.");
  assertCondition(typeof evidence?.mcp?.toolCount === "number" && evidence.mcp.toolCount > 0, errors, "Packaged MCP toolCount is required.");
  assertCondition(evidence?.mcp?.hasSafetyMetadata === true, errors, "Packaged MCP tools/list safety metadata is required.");
  assertCondition(
    (evidence?.commands ?? []).some((command) => command.name === "mcp.initialize.tools.list" && command.ok === true),
    errors,
    "Packaged evidence must include MCP initialize/tools.list command evidence.",
  );
  assertCondition(
    (evidence?.checks ?? []).includes("doctor") && (evidence?.checks ?? []).includes("mcp.initialize.tools.list"),
    errors,
    "Packaged evidence must include doctor and MCP checks.",
  );
  if (evidence?.summary?.repairChecked === true) {
    assertCondition(evidence?.repair?.repaired === true, errors, "Packaged repair.repaired must be true.");
    assertCondition(
      (evidence?.commands ?? []).some((command) => command.name === "repair" && command.ok === true),
      errors,
      "Packaged repair evidence must include repair command.",
    );
    assertCondition((evidence?.checks ?? []).includes("repair"), errors, "Packaged repair evidence must include repair check.");
  }
  if (evidence?.summary?.draftExportChecked === true) {
    assertCondition(evidence?.draftExport?.checked === true, errors, "Packaged draftExport.checked must be true.");
    assertCondition(typeof evidence?.draftExport?.bookId === "string", errors, "Packaged draftExport.bookId is required.");
    assertCondition(typeof evidence?.draftExport?.outputPath === "string", errors, "Packaged draftExport.outputPath is required.");
    assertCondition(typeof evidence?.draftExport?.outputHash === "string", errors, "Packaged draftExport.outputHash is required.");
    assertCondition(
      typeof evidence?.draftExport?.exportedInspect?.spineCount === "number" &&
        evidence.draftExport.exportedInspect.spineCount > 0,
      errors,
      "Packaged draftExport exportedInspect.spineCount is required.",
    );
    for (const commandName of ["epub.draft.create", "epub.validate", "epub.export", "epub.draft.discard"]) {
      assertCondition(
        (evidence?.commands ?? []).some((command) => command.name === commandName && command.ok === true),
        errors,
        `Packaged draft export evidence must include ${commandName}.`,
      );
    }
    for (const checkName of ["epub.draft.create", "epub.validate", "epub.export", "epub.export.inspect"]) {
      assertCondition(
        (evidence?.checks ?? []).includes(checkName),
        errors,
        `Packaged draft export evidence must include check ${checkName}.`,
      );
    }
  }

  for (const item of evidence?.manualAcceptanceRequired ?? []) {
    assertCondition(typeof item.id === "string", errors, "Manual requirement id is required.");
    assertCondition(typeof item.label === "string", errors, `Manual requirement ${item.id} label is required.`);
    assertCondition(
      Array.isArray(item.evidence) && item.evidence.length > 0,
      errors,
      `Manual requirement ${item.id} evidence hints are required.`,
    );
    assertCondition(Array.isArray(item.commands), errors, `Manual requirement ${item.id} commands must be an array.`);
  }

  warnings.push("Packaged evidence validates one platform only; strict M5 still requires macOS/Windows/Linux matrix rows.");
  return { errors, warnings };
}

function validateRealSampleEvidence(evidence) {
  const errors = [];
  const warnings = [];

  assertCondition(evidence?.ok === true, errors, "Evidence ok must be true.");
  assertCondition(typeof evidence?.generatedAt === "string", errors, "Evidence generatedAt is required.");
  assertCondition(typeof evidence?.readanyHome === "string", errors, "Evidence readanyHome is required.");
  assertCondition(Array.isArray(evidence?.checks), errors, "Evidence checks must be an array.");
  assertCondition(Array.isArray(evidence?.commands), errors, "Evidence commands must be an array.");
  assertCondition(Array.isArray(evidence?.sampleFiles), errors, "Evidence sampleFiles must be an array.");
  assertCondition(Array.isArray(evidence?.citationTargets), errors, "Evidence citationTargets must be an array.");

  validateDoctorEvidence(evidence, errors);
  validateSummaryCounts(evidence, errors, warnings);

  if (evidence?.summary) {
    assertCondition(
      evidence.summary.sampleFileCount === evidence.sampleFiles?.length,
      errors,
      "Summary sampleFileCount must match sampleFiles length.",
    );
    assertCondition(
      evidence.summary.citationTargetCount === evidence.citationTargets?.length,
      errors,
      "Summary citationTargetCount must match citationTargets length.",
    );
  } else {
    warnings.push("Evidence has no summary field.");
  }

  const citationTargets = evidence?.citationTargets ?? [];
  assertCondition(citationTargets.length > 0, errors, "At least one citation target is required.");
  assertCondition(
    citationTargets.some((target) => target.type === "rag-chunk" && target.bookId && target.chunkId && (target.cfi || target.startCfi)),
    errors,
    "At least one RAG chunk citation target with bookId/chunkId/CFI is required.",
  );
  for (const [index, target] of citationTargets.entries()) {
    assertCondition(typeof target.type === "string" && target.type.length > 0, errors, `Citation target ${index} type is required.`);
    assertCondition(typeof target.bookId === "string" && target.bookId.length > 0, errors, `Citation target ${index} bookId is required.`);
    assertCondition(
      Boolean(target.cfi || target.startCfi || target.page || target.chapterId || target.chunkId),
      errors,
      `Citation target ${index} must include a jumpback location.`,
    );
  }

  for (const [index, sample] of (evidence?.sampleFiles ?? []).entries()) {
    assertCondition(Array.isArray(sample.labels) && sample.labels.length > 0, errors, `Sample ${index} labels are required.`);
    assertCondition(typeof sample.bookId === "string" && sample.bookId.length > 0, errors, `Sample ${index} bookId is required.`);
    assertCondition(typeof sample.format === "string" && sample.format.length > 0, errors, `Sample ${index} format is required.`);
    assertCondition(typeof sample.filePath === "string" && sample.filePath.length > 0, errors, `Sample ${index} filePath is required.`);
    assertCondition(typeof sample.bytes === "number" && sample.bytes > 0, errors, `Sample ${index} bytes must be positive.`);
    assertCondition(/^[a-f0-9]{64}$/.test(sample.sha256 ?? ""), errors, `Sample ${index} sha256 must be a hex SHA-256.`);
  }

  const manualRequirements = evidence?.manualAcceptanceRequired ?? [];
  assertCondition(Array.isArray(manualRequirements), errors, "manualAcceptanceRequired must be an array.");
  const requirementIds = new Set(manualRequirements.map((item) => item.id));
  for (const id of KNOWN_MANUAL_REQUIREMENTS) {
    assertCondition(requirementIds.has(id), errors, `Missing manual acceptance requirement: ${id}`);
  }
  for (const item of manualRequirements) {
    assertCondition(typeof item.id === "string", errors, "Manual requirement id is required.");
    assertCondition(typeof item.label === "string", errors, `Manual requirement ${item.id} label is required.`);
    assertCondition(
      Array.isArray(item.evidence) && item.evidence.length > 0,
      errors,
      `Manual requirement ${item.id} evidence hints are required.`,
    );
    assertCondition(Array.isArray(item.commands), errors, `Manual requirement ${item.id} commands must be an array.`);
  }

  return { errors, warnings };
}

function validateEvidence(evidence) {
  const type = evidenceType(evidence);
  if (type === "packaged-platform") return validatePackagedEvidence(evidence);
  if (type === "external-agent") return validateExternalAgentEvidence(evidence);
  if (type === "desktop-settings") return validateDesktopSettingsEvidence(evidence);
  return validateRealSampleEvidence(evidence);
}

function citationAnchor(target) {
  return target?.cfi ?? target?.startCfi ?? (target?.page ? `page:${target.page}` : undefined);
}

function validateStrictM5RecordEvidenceLinks(recordText, evidence, errors) {
  const sampleHashes = (evidence?.sampleFiles ?? [])
    .map((sample) => sample.sha256)
    .filter(Boolean);
  assertCondition(
    sampleHashes.some((hash) => recordText.includes(hash)),
    errors,
    "Strict M5 record must reference at least one sample SHA-256 from evidence.",
  );

  const citationAnchors = (evidence?.citationTargets ?? [])
    .map(citationAnchor)
    .filter(Boolean);
  assertCondition(
    citationAnchors.some((anchor) => recordText.includes(anchor)),
    errors,
    "Strict M5 record must reference at least one citation target from evidence.",
  );

  const distribution = evidence?.doctor?.distribution;
  const distributionAnchors = [
    distribution?.builtBundle === true ? "builtBundle: true" : undefined,
    distribution?.desktopResourceBundle === true ? "desktopResourceBundle: true" : "desktopResourceBundle: false",
    distribution?.nativeBinary === true ? "nativeBinary: true" : "nativeBinary: false",
  ].filter(Boolean);
  assertCondition(
    distributionAnchors.every((anchor) => recordText.includes(anchor)),
    errors,
    "Strict M5 record must reference doctor distribution flags from evidence.",
  );

  const closureRows = parseMarkdownTableRows(section(recordText, "## Manual Acceptance Closure"));
  for (const item of evidence?.manualAcceptanceRequired ?? []) {
    const row = closureRows.find((entry) => entry[0] === item.id);
    assertCondition(
      Boolean(row) && /resolved|pass|passed|done/i.test(row?.[1] ?? ""),
      errors,
      `Strict M5 record must close evidence manual requirement: ${item.id}`,
    );
  }
}

function validateStrictM5EvidenceSet(recordText, evidences, errors) {
  assertCondition(Boolean(recordText), errors, "Strict M5 validation requires an acceptance record.");
  const byType = new Map();
  for (const evidence of evidences) {
    const type = evidenceType(evidence);
    const list = byType.get(type) ?? [];
    list.push(evidence);
    byType.set(type, list);
  }

  const realSample = byType.get("real-sample")?.[0];
  assertCondition(Boolean(realSample), errors, "Strict M5 validation requires acceptance:real evidence.");
  if (realSample && recordText) {
    validateStrictM5RecordEvidenceLinks(recordText, realSample, errors);
  }

  const agentEvidences = byType.get("external-agent") ?? [];
  const agentClients = new Set(agentEvidences.map((evidence) => normalizeClientName(evidence.client?.name)).filter(Boolean));
  assertCondition(agentEvidences.length >= 2, errors, "Strict M5 validation requires at least two external-agent evidence files.");
  assertCondition(agentClients.size >= 2, errors, "Strict M5 validation requires at least two distinct external-agent clients.");
  assertCondition(
    agentEvidences.some((evidence) => /codex/i.test(evidence.client?.name ?? "")),
    errors,
    "Strict M5 validation requires Codex external-agent evidence.",
  );
  assertCondition(
    agentEvidences.some((evidence) => /claude|cursor/i.test(evidence.client?.name ?? "")),
    errors,
    "Strict M5 validation requires Claude Desktop or Cursor external-agent evidence.",
  );
  assertCondition(
    agentEvidences.some((evidence) => evidence.client?.usesMcp === true),
    errors,
    "Strict M5 validation requires at least one MCP-backed external-agent evidence.",
  );

  const desktopSettings = byType.get("desktop-settings")?.[0];
  assertCondition(Boolean(desktopSettings), errors, "Strict M5 validation requires desktop-settings evidence.");

  const packagedEvidences = byType.get("packaged-platform") ?? [];
  const packagedPlatforms = new Set(
    packagedEvidences.map((evidence) => normalizePlatform(evidence.environment?.platform)),
  );
  for (const platform of ["macos", "windows", "linux"]) {
    assertCondition(
      packagedPlatforms.has(platform),
      errors,
      `Strict M5 validation requires packaged-platform evidence for ${platform}.`,
    );
  }

  for (const agentEvidence of agentEvidences) {
    assertCondition(
      Boolean(recordText) && recordText.toLowerCase().includes(String(agentEvidence.client?.name ?? "").toLowerCase()),
      errors,
      `Strict M5 record must reference external-agent evidence for ${agentEvidence.client?.name ?? "unknown"}.`,
    );
  }
  if (desktopSettings) {
    assertCondition(
      Boolean(recordText) &&
        (recordText.includes("desktop settings") || recordText.includes("desktop-settings") || recordText.includes("桌面设置页")),
      errors,
      "Strict M5 record must reference desktop settings evidence.",
    );
  }
  for (const packagedEvidence of packagedEvidences) {
    const platform = displayPlatform(packagedEvidence.environment?.platform);
    assertCondition(
      Boolean(recordText) && platform && recordText.toLowerCase().includes(String(platform).toLowerCase()),
      errors,
      `Strict M5 record must reference packaged-platform evidence for ${platform ?? "unknown"}.`,
    );
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

  const recordPath = options.recordPath
    ? resolveInputPath(options.recordPath)
    : workspaceRecordPath(workspace);
  const evidencePathInputs = options.evidencePaths.length > 0
    ? options.evidencePaths
    : workspaceEvidenceFiles(workspace);
  const resolvedEvidencePaths = evidencePathInputs.map(resolveInputPath);
  const evidencePaths = options.evidencePaths.length > 0
    ? resolvedEvidencePaths
    : await filterExistingPaths(resolvedEvidencePaths);

  if (!recordPath && evidencePaths.length === 0) {
    throw new Error("Pass --record <path>, --evidence <path>, or both.");
  }

  const errors = [];
  const warnings = [];
  const validated = {};
  let recordText;
  const evidences = [];

  if (recordPath) {
    recordText = await readFile(recordPath, "utf8");
    const result = validateRecord(recordText, { strictM5: options.strictM5 });
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    validated.record = recordPath;
  }

  for (const evidencePath of evidencePaths) {
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    const result = validateEvidence(evidence);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    evidences.push(evidence);
    validated.evidences = [...(validated.evidences ?? []), { path: evidencePath, type: evidenceType(evidence), label: evidenceLabel(evidence) }];
  }

  if (options.strictM5 && recordText && evidences.length === 0) {
    errors.push("Strict M5 validation requires evidence files.");
  }

  if (options.strictM5 && evidences.length > 0) {
    validateStrictM5EvidenceSet(recordText, evidences, errors);
  }

  const output = {
    ok: errors.length === 0,
    workspaceFile,
    strictM5: options.strictM5,
    validated,
    errors,
    warnings,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else if (output.ok) {
    process.stdout.write(
      `Acceptance validation passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.\n`,
    );
  } else {
    process.stderr.write(`Acceptance validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}\n`);
  }

  if (!output.ok) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
