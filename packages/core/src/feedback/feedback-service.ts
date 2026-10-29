/**
 * Feedback service — handles submission, local storage, and status tracking.
 *
 * API calls go through a Cloudflare Worker that creates GitHub Issues
 * via a GitHub App installation token. The Worker URL is configurable.
 */

import { getDB } from "../db/db-core";
import i18n from "../i18n";
import { getPlatformService } from "../services/platform";
import type {
  DeviceInfo,
  FeedbackDetail,
  FeedbackRecord,
  FeedbackStatusItem,
  FeedbackSubmission,
  FeedbackSubmitResult,
} from "./feedback-types";

// Worker API base URL — will be configured when Worker is deployed
let _workerBaseUrl = "";

export function setFeedbackWorkerUrl(url: string): void {
  _workerBaseUrl = url.replace(/\/+$/, "");
}

/** Max submissions per device per day */
const MAX_DAILY_SUBMISSIONS = 3;

// ─── File-based Log System ────────────────────────────────────────────────

const CONSOLE_LEVELS = ["debug", "info", "log", "warn", "error"] as const;
const LOG_DIR = "logs";
const LOG_FLUSH_INTERVAL_MS = 3000; // Flush to file every 3 seconds
const LOG_MAX_DAYS = 7; // Keep 7 days of logs
/**
 * Tail-truncate the collected logs to this UTF-8 byte budget before
 * submission. Sits below the worker's MAX_BODY_BYTES with room for the
 * description (≤12_000 chars) + device info + JSON envelope, so a payload
 * with maxed-out description never trips the worker's 413.
 */
const MAX_LOG_BYTES = 60_000;

/** In-memory write buffer — flushed to file periodically */
let _pendingLines: string[] = [];
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _logCaptureCleanup: (() => void) | null = null;
let _logDirReady = false;
let _logDirPath = "";

function getTodayDateStr(): string {
  return new Date().toISOString().slice(0, 10); // "2026-05-08"
}

async function ensureLogDir(): Promise<string> {
  if (_logDirReady) return _logDirPath;
  const platform = getPlatformService();
  const dataDir = await platform.getAppDataDir();
  _logDirPath = await platform.joinPath(dataDir, LOG_DIR);
  try {
    await platform.mkdir(_logDirPath);
  } catch {
    // Already exists
  }
  _logDirReady = true;
  return _logDirPath;
}

async function getLogFilePath(dateStr?: string): Promise<string> {
  const platform = getPlatformService();
  const dir = await ensureLogDir();
  const filename = `app-${dateStr || getTodayDateStr()}.log`;
  return platform.joinPath(dir, filename);
}

/** Flush pending log lines to file */
async function flushLogs(): Promise<void> {
  if (_pendingLines.length === 0) return;
  const lines = _pendingLines.join("");
  _pendingLines = [];

  try {
    const filePath = await getLogFilePath();
    const platform = getPlatformService();
    // Read existing content and append
    let existing = "";
    try {
      if (await platform.exists(filePath)) {
        existing = await platform.readTextFile(filePath);
      }
    } catch {
      // File may not exist yet
    }
    await platform.writeTextFile(filePath, existing + lines);
  } catch {
    // Non-fatal: if file write fails, logs are lost
  }
}

/** Delete log files older than LOG_MAX_DAYS */
async function cleanOldLogs(): Promise<void> {
  try {
    const platform = getPlatformService();
    const dir = await ensureLogDir();
    const now = Date.now();

    // Try to delete old files by iterating possible old dates (7-30 days ago)
    for (let i = LOG_MAX_DAYS; i < 30; i++) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      const oldFile = await platform.joinPath(dir, `app-${dateStr}.log`);
      try {
        if (await platform.exists(oldFile)) {
          await platform.deleteFile(oldFile);
        }
      } catch {
        // Ignore
      }
    }
  } catch {
    // Non-fatal
  }
}

function getEventTarget(): Pick<Window, "addEventListener" | "removeEventListener"> | null {
  if (typeof window === "undefined") return null;
  if (typeof window.addEventListener !== "function") return null;
  if (typeof window.removeEventListener !== "function") return null;
  return window;
}

function formatLogArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ""}`;
  }
  if (typeof arg === "string") return arg;
  if (typeof arg === "number" || typeof arg === "boolean" || arg == null) return String(arg);

  try {
    return JSON.stringify(arg);
  } catch {
    return Object.prototype.toString.call(arg);
  }
}

function formatErrorEvent(event: ErrorEvent): string {
  if (event.error instanceof Error) {
    return formatLogArg(event.error);
  }
  return `${event.message || "Unhandled error"}${event.filename ? ` at ${event.filename}` : ""}${
    event.lineno ? `:${event.lineno}` : ""
  }`;
}

/** Format date as local time string: YYYY-MM-DD HH:mm:ss.SSS */
function formatLocalTime(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** Append a single log line to the write buffer */
export function appendLog(entry: string): void {
  const line = `[${formatLocalTime(new Date())}] ${entry}\n`;
  _pendingLines.push(line);
}

/** Capture a structured app event into the feedback log buffer. */
export function appendStructuredLog(
  event: string,
  data?: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info",
): void {
  const payload = data ? ` ${formatLogArg(data)}` : "";
  appendLog(`[${level}] [event:${event}]${payload}`);
}

/**
 * Sanitize a single log line to redact sensitive information before
 * the log is submitted as feedback or exposed externally.
 *
 * Handles:
 * - Base64-encoded credentials (Basic auth pattern)
 * - "encodedPreview" fields
 * - URLs containing userinfo (user:pass@host)
 * - Explicit password/secret/token values in JSON-like structures
 */
function sanitizeLogLine(line: string): string {
  // Redact Base64-encoded Basic auth credentials (e.g. "YWRtaW46cGFzc3dvcmQ=")
  // Match base64 strings that look like "user:pass" encoded (contains colon when decoded)
  line = line.replace(
    /("encodedPreview"\s*:\s*)"[A-Za-z0-9+/=]+"/g,
    '$1"[REDACTED]"',
  );

  // Redact full URLs (https://host.example.com/path) — keep only the path portion
  line = line.replace(
    /https?:\/\/[^/\s"]+(\/?[^\s"]*)/g,
    (_, path) => `https://[REDACTED_HOST]${path || "/"}`,
  );

  // Redact "password":"value" or "secret":"value" patterns in JSON
  line = line.replace(
    /("(?:password|secret|token|apiKey|api_key|secretAccessKey|accessToken|refreshToken)")\s*:\s*"[^"]*"/gi,
    '$1:"[REDACTED]"',
  );

  // Redact standalone base64 strings that are clearly credentials (contain ":" when decoded, typically short)
  // Pattern: sequences of base64 chars that match user:pass encoding
  line = line.replace(
    /\b[A-Za-z0-9+/]{8,}={0,2}\b/g,
    (match) => {
      try {
        const decoded = Buffer.from(match, "base64").toString("utf8");
        // If it looks like credentials (contains ":" and both parts are printable)
        if (decoded.includes(":") && /^[\x20-\x7e]+$/.test(decoded)) {
          return "[REDACTED_CREDENTIAL]";
        }
      } catch {
        // Not valid base64, leave as-is
      }
      return match;
    },
  );

  return line;
}

/**
 * Tail-truncate a string to at most `maxBytes` UTF-8 bytes. Diagnostic logs
 * are most useful at the END — we drop the older lines when oversize. Skips
 * leading UTF-8 continuation bytes so the cut lands on a code-point boundary.
 */
export function truncateUtf8Tail(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  let offset = bytes.byteLength - maxBytes;
  while (offset < bytes.byteLength && (bytes[offset] & 0xc0) === 0x80) offset++;
  const dropped = offset;
  return `[truncated: dropped ${dropped} bytes of older logs]\n${new TextDecoder().decode(bytes.slice(offset))}`;
}

