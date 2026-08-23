import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterExistingPaths,
  loadWorkspaceConfig,
  resolveInputPath,
  workspaceAgentEvidencePath,
  workspaceDesktopPackage,
  workspaceDesktopSettingsPath,
  workspaceMilestone,
  workspacePackagedEvidencePath,
  workspaceRealSamplePath,
  workspaceRelease,
  workspaceRecordPath,
  workspaceReviewer,
} from "./acceptance-workspace.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = {
    evidencePath: undefined,
    packagedEvidencePaths: [],
    agentEvidencePaths: [],
    desktopEvidencePath: undefined,
    workspacePath: undefined,
    outputPath: undefined,
    milestone: "M5 acceptance draft",
    reviewer: "TBD",
    desktopPackage: "TBD",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--evidence") {
      options.evidencePath = next;
      index += 1;
    } else if (arg === "--packaged-evidence") {
      options.packagedEvidencePaths.push(next);
      index += 1;
    } else if (arg === "--agent-evidence") {
      options.agentEvidencePaths.push(next);
      index += 1;
    } else if (arg === "--desktop-evidence") {
      options.desktopEvidencePath = next;
      index += 1;
    } else if (arg === "--workspace") {
      options.workspacePath = next;
      index += 1;
    } else if (arg === "--output") {
      options.outputPath = next;
      index += 1;
    } else if (arg === "--milestone") {
      options.milestone = next;
      index += 1;
    } else if (arg === "--reviewer") {
      options.reviewer = next;
      index += 1;
    } else if (arg === "--desktop-package") {
      options.desktopPackage = next;
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
  return `ReadAny acceptance record scaffold

Usage:
  pnpm --filter @readany/cli acceptance:scaffold -- --evidence <real-sample.json> [options]

Options:
  --evidence <path>              acceptance:real JSON evidence.
  --packaged-evidence <path>     acceptance:packaged JSON evidence; repeatable.
  --agent-evidence <path>        acceptance:agent JSON evidence; repeatable.
  --desktop-evidence <path>      acceptance:desktop JSON evidence.
  --workspace <path>             Acceptance workspace root or workspace.json.
  --output <path>                Write Markdown record to this path; stdout when omitted.
  --milestone <name>             Milestone label.
  --reviewer <name>              Reviewer name.
  --desktop-package <source>     Desktop package source.
`;
}

function value(value, fallback = "TBD") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function firstCitationAnchor(evidence) {
  const target = evidence.citationTargets?.find((item) => item.type === "rag-chunk") ?? evidence.citationTargets?.[0];
  return target?.cfi ?? target?.startCfi ?? (target?.page ? `page:${target.page}` : "TBD");
}

function distributionAnchors(evidence) {
  const distribution = evidence.doctor?.distribution ?? {};
  return [
    `builtBundle: ${distribution.builtBundle === true ? "true" : "false"}`,
    `desktopResourceBundle: ${distribution.desktopResourceBundle === true ? "true" : "false"}`,
    `nativeBinary: ${distribution.nativeBinary === true ? "true" : "false"}`,
  ];
}

function packagedDistribution(packagedEvidence) {
  const distribution = packagedEvidence.doctor?.distribution ?? {};
  const summary = packagedEvidence.summary ?? {};
  return {
    builtBundle: distribution.builtBundle ?? summary.builtBundle,
    desktopResourceBundle: distribution.desktopResourceBundle ?? summary.desktopResourceBundle,
    nativeBinary: distribution.nativeBinary ?? summary.nativeBinary,
    usesNodeRuntime: distribution.usesNodeRuntime ?? summary.usesNodeRuntime,
  };
}

function flag(value) {
  return value === true ? "true" : "false";
}

function distributionText(packagedEvidence) {
  const distribution = packagedDistribution(packagedEvidence);
  return [
    `builtBundle: ${flag(distribution.builtBundle)}`,
    `desktopResourceBundle: ${flag(distribution.desktopResourceBundle)}`,
    `nativeBinary: ${flag(distribution.nativeBinary)}`,
    `usesNodeRuntime: ${flag(distribution.usesNodeRuntime)}`,
  ].join(" / ");
}

