import { lstat, mkdir, readFile, readlink, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CLI_VERSION } from "./version.js";
import { getCliPaths, resolveExecutablePath } from "./paths.js";
import { isAccessProfile, parseAccessProfile, profileHasScope } from "./profiles.js";
import { failure, success, type CommandResult } from "./result.js";
import { runDoctor } from "./doctor.js";
import { installCli, uninstallCli, type InstallMode, type InstallOptions } from "./install.js";
import { getSkillStatus, installSkill, uninstallSkill, updateSkill } from "./skill.js";
import { isRagSearchMode } from "./rag-config.js";
import { listTools } from "./tool-registry.js";

export type ParsedCommand = {
  name: string;
  args: string[];
  json: boolean;
  profile?: string;
  mode?: InstallMode;
  options: Record<string, string | boolean>;
};

type McpConfigClient = "generic" | "claude" | "cursor" | "codex" | "opencode";
type AgentSetupClient = McpConfigClient | "all";
type ClientSkillClient = "agents" | "claude" | "cursor" | "codex" | "opencode";

type AgentSetupResult = {
  setup: true;
  command: string;
  install: Awaited<ReturnType<typeof installCli>>;
  skill: Awaited<ReturnType<typeof installSkill>> | Awaited<ReturnType<typeof updateSkill>>;
  clientSkillLinks: ClientSkillLinkResult[];
  mcp: ReturnType<typeof createMcpConfig>;
  mcpConfigs: ReturnType<typeof createMcpConfig>[];
  nextSteps: string[];
};

type AgentUninstallResult = {
  uninstalled: true;
  command: string;
  install: Awaited<ReturnType<typeof uninstallCli>>;
  skill: Awaited<ReturnType<typeof uninstallSkill>>;
  clientSkillLinks: ClientSkillUnlinkResult[];
  nextSteps: string[];
};

type ClientSkillLinkResult = {
  client: ClientSkillClient;
  linked: true;
  path: string;
  target: string;
};

type ClientSkillUnlinkResult = {
  client: ClientSkillClient;
  removed: boolean;
  path: string;
};

export function parseCommand(argv: string[]): ParsedCommand {
  const args = [...argv];
  let json = false;
  let profile: string | undefined;
  let mode: InstallMode | undefined;
  const options: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--profile") {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        profile = next;
        index += 1;
      } else {
        profile = "";
      }
      continue;
    }

    if (arg === "--user") {
      mode = "user";
      continue;
    }

    if (arg === "--global") {
      mode = "global";
      continue;
    }

    if (arg === "--version" || arg === "--help") {
      positional.push(arg);
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        options[key] = next;
        index += 1;
      } else {
        options[key] = true;
      }
      continue;
    }

    positional.push(arg);
  }

  return {
    name: positional[0] ?? "help",
    args: positional.slice(1),
    json,
    profile,
    mode,
    options,
  };
}

class InvalidCommandOptionError extends Error {
  readonly code = "invalid_option";
}

type NumberOptionBounds = {
  min?: number;
  max?: number;
};

function getLimit(command: ParsedCommand, fallback: number, max: number): number {
  return getNumberOption(command, "limit", fallback, { max });
}

function getNumberOption(
  command: ParsedCommand,
  name: string,
  fallback: number,
  bounds: NumberOptionBounds = {},
): number {
  const raw = command.options[name];
  if (typeof raw !== "string") return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new InvalidCommandOptionError(`--${name} must be a positive integer`);
  }
  const parsed = Number.parseInt(raw, 10);
  const min = bounds.min ?? 1;
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new InvalidCommandOptionError(`--${name} must be greater than or equal to ${min}`);
  }
  if (bounds.max !== undefined && parsed > bounds.max) {
    throw new InvalidCommandOptionError(`--${name} must be less than or equal to ${bounds.max}`);
  }
  return parsed;
}

function getStringOption(command: ParsedCommand, name: string): string | undefined {
  const value = command.options[name];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getRequiredStringOption(command: ParsedCommand, name: string): string | undefined {
  const value = command.options[name];
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.trim()) return value;
  throw new InvalidCommandOptionError(`--${name} requires a value`);
}

function getBooleanOption(command: ParsedCommand, name: string, fallback: boolean): boolean {
  const value = command.options[name];
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

function isNotesExportFormat(value: string): value is "markdown" | "json" | "obsidian" | "notion" {
  return value === "markdown" || value === "json" || value === "obsidian" || value === "notion";
}

function isKnowledgeExportFormat(value: string): value is "markdown" | "json" | "obsidian" {
  return value === "markdown" || value === "json" || value === "obsidian";
}

function isEpubChapterReadFormat(value: string): value is "text" | "xhtml" {
  return value === "text" || value === "xhtml";
}

function parseEpubChapterPatchPlan(value: unknown): unknown[] {
  const patches = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { patches?: unknown }).patches)
      ? (value as { patches: unknown[] }).patches
      : undefined;

  if (!patches) {
    throw new Error("epub chapters patch file must contain a patches array");
  }

  return patches;
}

function parseEpubMetadataPatch(value: unknown): {
  title?: string;
  creator?: string;
  language?: string;
  publisher?: string;
  description?: string;
  modified?: string;
  subjects?: string[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const metadata = record.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as ReturnType<typeof parseEpubMetadataPatch>;
  }
  return record as ReturnType<typeof parseEpubMetadataPatch>;
}

