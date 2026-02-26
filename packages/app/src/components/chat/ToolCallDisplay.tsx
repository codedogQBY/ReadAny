/**
 * ToolCallDisplay — tool invocation status
 */
import type { ToolCall } from "@/types";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ToolCallDisplayProps {
  toolCall: ToolCall;
}

export function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
  const { t } = useTranslation();
  const StatusIcon = {
    pending: Loader2,
    running: Loader2,
    completed: CheckCircle,
    error: AlertCircle,
  }[toolCall.status];

  const statusColor = {
    pending: "text-muted-foreground",
    running: "text-primary",
    completed: "text-green-600",
    error: "text-destructive",
  }[toolCall.status];

  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/50 px-2.5 py-1.5 text-xs">
      <StatusIcon className={`size-3 ${statusColor} ${toolCall.status === "running" || toolCall.status === "pending" ? "animate-spin" : ""}`} />
      <span className="font-medium text-neutral-700">{toolCall.name}</span>
      <span className="text-muted-foreground">{toolCall.status === "completed" ? t("common.done") : toolCall.status}</span>
    </div>
  );
}
