/**
 * ToolCallDisplay — shows AI tool invocation status
 */
import type { ToolCall } from "@/types";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";

interface ToolCallDisplayProps {
  toolCall: ToolCall;
}

export function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
  const StatusIcon = {
    pending: Loader2,
    running: Loader2,
    completed: CheckCircle,
    error: AlertCircle,
  }[toolCall.status];

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-background/50 px-2 py-1 text-xs">
      <StatusIcon className={`h-3 w-3 ${toolCall.status === "running" ? "animate-spin" : ""}`} />
      <span className="font-mono">{toolCall.name}</span>
      <span className="text-muted-foreground">
        {toolCall.status === "completed" ? "done" : toolCall.status}
      </span>
    </div>
  );
}
