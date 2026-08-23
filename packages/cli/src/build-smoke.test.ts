import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { seedLibrary } from "../scripts/agent-smoke.mjs";

const cliRoot = resolve(import.meta.dirname, "..");
const binPath = resolve(cliRoot, "dist/bin/readany.js");

function runBuiltCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: cliRoot,
    env,
    encoding: "utf8",
  });
}

function runBuiltMcp(requests: unknown[], env: NodeJS.ProcessEnv): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, "mcp", "serve", "--profile", "readonly"], {
      cwd: cliRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`MCP smoke exited with ${code}: ${Buffer.concat(stderr).toString("utf8")}`),
        );
        return;
      }

      try {
        const lines = Buffer.concat(stdout).toString("utf8").trim().split("\n").filter(Boolean);
        resolve(lines.map((line) => JSON.parse(line)));
      } catch (error) {
        reject(error);
      }
    });

    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
    child.stdin.end();
  });
}

describe("built CLI smoke", () => {
  beforeAll(() => {
    const result = spawnSync(process.execPath, [resolve(cliRoot, "scripts/build.mjs")], {
      cwd: cliRoot,
      encoding: "utf8",
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it("runs management commands without loading better-sqlite3", async () => {
    const root = await mkdtemp(join(tmpdir(), "readany-cli-built-smoke-"));
    const blockBetterSqlite = join(root, "block-better-sqlite.cjs");
    await writeFile(
      blockBetterSqlite,
      `
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "better-sqlite3") {
    throw new Error("better-sqlite3 should not be loaded for management commands");
  }
  return originalLoad.call(this, request, parent, isMain);
};
`,
      "utf8",
    );

    const env = {
      ...process.env,
      NODE_OPTIONS: `--require ${blockBetterSqlite}`,
      READANY_HOME: join(root, "readany-home"),
      AGENT_HOME: join(root, "agent"),
    };

    const version = runBuiltCli(["--version"], env);
    expect(version.status, version.stderr).toBe(0);
    expect(version.stdout.trim()).toBe("0.1.0");

    const status = runBuiltCli(["skill", "status", "--json"], env);
    expect(status.status, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      ok: true,
      data: { installed: false },
    });

    const doctor = runBuiltCli(["doctor", "--json"], env);
    expect(doctor.status, doctor.stderr).toBe(0);
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      ok: true,
      data: {
        version: "0.1.0",
        runtime: {
          node: expect.stringMatching(/^v/),
          executable: process.execPath,
          nativeSqliteAvailable: true,
          nativeSqlitePath: expect.stringContaining("better-sqlite3"),
        },
        distribution: {
          kind: "node-script",
          usesNodeRuntime: true,
          nativeBinary: false,
          entrypoint: binPath,
          modulePath: binPath,
          bundleRoot: resolve(cliRoot, "dist"),
          builtBundle: true,
          desktopResourceBundle: false,
        },
        tools: { count: 27 },
        mcp: {
          defaultProfile: "readonly",
          serveArgs: ["mcp", "serve", "--profile", "readonly"],
          supportedProfiles: ["readonly", "assistant", "editor", "publisher"],
          supportedClients: ["generic", "claude", "cursor", "codex", "opencode"],
          toolCount: 27,
        },
      },
    });

    const mcpConfig = runBuiltCli(["mcp", "config", "--json"], env);
    expect(mcpConfig.status, mcpConfig.stderr).toBe(0);
    expect(JSON.parse(mcpConfig.stdout)).toMatchObject({
      ok: true,
      data: {
        client: "generic",
        format: "json",
        profile: "readonly",
        snippet: expect.stringContaining('"mcpServers"'),
        mcpServers: {
          readany: {
            command: process.execPath,
            args: [
              expect.stringMatching(
                /readany\.(js|ts|cmd)$|dist\/bin\/readany\.js|src\/bin\/readany\.ts/,
              ),
              "mcp",
              "serve",
              "--profile",
              "readonly",
            ],
          },
        },
      },
    });
    const codexConfig = runBuiltCli(["mcp", "config", "--client", "codex", "--json"], env);
    expect(codexConfig.status, codexConfig.stderr).toBe(0);
    expect(JSON.parse(codexConfig.stdout)).toMatchObject({
      ok: true,
      data: {
        client: "codex",
        format: "toml",
        profile: "readonly",
        snippet: expect.stringContaining("[mcp_servers.readany]"),
      },
    });
    const opencodeConfig = runBuiltCli(["mcp", "config", "--client", "opencode", "--json"], env);
    expect(opencodeConfig.status, opencodeConfig.stderr).toBe(0);
    expect(JSON.parse(opencodeConfig.stdout)).toMatchObject({
      ok: true,
      data: {
        client: "opencode",
        format: "json",
        profile: "readonly",
        mcp: {
          readany: {
            type: "local",
            command: [
              process.execPath,
              expect.stringMatching(
                /readany\.(js|ts|cmd)$|dist\/bin\/readany\.js|src\/bin\/readany\.ts/,
              ),
              "mcp",
              "serve",
              "--profile",
              "readonly",
            ],
            enabled: true,
          },
        },
      },
    });

    const tools = runBuiltCli(["tools", "list", "--json"], env);
    expect(tools.status, tools.stderr).toBe(0);
    expect(JSON.parse(tools.stdout)).toMatchObject({
      ok: true,
      data: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "books.list" }),
          expect.objectContaining({ name: "epub.export" }),
        ]),
      },
    });

    const install = runBuiltCli(["skill", "install", "--json"], env);
    expect(install.status, install.stderr).toBe(0);
    expect(JSON.parse(install.stdout)).toMatchObject({
      ok: true,
      data: { installed: true, version: "0.1.0" },
    });

    const update = runBuiltCli(["skill", "update", "--json"], env);
    expect(update.status, update.stderr).toBe(0);
    expect(JSON.parse(update.stdout)).toMatchObject({
      ok: true,
      data: { updated: true, version: "0.1.0" },
    });

    const installedStatus = runBuiltCli(["skill", "status", "--json"], env);
    expect(installedStatus.status, installedStatus.stderr).toBe(0);
    expect(JSON.parse(installedStatus.stdout)).toMatchObject({
      ok: true,
      data: { installed: true, version: "0.1.0" },
    });

    const uninstall = runBuiltCli(["skill", "uninstall", "--json"], env);
    expect(uninstall.status, uninstall.stderr).toBe(0);
    expect(JSON.parse(uninstall.stdout)).toMatchObject({
      ok: true,
      data: { removed: true },
    });
  });

  it("serves MCP over stdio from the built CLI", async () => {
    const root = await mkdtemp(join(tmpdir(), "readany-cli-built-mcp-"));
    const env = {
      ...process.env,
      READANY_HOME: join(root, "readany-home"),
      AGENT_HOME: join(root, "agent"),
    };
    const responses = await runBuiltMcp(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "books.list",
            arguments: { limit: 1 },
          },
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "epub.export",
            arguments: {
              draftId: "draft-smoke",
              outputPath: join(root, "exports", "blocked.epub"),
            },
          },
        },
      ],
      env,
    );

    expect(responses).toHaveLength(4);
    expect(responses[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "readany" } },
    });
    expect(responses[1]).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: [
          { name: "books.list" },
          { name: "books.search" },
          { name: "books.get" },
          { name: "chapters.list" },
          { name: "chapters.get" },
          { name: "context.get" },
          { name: "bookmarks.list" },
          { name: "skills.list" },
          { name: "notes.search" },
          { name: "notes.export" },
          { name: "knowledge.export" },
          { name: "knowledge.search" },
          { name: "highlights.search" },
          { name: "rag.search" },
          { name: "epub.inspect" },
          { name: "epub.draft.create" },
          { name: "epub.draft.discard" },
          { name: "epub.chapter.read" },
          { name: "epub.chapter.patch" },
          { name: "epub.chapters.patch" },
          { name: "epub.metadata.patch" },
          { name: "epub.toc.rebuild" },
          { name: "epub.history" },
          { name: "epub.diff" },
          { name: "epub.undo" },
          { name: "epub.validate" },
          { name: "epub.export" },
        ],
      },
    });
    expect(responses[2]).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        isError: false,
      },
    });

    const toolResult = JSON.parse(
      (responses[2] as { result: { content: Array<{ text: string }> } }).result.content[0].text,
    );
    expect(toolResult).toMatchObject({
      ok: true,
      data: { books: [] },
    });

    expect(responses[3]).toMatchObject({
      jsonrpc: "2.0",
      id: 4,
      result: {
        isError: true,
      },
    });
    const deniedResult = JSON.parse(
      (responses[3] as { result: { content: Array<{ text: string }> } }).result.content[0].text,
    );
    expect(deniedResult).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });
  });

  it("runs the external agent MCP smoke workflow", () => {
    const result = spawnSync(process.execPath, [resolve(cliRoot, "scripts/agent-smoke.mjs")], {
      cwd: cliRoot,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout) as {
      ok: boolean;
      checks: string[];
      exportPath: string;
      sourceHash: string;
      exportHash: string;
    };
    expect(summary).toMatchObject({
      ok: true,
      checks: expect.arrayContaining([
        "readonly MCP initialize/tools/list/books.search/rag.search",
        "copyable MCP config snippets",
        "tools/list safety metadata",
        "readonly PDF fallback chapters.list/chapters.get",
        "readonly write denial",
        "editor draft create, batch chapter patch, and toc rebuild",
        "publisher validate and export",
        "source EPUB hash unchanged",
        "exported EPUB reimport inspect and chapter reads",
      ]),
      exportPath: expect.stringMatching(/agent-smoke-export\.epub$/),
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      exportHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("runs real-sample acceptance helper against fixture data", async () => {
    const root = await mkdtemp(join(tmpdir(), "readany-cli-real-acceptance-"));
    const dataRoot = join(root, "library");
    const env = {
      ...process.env,
      READANY_HOME: dataRoot,
      AGENT_HOME: join(root, "agent"),
    };
    expect(runBuiltCli(["doctor", "--json"], env).status).toBe(0);
    expect(runBuiltCli(["books", "list", "--json"], env).status).toBe(0);
    await seedLibrary(dataRoot);

    const evidencePath = join(root, "evidence", "real-sample.json");
    const exportDir = join(root, "exports");
    const result = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/real-sample-acceptance.mjs"),
        "--readany-home",
        dataRoot,
        "--book",
        "agent-smoke-book",
        "--epub-book",
        "agent-smoke-book",
        "--pdf-book",
        "agent-smoke-pdf",
        "--rag-query",
        "bounded MCP",
        "--draft-export",
        "--export-dir",
        exportDir,
        "--evidence",
        evidencePath,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      checks: string[];
      evidencePath: string;
      summary: {
        commandCount: number;
        checkCount: number;
        sampleFileCount: number;
        sampleFormats: string[];
        citationTargetCount: number;
        citationTargetTypes: string[];
        draftExport: boolean;
        pdfChecked: boolean;
        doctorFailedChecks: string[];
        manualAcceptanceRequiredCount: number;
        manualAcceptanceRequiredIds: string[];
      };
    };
    expect(output).toMatchObject({
      ok: true,
      evidencePath,
      checks: expect.arrayContaining([
        "doctor runtime and MCP diagnostics",
        "books.list contains primary real sample",
        "chapter.get primary sample",
        "rag.search primary sample",
        "epub.inspect real sample",
        "epub.export real sample draft",
        "epub.export inspect real sample output",
        "epub.draft.discard real sample cleanup",
        "pdf chapter.get real sample",
      ]),
      summary: {
        commandCount: expect.any(Number),
        checkCount: expect.any(Number),
        sampleFileCount: 2,
        sampleFormats: expect.arrayContaining(["epub", "pdf"]),
        citationTargetCount: expect.any(Number),
        citationTargetTypes: expect.arrayContaining(["chapter", "rag-chunk", "pdf-page"]),
        draftExport: true,
        pdfChecked: true,
        doctorFailedChecks: expect.any(Array),
        manualAcceptanceRequiredCount: 6,
        manualAcceptanceRequiredIds: expect.arrayContaining([
          "external-agent-clients",
          "packaged-app-matrix",
          "runtime-bundle",
        ]),
      },
    });

    const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as {
      environment: {
        platform: string;
        arch: string;
        node: string;
        pnpm: string;
        cliVersion: string;
        gitCommit: string;
        gitBranch: string;
      };
      doctor: {
        version: string;
        runtime: {
          node: string;
          executable: string;
          nativeSqliteAvailable: boolean;
        };
        distribution: {
          kind: string;
          usesNodeRuntime: boolean;
          nativeBinary: boolean;
          entrypoint?: string;
          modulePath: string;
          bundleRoot?: string;
          builtBundle: boolean;
          desktopResourceBundle: boolean;
        };
        tools: {
          count: number;
        };
        mcp: {
          defaultProfile: string;
          serveArgs: string[];
          supportedProfiles: string[];
          supportedClients: string[];
          toolCount: number;
        };
        checks: Array<{
          name: string;
          ok: boolean;
          message: string;
        }>;
      };
      sampleFiles: Array<{
        labels: string[];
        bookId: string;
        format: string;
        filePath: string;
        absoluteFilePath: string;
        bytes: number;
        sha256: string;
      }>;
      citationTargets: Array<{
        type: string;
        bookId: string;
        chapterId?: string;
        chunkId?: string;
        chapterIndex?: number;
        chapterTitle?: string;
        page?: number;
        cfi?: string;
        startCfi?: string;
        endCfi?: string;
        source?: string;
        matchType?: string;
      }>;
      summary: typeof output.summary;
      manualAcceptanceRequired: Array<{
        id: string;
        label: string;
        evidence: string[];
        commands: string[];
      }>;
    };
    expect(evidence.environment).toMatchObject({
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cliVersion: "0.1.0",
      gitCommit: expect.stringMatching(/^unavailable|[a-f0-9]{40}$/),
      gitBranch: expect.any(String),
      pnpm: expect.any(String),
    });
    expect(evidence.doctor).toMatchObject({
      version: "0.1.0",
      runtime: {
        node: process.version,
        executable: process.execPath,
        nativeSqliteAvailable: true,
      },
      distribution: {
        kind: "node-script",
        usesNodeRuntime: true,
        nativeBinary: false,
        entrypoint: binPath,
        modulePath: binPath,
        bundleRoot: resolve(cliRoot, "dist"),
        builtBundle: true,
        desktopResourceBundle: false,
      },
      tools: { count: 27 },
      mcp: {
        defaultProfile: "readonly",
        serveArgs: ["mcp", "serve", "--profile", "readonly"],
        supportedProfiles: ["readonly", "assistant", "editor", "publisher"],
        supportedClients: ["generic", "claude", "cursor", "codex", "opencode"],
        toolCount: 27,
      },
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "node-runtime", ok: true }),
        expect.objectContaining({ name: "native-sqlite", ok: true }),
      ]),
    });
    expect(evidence.summary).toEqual(output.summary);
    expect(evidence.summary.commandCount).toBe(evidence.commands.length);
    expect(evidence.summary.checkCount).toBe(evidence.checks.length);
    expect(evidence.summary.citationTargetCount).toBe(evidence.citationTargets.length);
    expect(evidence.citationTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "chapter",
          bookId: "agent-smoke-book",
          chapterId: expect.any(String),
          startCfi: expect.stringMatching(/^epubcfi/),
        }),
        expect.objectContaining({
          type: "rag-chunk",
          bookId: "agent-smoke-book",
          chunkId: expect.any(String),
          cfi: expect.stringMatching(/^epubcfi/),
          startCfi: expect.stringMatching(/^epubcfi/),
          matchType: "bm25",
        }),
        expect.objectContaining({
          type: "pdf-page",
          bookId: "agent-smoke-pdf",
          chapterId: "page-1",
          page: 1,
          cfi: "page:1",
          source: "pdf",
        }),
      ]),
    );
    expect(evidence.sampleFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: expect.arrayContaining(["primary", "epub"]),
          bookId: "agent-smoke-book",
          format: "epub",
          filePath: "books/agent-smoke.epub",
          absoluteFilePath: join(dataRoot, "books", "agent-smoke.epub"),
          bytes: expect.any(Number),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          labels: ["pdf"],
          bookId: "agent-smoke-pdf",
          format: "pdf",
          filePath: "books/agent-smoke.pdf",
          absoluteFilePath: join(dataRoot, "books", "agent-smoke.pdf"),
          bytes: expect.any(Number),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );
    expect(evidence.sampleFiles.every((sample) => sample.bytes > 0)).toBe(true);
    expect(evidence.manualAcceptanceRequired).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "external-agent-clients" }),
        expect.objectContaining({ id: "packaged-app-matrix" }),
        expect.objectContaining({ id: "runtime-bundle" }),
      ]),
    );
    expect(evidence.manualAcceptanceRequired).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "external-agent-clients",
          evidence: expect.arrayContaining(["tools/list output"]),
          commands: expect.arrayContaining([
            "readany mcp config --client codex --profile readonly --json",
          ]),
        }),
        expect.objectContaining({
          id: "runtime-bundle",
          evidence: expect.arrayContaining(["nativeSqliteAvailable and nativeSqlitePath"]),
          commands: expect.arrayContaining(["readany doctor --json"]),
        }),
      ]),
    );

    const validateEvidence = spawnSync(
      process.execPath,
      [resolve(cliRoot, "scripts/validate-acceptance.mjs"), "--evidence", evidencePath, "--json"],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(validateEvidence.status, validateEvidence.stderr).toBe(0);
    expect(JSON.parse(validateEvidence.stdout)).toMatchObject({
      ok: true,
      validated: {
        evidences: [expect.objectContaining({ path: evidencePath, type: "real-sample" })],
      },
      errors: [],
    });

    const packagedEvidencePath = join(root, "evidence", "packaged-platform.json");
    const packagedExportDir = join(root, "packaged-exports");
    const packagedRepairBinDir = join(root, "packaged-bin");
    const packaged = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/packaged-platform-acceptance.mjs"),
        "--cli",
        binPath,
        "--package-source",
        "fixture packaged cli",
        "--platform",
        "macOS",
        "--readany-home",
        dataRoot,
        "--agent-home",
        join(root, "packaged-agent"),
        "--repair-bin-dir",
        packagedRepairBinDir,
        "--with-skill-install",
        "--draft-export",
        "--book",
        "agent-smoke-book",
        "--export-dir",
        packagedExportDir,
        "--evidence",
        packagedEvidencePath,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(packaged.status, packaged.stderr).toBe(0);
    expect(JSON.parse(packaged.stdout)).toMatchObject({
      ok: true,
      evidencePath: packagedEvidencePath,
      summary: {
        platform: "macOS",
        packageSource: "fixture packaged cli",
        commandCount: 15,
        checkCount: 16,
        skillInstallChecked: true,
        repairChecked: true,
        builtBundle: true,
        desktopResourceBundle: false,
        nativeBinary: false,
        usesNodeRuntime: true,
        draftExportChecked: true,
      },
      manualAcceptanceRequired: expect.arrayContaining(["desktop-settings", "draft-export"]),
    });
    const packagedEvidence = JSON.parse(await readFile(packagedEvidencePath, "utf8")) as {
      environment: {
        evidenceType: string;
        platform: string;
        packageSource: string;
        cliPath: string;
      };
      doctor: typeof evidence.doctor;
      mcp: {
        serverName: string;
        toolCount: number;
        hasSafetyMetadata: boolean;
      };
      summary: {
        commandCount: number;
        checkCount: number;
        skillInstallChecked: boolean;
        repairChecked: boolean;
        builtBundle: boolean;
        draftExportChecked: boolean;
      };
      draftExport: {
        checked: boolean;
        bookId: string;
        outputPath: string;
        outputBytes: number;
        outputHash: string;
        exportedInspect: {
          spineCount: number;
        };
      };
      commands: Array<{ name: string; ok: boolean }>;
    };
    expect(packagedEvidence.environment).toMatchObject({
      evidenceType: "packaged-platform",
      platform: "macOS",
      packageSource: "fixture packaged cli",
      cliPath: binPath,
    });
    expect(packagedEvidence.doctor.distribution).toMatchObject({
      builtBundle: true,
      desktopResourceBundle: false,
      nativeBinary: false,
      usesNodeRuntime: true,
    });
    expect(packagedEvidence.mcp).toMatchObject({
      serverName: "readany",
      toolCount: 27,
      hasSafetyMetadata: true,
    });
    expect(packagedEvidence.summary).toMatchObject({
      repairChecked: true,
      draftExportChecked: true,
    });
    expect(packagedEvidence.draftExport).toMatchObject({
      checked: true,
      bookId: "agent-smoke-book",
      outputPath: expect.stringContaining(packagedExportDir),
      outputBytes: expect.any(Number),
      outputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      exportedInspect: {
        spineCount: expect.any(Number),
      },
    });
    expect(packagedEvidence.draftExport.outputBytes).toBeGreaterThan(0);
    expect(packagedEvidence.draftExport.exportedInspect.spineCount).toBeGreaterThan(0);
    expect(packagedEvidence.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "doctor", ok: true }),
        expect.objectContaining({ name: "repair", ok: true }),
        expect.objectContaining({ name: "mcp.initialize.tools.list", ok: true }),
        expect.objectContaining({ name: "skill.install", ok: true }),
        expect.objectContaining({ name: "skill.uninstall", ok: true }),
        expect.objectContaining({ name: "epub.draft.create", ok: true }),
        expect.objectContaining({ name: "epub.validate", ok: true }),
        expect.objectContaining({ name: "epub.export", ok: true }),
        expect.objectContaining({ name: "epub.draft.discard", ok: true }),
      ]),
    );

    const validatePackagedEvidence = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--evidence",
        packagedEvidencePath,
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(validatePackagedEvidence.status, validatePackagedEvidence.stderr).toBe(0);
    expect(JSON.parse(validatePackagedEvidence.stdout)).toMatchObject({
      ok: true,
      validated: {
        evidences: [
          expect.objectContaining({ path: packagedEvidencePath, type: "packaged-platform" }),
        ],
      },
      errors: [],
      warnings: expect.arrayContaining([
        "Packaged evidence validates one platform only; strict M5 still requires macOS/Windows/Linux matrix rows.",
      ]),
    });

    const codexAgentEvidencePath = join(root, "evidence", "agent-codex.json");
    const codexAgent = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/agent-acceptance.mjs"),
        "--client",
        "Codex",
        "--client-version",
        "fixture-1.0.0",
        "--profile",
        "readonly/editor/publisher",
        "--uses-mcp",
        "--mcp-config-text",
        JSON.stringify({
          mcpServers: {
            readany: {
              command: process.execPath,
              args: [binPath, "mcp", "serve", "--profile", "readonly"],
            },
          },
        }),
        "--tools-list-summary",
        "readany tools/list captured 27 tools with risk scopes and minimumProfile metadata",
        "--tool-count",
        "27",
        "--read-flow",
        "books.search, chapters.get, and rag.search returned bounded ReadAny results",
        "--readonly-denial",
        "readonly epub.export returned permission_denied before any draft output",
        "--draft-export-flow",
        "editor draft patch and publisher export completed to a new EPUB path",
        "--evidence",
        codexAgentEvidencePath,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(codexAgent.status, codexAgent.stderr).toBe(0);
    expect(JSON.parse(codexAgent.stdout)).toMatchObject({
      ok: true,
      outputPath: codexAgentEvidencePath,
      client: "Codex",
      usesMcp: true,
    });

    const claudeAgentEvidencePath = join(root, "evidence", "agent-claude.json");
    const claudeAgent = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/agent-acceptance.mjs"),
        "--client",
        "Claude Desktop",
        "--client-version",
        "fixture-2.0.0",
        "--profile",
        "readonly/editor/publisher",
        "--read-flow",
        "CLI-backed client prompt listed books and read a chapter through the installed readany command",
        "--readonly-denial",
        "readonly write attempt was refused with permission_denied",
        "--draft-export-flow",
        "agent requested draft edit and export only after profile elevation was confirmed",
        "--evidence",
        claudeAgentEvidencePath,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(claudeAgent.status, claudeAgent.stderr).toBe(0);
    expect(JSON.parse(claudeAgent.stdout)).toMatchObject({
      ok: true,
      outputPath: claudeAgentEvidencePath,
      client: "Claude Desktop",
      usesMcp: false,
    });

    const codexAgentEvidence = JSON.parse(await readFile(codexAgentEvidencePath, "utf8")) as {
      environment: { evidenceType: string };
      client: { name: string; version: string; profile: string; usesMcp: boolean };
      mcp: { toolCount?: number; configRedacted?: string; toolsListSummary?: string };
      flows: {
        read: { summary: string };
        readonlyDenial: { summary: string };
        draftExport: { summary: string };
      };
      summary: { completed: boolean; usesMcp: boolean };
    };
    expect(codexAgentEvidence).toMatchObject({
      environment: { evidenceType: "external-agent" },
      client: {
        name: "Codex",
        version: "fixture-1.0.0",
        profile: "readonly/editor/publisher",
        usesMcp: true,
      },
      mcp: {
        toolCount: 27,
        configRedacted: expect.stringContaining("readany"),
        toolsListSummary: expect.stringContaining("minimumProfile"),
      },
      flows: {
        readonlyDenial: {
          summary: expect.stringContaining("permission_denied"),
        },
      },
      summary: {
        completed: true,
        usesMcp: true,
      },
    });

    for (const agentEvidencePath of [codexAgentEvidencePath, claudeAgentEvidencePath]) {
      const validateAgentEvidence = spawnSync(
        process.execPath,
        [
          resolve(cliRoot, "scripts/validate-acceptance.mjs"),
          "--evidence",
          agentEvidencePath,
          "--json",
        ],
        {
          cwd: cliRoot,
          env,
          encoding: "utf8",
        },
      );
      expect(validateAgentEvidence.status, validateAgentEvidence.stderr).toBe(0);
      expect(JSON.parse(validateAgentEvidence.stdout)).toMatchObject({
        ok: true,
        validated: {
          evidences: [expect.objectContaining({ path: agentEvidencePath, type: "external-agent" })],
        },
        errors: [],
        warnings: expect.arrayContaining([
          "External agent evidence validates one client only; strict M5 still requires multiple completed client rows in the record.",
        ]),
      });
    }

    const desktopSnapshotPath = join(root, "evidence", "desktop-settings-snapshot.json");
    await writeFile(
      desktopSnapshotPath,
      JSON.stringify(
        {
          generatedAt: "2026-06-17T00:00:00.000Z",
          cli: {
            available: true,
            version: "0.1.0",
            source: "fixture bundled CLI",
          },
          doctor: evidence.doctor,
          skill: {
            installed: true,
            path: join(root, "agent", "skills", "readany", "SKILL.md"),
            version: "0.1.0",
          },
          mcp: {
            profile: "readonly",
            client: "codex",
            config: {
              mcpServers: {
                readany: {
                  command: process.execPath,
                  args: [
                    expect.stringMatching(
                      /readany\.(js|ts|cmd)$|dist\/bin\/readany\.js|src\/bin\/readany\.ts/,
                    ),
                    "mcp",
                    "serve",
                    "--profile",
                    "readonly",
                  ],
                },
              },
            },
          },
          tools: Array.from({ length: 27 }, (_, index) => ({
            name: `readany.fixture.${index + 1}`,
            risk: index % 3 === 0 ? "write" : "read",
          })),
          lastAction: {
            action: "tools_list",
            ok: true,
            command: "readany tools list --json",
            command_source: "fixture bundled CLI",
            status: 0,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const desktopEvidencePath = join(root, "evidence", "desktop-settings.json");
    const desktopEvidenceResult = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/desktop-settings-acceptance.mjs"),
        "--snapshot",
        desktopSnapshotPath,
        "--screenshot",
        "docs/readany-cli/acceptance/screenshots/desktop-settings-fixture.png",
        "--reviewer",
        "Vitest",
        "--notes",
        "Fixture desktop settings snapshot captured through copy evidence flow.",
        "--evidence",
        desktopEvidencePath,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(desktopEvidenceResult.status, desktopEvidenceResult.stderr).toBe(0);
    expect(JSON.parse(desktopEvidenceResult.stdout)).toMatchObject({
      ok: true,
      outputPath: desktopEvidencePath,
      summary: {
        cliAvailable: true,
        skillInstalled: true,
        mcpProfile: "readonly",
        mcpClient: "codex",
        toolCount: 27,
        commandSource: "fixture bundled CLI",
      },
    });
    const desktopEvidence = JSON.parse(await readFile(desktopEvidencePath, "utf8")) as {
      environment: { evidenceType: string };
      snapshot: {
        doctor: typeof evidence.doctor;
        skill: { installed: boolean };
        mcp: { profile: string; client: string; hasConfig: boolean };
        tools: { count: number };
      };
      summary: {
        completed: boolean;
        cliAvailable: boolean;
        skillInstalled: boolean;
        toolCount: number;
      };
    };
    expect(desktopEvidence).toMatchObject({
      environment: { evidenceType: "desktop-settings" },
      snapshot: {
        skill: { installed: true },
        mcp: { profile: "readonly", client: "codex", hasConfig: true },
        tools: { count: 27 },
      },
      summary: {
        completed: true,
        cliAvailable: true,
        skillInstalled: true,
        toolCount: 27,
      },
    });

    const validateDesktopEvidence = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--evidence",
        desktopEvidencePath,
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(validateDesktopEvidence.status, validateDesktopEvidence.stderr).toBe(0);
    expect(JSON.parse(validateDesktopEvidence.stdout)).toMatchObject({
      ok: true,
      validated: {
        evidences: [
          expect.objectContaining({ path: desktopEvidencePath, type: "desktop-settings" }),
        ],
      },
      errors: [],
      warnings: expect.arrayContaining([
        "Desktop settings evidence validates the settings page snapshot only; strict M5 still requires final record closure.",
      ]),
    });

    const scaffoldPath = join(root, "evidence", "scaffold-record.md");
    const scaffold = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/scaffold-acceptance-record.mjs"),
        "--evidence",
        evidencePath,
        "--packaged-evidence",
        packagedEvidencePath,
        "--agent-evidence",
        codexAgentEvidencePath,
        "--agent-evidence",
        claudeAgentEvidencePath,
        "--desktop-evidence",
        desktopEvidencePath,
        "--output",
        scaffoldPath,
        "--milestone",
        "M5 test scaffold",
        "--reviewer",
        "Vitest",
        "--desktop-package",
        "fixture package",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(scaffold.status, scaffold.stderr).toBe(0);
    expect(JSON.parse(scaffold.stdout)).toMatchObject({ ok: true, outputPath: scaffoldPath });
    const scaffoldRecord = await readFile(scaffoldPath, "utf8");
    expect(scaffoldRecord).toContain("## Manual Acceptance Closure");
    expect(scaffoldRecord).toContain(`sample SHA-256：${evidence.sampleFiles[0]?.sha256}`);
    expect(scaffoldRecord).toContain(
      `citation target：${evidence.citationTargets.find((target) => target.type === "rag-chunk")?.cfi}`,
    );
    expect(scaffoldRecord).toContain("distribution：builtBundle: true");
    expect(scaffoldRecord).toContain(
      `| macOS | fixture packaged cli | CLI executable checked; installer install TBD | builtBundle: true / desktopResourceBundle: false / nativeBinary: false / usesNodeRuntime: true | install/status/uninstall pass | readany / tools: 27 / safety metadata: yes | export pass / spine: ${packagedEvidence.draftExport.exportedInspect.spineCount} / hash: ${packagedEvidence.draftExport.outputHash} | partial |`,
    );
    expect(scaffoldRecord).toContain("| Windows |  |  |  |  |  |  |  |");
    expect(scaffoldRecord).toContain("| Linux |  |  |  |  |  |  |  |");
    expect(scaffoldRecord).toContain(
      `- packaged macOS：packageSource: fixture packaged cli / builtBundle: true / desktopResourceBundle: false / nativeBinary: false / usesNodeRuntime: true / MCP readany / tools: 27 / safety metadata: yes / draftExport export pass / spine: ${packagedEvidence.draftExport.exportedInspect.spineCount} / hash: ${packagedEvidence.draftExport.outputHash}`,
    );
    expect(scaffoldRecord).toContain(
      "pnpm --filter @readany/cli acceptance:validate -- --record <acceptance-record.md> --evidence <evidence-json> --evidence <agent-evidence-json> --evidence <desktop-evidence-json> --evidence <macos-packaged-evidence-json> --evidence <windows-packaged-evidence-json> --evidence <linux-packaged-evidence-json> --strict-m5",
    );
    expect(scaffoldRecord).toContain(
      "pnpm --filter @readany/cli acceptance:finalize -- --record <acceptance-record.md> --evidence <evidence-json> --evidence <agent-evidence-json> --evidence <desktop-evidence-json> --evidence <macos-packaged-evidence-json> --evidence <windows-packaged-evidence-json> --evidence <linux-packaged-evidence-json> --release <release-label> --reviewer <name> --output <final-manifest.json>",
    );
    expect(scaffoldRecord).toContain(
      "pnpm --filter @readany/cli acceptance:assemble -- --record <acceptance-record.md> --evidence <evidence-json> --evidence <agent-evidence-json> --evidence <desktop-evidence-json> --evidence <macos-packaged-evidence-json> --evidence <windows-packaged-evidence-json> --evidence <linux-packaged-evidence-json> --release <release-label> --reviewer <name> --output-dir <acceptance-bundle-dir>",
    );
    expect(scaffoldRecord).toContain(
      "| Codex | fixture-1.0.0 | readonly/editor/publisher / MCP | tools: 27 / captured | books.search, chapters.get, and rag.search returned bounded ReadAny results | editor draft patch and publisher export completed to a new EPUB path | manual evidence captured |",
    );
    expect(scaffoldRecord).toContain(
      "| Claude Desktop | fixture-2.0.0 | readonly/editor/publisher / CLI | CLI flow; MCP not used | CLI-backed client prompt listed books and read a chapter through the installed readany command | agent requested draft edit and export only after profile elevation was confirmed | manual evidence captured |",
    );
    expect(scaffoldRecord).toContain(
      "- external agent Codex：version: fixture-1.0.0 / profile: readonly/editor/publisher / usesMcp: true / tools: 27 / readonly denial: readonly epub.export returned permission_denied before any draft output",
    );
    expect(scaffoldRecord).toContain(
      "- 桌面设置页：CLI: available / Skill: installed / MCP: codex/readonly / tools: 27 / source: fixture bundled CLI",
    );
    expect(scaffoldRecord).toContain(
      "| desktop-settings | resolved | CLI: available / Skill: installed / MCP: codex/readonly / tools: 27 / source: fixture bundled CLI | Vitest |",
    );
    expect(scaffoldRecord).toContain(
      "- desktop settings：CLI: available / Skill: installed / MCP: codex/readonly / tools: 27 / source: fixture bundled CLI",
    );
    expect(scaffoldRecord).toContain("sample-source | pending");

    const statusSummary = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/acceptance-status.mjs"),
        "--record",
        scaffoldPath,
        "--evidence",
        evidencePath,
        "--evidence",
        codexAgentEvidencePath,
        "--evidence",
        claudeAgentEvidencePath,
        "--evidence",
        desktopEvidencePath,
        "--evidence",
        packagedEvidencePath,
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(statusSummary.status, statusSummary.stderr || statusSummary.stdout).toBe(0);
    expect(JSON.parse(statusSummary.stdout)).toMatchObject({
      ok: true,
      recordPath: scaffoldPath,
      summary: {
        evidenceCount: 5,
        evidenceTypes: ["desktop-settings", "external-agent", "packaged-platform", "real-sample"],
        agentClients: ["claude", "codex"],
        packagedPlatforms: ["macos"],
      },
      readiness: {
        strictM5Ready: false,
        missing: expect.arrayContaining([
          "Windows packaged-platform evidence",
          "Linux packaged-platform evidence",
        ]),
      },
      validation: {
        strictM5: {
          ok: false,
          performed: true,
          strictM5: true,
        },
      },
      nextSteps: expect.arrayContaining([
        expect.stringContaining("acceptance:validate"),
        expect.stringContaining(scaffoldPath),
        expect.stringContaining(evidencePath),
        expect.stringContaining("packaged-windows.json"),
      ]),
    });

    const validateScaffold = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--record",
        scaffoldPath,
        "--evidence",
        evidencePath,
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(validateScaffold.status, validateScaffold.stderr).toBe(0);
    expect(JSON.parse(validateScaffold.stdout)).toMatchObject({
      ok: true,
      validated: {
        record: scaffoldPath,
        evidences: [expect.objectContaining({ path: evidencePath, type: "real-sample" })],
      },
    });

    const strictScaffold = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--record",
        scaffoldPath,
        "--evidence",
        evidencePath,
        "--strict-m5",
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(strictScaffold.status).toBe(1);
    expect(JSON.parse(strictScaffold.stdout)).toMatchObject({
      ok: false,
      strictM5: true,
      errors: expect.arrayContaining([
        "Strict M5 record still has unchecked scope items.",
        "Strict M5 record result is not a full pass.",
      ]),
    });

    const partialRecordPath = resolve(
      cliRoot,
      "../../docs/readany-cli/acceptance/2026-06-16-m3-m4-implementation.md",
    );
    const validatePartialRecord = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--record",
        partialRecordPath,
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(validatePartialRecord.status, validatePartialRecord.stderr).toBe(0);
    expect(JSON.parse(validatePartialRecord.stdout)).toMatchObject({
      ok: true,
      warnings: expect.arrayContaining([
        "Record is marked partial; use --strict-m5 only for final M5 acceptance.",
      ]),
    });

    const validateViaPackageScript = spawnSync(
      "corepack",
      [
        "pnpm",
        "--filter",
        "@readany/cli",
        "acceptance:validate",
        "--",
        "--record",
        "docs/readany-cli/acceptance/2026-06-16-m3-m4-implementation.md",
        "--json",
      ],
      {
        cwd: resolve(cliRoot, "../.."),
        env,
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    );
    expect(validateViaPackageScript.status, validateViaPackageScript.stderr).toBe(0);
    expect(
      JSON.parse(validateViaPackageScript.stdout.match(/\{[\s\S]*\}\s*$/)?.[0] ?? "{}"),
    ).toMatchObject({
      ok: true,
    });

    const strictPartialRecord = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--record",
        partialRecordPath,
        "--strict-m5",
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(strictPartialRecord.status).toBe(1);
    expect(JSON.parse(strictPartialRecord.stdout)).toMatchObject({
      ok: false,
      strictM5: true,
      errors: expect.arrayContaining([
        "Strict M5 record still has unchecked scope items.",
        "Strict M5 record result is not a full pass.",
        "Strict M5 record must include at least two completed external agent rows.",
        "Strict M5 record must include macOS in the packaged app matrix.",
      ]),
    });

    const strictRecordPath = join(root, "evidence", "strict-m5-record.md");
    await writeFile(
      strictRecordPath,
      `# ReadAny CLI M5 Acceptance

## 基本信息
- 日期：2026-06-16

## 本次验收范围
- [x] CLI 基础命令
- [x] 外部 agent 接入
- [x] macOS / Windows / Linux install matrix

## 本次明确不验收
-

## 执行命令
\`\`\`bash
pnpm --filter @readany/cli acceptance:validate -- --strict-m5
\`\`\`

## 验收结果
\`\`\`text
通过
\`\`\`

## 证据摘要
- CLI check：pass

## 安全边界证据
- readonly 写入拒绝：pass

## 真实样本证据
- RAG result 引用字段：pass

## 外部 Agent 证据
| 客户端 | 版本 | MCP 配置 profile | tools/list | read flow | draft/export flow | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | 1.0.0 | readonly/editor/publisher | pass | pass | pass | pass |
| Claude Desktop | 2.0.0 | readonly/editor/publisher | pass | pass | pass | pass |

## 打包 / 安装矩阵
| 平台 | 包来源 | 安装 | \`readany doctor --json\` | Skill install/status | MCP initialize/tools/list | Draft export | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| macOS | release dmg | pass | pass | pass | pass | pass | pass |
| Windows | release msi | pass | pass | pass | pass | pass | pass |
| Linux | release appimage | pass | pass | pass | pass | pass | pass |

## Manual Acceptance Closure
| id | status | evidence | owner |
| --- | --- | --- | --- |
| sample-source | resolved | sample source recorded | QA |
| external-agent-clients | resolved | Codex and Claude Desktop rows complete | QA |
| desktop-settings | resolved | settings page evidence attached | QA |
| packaged-app-matrix | resolved | macOS Windows Linux matrix complete | QA |
| reader-jumpback | resolved | citation target evidence attached | QA |
| runtime-bundle | resolved | doctor distribution evidence attached | QA |

## 当前可对外说明
- M5 complete.

## 当前不能对外宣称
-

## 已知问题
-

## 是否允许进入下一阶段
- [x] 是
`,
      "utf8",
    );
    const strictFullRecord = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--record",
        strictRecordPath,
        "--strict-m5",
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(strictFullRecord.status).toBe(1);
    expect(JSON.parse(strictFullRecord.stdout)).toMatchObject({
      ok: false,
      strictM5: true,
      errors: expect.arrayContaining(["Strict M5 validation requires evidence files."]),
    });

    const strictFullRecordWithEvidence = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--record",
        strictRecordPath,
        "--evidence",
        evidencePath,
        "--strict-m5",
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(strictFullRecordWithEvidence.status).toBe(1);
    expect(JSON.parse(strictFullRecordWithEvidence.stdout)).toMatchObject({
      ok: false,
      strictM5: true,
      errors: expect.arrayContaining([
        "Strict M5 record must reference at least one sample SHA-256 from evidence.",
        "Strict M5 record must reference at least one citation target from evidence.",
        "Strict M5 record must reference doctor distribution flags from evidence.",
        "Strict M5 validation requires at least two external-agent evidence files.",
        "Strict M5 validation requires desktop-settings evidence.",
        "Strict M5 validation requires packaged-platform evidence for macos.",
      ]),
    });

    const anchoredStrictRecordPath = join(root, "evidence", "strict-m5-record-with-anchors.md");
    await writeFile(
      anchoredStrictRecordPath,
      `${await readFile(strictRecordPath, "utf8")}

## Evidence Anchors
- sample SHA-256：${evidence.sampleFiles[0]?.sha256}
- citation target：${evidence.citationTargets.find((target) => target.type === "rag-chunk")?.cfi}
- distribution：builtBundle: true
- distribution：desktopResourceBundle: false
- distribution：nativeBinary: false
`,
      "utf8",
    );
    const anchoredStrictFullRecord = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--record",
        anchoredStrictRecordPath,
        "--evidence",
        evidencePath,
        "--strict-m5",
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(anchoredStrictFullRecord.status).toBe(1);
    expect(JSON.parse(anchoredStrictFullRecord.stdout)).toMatchObject({
      ok: false,
      strictM5: true,
      errors: expect.arrayContaining([
        "Strict M5 validation requires at least two external-agent evidence files.",
        "Strict M5 validation requires at least two distinct external-agent clients.",
        "Strict M5 validation requires desktop-settings evidence.",
        "Strict M5 validation requires packaged-platform evidence for macos.",
      ]),
    });

    const windowsPackagedEvidencePath = join(root, "evidence", "packaged-windows.json");
    const linuxPackagedEvidencePath = join(root, "evidence", "packaged-linux.json");
    await writeFile(
      windowsPackagedEvidencePath,
      JSON.stringify(
        {
          ...packagedEvidence,
          environment: {
            ...packagedEvidence.environment,
            platform: "Windows",
            packageSource: "release msi",
          },
          summary: {
            ...packagedEvidence.summary,
            platform: "Windows",
            packageSource: "release msi",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      linuxPackagedEvidencePath,
      JSON.stringify(
        {
          ...packagedEvidence,
          environment: {
            ...packagedEvidence.environment,
            platform: "Linux",
            packageSource: "release appimage",
          },
          summary: {
            ...packagedEvidence.summary,
            platform: "Linux",
            packageSource: "release appimage",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const darwinPackagedEvidencePath = join(root, "evidence", "packaged-darwin.json");
    await writeFile(
      darwinPackagedEvidencePath,
      JSON.stringify(
        {
          ...packagedEvidence,
          environment: {
            ...packagedEvidence.environment,
            platform: "darwin",
            packageSource: "release dmg",
          },
          summary: {
            ...packagedEvidence.summary,
            platform: "darwin",
            packageSource: "release dmg",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const duplicateCodexEvidencePath = join(root, "evidence", "agent-codex-duplicate.json");
    await writeFile(
      duplicateCodexEvidencePath,
      JSON.stringify(
        {
          ...codexAgentEvidence,
          generatedAt: "2026-06-17T00:00:01.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );

    const duplicateAgentEvidenceSet = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--record",
        anchoredStrictRecordPath,
        "--evidence",
        evidencePath,
        "--evidence",
        codexAgentEvidencePath,
        "--evidence",
        duplicateCodexEvidencePath,
        "--evidence",
        desktopEvidencePath,
        "--evidence",
        packagedEvidencePath,
        "--evidence",
        windowsPackagedEvidencePath,
        "--evidence",
        linuxPackagedEvidencePath,
        "--strict-m5",
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(duplicateAgentEvidenceSet.status).toBe(1);
    expect(JSON.parse(duplicateAgentEvidenceSet.stdout)).toMatchObject({
      ok: false,
      strictM5: true,
      errors: expect.arrayContaining([
        "Strict M5 validation requires at least two distinct external-agent clients.",
        "Strict M5 validation requires Claude Desktop or Cursor external-agent evidence.",
      ]),
    });

    const strictFullEvidenceSet = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--record",
        anchoredStrictRecordPath,
        "--evidence",
        evidencePath,
        "--evidence",
        codexAgentEvidencePath,
        "--evidence",
        claudeAgentEvidencePath,
        "--evidence",
        desktopEvidencePath,
        "--evidence",
        darwinPackagedEvidencePath,
        "--evidence",
        windowsPackagedEvidencePath,
        "--evidence",
        linuxPackagedEvidencePath,
        "--strict-m5",
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      strictFullEvidenceSet.status,
      strictFullEvidenceSet.stderr || strictFullEvidenceSet.stdout,
    ).toBe(0);
    expect(JSON.parse(strictFullEvidenceSet.stdout)).toMatchObject({
      ok: true,
      strictM5: true,
      validated: {
        evidences: expect.arrayContaining([
          expect.objectContaining({ path: evidencePath, type: "real-sample" }),
          expect.objectContaining({ path: codexAgentEvidencePath, type: "external-agent" }),
          expect.objectContaining({ path: claudeAgentEvidencePath, type: "external-agent" }),
          expect.objectContaining({ path: desktopEvidencePath, type: "desktop-settings" }),
          expect.objectContaining({ path: darwinPackagedEvidencePath, type: "packaged-platform" }),
          expect.objectContaining({ path: windowsPackagedEvidencePath, type: "packaged-platform" }),
          expect.objectContaining({ path: linuxPackagedEvidencePath, type: "packaged-platform" }),
        ]),
      },
      errors: [],
    });
    const readyStatusSummary = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/acceptance-status.mjs"),
        "--record",
        anchoredStrictRecordPath,
        "--evidence",
        evidencePath,
        "--evidence",
        codexAgentEvidencePath,
        "--evidence",
        claudeAgentEvidencePath,
        "--evidence",
        desktopEvidencePath,
        "--evidence",
        darwinPackagedEvidencePath,
        "--evidence",
        windowsPackagedEvidencePath,
        "--evidence",
        linuxPackagedEvidencePath,
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(readyStatusSummary.status, readyStatusSummary.stderr || readyStatusSummary.stdout).toBe(
      0,
    );
    expect(JSON.parse(readyStatusSummary.stdout)).toMatchObject({
      ok: true,
      recordPath: anchoredStrictRecordPath,
      readiness: {
        strictM5Ready: true,
        missing: [],
      },
      validation: {
        strictM5: {
          ok: true,
          performed: true,
          strictM5: true,
          errors: [],
        },
      },
      nextSteps: expect.arrayContaining([
        expect.stringContaining("acceptance:assemble"),
        expect.stringContaining(anchoredStrictRecordPath),
        expect.stringContaining(linuxPackagedEvidencePath),
        expect.stringContaining("--output-dir"),
      ]),
    });

    const tbdDefaultsWorkspace = join(root, "evidence", "acceptance-workspace-tbd-defaults");
    const initTbdDefaultsWorkspace = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/acceptance-init.mjs"),
        "--workspace",
        tbdDefaultsWorkspace,
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      initTbdDefaultsWorkspace.status,
      initTbdDefaultsWorkspace.stderr || initTbdDefaultsWorkspace.stdout,
    ).toBe(0);
    const tbdDefaultsWorkspaceJson = JSON.parse(
      await readFile(join(tbdDefaultsWorkspace, "workspace.json"), "utf8"),
    ) as {
      evidenceFiles: { realSample: string };
    };
    await writeFile(
      tbdDefaultsWorkspaceJson.evidenceFiles.realSample,
      await readFile(evidencePath, "utf8"),
      "utf8",
    );
    const tbdDefaultsScaffold = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/scaffold-acceptance-record.mjs"),
        "--workspace",
        tbdDefaultsWorkspace,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      tbdDefaultsScaffold.status,
      tbdDefaultsScaffold.stderr || tbdDefaultsScaffold.stdout,
    ).toBe(0);
    const tbdDefaultsRecord = await readFile(join(tbdDefaultsWorkspace, "record.md"), "utf8");
    expect(tbdDefaultsRecord).toContain(
      `acceptance:finalize -- --workspace ${join(tbdDefaultsWorkspace, "workspace.json")} --release <release-label> --reviewer <name>`,
    );
    expect(tbdDefaultsRecord).toContain(
      `acceptance:assemble -- --workspace ${join(tbdDefaultsWorkspace, "workspace.json")} --release <release-label> --reviewer <name>`,
    );
    await writeFile(
      join(tbdDefaultsWorkspace, "record.md"),
      await readFile(anchoredStrictRecordPath, "utf8"),
      "utf8",
    );
    const tbdDefaultsReadyStatus = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/acceptance-status.mjs"),
        "--workspace",
        tbdDefaultsWorkspace,
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      tbdDefaultsReadyStatus.status,
      tbdDefaultsReadyStatus.stderr || tbdDefaultsReadyStatus.stdout,
    ).toBe(0);
    const tbdDefaultsReadyStatusJson = JSON.parse(tbdDefaultsReadyStatus.stdout);
    const tbdDefaultsAssembleStep = tbdDefaultsReadyStatusJson.nextSteps.find((step: string) =>
      step.includes("acceptance:assemble"),
    );
    expect(tbdDefaultsAssembleStep).toContain("--release");
    expect(tbdDefaultsAssembleStep).toContain("<release-label>");
    expect(tbdDefaultsAssembleStep).toContain("--reviewer");
    expect(tbdDefaultsAssembleStep).toContain("<name>");

    const acceptanceInitWorkspace = join(root, "evidence", "acceptance-workspace");
    const initWorkspace = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/acceptance-init.mjs"),
        "--workspace",
        acceptanceInitWorkspace,
        "--milestone",
        "Workspace M5",
        "--reviewer",
        "Workspace Reviewer",
        "--release",
        "workspace-default-release",
        "--desktop-package",
        "workspace desktop package",
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(initWorkspace.status, initWorkspace.stderr || initWorkspace.stdout).toBe(0);
    expect(JSON.parse(initWorkspace.stdout)).toMatchObject({
      ok: true,
      workspacePath: acceptanceInitWorkspace,
      paths: {
        recordPath: join(acceptanceInitWorkspace, "record.md"),
        evidenceDir: join(acceptanceInitWorkspace, "evidence"),
        bundleDir: join(acceptanceInitWorkspace, "bundle"),
        exportsDir: join(acceptanceInitWorkspace, "exports"),
        logsDir: join(acceptanceInitWorkspace, "logs"),
      },
      createdDirectories: expect.arrayContaining([
        acceptanceInitWorkspace,
        join(acceptanceInitWorkspace, "evidence"),
        join(acceptanceInitWorkspace, "bundle"),
        join(acceptanceInitWorkspace, "exports"),
        join(acceptanceInitWorkspace, "logs"),
      ]),
      createdFiles: expect.arrayContaining([
        join(acceptanceInitWorkspace, "record.md"),
        join(acceptanceInitWorkspace, "README.md"),
        join(acceptanceInitWorkspace, "workspace.json"),
      ]),
    });
    expect(await readFile(join(acceptanceInitWorkspace, "record.md"), "utf8")).toContain(
      "ReadAny CLI Acceptance Record",
    );
    const workspaceReadme = await readFile(join(acceptanceInitWorkspace, "README.md"), "utf8");
    expect(workspaceReadme).toContain("ReadAny Acceptance Workspace");
    expect(workspaceReadme).toContain(`acceptance:real -- --workspace ${acceptanceInitWorkspace}`);
    expect(workspaceReadme).toContain(
      `acceptance:status -- --workspace ${acceptanceInitWorkspace}`,
    );
    expect(workspaceReadme).toContain("milestone: `Workspace M5`");
    expect(workspaceReadme).toContain("reviewer: `Workspace Reviewer`");
    expect(workspaceReadme).toContain("release: `workspace-default-release`");
    expect(workspaceReadme).toContain("desktopPackage: `workspace desktop package`");
    const workspaceJson = JSON.parse(
      await readFile(join(acceptanceInitWorkspace, "workspace.json"), "utf8"),
    ) as {
      paths: { recordPath: string };
      defaults: { milestone: string; reviewer: string; release: string; desktopPackage: string };
      evidenceFiles: { realSample: string; packagedWindows: string };
    };
    expect(workspaceJson).toMatchObject({
      paths: {
        recordPath: join(acceptanceInitWorkspace, "record.md"),
      },
      evidenceFiles: {
        realSample: join(acceptanceInitWorkspace, "evidence", "real-sample.json"),
        packagedWindows: join(acceptanceInitWorkspace, "evidence", "packaged-windows.json"),
      },
      defaults: {
        milestone: "Workspace M5",
        reviewer: "Workspace Reviewer",
        release: "workspace-default-release",
        desktopPackage: "workspace desktop package",
      },
    });
    const workspaceReal = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/real-sample-acceptance.mjs"),
        "--workspace",
        acceptanceInitWorkspace,
        "--readany-home",
        dataRoot,
        "--book",
        "agent-smoke-book",
        "--epub-book",
        "agent-smoke-book",
        "--pdf-book",
        "agent-smoke-pdf",
        "--rag-query",
        "bounded MCP",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(workspaceReal.status, workspaceReal.stderr || workspaceReal.stdout).toBe(0);
    expect(JSON.parse(workspaceReal.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      evidencePath: workspaceJson.evidenceFiles.realSample,
      summary: {
        draftExport: false,
        pdfChecked: true,
      },
    });
    const workspaceStatus = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/acceptance-status.mjs"),
        "--workspace",
        acceptanceInitWorkspace,
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(workspaceStatus.status, workspaceStatus.stderr || workspaceStatus.stdout).toBe(0);
    expect(JSON.parse(workspaceStatus.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      recordPath: join(acceptanceInitWorkspace, "record.md"),
      summary: {
        evidenceCount: 1,
        evidenceTypes: ["real-sample"],
      },
      readiness: {
        strictM5Ready: false,
        missing: expect.arrayContaining([
          "Codex external-agent evidence",
          "Windows packaged-platform evidence",
        ]),
      },
      nextSteps: expect.arrayContaining([
        expect.stringContaining("acceptance:agent"),
        expect.stringContaining("--workspace"),
        expect.stringContaining(join(acceptanceInitWorkspace, "workspace.json")),
      ]),
    });
    const workspaceAgentCodex = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/agent-acceptance.mjs"),
        "--workspace",
        acceptanceInitWorkspace,
        "--client",
        "Codex",
        "--client-version",
        "fixture-1.0.0",
        "--profile",
        "readonly/editor/publisher",
        "--uses-mcp",
        "--mcp-config-text",
        JSON.stringify({
          mcpServers: {
            readany: {
              command: process.execPath,
              args: [binPath, "mcp", "serve", "--profile", "readonly"],
            },
          },
        }),
        "--tools-list-summary",
        "readany tools/list captured 27 tools with risk scopes and minimumProfile metadata",
        "--tool-count",
        "27",
        "--read-flow",
        "books.search, chapters.get, and rag.search returned bounded ReadAny results",
        "--readonly-denial",
        "readonly epub.export returned permission_denied before any draft output",
        "--draft-export-flow",
        "editor draft patch and publisher export completed to a new EPUB path",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      workspaceAgentCodex.status,
      workspaceAgentCodex.stderr || workspaceAgentCodex.stdout,
    ).toBe(0);
    expect(JSON.parse(workspaceAgentCodex.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      outputPath: workspaceJson.evidenceFiles.agentCodex,
      client: "Codex",
      usesMcp: true,
    });
    const workspaceAgentClaude = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/agent-acceptance.mjs"),
        "--workspace",
        acceptanceInitWorkspace,
        "--client",
        "Claude Desktop",
        "--client-version",
        "fixture-2.0.0",
        "--profile",
        "readonly/editor/publisher",
        "--read-flow",
        "CLI-backed client prompt listed books and read a chapter through the installed readany command",
        "--readonly-denial",
        "readonly write attempt was refused with permission_denied",
        "--draft-export-flow",
        "agent requested draft edit and export only after profile elevation was confirmed",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      workspaceAgentClaude.status,
      workspaceAgentClaude.stderr || workspaceAgentClaude.stdout,
    ).toBe(0);
    expect(JSON.parse(workspaceAgentClaude.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      outputPath: workspaceJson.evidenceFiles.agentSecondClient,
      client: "Claude Desktop",
      usesMcp: false,
    });
    const workspaceDesktop = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/desktop-settings-acceptance.mjs"),
        "--workspace",
        acceptanceInitWorkspace,
        "--snapshot",
        desktopSnapshotPath,
        "--screenshot",
        "docs/readany-cli/acceptance/screenshots/desktop-settings-fixture.png",
        "--reviewer",
        "Vitest",
        "--notes",
        "Fixture desktop settings snapshot captured through copy evidence flow.",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(workspaceDesktop.status, workspaceDesktop.stderr || workspaceDesktop.stdout).toBe(0);
    expect(JSON.parse(workspaceDesktop.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      outputPath: workspaceJson.evidenceFiles.desktopSettings,
      summary: {
        cliAvailable: true,
        skillInstalled: true,
        toolCount: 27,
      },
    });
    const workspacePackagedMacos = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/packaged-platform-acceptance.mjs"),
        "--workspace",
        acceptanceInitWorkspace,
        "--cli",
        binPath,
        "--package-source",
        "fixture packaged cli",
        "--platform",
        "macOS",
        "--readany-home",
        dataRoot,
        "--agent-home",
        join(root, "workspace-packaged-agent"),
        "--repair-bin-dir",
        join(root, "workspace-packaged-bin"),
        "--with-skill-install",
        "--draft-export",
        "--book",
        "agent-smoke-book",
        "--export-dir",
        join(acceptanceInitWorkspace, "exports", "packaged-macos"),
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      workspacePackagedMacos.status,
      workspacePackagedMacos.stderr || workspacePackagedMacos.stdout,
    ).toBe(0);
    expect(JSON.parse(workspacePackagedMacos.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      evidencePath: workspaceJson.evidenceFiles.packagedMacos,
      summary: {
        platform: "macOS",
        draftExportChecked: true,
      },
    });
    await writeFile(
      workspaceJson.evidenceFiles.packagedWindows,
      await readFile(windowsPackagedEvidencePath, "utf8"),
      "utf8",
    );
    await writeFile(
      workspaceJson.evidenceFiles.packagedLinux,
      await readFile(linuxPackagedEvidencePath, "utf8"),
      "utf8",
    );
    const workspaceValidate = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--workspace",
        acceptanceInitWorkspace,
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(workspaceValidate.status, workspaceValidate.stderr || workspaceValidate.stdout).toBe(0);
    expect(JSON.parse(workspaceValidate.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      validated: {
        record: join(acceptanceInitWorkspace, "record.md"),
        evidences: expect.arrayContaining([
          expect.objectContaining({
            path: workspaceJson.evidenceFiles.realSample,
            type: "real-sample",
          }),
          expect.objectContaining({
            path: workspaceJson.evidenceFiles.agentCodex,
            type: "external-agent",
          }),
          expect.objectContaining({
            path: workspaceJson.evidenceFiles.desktopSettings,
            type: "desktop-settings",
          }),
          expect.objectContaining({
            path: workspaceJson.evidenceFiles.packagedMacos,
            type: "packaged-platform",
          }),
        ]),
      },
    });
    const workspaceScaffold = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/scaffold-acceptance-record.mjs"),
        "--workspace",
        acceptanceInitWorkspace,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(workspaceScaffold.status, workspaceScaffold.stderr || workspaceScaffold.stdout).toBe(0);
    expect(JSON.parse(workspaceScaffold.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      outputPath: join(acceptanceInitWorkspace, "record.md"),
    });
    const workspaceRecord = await readFile(join(acceptanceInitWorkspace, "record.md"), "utf8");
    expect(workspaceRecord).toContain("# ReadAny CLI Acceptance Record");
    expect(workspaceRecord).toContain("sample SHA-256");
    expect(workspaceRecord).toContain("- Milestone：Workspace M5");
    expect(workspaceRecord).toContain("- 验收人：Workspace Reviewer");
    expect(workspaceRecord).toContain("- 桌面包来源：workspace desktop package");
    expect(workspaceRecord).toContain(
      `acceptance:status -- --workspace ${join(acceptanceInitWorkspace, "workspace.json")}`,
    );
    expect(workspaceRecord).toContain(
      `acceptance:validate -- --workspace ${join(acceptanceInitWorkspace, "workspace.json")} --strict-m5`,
    );
    expect(workspaceRecord).toContain(
      `acceptance:finalize -- --workspace ${join(acceptanceInitWorkspace, "workspace.json")}`,
    );
    expect(workspaceRecord).toContain(
      `acceptance:assemble -- --workspace ${join(acceptanceInitWorkspace, "workspace.json")}`,
    );
    expect(workspaceRecord).not.toContain("--release <release-label> --reviewer <name>");
    await writeFile(
      join(acceptanceInitWorkspace, "record.md"),
      await readFile(anchoredStrictRecordPath, "utf8"),
      "utf8",
    );
    const workspaceStrictValidate = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/validate-acceptance.mjs"),
        "--workspace",
        acceptanceInitWorkspace,
        "--strict-m5",
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      workspaceStrictValidate.status,
      workspaceStrictValidate.stderr || workspaceStrictValidate.stdout,
    ).toBe(0);
    expect(JSON.parse(workspaceStrictValidate.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      strictM5: true,
    });
    const workspaceReadyStatus = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/acceptance-status.mjs"),
        "--workspace",
        acceptanceInitWorkspace,
        "--json",
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      workspaceReadyStatus.status,
      workspaceReadyStatus.stderr || workspaceReadyStatus.stdout,
    ).toBe(0);
    const workspaceReadyStatusJson = JSON.parse(workspaceReadyStatus.stdout);
    expect(workspaceReadyStatusJson).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      readiness: {
        strictM5Ready: true,
        missing: [],
      },
      nextSteps: expect.arrayContaining([
        expect.stringContaining("acceptance:validate"),
        expect.stringContaining("--workspace"),
        expect.stringContaining(join(acceptanceInitWorkspace, "workspace.json")),
        expect.stringContaining("--strict-m5"),
        expect.stringContaining("acceptance:assemble"),
      ]),
    });
    expect(workspaceReadyStatusJson.nextSteps.join("\n")).not.toContain(
      "--release <release-label>",
    );
    expect(workspaceReadyStatusJson.nextSteps.join("\n")).not.toContain("--reviewer <name>");
    const workspaceFinalize = spawnSync(
      process.execPath,
      [resolve(cliRoot, "scripts/finalize-acceptance.mjs"), "--workspace", acceptanceInitWorkspace],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(workspaceFinalize.status, workspaceFinalize.stderr || workspaceFinalize.stdout).toBe(0);
    expect(JSON.parse(workspaceFinalize.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      outputPath: join(acceptanceInitWorkspace, "final-manifest.json"),
    });
    expect(
      JSON.parse(await readFile(join(acceptanceInitWorkspace, "final-manifest.json"), "utf8")),
    ).toMatchObject({
      release: "workspace-default-release",
      reviewer: "Workspace Reviewer",
    });
    const workspaceBundle = spawnSync(
      process.execPath,
      [resolve(cliRoot, "scripts/acceptance-bundle.mjs"), "--workspace", acceptanceInitWorkspace],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(workspaceBundle.status, workspaceBundle.stderr || workspaceBundle.stdout).toBe(0);
    expect(JSON.parse(workspaceBundle.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      outputDir: join(acceptanceInitWorkspace, "bundle"),
      files: expect.arrayContaining(["record.md", "manifest.json", "index.json"]),
    });
    expect(
      JSON.parse(await readFile(join(acceptanceInitWorkspace, "bundle", "index.json"), "utf8")),
    ).toMatchObject({
      release: "workspace-default-release",
    });
    const workspaceVerifyBundle = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/verify-acceptance-bundle.mjs"),
        "--workspace",
        acceptanceInitWorkspace,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      workspaceVerifyBundle.status,
      workspaceVerifyBundle.stderr || workspaceVerifyBundle.stdout,
    ).toBe(0);
    expect(JSON.parse(workspaceVerifyBundle.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      bundleDir: join(acceptanceInitWorkspace, "bundle"),
    });
    const workspaceAssemble = spawnSync(
      process.execPath,
      [resolve(cliRoot, "scripts/assemble-acceptance.mjs"), "--workspace", acceptanceInitWorkspace],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(workspaceAssemble.status, workspaceAssemble.stderr || workspaceAssemble.stdout).toBe(0);
    expect(JSON.parse(workspaceAssemble.stdout)).toMatchObject({
      ok: true,
      workspaceFile: join(acceptanceInitWorkspace, "workspace.json"),
      outputDir: join(acceptanceInitWorkspace, "bundle"),
      verified: true,
    });
    expect(
      JSON.parse(await readFile(join(acceptanceInitWorkspace, "final-manifest.json"), "utf8")),
    ).toMatchObject({
      release: "workspace-default-release",
      reviewer: "Workspace Reviewer",
    });

    const rejectedManifestPath = join(root, "evidence", "rejected-final-manifest.json");
    const rejectedFinalize = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/finalize-acceptance.mjs"),
        "--record",
        anchoredStrictRecordPath,
        "--evidence",
        evidencePath,
        "--output",
        rejectedManifestPath,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(rejectedFinalize.status).toBe(1);
    expect(rejectedFinalize.stderr).toContain(
      "Strict M5 validation failed; manifest was not written.",
    );

    const finalManifestPath = join(root, "evidence", "final-manifest.json");
    const finalize = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/finalize-acceptance.mjs"),
        "--record",
        anchoredStrictRecordPath,
        "--evidence",
        evidencePath,
        "--evidence",
        codexAgentEvidencePath,
        "--evidence",
        claudeAgentEvidencePath,
        "--evidence",
        desktopEvidencePath,
        "--evidence",
        darwinPackagedEvidencePath,
        "--evidence",
        windowsPackagedEvidencePath,
        "--evidence",
        linuxPackagedEvidencePath,
        "--reviewer",
        "Vitest",
        "--release",
        "fixture-release",
        "--output",
        finalManifestPath,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(finalize.status, finalize.stderr || finalize.stdout).toBe(0);
    expect(JSON.parse(finalize.stdout)).toMatchObject({
      ok: true,
      outputPath: finalManifestPath,
      summary: {
        evidenceCount: 7,
        evidenceTypes: ["desktop-settings", "external-agent", "packaged-platform", "real-sample"],
      },
    });
    const finalManifest = JSON.parse(await readFile(finalManifestPath, "utf8")) as {
      ok: boolean;
      release?: string;
      reviewer?: string;
      record: { path: string; sha256: string; bytes: number };
      evidences: Array<{
        path: string;
        sha256: string;
        bytes: number;
        type: string;
        label: string;
      }>;
      validation: { ok: boolean; strictM5: boolean; errors: string[] };
      summary: { evidenceCount: number; evidenceTypes: string[] };
    };
    expect(finalManifest).toMatchObject({
      ok: true,
      release: "fixture-release",
      reviewer: "Vitest",
      record: {
        path: anchoredStrictRecordPath,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        bytes: expect.any(Number),
      },
      validation: {
        ok: true,
        strictM5: true,
        errors: [],
      },
      summary: {
        evidenceCount: 7,
        evidenceTypes: ["desktop-settings", "external-agent", "packaged-platform", "real-sample"],
      },
    });
    expect(finalManifest.evidences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: evidencePath, type: "real-sample", label: "real-sample" }),
        expect.objectContaining({
          path: codexAgentEvidencePath,
          type: "external-agent",
          label: "Codex",
        }),
        expect.objectContaining({
          path: claudeAgentEvidencePath,
          type: "external-agent",
          label: "Claude Desktop",
        }),
        expect.objectContaining({
          path: desktopEvidencePath,
          type: "desktop-settings",
          label: "desktop-settings",
        }),
        expect.objectContaining({
          path: darwinPackagedEvidencePath,
          type: "packaged-platform",
          label: "darwin",
        }),
      ]),
    );

    const bundleDir = join(root, "evidence", "final-bundle");
    const bundle = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/acceptance-bundle.mjs"),
        "--record",
        anchoredStrictRecordPath,
        "--manifest",
        finalManifestPath,
        "--evidence",
        evidencePath,
        "--evidence",
        codexAgentEvidencePath,
        "--evidence",
        claudeAgentEvidencePath,
        "--evidence",
        desktopEvidencePath,
        "--evidence",
        darwinPackagedEvidencePath,
        "--evidence",
        windowsPackagedEvidencePath,
        "--evidence",
        linuxPackagedEvidencePath,
        "--release",
        "fixture-release",
        "--output-dir",
        bundleDir,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(bundle.status, bundle.stderr || bundle.stdout).toBe(0);
    expect(JSON.parse(bundle.stdout)).toMatchObject({
      ok: true,
      outputDir: bundleDir,
      files: expect.arrayContaining(["record.md", "manifest.json", "index.json"]),
    });
    const bundleIndex = JSON.parse(await readFile(join(bundleDir, "index.json"), "utf8")) as {
      ok: boolean;
      release?: string;
      record: string;
      manifest: string;
      evidences: Array<{ source: string; target: string }>;
      files: Array<{ source: string; target: string; sha256: string; bytes: number }>;
    };
    expect(bundleIndex).toMatchObject({
      ok: true,
      release: "fixture-release",
      record: "record.md",
      manifest: "manifest.json",
    });
    expect(bundleIndex.evidences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: evidencePath }),
        expect.objectContaining({ source: codexAgentEvidencePath }),
        expect.objectContaining({ source: desktopEvidencePath }),
      ]),
    );
    expect(bundleIndex.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: anchoredStrictRecordPath,
          target: "record.md",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          bytes: expect.any(Number),
        }),
        expect.objectContaining({
          source: finalManifestPath,
          target: "manifest.json",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          bytes: expect.any(Number),
        }),
        expect.objectContaining({
          source: evidencePath,
          target: expect.stringMatching(/^evidence\//),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          bytes: expect.any(Number),
        }),
      ]),
    );
    const verifyBundle = spawnSync(
      process.execPath,
      [resolve(cliRoot, "scripts/verify-acceptance-bundle.mjs"), "--bundle-dir", bundleDir],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(verifyBundle.status, verifyBundle.stderr || verifyBundle.stdout).toBe(0);
    expect(JSON.parse(verifyBundle.stdout)).toMatchObject({
      ok: true,
      bundleDir,
      evidenceCount: 7,
      strictM5: {
        ok: true,
        strictM5: true,
        errors: [],
      },
    });
    const verifyBundleRelative = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/verify-acceptance-bundle.mjs"),
        "--bundle-dir",
        relative(cliRoot, bundleDir),
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      verifyBundleRelative.status,
      verifyBundleRelative.stderr || verifyBundleRelative.stdout,
    ).toBe(0);
    expect(JSON.parse(verifyBundleRelative.stdout)).toMatchObject({
      ok: true,
      bundleDir,
      evidenceCount: 7,
      strictM5: {
        ok: true,
        strictM5: true,
        errors: [],
      },
    });

    const mismatchManifestPath = join(root, "evidence", "mismatch-final-manifest.json");
    await writeFile(
      mismatchManifestPath,
      `${JSON.stringify(
        {
          ...finalManifest,
          record: {
            ...finalManifest.record,
            sha256: "0".repeat(64),
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const rejectedBundle = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/acceptance-bundle.mjs"),
        "--record",
        anchoredStrictRecordPath,
        "--manifest",
        mismatchManifestPath,
        "--evidence",
        evidencePath,
        "--evidence",
        codexAgentEvidencePath,
        "--evidence",
        claudeAgentEvidencePath,
        "--evidence",
        desktopEvidencePath,
        "--evidence",
        darwinPackagedEvidencePath,
        "--evidence",
        windowsPackagedEvidencePath,
        "--evidence",
        linuxPackagedEvidencePath,
        "--output-dir",
        join(root, "evidence", "mismatch-bundle"),
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(rejectedBundle.status).toBe(1);
    expect(rejectedBundle.stderr).toContain("Acceptance bundle consistency check failed");
    const rejectedVerifyBundle = spawnSync(
      process.execPath,
      [resolve(cliRoot, "scripts/verify-acceptance-bundle.mjs"), "--bundle-dir", bundleDir],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      rejectedVerifyBundle.status,
      rejectedVerifyBundle.stderr || rejectedVerifyBundle.stdout,
    ).toBe(0);

    const rejectedAssembleDir = join(root, "evidence", "rejected-assemble");
    const rejectedAssemble = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/assemble-acceptance.mjs"),
        "--record",
        anchoredStrictRecordPath,
        "--evidence",
        evidencePath,
        "--output-dir",
        rejectedAssembleDir,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(rejectedAssemble.status).toBe(1);

    const assembledDir = join(root, "evidence", "assembled-final-bundle");
    const assemble = spawnSync(
      process.execPath,
      [
        resolve(cliRoot, "scripts/assemble-acceptance.mjs"),
        "--record",
        anchoredStrictRecordPath,
        "--evidence",
        evidencePath,
        "--evidence",
        codexAgentEvidencePath,
        "--evidence",
        claudeAgentEvidencePath,
        "--evidence",
        desktopEvidencePath,
        "--evidence",
        darwinPackagedEvidencePath,
        "--evidence",
        windowsPackagedEvidencePath,
        "--evidence",
        linuxPackagedEvidencePath,
        "--reviewer",
        "Vitest",
        "--release",
        "fixture-release",
        "--output-dir",
        assembledDir,
      ],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(assemble.status, assemble.stderr || assemble.stdout).toBe(0);
    expect(JSON.parse(assemble.stdout)).toMatchObject({
      ok: true,
      outputDir: assembledDir,
      manifestPath: join(assembledDir, "final-manifest.json"),
      verified: true,
      evidenceCount: 7,
    });
    const assembledManifest = JSON.parse(
      await readFile(join(assembledDir, "manifest.json"), "utf8"),
    ) as {
      ok: boolean;
      release?: string;
      reviewer?: string;
      bundle?: {
        verified: boolean;
        indexPath: string;
        verification: { ok: boolean; bundleDir: string; evidenceCount: number };
      };
    };
    expect(assembledManifest).toMatchObject({
      ok: true,
      release: "fixture-release",
      reviewer: "Vitest",
      bundle: {
        verified: true,
        indexPath: "index.json",
        verification: {
          ok: true,
          bundleDir: assembledDir,
          evidenceCount: 7,
          strictM5: {
            ok: true,
            strictM5: true,
            errors: [],
          },
        },
      },
    });
    const verifyAssembledBundle = spawnSync(
      process.execPath,
      [resolve(cliRoot, "scripts/verify-acceptance-bundle.mjs"), "--bundle-dir", assembledDir],
      {
        cwd: cliRoot,
        env,
        encoding: "utf8",
      },
    );
    expect(
      verifyAssembledBundle.status,
      verifyAssembledBundle.stderr || verifyAssembledBundle.stdout,
    ).toBe(0);
    expect(JSON.parse(verifyAssembledBundle.stdout)).toMatchObject({
      ok: true,
      bundleDir: assembledDir,
      evidenceCount: 7,
      strictM5: {
        ok: true,
        strictM5: true,
        errors: [],
      },
    });
  }, 15000);
});
