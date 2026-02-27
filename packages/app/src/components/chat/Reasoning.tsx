/**
 * Reasoning Component — displays AI thinking/reasoning process
 * Collapsible panel showing the agent's thought process
 */
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Brain, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ReasoningProps {
  content: string;
  isStreaming?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

export function Reasoning({ content, isStreaming = false, defaultOpen = false, className }: ReasoningProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [wasAutoOpened, setWasAutoOpened] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming && !wasAutoOpened) {
      setIsOpen(true);
      setWasAutoOpened(true);
    }
    if (!isStreaming && wasAutoOpened) {
      setIsOpen(false);
      setWasAutoOpened(false);
    }
  }, [isStreaming, wasAutoOpened]);

  useEffect(() => {
    if (isOpen && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, isOpen]);

  if (!content) return null;

  return (
    <div className={cn("my-1", className)}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="overflow-hidden rounded-lg border border-amber-200 bg-amber-50/50">
          <CollapsibleTrigger asChild>
            <div className="flex h-auto w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 hover:bg-amber-100/50">
              <div className="flex flex-1 items-center gap-2 overflow-hidden">
                {isStreaming ? (
                  <div className="flex h-4 w-4 items-center justify-center">
                    <div className="h-3 w-3 animate-pulse rounded-full bg-amber-400" />
                  </div>
                ) : (
                  <Brain className="h-4 w-4 text-amber-600" />
                )}
                <span className="text-sm font-medium text-amber-700">
                  {isStreaming ? "正在思考..." : "思考过程"}
                </span>
                {isStreaming && (
                  <span className="flex-1 truncate text-xs text-amber-500">
                    分析中...
                  </span>
                )}
              </div>
              <ChevronDown className={cn("h-4 w-4 text-amber-400 transition-transform", isOpen && "rotate-180")} />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div
              ref={contentRef}
              className="max-h-48 overflow-y-auto border-t border-amber-200/50 bg-white/50 p-3"
            >
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-amber-900">
                {content}
              </p>
              {isStreaming && (
                <span className="inline-block h-4 w-1 animate-pulse bg-amber-500" />
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}

/**
 * Plan Step Component — displays agent's plan steps
 */
interface PlanStep {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "skipped";
}

interface PlanViewProps {
  steps: PlanStep[];
  className?: string;
}

export function PlanView({ steps, className }: PlanViewProps) {
  return (
    <div className={cn("my-2", className)}>
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-neutral-500" />
          <span className="text-sm font-medium text-neutral-700">执行计划</span>
        </div>
        <div className="space-y-1">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1.5 text-sm",
                step.status === "running" && "bg-blue-50 text-blue-700",
                step.status === "completed" && "text-neutral-500",
                step.status === "pending" && "text-neutral-400",
                step.status === "skipped" && "text-neutral-300 line-through"
              )}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                {step.status === "completed" ? (
                  <span className="text-emerald-500">✓</span>
                ) : step.status === "running" ? (
                  <span className="flex h-4 w-4 items-center justify-center">
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-blue-500" />
                  </span>
                ) : (
                  index + 1
                )}
              </span>
              <span className={cn(step.status === "running" && "font-medium")}>
                {step.description}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { Lightbulb } from "lucide-react";