function parseMcpConfigClient(value: string | undefined): McpConfigClient {
  if (!value) return "generic";
  if (
    value === "generic" ||
    value === "claude" ||
    value === "cursor" ||
    value === "codex" ||
    value === "opencode"
  ) {
    return value;
  }
  throw new Error(`Unknown MCP config client: ${value}`);
}

function parseAgentSetupClient(value: string | undefined): AgentSetupClient {
  if (value === "all") return "all";
  return parseMcpConfigClient(value);
}

function createMcpServer(profile: string | undefined) {
  const parsedProfile = parseAccessProfile(profile);
  const executablePath = resolveExecutablePath();
  return {
    command: process.execPath,
    args: [executablePath, "mcp", "serve", "--profile", parsedProfile],
  };
}

export function createMcpConfig(
  profile: string | undefined = "readonly",
  client: string | undefined = "generic",
) {
  const parsedClient = parseMcpConfigClient(client);
  const server = createMcpServer(profile);
  const profileName = server.args[4];
  const jsonConfig = {
    mcpServers: {
      readany: server,
    },
  };

  if (parsedClient === "codex") {
    return {
      client: "codex",
      format: "toml",
      profile: profileName,
      snippet: [
        "[mcp_servers.readany]",
        `command = ${JSON.stringify(server.command)}`,
        `args = ${JSON.stringify(server.args)}`,
      ].join("\n"),
    };
  }

  if (parsedClient === "opencode") {
    const opencodeConfig = {
      mcp: {
        readany: {
          type: "local",
          command: [server.command, ...server.args],
          enabled: true,
        },
      },
    };
    return {
      client: "opencode",
      format: "json",
      profile: profileName,
      snippet: JSON.stringify(opencodeConfig, null, 2),
      ...opencodeConfig,
    };
  }

  return {
    client: parsedClient,
    format: "json",
    profile: profileName,
    snippet: JSON.stringify(jsonConfig, null, 2),
    ...jsonConfig,
  };
}

async function getDataApi() {
  return import("./data.js");
}

export function createHelpText(): string {
  return `ReadAny CLI ${CLI_VERSION}

Usage:
  readany --version
  readany agent setup [--user|--global] [--json] [--client generic|claude|cursor|codex|opencode|all] [--profile readonly|editor|publisher] [--user-bin-dir <dir>] [--global-bin-dir <dir>]
  readany agent uninstall [--user|--global] [--json] [--user-bin-dir <dir>] [--global-bin-dir <dir>] [--remove-path-shims]
  readany install [--user|--global] [--json] [--user-bin-dir <dir>] [--global-bin-dir <dir>]
  readany repair [--user|--global] [--json] [--user-bin-dir <dir>] [--global-bin-dir <dir>]
  readany uninstall [--user|--global] [--json] [--user-bin-dir <dir>] [--global-bin-dir <dir>] [--remove-path-shims]
  readany doctor [--json] [--profile readonly]
  readany skill install
  readany skill update
  readany skill uninstall
  readany skill status [--json]
  readany tools list [--json]
  readany books list [--json] [--limit 50]
  readany books search <query> [--json]
  readany book get <book-id> [--json]
  readany chapters list <book-id> [--json]
  readany chapter get <book-id> <chapter-id> [--json] [--chunk-start 1] [--chunk-count 5] [--limit 12000]
  readany context get [--json] [--limit 12000] [--include-selection true|false] [--include-surrounding-text true|false] [--include-highlights true|false]
  readany bookmarks list <book-id> [--json]
  readany skills list [--json]
  readany epub inspect <book-id> [--json] [--profile editor]
  readany epub draft create <book-id> [--json] [--profile editor]
  readany epub draft discard <draft-id> [--json] [--profile editor] [--reason "..."]
  readany epub chapter read <draft-id> <chapter-id> [--json] [--profile editor] [--limit 12000] [--format text|xhtml]
  readany epub chapter patch <draft-id> <chapter-id> --xhtml <file> [--json] [--profile editor]
  readany epub chapters patch <draft-id> --patch <file> [--json] [--profile editor]
  readany epub metadata patch <draft-id> --patch <file> [--json] [--profile editor]
  readany epub toc rebuild <draft-id> [--json] [--profile editor]
  readany epub history <draft-id> [--json] [--profile editor]
  readany epub diff <draft-id> [--json] [--profile editor]
  readany epub undo <draft-id> <operation-id> [--json] [--profile editor]
  readany epub validate <draft-id> [--json] [--profile publisher]
  readany epub export <draft-id> --output <path> [--json] [--profile publisher] [--overwrite]
  readany notes search <query> [--json] [--book <book-id>]
  readany notes export <book-id> --output <path> [--json] [--profile publisher] [--format markdown] [--overwrite]
  readany highlights search <query> [--json] [--book <book-id>]
  readany knowledge search <query> [--json] [--book <book-id>] [--limit 20] [--content-limit 240]
  readany knowledge export --output <path> [--json] [--profile publisher] [--format markdown|json|obsidian] [--limit 1000] [--overwrite]
  readany rag search <query> --book <book-id> [--json] [--mode bm25|hybrid|vector] [--limit 5]
  readany mcp serve --profile readonly
  readany mcp config [--json] [--profile readonly|editor|publisher] [--client generic|claude|cursor|codex|opencode]
`;
}