/** Collect logs for feedback submission. Reads today's + yesterday's log files. */
export async function collectLogs(options?: { sinceMs?: number }): Promise<string> {
  // First flush any pending lines
  await flushLogs();

  const platform = getPlatformService();
  const sinceMs = options?.sinceMs ?? 60 * 60 * 1000; // Default last 1 hour
  const sinceTime = formatLocalTime(new Date(Date.now() - sinceMs));
  const parts: string[] = [];

  // Read today's log
  try {
    const todayPath = await getLogFilePath(getTodayDateStr());
    if (await platform.exists(todayPath)) {
      parts.push(await platform.readTextFile(todayPath));
    }
  } catch {
    // Ignore
  }

  // If sinceMs spans more than today, also read yesterday
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (yesterday !== getTodayDateStr()) {
    try {
      const yesterdayPath = await getLogFilePath(yesterday);
      if (await platform.exists(yesterdayPath)) {
        const content = await platform.readTextFile(yesterdayPath);
        parts.unshift(content);
      }
    } catch {
      // Ignore
    }
  }

  const allLogs = parts.join("");

  // Filter lines by timestamp (only return lines since the cutoff)
  const lines = allLogs.split("\n").filter((line) => {
    const match = line.match(/^\[(\d{4}-\d{2}-\d{2} [\d:.]+)\]/);
    if (!match) return false;
    return match[1] >= sinceTime;
  });

  // Sanitize sensitive data before exposing logs externally, then tail-truncate
  // to stay under the worker's MAX_BODY_BYTES (most recent lines are most relevant).
  const sanitized = lines.map(sanitizeLogLine).join("\n");
  return truncateUtf8Tail(sanitized, MAX_LOG_BYTES);
}

/** Clear all log files */
export async function clearLogs(): Promise<void> {
  _pendingLines = [];
  try {
    const platform = getPlatformService();
    await ensureLogDir();
    // Delete current day's log
    const todayPath = await getLogFilePath(getTodayDateStr());
    if (await platform.exists(todayPath)) {
      await platform.deleteFile(todayPath);
    }
  } catch {
    // Ignore
  }
}

/** Install console/error capture into the file-based log system. Safe to call more than once. */
export function installFeedbackLogCapture(): () => void {
  if (_logCaptureCleanup) return _logCaptureCleanup;

  const originalConsole = new Map<(typeof CONSOLE_LEVELS)[number], (...args: unknown[]) => void>();

  for (const level of CONSOLE_LEVELS) {
    const original = console[level]?.bind(console);
    if (!original) continue;

    originalConsole.set(level, original);
    console[level] = ((...args: unknown[]) => {
      original(...args);
      appendLog(`[${level}] ${args.map(formatLogArg).join(" ")}`);
    }) as (typeof console)[typeof level];
  }

  const onError = (event: ErrorEvent) => {
    appendLog(`[error] ${formatErrorEvent(event)}`);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    appendLog(`[unhandledrejection] ${formatLogArg(event.reason)}`);
  };

  const eventTarget = getEventTarget();
  if (eventTarget) {
    eventTarget.addEventListener("error", onError);
    eventTarget.addEventListener("unhandledrejection", onUnhandledRejection);
  }

  // Start periodic flush timer
  _flushTimer = setInterval(() => {
    flushLogs().catch(() => {});
  }, LOG_FLUSH_INTERVAL_MS);

  // Clean old logs on startup (fire-and-forget)
  cleanOldLogs().catch(() => {});

  _logCaptureCleanup = () => {
    for (const [level, original] of originalConsole.entries()) {
      console[level] = original as (typeof console)[typeof level];
    }
    if (eventTarget) {
      eventTarget.removeEventListener("error", onError);
      eventTarget.removeEventListener("unhandledrejection", onUnhandledRejection);
    }
    if (_flushTimer) {
      clearInterval(_flushTimer);
      _flushTimer = null;
    }
    // Final flush
    flushLogs().catch(() => {});
    _logCaptureCleanup = null;
  };

  return _logCaptureCleanup;
}

// ─── Rate Limiting (local) ─────────────────────────────────────────────────

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10); // "2026-05-07"
}

let _dailyCount = 0;
let _dailyKey = "";

function loadDailyCount(): number {
  const today = getTodayKey();
  if (_dailyKey !== today) {
    _dailyKey = today;
    _dailyCount = 0;
  }
  return _dailyCount;
}

export function getRemainingSubmissions(): number {
  return Math.max(0, MAX_DAILY_SUBMISSIONS - loadDailyCount());
}

