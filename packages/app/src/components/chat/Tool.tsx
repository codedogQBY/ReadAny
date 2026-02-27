/**
 * Tool Component — displays AI tool calls with status, input, and output
 * Inspired by Claude Code's tool visualization
 */
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { CheckCircle, ChevronDown, Circle, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import type { ToolCall } from "@/types/chat";

interface ToolProps {
  toolCall: ToolCall;
  defaultOpen?: boolean;
  className?: string;
}

const TOOL_LABELS: Record<string, string> = {
  ragSearch: "搜索书籍内容",
  ragToc: "获取目录结构",
  ragContext: "获取上下文",
  summarize: "生成摘要",
  extractEntities: "提取实体",
  analyzeArguments: "分析论证",
  findQuotes: "查找金句",
  getAnnotations: "获取标注",
  compareSections: "对比章节",
  getCurrentChapter: "获取当前章节",
  getSelection: "获取选中内容",
  getReadingProgress: "获取阅读进度",
  getRecentHighlights: "获取最近标注",
  getSurroundingContext: "获取上下文",
};

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function truncateText(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function getResultSummary(result: unknown): string {
  if (Array.isArray(result)) {
    return `${result.length} 条结果`;
  }
  return "完成";
}

export function Tool({ toolCall, defaultOpen = false, className }: ToolProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const { name, args, result, status } = toolCall;

  const getStatusIcon = () => {
    switch (status) {
      case "pending":
        return <Circle className="h-4 w-4 text-neutral-300" />;
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "completed":
        return <CheckCircle className="h-4 w-4 text-emerald-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Circle className="h-4 w-4 text-neutral-300" />;
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case "pending":
        return "等待中";
      case "running":
        return "执行中";
      case "completed":
        return "已完成";
      case "error":
        return "出错";
      default:
        return "";
    }
  };

  const label = TOOL_LABELS[name] || name;
  const displayArgs = Object.fromEntries(
    Object.entries(args).filter(([key]) => key !== "reasoning"),
  );

  const queryText = args.query ? String(args.query) : "";
  const scopeText = args.scope ? String(args.scope) : "";
  const resultText = result !== undefined && result !== null ? formatValue(result) : "";
  const hasResult = result !== undefined && result !== null;

  return (
    <div className={cn("my-1", className)}>
      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <div className="flex h-auto w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 hover:bg-neutral-50">
              <div className="flex flex-1 items-center gap-2 overflow-hidden">
                {getStatusIcon()}
                <span className="text-sm font-medium text-neutral-700">{label}</span>
                {queryText && (
                  <span className="flex-1 truncate font-mono text-xs text-neutral-500">
                    {truncateText(queryText, 50)}
                  </span>
                )}
                {scopeText && (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                    {scopeText}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {status !== "completed" && (
                  <span className="text-xs text-neutral-400">{getStatusLabel()}</span>
                )}
                {status === "completed" && hasResult && (
                  <span className="text-xs text-neutral-400">
                    {getResultSummary(result)}
                  </span>
                )}
                <ChevronDown className={cn("h-4 w-4 text-neutral-400 transition-transform", isOpen && "rotate-180")} />
              </div>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 border-t border-neutral-100 bg-neutral-50/50 p-3">
              {Object.keys(displayArgs).length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-xs font-medium text-neutral-500">参数</h4>
                  <div className="rounded border border-neutral-200 bg-white p-2 font-mono text-xs">
                    {Object.entries(displayArgs).map(([key, value]) => (
                      <div key={key} className="mb-0.5 last:mb-0">
                        <span className="text-neutral-400">{key}:</span>{" "}
                        <span className="text-neutral-600">
                          {truncateText(formatValue(value), 100)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {hasResult && status === "completed" && (
                <div>
                  <h4 className="mb-1.5 text-xs font-medium text-neutral-500">结果</h4>
                  <div className="max-h-48 overflow-auto rounded border border-neutral-200 bg-white p-2 font-mono text-xs">
                    <pre className="whitespace-pre-wrap text-neutral-600">
                      {truncateText(resultText, 500)}
                    </pre>
                  </div>
                </div>
              )}

              {status === "error" && toolCall.error && (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600">
                  {toolCall.error}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