function getInstallOptions(
  command: ParsedCommand,
  binPath: string,
  env: NodeJS.ProcessEnv = process.env,
): InstallOptions {
  return {
    binPath,
    mode: command.mode,
    userBinDir: getRequiredStringOption(command, "user-bin-dir"),
    globalBinDir: getRequiredStringOption(command, "global-bin-dir"),
    removePathShims: getBooleanOption(command, "remove-path-shims", false),
    pathEnv: env.PATH,
  };
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function createAgentSetupCommand(command: ParsedCommand): string {
  const args = ["readany", "agent", "setup"];
  if (command.mode === "global") args.push("--global");
  else args.push("--user");

  const client = getRequiredStringOption(command, "client") ?? "generic";
  args.push("--client", client);
  args.push("--profile", parseAccessProfile(command.profile));
  args.push("--json");

  const userBinDir = getRequiredStringOption(command, "user-bin-dir");
  if (userBinDir) args.push("--user-bin-dir", userBinDir);
  const globalBinDir = getRequiredStringOption(command, "global-bin-dir");
  if (globalBinDir) args.push("--global-bin-dir", globalBinDir);

  return args.map(quoteShellArg).join(" ");
}

function createAgentUninstallCommand(command: ParsedCommand): string {
  const args = ["readany", "agent", "uninstall"];
  if (command.mode === "global") args.push("--global");
  else args.push("--user");
  args.push("--json");

  const userBinDir = getRequiredStringOption(command, "user-bin-dir");
  if (userBinDir) args.push("--user-bin-dir", userBinDir);
  const globalBinDir = getRequiredStringOption(command, "global-bin-dir");
  if (globalBinDir) args.push("--global-bin-dir", globalBinDir);
  if (command.options["remove-path-shims"] === true) args.push("--remove-path-shims");

  return args.map(quoteShellArg).join(" ");
}

async function installOrUpdateReadAnySkill(skillFile: string): Promise<AgentSetupResult["skill"]> {
  const status = await getSkillStatus(skillFile);
  return status.installed ? updateSkill(skillFile) : installSkill(skillFile);
}

async function assertSkillCanBeManaged(skillFile: string): Promise<void> {
  const status = await getSkillStatus(skillFile);
  if (status.installed) return;

  try {
    await readFile(skillFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  throw new Error(`Skill file already exists and is not managed by ReadAny CLI: ${skillFile}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

const MCP_CONFIG_CLIENTS: McpConfigClient[] = ["generic", "claude", "cursor", "codex", "opencode"];
const CLIENT_SKILL_CLIENTS: ClientSkillClient[] = [
  "agents",
  "codex",
  "claude",
  "cursor",
  "opencode",
];

function getClientSkillLinkPath(client: ClientSkillClient, env: NodeJS.ProcessEnv): string {
  if (client === "agents") {
    const agentsHome = env.AGENTS_HOME ? resolve(env.AGENTS_HOME) : join(homedir(), ".agents");
    return join(agentsHome, "skills", "readany");
  }

  if (client === "codex") {
    const codexHome = env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(homedir(), ".codex");
    return join(codexHome, "skills", "readany");
  }

  if (client === "claude") {
    const claudeHome = env.CLAUDE_HOME ? resolve(env.CLAUDE_HOME) : join(homedir(), ".claude");
    return join(claudeHome, "skills", "readany");
  }

  if (client === "opencode") {
    const opencodeHome = env.OPENCODE_HOME
      ? resolve(env.OPENCODE_HOME)
      : join(
          env.XDG_CONFIG_HOME ? resolve(env.XDG_CONFIG_HOME) : join(homedir(), ".config"),
          "opencode",
        );
    return join(opencodeHome, "skills", "readany");
  }

  const cursorHome = env.CURSOR_HOME ? resolve(env.CURSOR_HOME) : join(homedir(), ".cursor");
  return join(cursorHome, "skills", "readany");
}

function getRequestedClientSkillLinks(
  client: AgentSetupClient,
  env: NodeJS.ProcessEnv,
): Array<{ client: ClientSkillClient; path: string }> {
  const clients =
    client === "all"
      ? CLIENT_SKILL_CLIENTS
      : client === "codex" || client === "claude" || client === "cursor" || client === "opencode"
        ? [client]
        : [];
  return clients.map((client) => ({
    client,
    path: getClientSkillLinkPath(client, env),
  }));
}

function getMcpConfigsForAgentClient(
  profile: string | undefined,
  client: AgentSetupClient,
): ReturnType<typeof createMcpConfig>[] {
  const clients = client === "all" ? MCP_CONFIG_CLIENTS : [client];
  return clients.map((client) => createMcpConfig(profile, client));
}

async function assertClientSkillLinkCanBeManaged(
  linkPath: string,
  targetDir: string,
): Promise<void> {
  if (!(await pathExists(linkPath))) return;

  const stat = await lstat(linkPath);
  if (stat.isSymbolicLink()) {
    const target = await readlink(linkPath);
    if (target === targetDir) return;
    throw new Error(
      `Client skill link already exists and is not managed by ReadAny CLI: ${linkPath}`,
    );
  }

  const skillFile = join(linkPath, "SKILL.md");
  const status = await getSkillStatus(skillFile);
  if (status.installed) return;

  throw new Error(`Client skill already exists and is not managed by ReadAny CLI: ${linkPath}`);
}

async function installClientSkillLinks(options: {
  client: AgentSetupClient;
  env: NodeJS.ProcessEnv;
  skillDir: string;
}): Promise<ClientSkillLinkResult[]> {
  const requestedLinks = getRequestedClientSkillLinks(options.client, options.env);
  const results: ClientSkillLinkResult[] = [];

  for (const requestedLink of requestedLinks) {
    const linkPath = requestedLink.path;
    await mkdir(dirname(linkPath), { recursive: true });
    await assertClientSkillLinkCanBeManaged(linkPath, options.skillDir);
    await rm(linkPath, { force: true, recursive: true });
    await symlink(options.skillDir, linkPath, "dir");
    results.push({
      client: requestedLink.client,
      linked: true,
      path: linkPath,
      target: options.skillDir,
    });
  }

  return results;
}

async function assertClientSkillLinksCanBeManaged(options: {
  client: AgentSetupClient;
  env: NodeJS.ProcessEnv;
  skillDir: string;
}): Promise<void> {
  for (const requestedLink of getRequestedClientSkillLinks(options.client, options.env)) {
    await assertClientSkillLinkCanBeManaged(requestedLink.path, options.skillDir);
  }
}

async function uninstallClientSkillLinks(
  env: NodeJS.ProcessEnv,
  skillDir: string,
): Promise<ClientSkillUnlinkResult[]> {
  const results: ClientSkillUnlinkResult[] = [];

  for (const client of CLIENT_SKILL_CLIENTS) {
    const linkPath = getClientSkillLinkPath(client, env);
    if (!(await pathExists(linkPath))) {
      results.push({ client, removed: false, path: linkPath });
      continue;
    }

    const stat = await lstat(linkPath);
    if (stat.isSymbolicLink()) {
      const target = await readlink(linkPath);
      if (target === skillDir) {
        await rm(linkPath, { force: true });
        results.push({ client, removed: true, path: linkPath });
      } else {
        results.push({ client, removed: false, path: linkPath });
      }
      continue;
    }

    const skillFile = join(linkPath, "SKILL.md");
    const status = await getSkillStatus(skillFile);
    if (!status.installed) {
      results.push({ client, removed: false, path: linkPath });
      continue;
    }

    await rm(linkPath, { force: true, recursive: true });
    results.push({ client, removed: true, path: linkPath });
  }

  return results;
}

async function setupAgent(
  command: ParsedCommand,
  paths: ReturnType<typeof getCliPaths>,
  env: NodeJS.ProcessEnv,
): Promise<AgentSetupResult> {
  const setupCommand = createAgentSetupCommand(command);
  const client = parseAgentSetupClient(getRequiredStringOption(command, "client"));
  const mcpConfigs = getMcpConfigsForAgentClient(command.profile, client);
  const mcp = mcpConfigs[0];
  await assertSkillCanBeManaged(paths.skillFile);
  await assertClientSkillLinksCanBeManaged({
    client,
    env,
    skillDir: paths.skillDir,
  });
  const install = await installCli(getInstallOptions(command, paths.binPath, env));
  const skill = await installOrUpdateReadAnySkill(paths.skillFile);
  const clientSkillLinks = await installClientSkillLinks({
    client,
    env,
    skillDir: paths.skillDir,
  });

  return {
    setup: true,
    command: setupCommand,
    install,
    skill,
    clientSkillLinks,
    mcp,
    mcpConfigs,
    nextSteps: [
      `Run ${setupCommand} from the external agent if setup needs to be repeated.`,
      "Paste the matching mcp.snippet from mcpConfigs into each selected agent client config if the client does not import it automatically.",
      "Restart or reload the selected agent client so newly installed skills and MCP config are discovered.",
      "Use readonly profile by default; switch to editor or publisher only after the user approves write/export access.",
    ],
  };
}

async function uninstallAgent(
  command: ParsedCommand,
  paths: ReturnType<typeof getCliPaths>,
  env: NodeJS.ProcessEnv,
): Promise<AgentUninstallResult> {
  const uninstallCommand = createAgentUninstallCommand(command);

  return {
    uninstalled: true,
    command: uninstallCommand,
    install: await uninstallCli(getInstallOptions(command, paths.binPath, env)),
    skill: await uninstallSkill(paths.skillFile),
    clientSkillLinks: await uninstallClientSkillLinks(env, paths.skillDir),
    nextSteps: [
      "Remove any readany MCP server snippet from external agent client configs that were edited manually.",
    ],
  };
}

async function executeCommand(argv: string[], env = process.env): Promise<CommandResult> {
  const command = parseCommand(argv);
  const paths = getCliPaths(env);

  try {
    if (command.profile !== undefined && !command.profile.trim()) {
      return failure("invalid_option", "--profile requires a value");
    }

    if (command.name === "--version" || command.name === "version") {
      return success(CLI_VERSION);
    }

    if (command.name === "help" || command.name === "--help" || command.name === "-h") {
      return success(createHelpText());
    }

    if (command.name === "doctor") {
      const profile = parseAccessProfile(command.profile);
      return success(await runDoctor(paths, profile));
    }

    if (command.name === "agent") {
      const subcommand = command.args[0] ?? "setup";

      if (subcommand === "setup" || subcommand === "install") {
        return success(await setupAgent(command, paths, env));
      }

      if (subcommand === "uninstall") {
        return success(await uninstallAgent(command, paths, env));
      }

      return failure("unknown_agent_command", `Unknown agent command: ${subcommand}`);
    }

    if (command.name === "skill") {
      const subcommand = command.args[0] ?? "status";

      if (subcommand === "install") {
        return success(await installSkill(paths.skillFile));
      }

      if (subcommand === "update") {
        return success(await updateSkill(paths.skillFile));
      }

      if (subcommand === "uninstall") {
        return success(await uninstallSkill(paths.skillFile));
      }

      if (subcommand === "status") {
        return success(await getSkillStatus(paths.skillFile));
      }

      return failure("unknown_skill_command", `Unknown skill command: ${subcommand}`);
    }

    if (command.name === "tools") {
      const subcommand = command.args[0] ?? "list";
      if (subcommand === "list") {
        return success({ tools: listTools() });
      }

      return failure("unknown_tools_command", `Unknown tools command: ${subcommand}`);
    }

    if (command.name === "mcp") {
      const subcommand = command.args[0];
      if (subcommand === "config") {
        return success(
          createMcpConfig(command.profile, getRequiredStringOption(command, "client")),
        );
      }
      if (subcommand === "serve") {
        return failure("mcp_serve_requires_stdio", "mcp serve must be run from the CLI entrypoint");
      }

      return failure("unknown_mcp_command", `Unknown MCP command: ${subcommand ?? ""}`.trim());
    }

    if (command.name === "install") {
      return success(await installCli(getInstallOptions(command, paths.binPath, env)));
    }

    if (command.name === "repair") {
      return success({
        repaired: true,
        ...(await installCli(getInstallOptions(command, paths.binPath, env))),
      });
    }

    if (command.name === "uninstall") {
      return success(await uninstallCli(getInstallOptions(command, paths.binPath, env)));
    }

    if (command.name === "books") {
      const data = await getDataApi();
      const subcommand = command.args[0] ?? "list";
      if (subcommand === "list") {
        return success({ books: await data.listBooks(getLimit(command, 50, 200), env) });
      }
      if (subcommand === "search") {
        const query = command.args.slice(1).join(" ");
        if (!query) {
          return failure("missing_query", "books search requires a query");
        }
        return success({ books: await data.searchBooks(query, getLimit(command, 20, 200), env) });
      }
      return failure("unknown_books_command", `Unknown books command: ${subcommand}`);
    }

    if (command.name === "book") {
      const data = await getDataApi();
      const subcommand = command.args[0] ?? "get";
      if (subcommand === "get") {
        const bookId = command.args[1];
        if (!bookId) return failure("missing_book_id", "book get requires a book id");
        return success({ book: await data.getBookById(bookId, env) });
      }
      return failure("unknown_book_command", `Unknown book command: ${subcommand}`);
    }

    if (command.name === "chapters") {
      const data = await getDataApi();
      const subcommand = command.args[0] ?? "list";
      if (subcommand === "list") {
        const bookId = command.args[1];
        if (!bookId) return failure("missing_book_id", "chapters list requires a book id");
        return success({ chapters: await data.listIndexedChapters({ bookId, env }) });
      }
      return failure("unknown_chapters_command", `Unknown chapters command: ${subcommand}`);
    }

    if (command.name === "chapter") {
      const data = await getDataApi();
      const subcommand = command.args[0] ?? "get";
      if (subcommand === "get") {
        const bookId = command.args[1];
        const chapterId = command.args[2];
        if (!bookId) return failure("missing_book_id", "chapter get requires a book id");
        if (!chapterId) return failure("missing_chapter_id", "chapter get requires a chapter id");
        const chapter = await data.getIndexedChapter({
          bookId,
          chapterId,
          chunkStart: getNumberOption(command, "chunk-start", 1),
          chunkCount: getNumberOption(command, "chunk-count", 0, { max: 200 }) || undefined,
          contentLimit: getLimit(command, 12000, 50000),
          env,
        });
        if (!chapter) {
          return failure("chapter_not_found", `Chapter ${chapterId} was not found in ${bookId}`);
        }
        return success({ chapter });
      }
      return failure("unknown_chapter_command", `Unknown chapter command: ${subcommand}`);
    }

    if (command.name === "notes") {
      const data = await getDataApi();
      const subcommand = command.args[0] ?? "search";
      if (subcommand === "search") {
        const query = command.args.slice(1).join(" ");
        if (!query) {
          return failure("missing_query", "notes search requires a query");
        }
        return success({
          notes: await data.listNotes({
            query,
            bookId: getStringOption(command, "book"),
            limit: getLimit(command, 50, 200),
            env,
          }),
        });
      }
      if (subcommand === "export") {
        const profile = parseAccessProfile(command.profile);
        if (!profileHasScope(profile, "epub.export")) {
          return failure("permission_denied", "notes export requires publisher profile or higher");
        }
        const bookId = command.args[1];
        const outputPath = getStringOption(command, "output");
        if (!bookId) return failure("missing_book_id", "notes export requires a book id");
        if (!outputPath)
          return failure("missing_output_path", "notes export requires --output <path>");
        const format = getStringOption(command, "format") ?? "markdown";
        if (!isNotesExportFormat(format)) {
          return failure(
            "unsupported_notes_export_format",
            "notes export format must be markdown, json, obsidian, or notion",
          );
        }
        return success({
          export: await data.exportBookNotesWorkspace({
            bookId,
            outputPath,
            format,
            overwrite: command.options.overwrite === true,
            includeNotes: command.options["no-notes"] === true ? false : undefined,
            includeHighlights: command.options["no-highlights"] === true ? false : undefined,
            groupByChapter: command.options.flat === true ? false : undefined,
            env,
          }),
        });
      }
      return failure("unknown_notes_command", `Unknown notes command: ${subcommand}`);
    }

    if (command.name === "highlights") {
      const data = await getDataApi();
      const subcommand = command.args[0] ?? "search";
      if (subcommand === "search") {
        const query = command.args.slice(1).join(" ");
        if (!query) {
          return failure("missing_query", "highlights search requires a query");
        }
        return success({
          highlights: await data.listHighlights({
            query,
            bookId: getStringOption(command, "book"),
            limit: getLimit(command, 50, 200),
            env,
          }),
        });
      }
      return failure("unknown_highlights_command", `Unknown highlights command: ${subcommand}`);
    }

    if (command.name === "knowledge") {
      const data = await getDataApi();
      const subcommand = command.args[0] ?? "search";
      if (subcommand === "search") {
        const query = command.args.slice(1).join(" ");
        if (!query) {
          return failure("missing_query", "knowledge search requires a query");
        }
        return success({
          knowledge: await data.searchKnowledgeWorkspace({
            query,
            bookId: getStringOption(command, "book"),
            limit: getLimit(command, 20, 100),
            contentLimit: getNumberOption(command, "content-limit", 240, { min: 40, max: 1000 }),
            scanLimit: getNumberOption(command, "scan-limit", 1000, { max: 10000 }),
            includeBooks: command.options["no-books"] === true ? false : undefined,
            includeNotes: command.options["no-notes"] === true ? false : undefined,
            includeHighlights: command.options["no-highlights"] === true ? false : undefined,
            env,
          }),
        });
      }
      if (subcommand === "export") {
        const profile = parseAccessProfile(command.profile);
        if (!profileHasScope(profile, "epub.export")) {
          return failure(
            "permission_denied",
            "knowledge export requires publisher profile or higher",
          );
        }
        const outputPath = getStringOption(command, "output");
        if (!outputPath) {
          return failure("missing_output_path", "knowledge export requires --output <path>");
        }
        const format = getStringOption(command, "format") ?? "markdown";
        if (!isKnowledgeExportFormat(format)) {
          return failure(
            "unsupported_knowledge_export_format",
            "knowledge export format must be markdown, json, or obsidian",
          );
        }
        return success({
          export: await data.exportKnowledgeWorkspace({
            outputPath,
            format,
            overwrite: command.options.overwrite === true,
            includeBooks: command.options["no-books"] === true ? false : undefined,
            includeNotes: command.options["no-notes"] === true ? false : undefined,
            includeHighlights: command.options["no-highlights"] === true ? false : undefined,
            limit: getLimit(command, 1000, 10000),
            env,
          }),
        });
      }
      return failure("unknown_knowledge_command", `Unknown knowledge command: ${subcommand}`);
    }

    if (command.name === "rag") {
      const data = await getDataApi();
      const subcommand = command.args[0] ?? "search";
      if (subcommand === "search") {
        const query = command.args.slice(1).join(" ");
        if (!query) return failure("missing_query", "rag search requires a query");
        const bookId = getStringOption(command, "book");
        if (!bookId) return failure("missing_book_id", "rag search requires --book <book-id>");
        const mode = getStringOption(command, "mode") ?? "bm25";
        if (!isRagSearchMode(mode)) {
          return failure("unsupported_rag_mode", "--mode must be bm25, hybrid, or vector");
        }
        return success({
          results: await data.searchRag({
            query,
            bookId,
            mode,
            limit: getLimit(command, 5, 50),
            env,
          }),
        });
      }
      return failure("unknown_rag_command", `Unknown rag command: ${subcommand}`);
    }

    if (command.name === "context") {
      const data = await getDataApi();
      const subcommand = command.args[0] ?? "get";
      if (subcommand === "get") {
        return success({
          readerContext: await data.getReaderContextSnapshot({
            includeSelection: getBooleanOption(command, "include-selection", true),
            includeSurroundingText: getBooleanOption(command, "include-surrounding-text", true),
            includeHighlights: getBooleanOption(command, "include-highlights", true),
            contentLimit: getNumberOption(command, "limit", 12000, { max: 50000 }),
            env,
          }),
        });
      }
      return failure("unknown_context_command", `Unknown context command: ${subcommand}`);
    }

    if (command.name === "epub") {
      const data = await getDataApi();
      const subcommand = command.args[0];
      if (subcommand === "inspect") {
        const profile = parseAccessProfile(command.profile);
        if (!profileHasScope(profile, "epub.inspect")) {
          return failure("permission_denied", "epub inspect requires editor profile or higher");
        }
        const bookId = command.args[1];
        if (!bookId) return failure("missing_book_id", "epub inspect requires a book id");
        const inspect = await data.inspectEpubBook(bookId, env);
        if (!inspect) return failure("book_not_found", `Book ${bookId} was not found`);
        return success({ epub: inspect });
      }
      if (subcommand === "draft") {
        const draftCommand = command.args[1];
        if (draftCommand === "create") {
          const profile = parseAccessProfile(command.profile);
          if (!profileHasScope(profile, "epub.draft")) {
            return failure(
              "permission_denied",
              "epub draft create requires editor profile or higher",
            );
          }
          const bookId = command.args[2];
          if (!bookId) return failure("missing_book_id", "epub draft create requires a book id");
          const draft = await data.createEpubDraftForBook(bookId, env);
          if (!draft) return failure("book_not_found", `Book ${bookId} was not found`);
          return success({ draft });
        }
        if (draftCommand === "discard") {
          const profile = parseAccessProfile(command.profile);
          if (!profileHasScope(profile, "epub.draft")) {
            return failure(
              "permission_denied",
              "epub draft discard requires editor profile or higher",
            );
          }
          const draftId = command.args[2];
          if (!draftId)
            return failure("missing_draft_id", "epub draft discard requires a draft id");
          const discarded = await data.discardEpubDraftWorkspace({
            draftId,
            reason: getStringOption(command, "reason"),
            env,
          });
          return success({ discarded });
        }
        return failure(
          "unknown_epub_draft_command",
          `Unknown epub draft command: ${draftCommand ?? ""}`.trim(),
        );
      }
      if (subcommand === "chapter") {
        const chapterCommand = command.args[1];
        if (chapterCommand === "read") {
          const profile = parseAccessProfile(command.profile);
          if (!profileHasScope(profile, "epub.draft")) {
            return failure(
              "permission_denied",
              "epub chapter read requires editor profile or higher",
            );
          }
          const draftId = command.args[2];
          const chapterId = command.args[3];
          if (!draftId) return failure("missing_draft_id", "epub chapter read requires a draft id");
          if (!chapterId) {
            return failure("missing_chapter_id", "epub chapter read requires a chapter id");
          }
          const format = getStringOption(command, "format") ?? "text";
          if (!isEpubChapterReadFormat(format)) {
            return failure("invalid_format", "epub chapter read format must be text or xhtml");
          }
          const chapter = await data.readEpubChapter({
            draftId,
            chapterId,
            contentLimit: getLimit(command, 12000, 50000),
            contentFormat: format,
            env,
          });
          if (!chapter) return failure("chapter_not_found", `Chapter ${chapterId} was not found`);
          return success({ chapter });
        }
        if (chapterCommand === "patch") {
          const profile = parseAccessProfile(command.profile);
          if (!profileHasScope(profile, "epub.draft")) {
            return failure(
              "permission_denied",
              "epub chapter patch requires editor profile or higher",
            );
          }
          const draftId = command.args[2];
          const chapterId = command.args[3];
          const xhtmlPath = getStringOption(command, "xhtml");
          if (!draftId)
            return failure("missing_draft_id", "epub chapter patch requires a draft id");
          if (!chapterId) {
            return failure("missing_chapter_id", "epub chapter patch requires a chapter id");
          }
          if (!xhtmlPath) {
            return failure("missing_xhtml_file", "epub chapter patch requires --xhtml <file>");
          }
          const { readFile } = await import("node:fs/promises");
          const xhtml = await readFile(xhtmlPath, "utf8");
          const patch = await data.patchEpubChapter({
            draftId,
            chapterId,
            xhtml,
            env,
          });
          return success({ patch });
        }
        return failure(
          "unknown_epub_chapter_command",
          `Unknown epub chapter command: ${chapterCommand ?? ""}`.trim(),
        );
      }
      if (subcommand === "chapters") {
        const chaptersCommand = command.args[1];
        if (chaptersCommand === "patch") {
          const profile = parseAccessProfile(command.profile);
          if (!profileHasScope(profile, "epub.draft")) {
            return failure(
              "permission_denied",
              "epub chapters patch requires editor profile or higher",
            );
          }
          const draftId = command.args[2];
          const patchPath = getStringOption(command, "patch");
          if (!draftId)
            return failure("missing_draft_id", "epub chapters patch requires a draft id");
          if (!patchPath) {
            return failure("missing_patch_file", "epub chapters patch requires --patch <file>");
          }
          const { readFile } = await import("node:fs/promises");
          const patches = parseEpubChapterPatchPlan(JSON.parse(await readFile(patchPath, "utf8")));
          const batch = await data.patchEpubChapters({
            draftId,
            patches,
            env,
          });
          return success({ batch });
        }
        return failure(
          "unknown_epub_chapters_command",
          `Unknown epub chapters command: ${chaptersCommand ?? ""}`.trim(),
        );
      }
      if (subcommand === "metadata") {
        const metadataCommand = command.args[1];
        if (metadataCommand === "patch") {
          const profile = parseAccessProfile(command.profile);
          if (!profileHasScope(profile, "epub.draft")) {
            return failure(
              "permission_denied",
              "epub metadata patch requires editor profile or higher",
            );
          }
          const draftId = command.args[2];
          const patchPath = getStringOption(command, "patch");
          if (!draftId)
            return failure("missing_draft_id", "epub metadata patch requires a draft id");
          if (!patchPath) {
            return failure("missing_patch_file", "epub metadata patch requires --patch <file>");
          }
          const { readFile } = await import("node:fs/promises");
          const patch = parseEpubMetadataPatch(JSON.parse(await readFile(patchPath, "utf8")));
          const result = await data.patchEpubMetadata({
            draftId,
            patch,
            env,
          });
          return success({ metadata: result });
        }
        return failure(
          "unknown_epub_metadata_command",
          `Unknown epub metadata command: ${metadataCommand ?? ""}`.trim(),
        );
      }
      if (subcommand === "toc") {
        const tocCommand = command.args[1];
        if (tocCommand === "rebuild") {
          const profile = parseAccessProfile(command.profile);
          if (!profileHasScope(profile, "epub.draft")) {
            return failure(
              "permission_denied",
              "epub toc rebuild requires editor profile or higher",
            );
          }
          const draftId = command.args[2];
          if (!draftId) return failure("missing_draft_id", "epub toc rebuild requires a draft id");
          const toc = await data.rebuildEpubTocWorkspace(draftId, env);
          return success({ toc });
        }
        return failure(
          "unknown_epub_toc_command",
          `Unknown epub toc command: ${tocCommand ?? ""}`.trim(),
        );
      }
      if (subcommand === "history") {
        const profile = parseAccessProfile(command.profile);
        if (!profileHasScope(profile, "epub.draft")) {
          return failure("permission_denied", "epub history requires editor profile or higher");
        }
        const draftId = command.args[1];
        if (!draftId) return failure("missing_draft_id", "epub history requires a draft id");
        const history = await data.getEpubDraftHistory(draftId, env);
        return success({ history });
      }
      if (subcommand === "diff") {
        const profile = parseAccessProfile(command.profile);
        if (!profileHasScope(profile, "epub.draft")) {
          return failure("permission_denied", "epub diff requires editor profile or higher");
        }
        const draftId = command.args[1];
        if (!draftId) return failure("missing_draft_id", "epub diff requires a draft id");
        const diff = await data.diffEpubDraftWorkspace(draftId, env);
        return success({ diff });
      }
      if (subcommand === "undo") {
        const profile = parseAccessProfile(command.profile);
        if (!profileHasScope(profile, "epub.draft")) {
          return failure("permission_denied", "epub undo requires editor profile or higher");
        }
        const draftId = command.args[1];
        const operationId = command.args[2];
        if (!draftId) return failure("missing_draft_id", "epub undo requires a draft id");
        if (!operationId) {
          return failure("missing_operation_id", "epub undo requires an operation id");
        }
        const undo = await data.undoEpubDraftWorkspace({
          draftId,
          operationId,
          env,
        });
        return success({ undo });
      }
      if (subcommand === "validate") {
        const profile = parseAccessProfile(command.profile);
        if (!profileHasScope(profile, "epub.export")) {
          return failure("permission_denied", "epub validate requires publisher profile or higher");
        }
        const draftId = command.args[1];
        if (!draftId) return failure("missing_draft_id", "epub validate requires a draft id");
        const validation = await data.validateEpubDraftWorkspace(draftId, env);
        return success({ validation });
      }
      if (subcommand === "export") {
        const profile = parseAccessProfile(command.profile);
        if (!profileHasScope(profile, "epub.export")) {
          return failure("permission_denied", "epub export requires publisher profile or higher");
        }
        const draftId = command.args[1];
        const outputPath = getStringOption(command, "output");
        if (!draftId) return failure("missing_draft_id", "epub export requires a draft id");
        if (!outputPath)
          return failure("missing_output_path", "epub export requires --output <path>");
        const exported = await data.exportEpubDraftWorkspace({
          draftId,
          outputPath,
          overwrite: command.options.overwrite === true,
          env,
        });
        return success({ export: exported });
      }
      return failure("unknown_epub_command", `Unknown epub command: ${subcommand ?? ""}`.trim());
    }

    if (command.name === "bookmarks") {
      const data = await getDataApi();
      const subcommand = command.args[0] ?? "list";
      if (subcommand === "list") {
        const bookId = command.args[1];
        if (!bookId) return failure("missing_book_id", "bookmarks list requires a book id");
        return success({ bookmarks: await data.listBookmarks(bookId, env) });
      }
      return failure("unknown_bookmarks_command", `Unknown bookmarks command: ${subcommand}`);
    }

    if (command.name === "skills") {
      const data = await getDataApi();
      const subcommand = command.args[0] ?? "list";
      if (subcommand === "list") {
        return success({ skills: await data.listSkills(env) });
      }
      return failure("unknown_skills_command", `Unknown skills command: ${subcommand}`);
    }

    return failure("unknown_command", `Unknown command: ${command.name}`);
  } catch (error) {
    if (error instanceof InvalidCommandOptionError) {
      return failure(error.code, error.message);
    }
    return failure("command_failed", error instanceof Error ? error.message : String(error));
  }
}

export async function runCommand(argv: string[], env = process.env): Promise<CommandResult> {
  return executeCommand(argv, env);
}