function normalizePlatform(platform) {
  const normalized = String(platform ?? "").trim().toLowerCase();
  if (["macos", "mac", "darwin"].includes(normalized)) return "macOS";
  if (["windows", "win32", "win"].includes(normalized)) return "Windows";
  if (normalized === "linux") return "Linux";
  return platform ? String(platform) : "TBD";
}

function packagedEvidenceByPlatform(packagedEvidences) {
  const rows = new Map();
  for (const packagedEvidence of packagedEvidences) {
    const platform = normalizePlatform(packagedEvidence.environment?.platform ?? packagedEvidence.summary?.platform);
    if (platform !== "TBD") {
      rows.set(platform, packagedEvidence);
    }
  }
  return rows;
}

function packagedSkillText(packagedEvidence) {
  return packagedEvidence.summary?.skillInstallChecked === true ? "install/status/uninstall pass" : "status pass";
}

function packagedMcpText(packagedEvidence) {
  const mcp = packagedEvidence.mcp ?? {};
  return [
    value(mcp.serverName, "readany"),
    `tools: ${value(mcp.toolCount)}`,
    `safety metadata: ${mcp.hasSafetyMetadata === true ? "yes" : "TBD"}`,
  ].join(" / ");
}

function packagedDraftExportText(packagedEvidence) {
  if (packagedEvidence.summary?.draftExportChecked !== true || packagedEvidence.draftExport?.checked !== true) {
    return "TBD";
  }
  const inspect = packagedEvidence.draftExport.exportedInspect ?? {};
  return [
    "export pass",
    `spine: ${value(inspect.spineCount)}`,
    `hash: ${value(packagedEvidence.draftExport.outputHash)}`,
  ].join(" / ");
}

function packageMatrixRows(packagedEvidences) {
  const byPlatform = packagedEvidenceByPlatform(packagedEvidences);
  return ["macOS", "Windows", "Linux"]
    .map((platform) => {
      const packagedEvidence = byPlatform.get(platform);
      if (!packagedEvidence) {
        return `| ${platform} |  |  |  |  |  |  |  |`;
      }
      const packageSource = value(packagedEvidence.environment?.packageSource ?? packagedEvidence.summary?.packageSource);
      return [
        `| ${platform}`,
        packageSource,
        "CLI executable checked; installer install TBD",
        distributionText(packagedEvidence),
        packagedSkillText(packagedEvidence),
        packagedMcpText(packagedEvidence),
        packagedDraftExportText(packagedEvidence),
        "partial |",
      ].join(" | ");
    })
    .join("\n");
}

function packagedAnchors(packagedEvidences) {
  return packagedEvidences.map((packagedEvidence) => {
    const platform = normalizePlatform(packagedEvidence.environment?.platform ?? packagedEvidence.summary?.platform);
    const packageSource = value(packagedEvidence.environment?.packageSource ?? packagedEvidence.summary?.packageSource);
    return `- packaged ${platform}：packageSource: ${packageSource} / ${distributionText(packagedEvidence)} / MCP ${packagedMcpText(packagedEvidence)} / draftExport ${packagedDraftExportText(packagedEvidence)}`;
  });
}

function agentClientLabel(agentEvidence) {
  return value(agentEvidence.client?.name);
}

function agentProfileText(agentEvidence) {
  const profile = value(agentEvidence.client?.profile);
  return agentEvidence.client?.usesMcp === true ? `${profile} / MCP` : `${profile} / CLI`;
}

function agentToolsText(agentEvidence) {
  if (agentEvidence.client?.usesMcp !== true) return "CLI flow; MCP not used";
  return [
    `tools: ${value(agentEvidence.mcp?.toolCount)}`,
    "captured",
  ].join(" / ");
}

function agentResultText(agentEvidence) {
  return agentEvidence.summary?.completed === true ? "manual evidence captured" : "partial";
}

function agentRows(agentEvidences) {
  const remainingPlaceholders = ["Codex", "Claude Desktop / Cursor"].filter((label) => (
    !agentEvidences.some((agentEvidence) => {
      const name = agentEvidence.client?.name ?? "";
      return label === "Codex" ? /codex/i.test(name) : /claude|cursor/i.test(name);
    })
  ));
  return [
    ...agentEvidences.map((agentEvidence) => [
      `| ${agentClientLabel(agentEvidence)}`,
      value(agentEvidence.client?.version),
      agentProfileText(agentEvidence),
      agentToolsText(agentEvidence),
      value(agentEvidence.flows?.read?.summary),
      value(agentEvidence.flows?.draftExport?.summary),
      `${agentResultText(agentEvidence)} |`,
    ].join(" | ")),
    ...remainingPlaceholders.map((label) => `| ${label} |  |  |  |  |  |  |`),
  ].join("\n");
}