function incrementDailyCount(): void {
  loadDailyCount();
  _dailyCount++;
}

// ─── Submit Feedback ───────────────────────────────────────────────────────

export async function submitFeedback(
  submission: FeedbackSubmission,
): Promise<FeedbackSubmitResult> {
  if (getRemainingSubmissions() <= 0) {
    throw new Error(
      i18n.t("feedback.dailyLimitReached", "Daily feedback limit reached. Please try again tomorrow."),
    );
  }

  let result: FeedbackSubmitResult;

  if (_workerBaseUrl) {
    appendStructuredLog("feedback.submit.start", {
      type: submission.type,
      includeLogs: submission.includeLogs,
      platform: submission.deviceInfo.platform,
    });

    // Real API call
    const body: Record<string, unknown> = {
      type: submission.type,
      title: submission.title,
      description: submission.description,
      deviceInfo: submission.deviceInfo,
    };
    if (submission.includeLogs && submission.logs) {
      body.logs = submission.logs;
    }

    try {
      const response = await fetch(`${_workerBaseUrl}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          i18n.t("feedback.submitFailedStatus", "Submission failed: {{status}} {{text}}", {
            status: response.status,
            text,
          }),
        );
      }

      result = (await response.json()) as FeedbackSubmitResult;
    } catch (error) {
      appendStructuredLog("feedback.submit.failed", { error: formatLogArg(error) }, "error");
      throw error;
    }

    appendStructuredLog("feedback.submit.success", { issueNumber: result.issueNumber });
  } else {
    // Mock mode — for development before Worker is deployed
    const mockNumber = Math.floor(Math.random() * 9000) + 1000;
    result = {
      issueNumber: mockNumber,
      issueUrl: `https://github.com/codedogQBY/ReadAny/issues/${mockNumber}`,
    };
  }

  // Save to local DB
  const id = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record: FeedbackRecord = {
    id,
    issueNumber: result.issueNumber,
    issueUrl: result.issueUrl,
    title: submission.title,
    type: submission.type,
    status: "open",
    createdAt: Date.now(),
  };

  try {
    await saveFeedbackRecord(record);
  } catch (error) {
    appendStructuredLog("feedback.local_save.failed", { error: formatLogArg(error) }, "error");
    throw error;
  }
  incrementDailyCount();

  return result;
}

// ─── Local Storage ─────────────────────────────────────────────────────────

async function saveFeedbackRecord(record: FeedbackRecord): Promise<void> {
  const db = await getDB();
  await db.execute(
    `INSERT OR REPLACE INTO feedback (id, issue_number, issue_url, title, type, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.issueNumber,
      record.issueUrl,
      record.title,
      record.type,
      record.status,
      record.createdAt,
      record.updatedAt ?? null,
    ],
  );
}

export async function getFeedbackHistory(): Promise<FeedbackRecord[]> {
  const db = await getDB();
  const rows = await db.select<{
    id: string;
    issue_number: number;
    issue_url: string;
    title: string;
    type: string;
    status: string;
    created_at: number;
    updated_at: number | null;
    has_new_reply?: number | null;
    comment_count?: number | null;
  }>(
    `SELECT id, issue_number, issue_url, title, type, status, created_at, updated_at, has_new_reply, comment_count
     FROM feedback ORDER BY created_at DESC`,
  );
  return rows.map((row) => ({
    id: row.id,
    issueNumber: row.issue_number,
    issueUrl: row.issue_url,
    title: row.title,
    type: row.type as FeedbackRecord["type"],
    status: row.status as FeedbackRecord["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    hasNewReply: Boolean(row.has_new_reply),
  }));
}

export async function markFeedbackReplySeen(issueNumber: number): Promise<void> {
  const db = await getDB();
  await db.execute("UPDATE feedback SET has_new_reply = 0, updated_at = ? WHERE issue_number = ?", [
    Date.now(),
    issueNumber,
  ]);
}

/**
 * Count feedback records with an unseen reply (has_new_reply = 1).
 * Used to drive the red-dot badge on Profile / Settings menus.
 */
export async function getUnreadFeedbackCount(): Promise<number> {
  const db = await getDB();
  const rows = await db.select<{ count: number }>(
    "SELECT COUNT(*) as count FROM feedback WHERE has_new_reply = 1",
  );
  return rows[0]?.count ?? 0;
}

/**
 * Refresh feedback status from the worker for all locally-known issues, then
 * return the resulting unread count. Safe to call on screen mount / app
 * foreground — silently no-ops if there's no feedback yet or no worker URL.
 */
export async function refreshAndCountUnreadFeedback(): Promise<number> {
  try {
    const db = await getDB();
    const rows = await db.select<{ issue_number: number }>(
      "SELECT issue_number FROM feedback ORDER BY created_at DESC LIMIT 50",
    );
    const issueNumbers = rows.map((r) => r.issue_number).filter((n) => Number.isFinite(n));
    if (issueNumbers.length > 0) {
      await refreshFeedbackStatus(issueNumbers);
    }
  } catch (error) {
    appendStructuredLog(
      "feedback.unread_refresh.failed",
      { error: formatLogArg(error) },
      "warn",
    );
  }
  return getUnreadFeedbackCount();
}

// ─── Status Refresh ────────────────────────────────────────────────────────

export async function refreshFeedbackStatus(issueNumbers: number[]): Promise<FeedbackStatusItem[]> {
  if (!_workerBaseUrl || issueNumbers.length === 0) return [];

  const params = issueNumbers.join(",");
  let response: Response;
  try {
    response = await fetch(`${_workerBaseUrl}/api/feedback/status?issues=${params}`);
  } catch (error) {
    appendStructuredLog("feedback.status_refresh.failed", { error: formatLogArg(error) }, "warn");
    return [];
  }

  if (!response.ok) {
    appendStructuredLog("feedback.status_refresh.failed", { status: response.status }, "warn");
    return [];
  }

  const items = (await response.json()) as FeedbackStatusItem[];
  appendStructuredLog("feedback.status_refresh.success", { count: items.length });

  // Update local DB
  const db = await getDB();
  const returnedNumbers = new Set(items.map((i) => i.number));

  for (const item of items) {
    const existingRows = await db.select<{
      comment_count?: number | null;
      has_new_reply?: number | null;
    }>("SELECT comment_count, has_new_reply FROM feedback WHERE issue_number = ?", [item.number]);
    const existing = existingRows[0];
    const previousCommentCount = existing?.comment_count ?? 0;
    const commentCount = item.commentCount ?? (item.hasNewComment ? 1 : 0);
    const hasNewReply = Boolean(existing?.has_new_reply) || commentCount > previousCommentCount;

    await db.execute(
      "UPDATE feedback SET status = ?, has_new_reply = ?, comment_count = ?, updated_at = ? WHERE issue_number = ?",
      [item.state, hasNewReply ? 1 : 0, commentCount, Date.now(), item.number],
    );
  }

  // Remove issues not returned by the API (likely deleted on GitHub)
  // Only delete records older than 5 minutes to avoid race condition with newly submitted feedback
  const safeDeleteThreshold = Date.now() - 5 * 60 * 1000;
  for (const num of issueNumbers) {
    if (!returnedNumbers.has(num)) {
      await db.execute("DELETE FROM feedback WHERE issue_number = ? AND created_at < ?", [
        num,
        safeDeleteThreshold,
      ]);
    }
  }

  return items;
}

// ─── Device Info Collection ────────────────────────────────────────────────

export function collectDeviceInfo(overrides?: Partial<DeviceInfo>): DeviceInfo {
  // Base info — platform-specific code will override these
  return {
    platform: "macos",
    osVersion: "unknown",
    appVersion: "unknown",
    locale: "unknown",
    ...overrides,
  };
}

// ─── Feedback Detail ──────────────────────────────────────────────────────

export async function getFeedbackDetail(issueNumber: number): Promise<FeedbackDetail | null> {
  if (!_workerBaseUrl || !issueNumber) return null;

  try {
    const response = await fetch(`${_workerBaseUrl}/api/feedback/detail?issue=${issueNumber}`);
    if (!response.ok) return null;
    return (await response.json()) as FeedbackDetail;
  } catch {
    return null;
  }
}
