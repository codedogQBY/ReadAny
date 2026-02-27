/**
 * StreamingIndicator — shows current AI processing status
 * Displays thinking/tool-calling/responding state with animation
 */
import { Brain, Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

interface StreamingIndicatorProps {
  step: "thinking" | "tool_calling" | "responding" | "idle";
  toolName?: string;
  className?: string;
}

const STEP_LABELS = {
  thinking: "正在思考...",
  tool_calling: "调用工具中...",
  responding: "正在回复...",
  idle: "",
};

export function StreamingIndicator({ step, toolName, className }: StreamingIndicatorProps) {
  if (step === "idle") return null;

  return (
    <div className={cn("flex items-center gap-2 px-3 py-2", className)}>
      <div className="flex items-center gap-2">
        {step === "thinking" && (
          <>
            <div className="flex h-5 w-5 items-center justify-center">
              <Brain className="h-4 w-4 animate-pulse text-violet-500" />
            </div>
            <span className="text-xs text-violet-600">{STEP_LABELS.thinking}</span>
          </>
        )}
        {step === "tool_calling" && (
          <>
            <div className="flex h-5 w-5 items-center justify-center">
              <Wrench className="h-4 w-4 animate-spin text-blue-500" />
            </div>
            <span className="text-xs text-blue-600">
              {toolName ? `正在调用 ${toolName}...` : STEP_LABELS.tool_calling}
            </span>
          </>
        )}
        {step === "responding" && (
          <>
            <div className="flex h-5 w-5 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
            </div>
            <span className="text-xs text-emerald-600">{STEP_LABELS.responding}</span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * StreamingProgress — shows streaming progress with steps
 */
interface StreamingProgressProps {
  steps: Array<{
    type: "thinking" | "tool" | "responding";
    label: string;
    status: "pending" | "running" | "completed";
  }>;
  className?: string;
}

export function StreamingProgress({ steps, className }: StreamingProgressProps) {
  return (
    <div className={cn("flex items-center gap-1 text-xs", className)}>
      {steps.map((step, index) => (
        <div key={index} className="flex items-center gap-1">
          {index > 0 && (
            <span className={cn(
              "mx-1",
              step.status === "completed" ? "text-emerald-400" : "text-neutral-300"
            )}>
              →
            </span>
          )}
          <span
            className={cn(
              "rounded px-1.5 py-0.5",
              step.status === "running" && "bg-blue-50 text-blue-600",
              step.status === "completed" && "bg-emerald-50 text-emerald-600",
              step.status === "pending" && "text-neutral-400"
            )}
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
