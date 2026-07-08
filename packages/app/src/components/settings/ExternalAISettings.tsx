import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getPlatformService } from "@readany/core/services";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  FileCheck2,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type CliAction =
  | "version"
  | "install"
  | "uninstall"
  | "repair"
  | "agent_setup"
  | "agent_uninstall"
  | "doctor"
  | "mcp_config"
  | "tools_list"
  | "skill_status";

type CliRunResult = {
  ok: boolean;
  action: string;
  command: string;
  command_source?: string;
  args: string[];
  status?: number | null;
  stdout: string;
  stderr: string;
};

type CliRunOptions = {
  mcpProfile?: McpProfile;
  mcpClient?: AgentSetupClient;
};

type McpProfile = "readonly" | "editor" | "publisher";
type McpClient = "generic" | "codex" | "claude" | "cursor" | "opencode";
type AgentSetupClient = McpClient | "all";

const EXTERNAL_AI_PROFILE_STORAGE_KEY = "readany-external-ai-profile";
const EXTERNAL_AI_CLIENT_STORAGE_KEY = "readany-external-ai-client";
const EXTERNAL_AI_PROFILE_RISK_CONFIRMED_STORAGE_KEY = "readany-external-ai-profile-risk-confirmed";

function isMcpProfile(value: string | null): value is McpProfile {
  return value === "readonly" || value === "editor" || value === "publisher";
}

function isMcpClient(value: string | null): value is McpClient {
  return (
    value === "generic" ||
    value === "codex" ||
    value === "claude" ||
    value === "cursor" ||
    value === "opencode"
  );
}

function readStoredMcpProfile(): McpProfile {
  if (typeof window === "undefined") return "readonly";
  try {
    const stored = window.localStorage.getItem(EXTERNAL_AI_PROFILE_STORAGE_KEY);
    return isMcpProfile(stored) ? stored : "readonly";
  } catch {
    return "readonly";
  }
}

function readStoredMcpClient(): McpClient {
  if (typeof window === "undefined") return "generic";
  try {
    const stored = window.localStorage.getItem(EXTERNAL_AI_CLIENT_STORAGE_KEY);
    return isMcpClient(stored) ? stored : "generic";
  } catch {
    return "generic";
  }
}

function readStoredProfileRiskConfirmed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(EXTERNAL_AI_PROFILE_RISK_CONFIRMED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredExternalAiOption(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The selection still updates in memory; persistence is best-effort.
  }
}

type CommandResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

type DoctorReport = {
  version: string;
  profile: string;
  runtime?: {
    node: string;
    executable: string;
    nativeSqliteAvailable: boolean;
    nativeSqlitePath?: string;
  };
  distribution?: {
    kind: string;
    usesNodeRuntime: boolean;
    nativeBinary: boolean;
    entrypoint?: string;
    modulePath: string;
    bundleRoot?: string;
    builtBundle: boolean;
    desktopResourceBundle: boolean;
  };
  tools: { count: number };
  mcp?: {
    defaultProfile: string;
    serveArgs: string[];
    supportedProfiles: string[];
    supportedClients: string[];
    toolCount: number;
  };
  agentAccess?: {
    cliShim: {
      path: string;
      installed: boolean;
      target?: string;
      managed: boolean;
    };
    skill: {
      installed: boolean;
      path: string;
      version?: string;
    };
    clientSkills: Array<{
      client: "agents" | McpClient;
      path: string;
      installed: boolean;
      managed: boolean;
      target?: string;
    }>;
    mcpConfigs: Array<{
      client: McpClient;
      path: string;
      configured: boolean;
      checked: boolean;
    }>;
  };
  checks: Array<{ name: string; ok: boolean; message: string }>;
};

type SkillStatus = {
  installed: boolean;
  path: string;
  version?: string;
};