function agentAnchors(agentEvidences) {
  return agentEvidences.map((agentEvidence) => [
    `- external agent ${agentClientLabel(agentEvidence)}：version: ${value(agentEvidence.client?.version)}`,
    `profile: ${value(agentEvidence.client?.profile)}`,
    `usesMcp: ${flag(agentEvidence.client?.usesMcp)}`,
    `tools: ${value(agentEvidence.mcp?.toolCount, agentEvidence.client?.usesMcp ? "TBD" : "not used")}`,
    `readonly denial: ${value(agentEvidence.flows?.readonlyDenial?.summary)}`,
  ].join(" / "));
}

function desktopSettingsText(desktopEvidence) {
  if (!desktopEvidence) return "TBD";
  const summary = desktopEvidence.summary ?? {};
  return [
    `CLI: ${summary.cliAvailable === true ? "available" : "TBD"}`,
    `Skill: ${summary.skillInstalled === true ? "installed" : "not installed"}`,
    `MCP: ${value(summary.mcpClient)}/${value(summary.mcpProfile)}`,
    `tools: ${value(summary.toolCount)}`,
    `source: ${value(summary.commandSource)}`,
  ].join(" / ");
}

function closureStatus(id, evidence, desktopEvidence) {
  if (id === "desktop-settings" && desktopEvidence?.summary?.completed === true) {
    return {
      status: "resolved",
      evidence: desktopSettingsText(desktopEvidence),
      owner: value(desktopEvidence.reviewer, "TBD"),
    };
  }
  return {
    status: "pending",
    evidence: evidence.evidence?.join("; ") ?? evidence.label,
    owner: "TBD",
  };
}

function sampleRows(evidence) {
  return (evidence.sampleFiles ?? [])
    .map((sample) => {
      const labels = Array.isArray(sample.labels) ? sample.labels.join(", ") : "";
      return `| ${value(sample.format)} | ${value(sample.title ?? sample.filePath)} | ${labels || "TBD"} | ${value(sample.sha256)} | TBD | ${labels || "sample"} |`;
    })
    .join("\n");
}

function closureRows(evidence, desktopEvidence) {
  return (evidence.manualAcceptanceRequired ?? [])
    .map((item) => {
      const closure = closureStatus(item.id, item, desktopEvidence);
      return `| ${item.id} | ${closure.status} | ${closure.evidence} | ${closure.owner} |`;
    })
    .join("\n");
}

