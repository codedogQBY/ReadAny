import { cn } from "@readany/core/utils";
/**
 * StreamingIndicator — shows current AI processing status
 * Displays thinking/tool-calling/responding state with animation
 */
import { Brain, Loader2, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";

interface StreamingIndicatorProps {
  step: "thinking" | "tool_calling" | "responding" | "idle";
  toolName?: string;
  className?: string;
}

export function StreamingIndicator({ step, toolName, className }: StreamingIndicatorProps) {
  const { t } = useTranslation();
  if (step === "idle") return null;

  return (
    <div className={cn("flex items-center gap-2 px-3 py-2", className)}>
      <div className="flex items-center gap-2">
        {step === "thinking" && (
          <>
            <div className="flex h-5 w-5 items-center justify-center">
              <Brain className="h-4 w-4 animate-pulse text-primary" />
            </div>
            <span className="text-xs text-foreground">{t("streaming.thinking")}</span>
          </>
        )}
        {step === "tool_calling" && (
          <>
            <div className="flex h-5 w-5 items-center justify-center">
              <Wrench className="h-4 w-4 animate-spin text-primary" />
            </div>
            <span className="text-xs text-foreground">
              {toolName ? t("streaming.callingTool", { toolName }) : t("streaming.toolCalling")}
            </span>
          </>
        )}
        {step === "responding" && (
          <>
            <div className="flex h-5 w-5 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
            <span className="text-xs text-foreground">{t("streaming.responding")}</span>
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
      {steps.map((step, idx) => (
        <div key={step.label} className="flex items-center gap-1">
          {idx > 0 && (
            <span
              className={cn(
                "mx-1",
                step.status === "completed" ? "text-primary" : "text-muted-foreground",
              )}
            >
              →
            </span>
          )}
          <span
            className={cn(
              "rounded px-1.5 py-0.5",
              step.status === "running" && "bg-primary/10 text-foreground",
              step.status === "completed" && "bg-primary/10 text-foreground",
              step.status === "pending" && "text-muted-foreground",
            )}
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
