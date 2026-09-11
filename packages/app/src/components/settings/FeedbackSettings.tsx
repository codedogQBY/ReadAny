/**
 * FeedbackSettings — Desktop feedback form + history list in Settings dialog.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getWebviewLabel } from "@/lib/webview-info";
import {
  collectDeviceInfo,
  collectLogs,
  getFeedbackDetail,
  getFeedbackHistory,
  getRemainingSubmissions,
  markFeedbackReplySeen,
  refreshFeedbackStatus,
  submitFeedback,
} from "@readany/core/feedback";
import type {
  DeviceInfo,
  FeedbackDetail,
  FeedbackRecord,
  FeedbackType,
} from "@readany/core/feedback";
import { cn } from "@readany/core/utils";
import { getVersion } from "@tauri-apps/api/app";
import i18n from "i18next";
import {
  AlertCircle,
  ArrowLeft,
  Bug,
  Check,
  CheckCircle2,
  ExternalLink,
  Lightbulb,
  Loader2,
  MessageCircle,
  MessageSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const FEEDBACK_TYPES: {
  key: FeedbackType;
  labelKey: string;
  fallback: string;
  Icon: LucideIcon;
}[] = [
  { key: "bug", labelKey: "feedback.typeBug", fallback: "Bug", Icon: Bug },
  { key: "feature", labelKey: "feedback.typeFeature", fallback: "建议", Icon: Lightbulb },
  { key: "other", labelKey: "feedback.typeOther", fallback: "其他", Icon: MessageSquare },
];

type SubmitResult = { kind: "success" | "error"; message: string } | null;

export function FeedbackSettings() {
  const { t } = useTranslation();
  const [type, setType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [includeLogs, setIncludeLogs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResult>(null);
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [activeTab, setActiveTab] = useState<"submit" | "history">("submit");
  const hasUnread = useMemo(() => records.some((r) => r.hasNewReply), [records]);
  const autoSwitchedRef = useRef(false);

  // Auto-switch to "我的反馈" tab once on mount when there are unread replies,
  // so the user lands on the relevant list instead of the submit form.
  useEffect(() => {
    if (hasUnread && !autoSwitchedRef.current) {
      setActiveTab("history");
      autoSwitchedRef.current = true;
    }
  }, [hasUnread]);
  const [selectedIssue, setSelectedIssue] = useState<{ issueNumber: number; title: string } | null>(
    null,
  );
  const remaining = getRemainingSubmissions();

  const [appVersion, setAppVersion] = useState("...");
  const [webview, setWebview] = useState("");
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("unknown"));
    getWebviewLabel()
      .then((label) => setWebview(label))
      .catch(() => setWebview(""));
  }, []);

  const deviceInfo: DeviceInfo = useMemo(() => {
    const ua = navigator.userAgent.toLowerCase();
    const platform: DeviceInfo["platform"] = ua.includes("win")
      ? "windows"
      : ua.includes("linux")
        ? "linux"
        : "macos";
    return collectDeviceInfo({
      platform,
      osVersion: navigator.userAgent,
      appVersion,
      webview: webview || undefined,
      locale: i18n.language || navigator.language,
    });
  }, [appVersion, webview, i18n.language]);

  const loadRecords = useCallback(async (refreshStatus = false) => {
    const history = await getFeedbackHistory();
    setRecords(history);

    if (!refreshStatus || history.length === 0) return;

    await refreshFeedbackStatus(history.map((record) => record.issueNumber));
    setRecords(await getFeedbackHistory());
  }, []);

  useEffect(() => {
    loadRecords(true).catch(() => {});
  }, [loadRecords]);

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && remaining > 0;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const logs = includeLogs ? await collectLogs() : undefined;
      const result = await submitFeedback({
        type,
        title: title.trim(),
        description: description.trim(),
        includeLogs,
        deviceInfo,
        logs,
      });
      setSubmitResult({
        kind: "success",
        message: t("feedback.submitSuccessDesc", "感谢你的反馈！Issue #{{number}} 已创建。", {
          number: result.issueNumber,
        }),
      });
      setTitle("");
      setDescription("");
      setIncludeLogs(false);
      loadRecords().catch(() => {});
    } catch (err) {
      setSubmitResult({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : t("feedback.submitFailedUnknown", "提交失败，请稍后重试"),
      });
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, submitting, type, title, description, includeLogs, deviceInfo, loadRecords, t]);

  // Show detail view if an issue is selected
  if (selectedIssue) {
    return (
      <FeedbackDetailView
        issueNumber={selectedIssue.issueNumber}
        title={selectedIssue.title}
        onBack={() => {
          setSelectedIssue(null);
          loadRecords(true).catch(() => {});
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-5">
      <div className="mb-5 border-b border-border/70 pb-4">
        <h2 className="mb-1 text-sm font-semibold text-foreground">
          {t("feedback.title", "反馈建议")}
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          {t("feedback.desc", "提交 bug 报告或功能建议，我们会尽快处理")}
        </p>
      </div>

      <div className="mb-5 inline-flex rounded-md border border-border/70 bg-muted/30 p-0.5">
        {[
          { key: "submit", label: t("feedback.submitTab", "提交反馈"), showDot: false },
          { key: "history", label: t("feedback.historyTab", "我的反馈"), showDot: hasUnread },
        ].map((tab) => (
          <button
            type="button"
            key={tab.key}
            onClick={() => setActiveTab(tab.key as "submit" | "history")}
            className={cn(
              "inline-flex min-w-24 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === tab.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{tab.label}</span>
            {tab.showDot && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-destructive"
                aria-label={t("feedback.hasNewReply", "有新回复")}
              />
            )}
          </button>
        ))}
      </div>

      {activeTab === "submit" ? (
        <div className="space-y-5">
          <div className="space-y-2">
            <span className="text-xs font-medium text-foreground">
              {t("feedback.type", "类型")}
            </span>
            <div className="grid max-w-md grid-cols-3 gap-2">
              {FEEDBACK_TYPES.map((ft) => (
                <Button
                  key={ft.key}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-9 justify-start gap-2 text-xs",
                    type === ft.key &&
                      "border-primary bg-primary/10 text-primary shadow-sm hover:bg-primary/15 hover:text-primary",
                  )}
                  onClick={() => setType(ft.key)}
                >
                  <ft.Icon className="h-3.5 w-3.5" />
                  {t(ft.labelKey, ft.fallback)}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="feedback-title" className="text-xs font-medium text-foreground">
              {t("feedback.titleLabel", "标题")} *
            </label>
            <Input
              id="feedback-title"
              placeholder={t("feedback.titlePlaceholder", "简要描述问题或建议")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="feedback-description" className="text-xs font-medium text-foreground">
              {t("feedback.descLabel", "详细描述")} *
            </label>
            <Textarea
              id="feedback-description"
              placeholder={t("feedback.descPlaceholder", "请详细描述你遇到的问题或建议...")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className="resize-none text-sm"
            />
          </div>

          <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2.5">
            <div className="flex items-start gap-2.5">
              <button
                type="button"
                aria-pressed={includeLogs}
                aria-labelledby="include-logs-label"
                onClick={() => setIncludeLogs((checked) => !checked)}
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                  includeLogs
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:border-primary/60",
                )}
              >
                {includeLogs && <Check className="h-3 w-3" />}
              </button>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  id="include-logs-label"
                  className="cursor-pointer text-xs font-medium text-foreground"
                  onClick={() => setIncludeLogs((checked) => !checked)}
                >
                  {t("feedback.uploadLogs", "上传应用日志")}
                </button>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {t("feedback.logsHint", "仅在勾选时附带最近 1 小时诊断日志，帮助定位问题。")}
                </p>
              </div>
            </div>
            <div className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
              {t("feedback.deviceInfo", "{{platform}} · v{{version}} · {{locale}}", {
                platform: deviceInfo.platform,
                version: deviceInfo.appVersion,
                locale: deviceInfo.locale,
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {t("feedback.remaining", "今日还可提交 {{count}} 次", { count: remaining })}
            </span>
            <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="min-w-28">
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("feedback.submit", "提交反馈")
              )}
            </Button>
          </div>

          {submitResult && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-xs",
                submitResult.kind === "success"
                  ? "bg-green-500/10 text-green-700 dark:text-green-400"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {submitResult.kind === "success" ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5" />
              )}
              <span>{submitResult.message}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-72 divide-y overflow-y-auto rounded-md border border-border/70">
          {records.length > 0 ? (
            records.map((record) => (
              <button
                type="button"
                key={record.id}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                onClick={() =>
                  setSelectedIssue({ issueNumber: record.issueNumber, title: record.title })
                }
              >
                <div className="mr-3 min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {record.hasNewReply && (
                      <span
                        className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-destructive"
                        aria-label={t("feedback.hasNewReply", "有新回复")}
                      />
                    )}
                    <p className="truncate text-xs font-medium text-foreground">{record.title}</p>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <p className="text-[10px] text-muted-foreground">
                      #{record.issueNumber} · {new Date(record.createdAt).toLocaleDateString()}
                    </p>
                    {record.hasNewReply && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                        {t("feedback.newReply", "有新回复")}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                    record.status === "open"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {record.status === "open"
                    ? t("feedback.statusOpen", "处理中")
                    : t("feedback.statusClosed", "已关闭")}
                </span>
              </button>
            ))
          ) : (
            <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
              {t("feedback.noHistory", "暂无反馈记录")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Detail View ──────────────────────────────────────────────────────────────

function FeedbackDetailView({
  issueNumber,
  title,
  onBack,
}: { issueNumber: number; title: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await getFeedbackDetail(issueNumber);
      setDetail(data);
      setLoading(false);
      await markFeedbackReplySeen(issueNumber).catch(() => {});
    }
    load();
  }, [issueNumber]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-5">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("common.back", "返回")}
        </button>
        <span className="text-xs text-muted-foreground">|</span>
        <span className="text-xs font-medium text-foreground truncate">
          #{issueNumber} {title}
        </span>
        <a
          href={`https://github.com/codedogQBY/ReadAny/issues/${issueNumber}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-muted-foreground hover:text-foreground"
          title={t("feedback.openInBrowser", "在浏览器打开")}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !detail ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-xs text-muted-foreground">
            {t("feedback.detailLoadFailed", "加载失败，请稍后重试")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status */}
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "text-[11px] px-2 py-0.5 rounded font-medium",
                detail.state === "open"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {detail.state === "open"
                ? t("feedback.statusOpen", "处理中")
                : t("feedback.statusClosed", "已关闭")}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {new Date(detail.createdAt).toLocaleDateString()}
            </span>
          </div>

          {/* Body */}
          <div className="rounded-md border border-border/70 p-4">
            <p className="text-xs leading-5 text-foreground whitespace-pre-wrap">
              {stripMarkdown(detail.body)}
            </p>
          </div>

          {/* Comments */}
          {detail.comments.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <MessageCircle className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">
                  {t("feedback.replies", "回复")} ({detail.comments.length})
                </span>
              </div>
              {detail.comments.map((comment) => (
                <div key={comment.id} className="rounded-md border border-border/70 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-foreground">
                      {comment.author}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(comment.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-foreground whitespace-pre-wrap">
                    {stripMarkdown(comment.body)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center">
              <p className="text-xs text-muted-foreground">
                {t("feedback.noReplies", "暂无回复，我们会尽快处理。")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Simple markdown stripping for display */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`{3}[\s\S]*?`{3}/g, "[code block]")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^[-*]\s+/gm, "- ")
    .replace(/---\n?/g, "")
    .trim();
}
