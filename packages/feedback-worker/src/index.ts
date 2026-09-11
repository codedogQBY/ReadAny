interface Env {
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  FEEDBACK_RATE_LIMIT: KVNamespace;
  ALLOWED_ORIGINS?: string;
  GITHUB_LABELS?: string;
  RATE_LIMIT_SUBMISSIONS_PER_DAY?: string;
  RATE_LIMIT_STATUS_PER_HOUR?: string;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface DeviceInfo {
  platform?: string;
  osVersion?: string;
  appVersion?: string;
  webview?: string;
  deviceModel?: string;
  locale?: string;
}

interface FeedbackPayload {
  type?: "bug" | "feature" | "other";
  title?: string;
  description?: string;
  deviceInfo?: DeviceInfo;
  logs?: string;
}

interface GitHubIssueResponse {
  number: number;
  html_url: string;
  title: string;
  state: "open" | "closed";
  comments?: number;
  body?: string;
  created_at?: string;
  updated_at?: string;
}

interface GitHubCommentResponse {
  id: number;
  body: string;
  created_at: string;
  user: { login: string; avatar_url: string };
}

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 12_000;
/**
 * Server-side safety net for logs: byte-based and tail-keep (newest lines
 * matter most for diagnostics). Sized above the client's MAX_LOG_BYTES so
 * an updated client never gets re-truncated here; old clients still cap.
 */
const MAX_LOG_BYTES = 80_000;
const MAX_BODY_BYTES = 128_000;
const DEFAULT_SUBMISSIONS_PER_DAY = 20;
const DEFAULT_STATUS_REQUESTS_PER_HOUR = 120;

const TYPE_LABELS: Record<NonNullable<FeedbackPayload["type"]>, string> = {
  bug: "Bug",
  feature: "Suggestion",
  other: "Other",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);

    try {
      if (request.method === "POST" && url.pathname === "/api/feedback") {
        return await handleCreateFeedback(request, env);
      }

      if (request.method === "GET" && url.pathname === "/api/feedback/status") {
        return await handleFeedbackStatus(request, env, url);
      }

      // GET /api/feedback/detail?issue=123
      if (request.method === "GET" && url.pathname === "/api/feedback/detail") {
        return await handleFeedbackDetail(request, env, url);
      }

      return jsonResponse(request, env, { error: "Not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      const status = error instanceof HttpError ? error.status : 500;
      return jsonResponse(request, env, { error: message }, status);
    }
  },
};

async function handleCreateFeedback(request: Request, env: Env): Promise<Response> {
  assertGitHubEnv(env);
  await assertRateLimit(request, env, {
    name: "submit",
    limit: parsePositiveInt(env.RATE_LIMIT_SUBMISSIONS_PER_DAY, DEFAULT_SUBMISSIONS_PER_DAY),
    windowSeconds: 24 * 60 * 60,
  });

  const payload = await readFeedbackPayload(request);
  const type = payload.type ?? "other";
  const title = requireText(payload.title, "title", MAX_TITLE_LENGTH);
  const description = requireText(payload.description, "description", MAX_DESCRIPTION_LENGTH);
  const logs = truncateLogTail(payload.logs?.trim() ?? "", MAX_LOG_BYTES);

  // Upload logs to Gist if present
  let gistUrl: string | undefined;
  if (logs) {
    try {
      gistUrl = await uploadLogsToGist(env, logs, title);
    } catch {
      // Non-fatal: if Gist upload fails, just skip logs link
    }
  }

  const issue = await githubRequest<GitHubIssueResponse>(env, "/issues", {
    method: "POST",
    body: JSON.stringify({
      title: `[${TYPE_LABELS[type]}] ${title}`,
      body: buildIssueBody({ ...payload, type, title, description, logs, gistUrl }),
      labels: parseLabels(env.GITHUB_LABELS),
    }),
  });

  return jsonResponse(request, env, { issueNumber: issue.number, issueUrl: issue.html_url });
}

async function handleFeedbackStatus(request: Request, env: Env, url: URL): Promise<Response> {
  assertGitHubEnv(env);
  await assertRateLimit(request, env, {
    name: "status",
    limit: parsePositiveInt(env.RATE_LIMIT_STATUS_PER_HOUR, DEFAULT_STATUS_REQUESTS_PER_HOUR),
    windowSeconds: 60 * 60,
  });

  const issueNumbers = (url.searchParams.get("issues") ?? "")
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0)
    .slice(0, 50);

  if (issueNumbers.length === 0) {
    return jsonResponse(request, env, []);
  }

  const issues = await Promise.all(
    issueNumbers.map((number) =>
      githubRequest<GitHubIssueResponse>(env, `/issues/${number}`).catch(() => null),
    ),
  );

  const existingIssues = issues.filter((issue): issue is GitHubIssueResponse => issue !== null);

  return jsonResponse(
    request,
    env,
    existingIssues.map((issue) => ({
      number: issue.number,
      state: issue.state,
      title: issue.title,
      hasNewComment: (issue.comments ?? 0) > 0,
      commentCount: issue.comments ?? 0,
    })),
  );
}