function workspaceClosureCommandSuffix(workspace) {
  const parts = [];
  if (!workspaceRelease(workspace)) {
    parts.push("--release <release-label>");
  }
  if (!workspaceReviewer(workspace)) {
    parts.push("--reviewer <name>");
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function renderCommandBlock(options, workspaceFile, workspace) {
  if (workspaceFile) {
    const closureSuffix = workspaceClosureCommandSuffix(workspace);
    return `\`\`\`bash
pnpm --filter @readany/cli acceptance:status -- --workspace ${workspaceFile}
pnpm --filter @readany/cli acceptance:validate -- --workspace ${workspaceFile} --strict-m5
pnpm --filter @readany/cli acceptance:finalize -- --workspace ${workspaceFile}${closureSuffix}
pnpm --filter @readany/cli acceptance:assemble -- --workspace ${workspaceFile}${closureSuffix}
\`\`\``;
  }

  return `\`\`\`bash
pnpm --filter @readany/cli acceptance:real -- --evidence <evidence-json>
pnpm --filter @readany/cli acceptance:validate -- --record <acceptance-record.md> --evidence <evidence-json> --evidence <agent-evidence-json> --evidence <desktop-evidence-json> --evidence <macos-packaged-evidence-json> --evidence <windows-packaged-evidence-json> --evidence <linux-packaged-evidence-json> --strict-m5
pnpm --filter @readany/cli acceptance:finalize -- --record <acceptance-record.md> --evidence <evidence-json> --evidence <agent-evidence-json> --evidence <desktop-evidence-json> --evidence <macos-packaged-evidence-json> --evidence <windows-packaged-evidence-json> --evidence <linux-packaged-evidence-json> --release <release-label> --reviewer <name> --output <final-manifest.json>
pnpm --filter @readany/cli acceptance:assemble -- --record <acceptance-record.md> --evidence <evidence-json> --evidence <agent-evidence-json> --evidence <desktop-evidence-json> --evidence <macos-packaged-evidence-json> --evidence <windows-packaged-evidence-json> --evidence <linux-packaged-evidence-json> --release <release-label> --reviewer <name> --output-dir <acceptance-bundle-dir>
\`\`\``;
}

function renderRecord(evidence, options, packagedEvidences, agentEvidences, desktopEvidence, workspaceFile, workspace) {
  const sampleHash = evidence.sampleFiles?.[0]?.sha256 ?? "TBD";
  const citationAnchor = firstCitationAnchor(evidence);
  const distribution = distributionAnchors(evidence);
  const packagedAnchorRows = packagedAnchors(packagedEvidences);
  const agentAnchorRows = agentAnchors(agentEvidences);
  return `# ReadAny CLI Acceptance Record

## 基本信息

- 日期：${new Date().toISOString().slice(0, 10)}
- Milestone：${options.milestone}
- 分支：${value(evidence.environment?.gitBranch)}
- Commit：${value(evidence.environment?.gitCommit)}
- 验收人：${options.reviewer}
- 操作系统：${value(evidence.environment?.platform)} / ${value(evidence.environment?.arch)}
- Node 版本：${value(evidence.environment?.node)}
- pnpm 版本：${value(evidence.environment?.pnpm)}
- ReadAny CLI 版本：${value(evidence.environment?.cliVersion ?? evidence.doctor?.version)}
- 样本数据位置：${value(evidence.readanyHome)}
- 样本数据 hash：${sampleHash}
- 外部 agent 客户端：${agentEvidences.length > 0 ? agentEvidences.map(agentClientLabel).join(", ") : "TBD"}
- 桌面包来源：${options.desktopPackage}

## 本次验收范围

- [ ] CLI 基础命令
- [ ] Skill 安装 / 卸载
- [ ] readonly MCP
- [ ] 只读书库查询
- [ ] indexed chapters
- [ ] reader context snapshot
- [ ] RAG search
- [ ] EPUB draft
- [ ] EPUB export
- [ ] exported EPUB reimport / open
- [ ] 桌面设置页
- [ ] 外部 agent 接入
- [ ] macOS / Windows / Linux install matrix
- [ ] native binary / runtime bundle

## 本次明确不验收

- 当前为 scaffold，pending 项必须补证后才能改为通过。

## 执行命令

${renderCommandBlock(options, workspaceFile, workspace)}

## 验收结果

\`\`\`text
部分通过
\`\`\`

## 证据摘要

- evidence generatedAt：${value(evidence.generatedAt)}
- checks：${value(evidence.summary?.checkCount)}
- commands：${value(evidence.summary?.commandCount)}
- sample files：${value(evidence.summary?.sampleFileCount)}
- citation targets：${value(evidence.summary?.citationTargetCount)}
- sample SHA-256：${sampleHash}
- citation target：${citationAnchor}
- distribution：${distribution.join(" / ")}

## 安全边界证据

- readonly 写入拒绝：TBD
- 原始 EPUB hash 不变：TBD
- export 不覆盖源文件：TBD
- export 不覆盖已有文件：TBD
- Tauri allowlist：TBD
- MCP tools/list 与真实实现一致：TBD
- 桌面设置页：${desktopSettingsText(desktopEvidence)}

## 真实样本证据

样本清单：

| 类型 | 标题 / 文件 | 来源 | SHA-256 | 是否可公开 | 用途 |
| --- | --- | --- | --- | --- | --- |
${sampleRows(evidence)}

端到端结果：

- EPUB inspect：TBD
- EPUB draft edit：TBD
- EPUB validate：TBD
- EPUB export：TBD
- 导出 EPUB 重新导入或标准 EPUB 工具打开：TBD
- PDF \`chapters.list/get\` fallback：TBD
- RAG result 引用字段：${citationAnchor}
- 桌面端引用点击回跳：TBD

## 外部 Agent 证据

| 客户端 | 版本 | MCP 配置 profile | tools/list | read flow | draft/export flow | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
${agentRows(agentEvidences)}

必须附：

- MCP config 片段，不含密钥。
- \`tools/list\` 是否只包含真实实现工具。
- readonly 写入拒绝截图或日志摘要。
- editor draft 修改摘要。
- publisher validate/export 摘要。

## 打包 / 安装矩阵

| 平台 | 包来源 | 安装 | \`readany doctor --json\` | Skill install/status | MCP initialize/tools/list | Draft export | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${packageMatrixRows(packagedEvidences)}

## Manual Acceptance Closure

| id | status | evidence | owner |
| --- | --- | --- | --- |
${closureRows(evidence, desktopEvidence)}

## Evidence Anchors

- sample SHA-256：${sampleHash}
- citation target：${citationAnchor}
${distribution.map((item) => `- distribution：${item}`).join("\n")}
${agentAnchorRows.length > 0 ? agentAnchorRows.join("\n") : "- external agent evidence：TBD"}
${desktopEvidence ? `- desktop settings：${desktopSettingsText(desktopEvidence)}` : "- desktop settings evidence：TBD"}
${packagedAnchorRows.length > 0 ? packagedAnchorRows.join("\n") : "- packaged evidence：TBD"}

## 当前可对外说明

- TBD

## 当前不能对外宣称

- 该记录仍是 scaffold，不能作为 M5 完成记录。

## 已知问题

- TBD

## 是否允许进入下一阶段

- [ ] 是
- [x] 否

原因：scaffold 仍含 pending/TBD 项，需补齐人工验收和 strict M5 校验。
`;
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
    options.milestone = options.milestone === "M5 acceptance draft"
      ? workspaceMilestone(workspace) ?? options.milestone
      : options.milestone;
    options.reviewer = options.reviewer === "TBD"
      ? workspaceReviewer(workspace) ?? options.reviewer
      : options.reviewer;
    options.desktopPackage = options.desktopPackage === "TBD"
      ? workspaceDesktopPackage(workspace) ?? options.desktopPackage
      : options.desktopPackage;
  }

  const realSamplePath = options.evidencePath
    ? resolveInputPath(options.evidencePath)
    : workspaceRealSamplePath(workspace)
      ? resolveInputPath(workspaceRealSamplePath(workspace))
      : undefined;
  if (!realSamplePath) throw new Error("Pass --evidence <path> or use --workspace <path> with a real-sample evidence file.");

  const outputPath = options.outputPath
    ? resolveInputPath(options.outputPath)
    : workspaceRecordPath(workspace);
  const packagedEvidencePaths = options.packagedEvidencePaths.length > 0
    ? options.packagedEvidencePaths.map(resolveInputPath)
    : await filterExistingPaths(
        ["macos", "windows", "linux"]
          .map((platform) => workspacePackagedEvidencePath(workspace, platform))
          .filter(Boolean)
          .map(resolveInputPath),
      );
  const agentEvidencePaths = options.agentEvidencePaths.length > 0
    ? options.agentEvidencePaths.map(resolveInputPath)
    : await filterExistingPaths(
        [
          workspaceAgentEvidencePath(workspace, "codex"),
          workspaceAgentEvidencePath(workspace, "claude"),
        ]
          .filter(Boolean)
          .map(resolveInputPath),
      );
  const desktopEvidencePath = options.desktopEvidencePath
    ? resolveInputPath(options.desktopEvidencePath)
    : (await filterExistingPaths(
        [workspaceDesktopSettingsPath(workspace)]
          .filter(Boolean)
          .map(resolveInputPath),
      ))[0];

  const evidencePath = realSamplePath;
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const packagedEvidences = await Promise.all(
    packagedEvidencePaths.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
  );
  const agentEvidences = await Promise.all(
    agentEvidencePaths.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
  );
  const desktopEvidence = desktopEvidencePath
    ? JSON.parse(await readFile(desktopEvidencePath, "utf8"))
    : undefined;
  const record = renderRecord(evidence, options, packagedEvidences, agentEvidences, desktopEvidence, workspaceFile, workspace);
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, record, "utf8");
    process.stdout.write(`${JSON.stringify({ ok: true, workspaceFile, outputPath }, null, 2)}\n`);
  } else {
    process.stdout.write(record);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