function createMcpConfig(profile: McpProfile, client: McpClient) {
  if (client === "codex") {
    return [
      "[mcp_servers.readany]",
      'command = "readany"',
      `args = ["mcp","serve","--profile","${profile}"]`,
    ].join("\n");
  }

  if (client === "opencode") {
    return JSON.stringify(
      {
        mcp: {
          readany: {
            type: "local",
            command: ["readany", "mcp", "serve", "--profile", profile],
            enabled: true,
          },
        },
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      mcpServers: {
        readany: {
          command: "readany",
          args: ["mcp", "serve", "--profile", profile],
        },
      },
    },
    null,
    2,
  );
}

function createAgentSetupCommand(profile: McpProfile, client: AgentSetupClient) {
  return `readany agent setup --user --client ${client} --profile ${profile} --json`;
}

type SkillInstallPromptCopy = {
  intro: string;
  execute: string;
  mergeConfig: string;
  done: string;
  protectBooks: string;
};

function createSkillInstallPrompt(
  profile: McpProfile,
  client: AgentSetupClient,
  copy: SkillInstallPromptCopy,
) {
  const setupCommand = createAgentSetupCommand(profile, client);
  return [
    copy.intro,
    copy.execute,
    "readany repair --user --json",
    setupCommand,
    "readany doctor --json",
    copy.mergeConfig,
    copy.done,
    copy.protectBooks,
  ].join("\n");
}

function parseCliJson<T>(result?: CliRunResult): CommandResult<T> | undefined {
  if (!result) return undefined;
  const text = result.stdout.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as CommandResult<T>;
  } catch {
    return undefined;
  }
}

function statusLabel(ok: boolean, yes: string, no: string) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium leading-none ${
        ok ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {ok ? yes : no}
    </span>
  );
}

function neutralStatusLabel(label: string) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium leading-none text-muted-foreground">
      <AlertTriangle className="h-3 w-3" />
      {label}
    </span>
  );
}

function outputSummary(
  result: CliRunResult | undefined,
  parsed: CommandResult | undefined,
  labels: { notRun: string; success: string; exitStatus: string },
) {
  if (!result) return labels.notRun;
  if (parsed?.ok === false) return parsed.error.message;
  if (result.ok) return labels.success;
  return (
    result.stderr.trim() ||
    result.stdout.trim() ||
    labels.exitStatus.replace("{{status}}", String(result.status ?? "unknown"))
  );
}