async function handleFeedbackDetail(request: Request, env: Env, url: URL): Promise<Response> {
  assertGitHubEnv(env);

  const issueNumber = Number.parseInt(url.searchParams.get("issue") ?? "", 10);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new HttpError(400, "Invalid issue number");
  }

  // Fetch issue + comments in parallel
  const [issue, comments] = await Promise.all([
    githubRequest<GitHubIssueResponse>(env, `/issues/${issueNumber}`),
    githubRequest<GitHubCommentResponse[]>(env, `/issues/${issueNumber}/comments?per_page=50`),
  ]);

  return jsonResponse(request, env, {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    body: issue.body ?? "",
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    comments: (comments ?? []).map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      author: c.user?.login ?? "unknown",
      avatarUrl: c.user?.avatar_url ?? "",
    })),
  });
}

async function readFeedbackPayload(request: Request): Promise<FeedbackPayload> {
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Feedback payload is too large");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Feedback payload is too large");
  }

  try {
    return JSON.parse(text) as FeedbackPayload;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

async function assertRateLimit(
  request: Request,
  env: Env,
  options: { name: string; limit: number; windowSeconds: number },
): Promise<void> {
  if (!env.FEEDBACK_RATE_LIMIT) {
    throw new HttpError(500, "Rate limit storage is not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % options.windowSeconds);
  const clientKey = await getClientKey(request);
  const key = `feedback:${options.name}:${windowStart}:${clientKey}`;
  const current = Number.parseInt((await env.FEEDBACK_RATE_LIMIT.get(key)) ?? "0", 10);

  if (current >= options.limit) {
    throw new HttpError(429, "Too many feedback requests. Please try again later.");
  }

  await env.FEEDBACK_RATE_LIMIT.put(key, String(current + 1), {
    expirationTtl: options.windowSeconds + 300,
  });
}

async function getClientKey(request: Request): Promise<string> {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";
  const userAgent = request.headers.get("User-Agent") || "unknown";
  return sha256(`${ip}:${userAgent}`);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadLogsToGist(env: Env, logs: string, title: string): Promise<string> {
  const filename = `readany-logs-${Date.now()}.txt`;
  const response = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "ReadAny Feedback Worker",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      description: `ReadAny feedback logs: ${title}`,
      public: false,
      files: {
        [filename]: { content: logs },
      },
    }),
  });

  if (!response.ok) {
    throw new HttpError(500, "Failed to upload logs to Gist");
  }

  const gist = (await response.json()) as { html_url: string };
  return gist.html_url;
}

function buildIssueBody(
  payload: Required<Pick<FeedbackPayload, "type">> & FeedbackPayload & { gistUrl?: string },
): string {
  const device = payload.deviceInfo ?? {};
  // Device fields are client-supplied and rendered into issue Markdown:
  // strip line breaks and Markdown-significant characters so they cannot
  // inject headings, links, or mentions.
  const clean = (value: unknown): string =>
    String(value ?? "unknown")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[`[\]<>!@]/g, "")
      .slice(0, 300);
  const details = [
    `### Type\n${TYPE_LABELS[payload.type]}`,
    `### Description\n${payload.description}`,
    `### Device\n- Platform: ${clean(device.platform)}`,
    `- OS: ${clean(device.osVersion)}`,
    `- App: ${clean(device.appVersion)}`,
    `- WebView: ${clean(device.webview)}`,
    `- Locale: ${clean(device.locale)}`,
  ];

  if (device.deviceModel) {
    details[details.length - 1] += `\n- Device: ${clean(device.deviceModel)}`;
  }

  if (payload.gistUrl) {
    details.push(`### Logs\n[View diagnostic logs](${payload.gistUrl})`);
  }

  return `${details.join("\n\n")}\n\n---\nSubmitted from ReadAny.`;
}

async function githubRequest<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`,
    {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "ReadAny Feedback Worker",
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new HttpError(response.status, `GitHub request failed: ${response.status} ${text}`);
  }

  return response.json() as Promise<T>;
}

function requireText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${name} is required`);
  }
  return truncateText(value.trim(), maxLength);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[truncated]`;
}

/**
 * Tail-truncate logs to at most `maxBytes` UTF-8 bytes. Diagnostic logs
 * are most useful at the END, so we drop the older lines when oversize.
 * Skips leading UTF-8 continuation bytes to land on a code-point boundary.
 */
function truncateLogTail(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return value;
  let offset = bytes.byteLength - maxBytes;
  while (offset < bytes.byteLength && (bytes[offset] & 0xc0) === 0x80) offset++;
  return `[truncated: dropped ${offset} bytes of older logs]\n${new TextDecoder().decode(bytes.slice(offset))}`;
}

function parseLabels(raw: string | undefined): string[] | undefined {
  const labels = raw
    ?.split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  return labels && labels.length > 0 ? labels : undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function assertGitHubEnv(env: Env): void {
  if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
    throw new HttpError(500, "GitHub environment is not configured");
  }
}

function jsonResponse(request: Request, env: Env, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin") ?? "";
  const allowedOrigins = (env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin =
    allowedOrigins.includes("*") || !origin
      ? "*"
      : allowedOrigins.includes(origin)
        ? origin
        : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
