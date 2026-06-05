/**
 * ModelSelector - compact status pill for the local Claude Code backend.
 */
import { getPlatformService } from "@readany/core/services";
import { Check, Terminal, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

export function ModelSelector() {
  const [status, setStatus] = useState<"checking" | "ready" | "error">("checking");
  const [label, setLabel] = useState("Claude Code");

  useEffect(() => {
    let cancelled = false;
    getPlatformService()
      .checkClaudeCode?.()
      .then((result) => {
        if (cancelled) return;
        if (result?.available) {
          setStatus("ready");
          setLabel(result.version || "Claude Code");
        } else {
          setStatus("error");
          setLabel("Claude Code");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const Icon = status === "error" ? TriangleAlert : status === "ready" ? Check : Terminal;

  return (
    <div
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
        status === "error"
          ? "border-destructive/30 text-destructive"
          : "border-border text-muted-foreground"
      }`}
      title={status === "error" ? "Claude Code not available" : label}
    >
      <Icon className="size-3 shrink-0" />
      <span className="max-w-[150px] truncate">{label}</span>
    </div>
  );
}