function outputPanel(text: string, tone: "default" | "error" = "default") {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs leading-5 ${
        tone === "error"
          ? "border-destructive/20 bg-destructive/5 text-destructive"
          : "border-border/60 bg-background text-muted-foreground"
      }`}
    >
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
        {text}
      </pre>
    </div>
  );
}

function evidenceValue(label: string, value: string | number | boolean | undefined, mono = true) {
  const rendered =
    typeof value === "boolean"
      ? value
        ? "true"
        : "false"
      : value === undefined
        ? "-"
        : String(value);
  return (
    <div className="min-w-0 rounded-md border border-border/40 bg-background/70 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={`mt-1 truncate text-xs text-foreground ${mono ? "font-mono" : "font-medium"}`}
        title={rendered}
      >
        {rendered}
      </p>
    </div>
  );
}

function compactStatusItem(label: string, status: ReactNode) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border/40 bg-background/70 px-3 py-2">
      <p className="min-w-0 text-[11px] font-medium text-muted-foreground">{label}</p>
      <div className="shrink-0">{status}</div>
    </div>
  );
}

function AccessProfileSelect({
  value,
  onChange,
  label,
  triggerClassName = "h-8 text-xs",
}: {
  value: McpProfile;
  onChange: (value: string) => void;
  label: string;
  triggerClassName?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={triggerClassName}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="readonly">readonly</SelectItem>
          <SelectItem value="editor">editor</SelectItem>
          <SelectItem value="publisher">publisher</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function AccessRiskConfirmation({
  checked,
  id,
  label,
  onChange,
  visible,
}: {
  checked: boolean;
  id: string;
  label: string;
  onChange: (checked: boolean) => void;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <label className="flex items-start gap-3 rounded-md bg-background px-3 py-3" htmlFor={id}>
      <Switch checked={checked} id={id} onCheckedChange={onChange} />
      <span className="min-w-0 text-xs leading-5 text-muted-foreground">{label}</span>
    </label>
  );
}

function getDoctorCheckCopy(
  check: DoctorReport["checks"][number],
  t: (key: string, options?: Record<string, unknown>) => string,
  report: DoctorReport | undefined,
  skillStatus: SkillStatus | undefined,
) {
  const runtime = report?.runtime;
  if (check.name === "node-runtime") {
    return {
      name: t("settings.externalAiSettings.doctorChecks.nodeRuntime.name"),
      message: t("settings.externalAiSettings.doctorChecks.nodeRuntime.message", {
        executable: runtime?.executable ?? "-",
        version: runtime?.node ?? "-",
      }),
    };
  }
  if (check.name === "native-sqlite") {
    return {
      name: t("settings.externalAiSettings.doctorChecks.nativeSqlite.name"),
      message: check.ok
        ? t("settings.externalAiSettings.doctorChecks.nativeSqlite.ok")
        : t("settings.externalAiSettings.doctorChecks.nativeSqlite.fail"),
    };
  }
  if (check.name === "readany-home") {
    return {
      name: t("settings.externalAiSettings.doctorChecks.readanyHome.name"),
      message: check.ok
        ? t("settings.externalAiSettings.doctorChecks.readanyHome.ok")
        : t("settings.externalAiSettings.doctorChecks.readanyHome.fail"),
    };
  }
  if (check.name === "skill") {
    return {
      name: t("settings.externalAiSettings.doctorChecks.skill.name"),
      message: check.ok
        ? t("settings.externalAiSettings.doctorChecks.skill.ok", {
            path: skillStatus?.path ?? "-",
          })
        : t("settings.externalAiSettings.doctorChecks.skill.fail", {
            path: skillStatus?.path ?? "-",
          }),
    };
  }
  return check;
}

export function ExternalAISettings() {
  const { t } = useTranslation();
  const [loadingAction, setLoadingAction] = useState<CliAction | null>(null);
  const [versionResult, setVersionResult] = useState<CliRunResult>();
  const [doctorResult, setDoctorResult] = useState<CliRunResult>();
  const [skillResult, setSkillResult] = useState<CliRunResult>();
  const [toolsResult, setToolsResult] = useState<CliRunResult>();
  const [lastActionResult, setLastActionResult] = useState<CliRunResult>();
  const [copiedTarget, setCopiedTarget] = useState<"skillPrompt" | "mcp" | "evidence" | null>(null);
  const [mcpProfile, setMcpProfile] = useState<McpProfile>(() => readStoredMcpProfile());
  const [mcpClient, setMcpClient] = useState<McpClient>(() => readStoredMcpClient());
  const [profileRiskConfirmed, setProfileRiskConfirmed] = useState(() =>
    readStoredProfileRiskConfirmed(),
  );

  const doctor = useMemo(() => parseCliJson<DoctorReport>(doctorResult), [doctorResult]);
  const skill = useMemo(() => parseCliJson<SkillStatus>(skillResult), [skillResult]);
  const tools = useMemo(
    () => parseCliJson<{ tools: Array<{ name: string; risk: string }> }>(toolsResult),
    [toolsResult],
  );

  const cliAvailable = Boolean(versionResult?.ok);
  const cliVersion = versionResult?.ok ? versionResult.stdout.trim() : "";
  const doctorRuntime = doctor?.ok ? doctor.data.runtime : undefined;
  const doctorDistribution = doctor?.ok ? doctor.data.distribution : undefined;
  const skillInstalled = skill?.ok ? skill.data.installed : false;
  const agentAccess = doctor?.ok ? doctor.data.agentAccess : undefined;
  const clientSkillRows = agentAccess?.clientSkills ?? [];
  const mcpConfigRows = agentAccess?.mcpConfigs ?? [];
  const clientSkillReady =
    clientSkillRows.length > 0 && clientSkillRows.every((row) => row.installed && row.managed);
  const mcpConfigsReady = mcpConfigRows.length > 0 && mcpConfigRows.every((row) => row.configured);
  const readyChecks = [
    cliAvailable,
    doctor?.ok === true,
    doctor?.ok ? doctor.data.checks.every((check) => check.ok) : false,
    skillInstalled,
    clientSkillReady,
    mcpConfigsReady,
  ];
  const readyCount = readyChecks.filter(Boolean).length;
  const betaReady = readyCount >= 5;
  const readinessLabel = betaReady
    ? t("settings.externalAiSettings.status.betaReady")
    : readyCount >= 3
      ? t("settings.externalAiSettings.status.needsRepair")
      : t("settings.externalAiSettings.status.notReady");
  const readonlyToolNames = tools?.ok ? tools.data.tools.map((tool) => tool.name) : [];
  const needsProfileConfirmation = mcpProfile !== "readonly";
  const profileAccessConfirmed = !needsProfileConfirmation || profileRiskConfirmed;
  const canCopySkillInstallPrompt = profileAccessConfirmed;
  const canCopyMcpConfig = cliAvailable && profileAccessConfirmed;
  const mcpConfig = useMemo(() => createMcpConfig(mcpProfile, mcpClient), [mcpClient, mcpProfile]);
  const mcpClientLabels = useMemo<Record<McpClient, string>>(
    () => ({
      generic: t("settings.externalAiSettings.clients.generic"),
      codex: t("settings.externalAiSettings.clients.codex"),
      claude: "Claude",
      cursor: "Cursor",
      opencode: "OpenCode",
    }),
    [t],
  );
  const outputLabels = useMemo(
    () => ({
      notRun: t("settings.externalAiSettings.output.notRun"),
      success: t("settings.externalAiSettings.output.success"),
      exitStatus: t("settings.externalAiSettings.output.exitStatus"),
    }),
    [t],
  );
  const skillInstallPrompt = useMemo(
    () =>
      createSkillInstallPrompt(mcpProfile, "all", {
        intro: t("settings.externalAiSettings.skillPrompt.intro"),
        execute: t("settings.externalAiSettings.skillPrompt.execute"),
        mergeConfig: t("settings.externalAiSettings.skillPrompt.mergeConfig"),
        done: t("settings.externalAiSettings.skillPrompt.done"),
        protectBooks: t("settings.externalAiSettings.skillPrompt.protectBooks"),
      }),
    [mcpProfile, t],
  );
  const evidenceSnapshot = useMemo(
    () =>
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          cli: {
            available: cliAvailable,
            version: cliVersion || null,
            source: lastActionResult?.command_source ?? versionResult?.command_source ?? null,
          },
          doctor: doctor?.ok ? doctor.data : null,
          skill: skill?.ok ? skill.data : null,
          mcp: {
            profile: mcpProfile,
            client: mcpClient,
            config: mcpConfig,
          },
          tools: tools?.ok
            ? tools.data.tools.map((tool) => ({ name: tool.name, risk: tool.risk }))
            : [],
          lastAction: lastActionResult
            ? {
                action: lastActionResult.action,
                ok: lastActionResult.ok,
                command: lastActionResult.command,
                command_source: lastActionResult.command_source,
                status: lastActionResult.status,
              }
            : null,
        },
        null,
        2,
      ),
    [
      cliAvailable,
      cliVersion,
      doctor,
      lastActionResult,
      mcpClient,
      mcpConfig,
      mcpProfile,
      skill,
      tools,
      versionResult?.command_source,
      lastActionResult?.command_source,
    ],
  );

  async function runCli(action: CliAction, options?: CliRunOptions) {
    setLoadingAction(action);
    try {
      const result = await invoke<CliRunResult>("readany_cli_run", {
        action,
        options: options ?? null,
      });
      setLastActionResult(result);
      if (action === "version") setVersionResult(result);
      if (action === "doctor") setDoctorResult(result);
      if (action === "tools_list") setToolsResult(result);
      if (action.startsWith("skill_")) setSkillResult(result);
      return result;
    } catch (error) {
      const failed: CliRunResult = {
        ok: false,
        action,
        command: "readany",
        args: [],
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        command_source: "unknown",
      };
      setLastActionResult(failed);
      if (action === "version") setVersionResult(failed);
      if (action === "doctor") setDoctorResult(failed);
      if (action === "tools_list") setToolsResult(failed);
      if (action.startsWith("skill_")) setSkillResult(failed);
      return failed;
    } finally {
      setLoadingAction(null);
    }
  }

  async function refreshAll() {
    await runCli("version");
    await runCli("doctor", { mcpProfile });
    await runCli("skill_status");
    await runCli("tools_list");
  }

  async function handleCliInstall() {
    await runCli("install");
    await refreshAll();
  }

  async function handleCliRepair() {
    await runCli("repair");
    await refreshAll();
  }

  async function handleRepairExternalAccess() {
    await runCli("repair");
    await runCli("agent_setup", { mcpProfile, mcpClient: "all" });
    await refreshAll();
  }

  async function handleUninstallExternalAccess() {
    const result = await runCli("agent_uninstall");
    const parsed = parseCliJson(result);
    if (result.ok && parsed?.ok !== false) {
      toast.success(t("settings.externalAiSettings.output.accessUninstalled"));
    } else {
      toast.error(outputSummary(result, parsed, outputLabels));
    }
    await refreshAll();
  }

  async function handleCliUninstall() {
    const result = await runCli("uninstall");
    const parsed = parseCliJson(result);
    if (result.ok && parsed?.ok !== false) {
      toast.success(t("settings.externalAiSettings.output.cliUninstalled"));
    } else {
      toast.error(outputSummary(result, parsed, outputLabels));
    }
    await refreshAll();
  }

  async function copyMcpConfig() {
    if (!canCopyMcpConfig) return;
    const result = await runCli("mcp_config", { mcpProfile, mcpClient });
    const parsed = parseCliJson<{
      client: McpClient;
      format: "json" | "toml";
      snippet?: string;
      mcpServers?: { readany: { command: string; args: string[] } };
      mcp?: { readany: { type: "local"; command: string[]; enabled: boolean } };
    }>(result);
    const config = parsed?.ok
      ? (parsed.data.snippet ?? JSON.stringify(parsed.data, null, 2))
      : mcpConfig;
    await getPlatformService().copyToClipboard(config);
    setCopiedTarget("mcp");
    window.setTimeout(() => setCopiedTarget(null), 1600);
  }

  async function copySkillInstallPrompt() {
    if (!canCopySkillInstallPrompt) return;
    await getPlatformService().copyToClipboard(skillInstallPrompt);
    setCopiedTarget("skillPrompt");
    window.setTimeout(() => setCopiedTarget(null), 1600);
  }

  async function copyEvidenceSnapshot() {
    await getPlatformService().copyToClipboard(evidenceSnapshot);
    setCopiedTarget("evidence");
    window.setTimeout(() => setCopiedTarget(null), 1600);
  }

  function handleMcpProfileChange(value: string) {
    const nextProfile = value as McpProfile;
    setMcpProfile(nextProfile);
    writeStoredExternalAiOption(EXTERNAL_AI_PROFILE_STORAGE_KEY, nextProfile);
    setCopiedTarget(null);
    void runCli("doctor", { mcpProfile: nextProfile });
  }

  function handleMcpClientChange(value: string) {
    const nextClient = value as McpClient;
    setMcpClient(nextClient);
    writeStoredExternalAiOption(EXTERNAL_AI_CLIENT_STORAGE_KEY, nextClient);
    setCopiedTarget(null);
  }

  function handleProfileRiskConfirmedChange(confirmed: boolean) {
    setProfileRiskConfirmed(confirmed);
    writeStoredExternalAiOption(
      EXTERNAL_AI_PROFILE_RISK_CONFIRMED_STORAGE_KEY,
      confirmed ? "true" : "false",
    );
    setCopiedTarget(null);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial diagnostics should run once on mount.
  useEffect(() => {
    void refreshAll();
  }, []);

  const busy = loadingAction !== null;
  const uninstallingAccess = loadingAction === "agent_uninstall";
  const uninstallingCli = loadingAction === "uninstall";

  return (
    <div className="space-y-3 p-4 pt-3">
      <section className="rounded-lg border border-border/60 bg-background/60 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-foreground">
                {t("settings.externalAiSettings.overview.title")}
              </h2>
              {betaReady
                ? statusLabel(true, readinessLabel, "")
                : readyCount >= 3
                  ? neutralStatusLabel(readinessLabel)
                  : statusLabel(false, "", readinessLabel)}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={refreshAll} disabled={busy}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              {t("settings.externalAiSettings.actions.verify")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRepairExternalAccess}
              disabled={busy || !profileAccessConfirmed}
            >
              <Wrench className="mr-1.5 h-3.5 w-3.5" />
              {t("settings.externalAiSettings.actions.repairExternalAI")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleUninstallExternalAccess}
              disabled={busy}
              className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {uninstallingAccess ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("settings.externalAiSettings.actions.uninstallAccess")}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
          {compactStatusItem(
            t("settings.externalAiSettings.labels.cli"),
            statusLabel(
              cliAvailable,
              t("settings.externalAiSettings.status.available"),
              t("settings.externalAiSettings.status.missing"),
            ),
          )}
          {compactStatusItem(
            t("settings.externalAiSettings.labels.skill"),
            statusLabel(
              skillInstalled,
              t("settings.externalAiSettings.status.installed"),
              t("settings.externalAiSettings.status.notInstalled"),
            ),
          )}
          {compactStatusItem(
            t("settings.externalAiSettings.labels.clientLinks"),
            statusLabel(
              clientSkillReady,
              t("settings.externalAiSettings.status.complete"),
              t("settings.externalAiSettings.status.needsRepair"),
            ),
          )}
          {compactStatusItem(
            t("settings.externalAiSettings.labels.mcpConfig"),
            mcpConfigsReady
              ? statusLabel(true, t("settings.externalAiSettings.status.configured"), "")
              : neutralStatusLabel(t("settings.externalAiSettings.status.needsPasteRestart")),
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-background/60 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-foreground">
                {t("settings.externalAiSettings.skill.title")}
              </h2>
              {statusLabel(
                skillInstalled,
                t("settings.externalAiSettings.status.installed"),
                t("settings.externalAiSettings.status.notInstalled"),
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(180px,260px)_auto] sm:items-end">
            <AccessProfileSelect
              label={t("settings.externalAiSettings.labels.profile")}
              onChange={handleMcpProfileChange}
              triggerClassName="h-10 text-sm"
              value={mcpProfile}
            />
            <Button
              className="h-10 shrink-0 px-4"
              disabled={!canCopySkillInstallPrompt}
              size="sm"
              onClick={copySkillInstallPrompt}
            >
              <Clipboard className="mr-1.5 h-3.5 w-3.5" />
              {copiedTarget === "skillPrompt"
                ? t("settings.externalAiSettings.actions.copied")
                : t("settings.externalAiSettings.actions.copyInstructions")}
            </Button>
          </div>
        </div>

        {needsProfileConfirmation ? (
          <div className="mt-3">
            <AccessRiskConfirmation
              checked={profileRiskConfirmed}
              id="external-ai-skill-profile-confirmation"
              label={t("settings.externalAiSettings.mcp.riskConfirmation")}
              onChange={handleProfileRiskConfirmedChange}
              visible={needsProfileConfirmation}
            />
          </div>
        ) : null}
      </section>

      <details className="group rounded-lg border border-border/60 bg-background/45 transition-colors hover:bg-background/65 open:bg-background/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-foreground">
                {t("settings.externalAiSettings.mcp.title")}
              </h2>
              {statusLabel(
                canCopyMcpConfig,
                t("settings.externalAiSettings.status.canConfigure"),
                t("settings.externalAiSettings.status.waitingConfirmation"),
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-md border border-border/50 bg-background/70 px-2.5 py-1.5 text-xs text-muted-foreground">
            <span>{mcpClientLabels[mcpClient]}</span>
            <span className="hidden sm:inline">
              {t("settings.externalAiSettings.actions.expandDetails")}
            </span>
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          </div>
        </summary>

        <div className="border-t border-border/40 p-4 pt-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(160px,1fr)_minmax(160px,1fr)_auto] lg:items-end">
            <AccessProfileSelect
              label={t("settings.externalAiSettings.labels.profile")}
              onChange={handleMcpProfileChange}
              value={mcpProfile}
            />
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">
                {t("settings.externalAiSettings.labels.client")}
              </p>
              <Select value={mcpClient} onValueChange={handleMcpClientChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="generic">{mcpClientLabels.generic}</SelectItem>
                  <SelectItem value="codex">{mcpClientLabels.codex}</SelectItem>
                  <SelectItem value="claude">{mcpClientLabels.claude}</SelectItem>
                  <SelectItem value="cursor">{mcpClientLabels.cursor}</SelectItem>
                  <SelectItem value="opencode">{mcpClientLabels.opencode}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="h-8"
              size="sm"
              variant="outline"
              onClick={copyMcpConfig}
              disabled={!canCopyMcpConfig}
            >
              <Clipboard className="mr-1.5 h-3.5 w-3.5" />
              {copiedTarget === "mcp"
                ? t("settings.externalAiSettings.actions.copied")
                : t("settings.externalAiSettings.actions.copyConfig")}
            </Button>
          </div>

          {needsProfileConfirmation ? (
            <div className="mt-3">
              <AccessRiskConfirmation
                checked={profileRiskConfirmed}
                id="external-ai-mcp-profile-confirmation"
                label={t("settings.externalAiSettings.mcp.riskConfirmation")}
                onChange={handleProfileRiskConfirmedChange}
                visible={needsProfileConfirmation}
              />
            </div>
          ) : null}

          <pre className="mt-3 max-h-36 overflow-auto rounded-md border border-border/40 bg-background/70 p-3 text-xs leading-5 text-foreground">
            {mcpConfig}
          </pre>

          <div className="mt-3 rounded-md border border-border/40 bg-background/70 px-3 py-2">
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-medium text-foreground">
                {t("settings.externalAiSettings.mcp.currentTools")}
              </p>
            </div>
            <p className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-muted-foreground">
              {readonlyToolNames.length > 0
                ? readonlyToolNames.join(", ")
                : t("settings.externalAiSettings.empty.runDiagnostics")}
            </p>
          </div>
        </div>
      </details>

      <details className="group rounded-lg border border-border/60 bg-background/45 transition-colors hover:bg-background/65 open:bg-background/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-foreground">
                {t("settings.externalAiSettings.cli.title")}
              </h2>
              {statusLabel(
                cliAvailable,
                t("settings.externalAiSettings.status.available"),
                t("settings.externalAiSettings.status.notDetected"),
              )}
            </div>
          </div>
          <div className="flex max-w-[42%] shrink-0 items-center gap-2 rounded-md border border-border/50 bg-background/70 px-2.5 py-1.5 text-xs text-muted-foreground">
            <span className="truncate font-mono">
              {cliVersion || t("settings.externalAiSettings.cli.notInstalledOrPath")}
            </span>
            <span className="hidden shrink-0 sm:inline">
              {t("settings.externalAiSettings.actions.expandDetails")}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
          </div>
        </summary>

        <div className="space-y-3 border-t border-border/40 p-4 pt-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={refreshAll} disabled={busy}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              {t("settings.externalAiSettings.actions.diagnose")}
            </Button>
            <Button size="sm" variant="outline" onClick={handleCliInstall} disabled={busy}>
              {t("settings.externalAiSettings.actions.install")}
            </Button>
            <Button size="sm" variant="outline" onClick={handleCliRepair} disabled={busy}>
              {t("settings.externalAiSettings.actions.repair")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCliUninstall}
              disabled={busy}
              className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {uninstallingCli ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("settings.externalAiSettings.actions.uninstall")}
            </Button>
            <Button size="sm" variant="outline" onClick={copyEvidenceSnapshot} disabled={busy}>
              {copiedTarget === "evidence"
                ? t("settings.externalAiSettings.actions.copied")
                : t("settings.externalAiSettings.actions.copyEvidence")}
            </Button>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
            {evidenceValue(
              t("settings.externalAiSettings.labels.version"),
              cliVersion || t("settings.externalAiSettings.cli.notInstalledOrPath"),
            )}
            {evidenceValue(
              t("settings.externalAiSettings.labels.profile"),
              doctor?.ok ? doctor.data.profile : mcpProfile,
            )}
            {evidenceValue(
              t("settings.externalAiSettings.labels.tools"),
              doctor?.ok ? doctor.data.tools.count : readonlyToolNames.length || "-",
            )}
          </div>
          {evidenceValue(
            t("settings.externalAiSettings.labels.commandSource"),
            [
              lastActionResult?.command_source ??
                versionResult?.command_source ??
                doctorResult?.command_source ??
                t("settings.externalAiSettings.status.notDetectedYet"),
              lastActionResult?.command ?? versionResult?.command ?? "",
            ]
              .filter(Boolean)
              .join(" · "),
          )}

          {doctor?.ok ? (
            <div className="rounded-md border border-border/40 bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <PackageCheck className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-foreground">
                  {t("settings.externalAiSettings.cli.runtimeEvidence")}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
                {evidenceValue(
                  t("settings.externalAiSettings.labels.distribution"),
                  doctorDistribution?.kind,
                )}
                {evidenceValue(
                  t("settings.externalAiSettings.labels.builtBundle"),
                  doctorDistribution?.builtBundle,
                )}
                {evidenceValue(
                  t("settings.externalAiSettings.labels.desktopResource"),
                  doctorDistribution?.desktopResourceBundle,
                )}
                {evidenceValue(
                  t("settings.externalAiSettings.labels.nativeBinary"),
                  doctorDistribution?.nativeBinary,
                )}
                {evidenceValue(
                  t("settings.externalAiSettings.labels.usesNodeRuntime"),
                  doctorDistribution?.usesNodeRuntime,
                )}
                {evidenceValue(t("settings.externalAiSettings.labels.node"), doctorRuntime?.node)}
                {evidenceValue(
                  t("settings.externalAiSettings.labels.nativeSqlite"),
                  doctorRuntime?.nativeSqliteAvailable,
                )}
                {evidenceValue(
                  t("settings.externalAiSettings.labels.bundleRoot"),
                  doctorDistribution?.bundleRoot,
                )}
                {evidenceValue(
                  t("settings.externalAiSettings.labels.entrypoint"),
                  doctorDistribution?.entrypoint,
                )}
                {evidenceValue(
                  t("settings.externalAiSettings.labels.nodeExecutable"),
                  doctorRuntime?.executable,
                )}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            {doctor?.ok
              ? doctor.data.checks.map((check) => {
                  const copy = getDoctorCheckCopy(
                    check,
                    t,
                    doctor.data,
                    skill?.ok ? skill.data : undefined,
                  );
                  return (
                    <div
                      key={check.name}
                      className="flex flex-col gap-2 rounded-md border border-border/40 bg-background/70 px-3 py-2 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs text-foreground">{copy.name}</p>
                        <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground">
                          {copy.message}
                        </p>
                      </div>
                      <div className="self-start">
                        {statusLabel(
                          check.ok,
                          t("settings.externalAiSettings.status.passed"),
                          t("settings.externalAiSettings.status.failed"),
                        )}
                      </div>
                    </div>
                  );
                })
              : null}
            {!doctor?.ok &&
              outputPanel(
                outputSummary(doctorResult, doctor, outputLabels),
                doctorResult ? "error" : "default",
              )}
          </div>
        </div>
      </details>
    </div>
  );
}
