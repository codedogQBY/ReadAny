import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { platform } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type CliPaths = {
  packageRoot: string;
  binPath: string;
  agentHome: string;
  skillDir: string;
  skillFile: string;
  readanyHome: string;
};

type ExecutableResolutionRuntime = {
  argv1?: string;
  moduleUrl?: string;
};

const CLI_ENTRY_NAMES = new Set(["readany", "readany.js", "readany.cmd", "readany.ts"]);

function normalizePath(path: string): string {
  return path.split(/[\\/]+/).join(sep);
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function looksLikeCliEntrypoint(path: string): boolean {
  const normalized = normalizePath(path);
  const name = basename(normalized);
  return (
    CLI_ENTRY_NAMES.has(name) ||
    normalized.endsWith(`${sep}dist${sep}bin${sep}readany.js`) ||
    normalized.endsWith(`${sep}src${sep}bin${sep}readany.ts`)
  );
}

function deriveEntrypointFromModule(modulePath: string): string {
  const normalized = normalizePath(modulePath);
  if (normalized.includes(`${sep}dist${sep}chunks${sep}`)) {
    return resolve(dirname(modulePath), "..", "bin", "readany.js");
  }
  if (normalized.endsWith(`${sep}dist${sep}bin${sep}readany.js`)) {
    return modulePath;
  }
  if (normalized.endsWith(`${sep}src${sep}paths.ts`)) {
    return resolve(dirname(modulePath), "bin", "readany.ts");
  }
  return modulePath;
}

export function resolveExecutablePath(
  env: NodeJS.ProcessEnv = process.env,
  runtime: ExecutableResolutionRuntime = {},
): string {
  if (env.READANY_CLI_BIN_PATH) {
    return resolve(env.READANY_CLI_BIN_PATH);
  }

  const argv1 = runtime.argv1 ?? process.argv[1];
  if (argv1) {
    const resolvedArgvPath = resolve(argv1);
    const realArgvPath = safeRealpath(resolvedArgvPath);
    if (looksLikeCliEntrypoint(realArgvPath) || looksLikeCliEntrypoint(resolvedArgvPath)) {
      return realArgvPath;
    }
  }

  return deriveEntrypointFromModule(fileURLToPath(runtime.moduleUrl ?? import.meta.url));
}

export function resolvePackageRoot(env: NodeJS.ProcessEnv = process.env): string {
  const executablePath = resolveExecutablePath(env);
  return resolve(dirname(executablePath), "..", "..");
}

export function getAgentHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENT_HOME ? resolve(env.AGENT_HOME) : join(homedir(), ".agent");
}

export function getReadAnyHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.READANY_HOME) return resolve(env.READANY_HOME);

  if (platform() === "win32") {
    return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "com.readany.app");
  }

  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "com.readany.app");
  }

  return join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "com.readany.app");
}

export function getCliPaths(env: NodeJS.ProcessEnv = process.env): CliPaths {
  const packageRoot = resolvePackageRoot(env);
  const agentHome = getAgentHome(env);
  const readanyHome = getReadAnyHome(env);
  const skillDir = join(agentHome, "skills", "readany");
  const binPath = resolveExecutablePath(env);

  return {
    packageRoot,
    binPath,
    agentHome,
    skillDir,
    skillFile: join(skillDir, "SKILL.md"),
    readanyHome,
  };
}
