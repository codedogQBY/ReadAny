/**
 * Message Part Components
 * Renders individual parts of a message (text, reasoning, tool calls, citations)
 */
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  ChevronDown,
  Circle,
  Loader2,
  XCircle,
  Brain,
  Wrench,
  BookOpen,
  ExternalLink,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import type { Part, TextPart, ReasoningPart, ToolCallPart, CitationPart } from "@/types/message";
import { MarkdownRenderer } from "./MarkdownRenderer";

const TEXT_RENDER_THROTTLE_MS = 100;

function useThrottledText(text: string): string {
  const [throttledText, setThrottledText] = useState(text);
  const lastUpdateRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;
    const remaining = TEXT_RENDER_THROTTLE_MS - timeSinceLastUpdate;

    if (remaining <= 0) {
      lastUpdateRef.current = now;
      setThrottledText(text);
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      lastUpdateRef.current = Date.now();
      setThrottledText(text);
    }, remaining);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [text]);

  return throttledText;
}

interface PartProps {
  part: Part;
  onCitationClick?: (citation: CitationPart) => void;
}

export function PartRenderer({ part, onCitationClick }: PartProps) {
  switch (part.type) {
    case "text":
      return <TextPartView part={part} />;
    case "reasoning":
      return <ReasoningPartView part={part} />;
    case "tool_call":
      return <ToolCallPartView part={part} />;
    case "citation":
      return <CitationPartView part={part} onCitationClick={onCitationClick} />;
    default:
      return null;
  }
}

function TextPartView({ part }: { part: TextPart }) {
  const throttledText = useThrottledText(part.text);

  if (!throttledText.trim()) return null;

  return (
    <div className="chat-markdown max-w-none text-sm leading-relaxed">
      <MarkdownRenderer content={throttledText} />
      {part.status === "running" && (
        <span className="inline-block h-4 w-1 animate-pulse bg-primary ml-0.5" />
      )}
    </div>
  );
}

function ReasoningPartView({ part }: { part: ReasoningPart }) {
  const [isOpen, setIsOpen] = useState(false);
  const throttledText = useThrottledText(part.text);

  if (!throttledText.trim()) return null;

  return (
    <div className="my-1">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="overflow-hidden rounded-lg border border-violet-200 bg-violet-50/50">
          <CollapsibleTrigger asChild>
            <div className="flex h-auto w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 hover:bg-violet-100/50">
              <div className="flex flex-1 items-center gap-2 overflow-hidden">
                {part.status === "running" ? (
                  <div className="flex h-4 w-4 items-center justify-center">
                    <div className="h-3 w-3 animate-pulse rounded-full bg-violet-400" />
                  </div>
                ) : (
                  <Brain className="h-4 w-4 text-violet-600" />
                )}
                <span className="text-sm font-medium text-violet-700">
                  {part.status === "running" ? "正在思考..." : "思考过程"}
                </span>
                {part.thinkingType && (
                  <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-500">
                    {part.thinkingType}
                  </span>
                )}
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-violet-400 transition-transform",
                  isOpen && "rotate-180"
                )}
              />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="max-h-48 overflow-y-auto border-t border-violet-200/50 bg-white/50 p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-violet-900">
                {throttledText}
              </p>
              {part.status === "running" && (
                <span className="inline-block h-4 w-1 animate-pulse bg-violet-500" />
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
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

function ToolCallPartView({ part }: { part: ToolCallPart }) {
  const [isOpen, setIsOpen] = useState(false);

  const getStatusIcon = () => {
    switch (part.status) {
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

  const label = TOOL_LABELS[part.name] || part.name;
  const queryText = part.args.query ? String(part.args.query) : "";
  const scopeText = part.args.scope ? String(part.args.scope) : "";

  return (
    <div className="my-1">
      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <div className="flex h-auto w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 hover:bg-neutral-50">
              <div className="flex flex-1 items-center gap-2 overflow-hidden">
                {getStatusIcon()}
                <Wrench className="h-3.5 w-3.5 text-neutral-500" />
                <span className="text-sm font-medium text-neutral-700">{label}</span>
                {queryText && (
                  <span className="flex-1 truncate font-mono text-xs text-neutral-500">
                    {queryText.slice(0, 50)}
                  </span>
                )}
                {scopeText && (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                    {scopeText}
                  </span>
                )}
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-neutral-400 transition-transform",
                  isOpen && "rotate-180"
                )}
              />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 border-t border-neutral-100 bg-neutral-50/50 p-3">
              {part.reasoning && (
                <div className="rounded border border-violet-100 bg-violet-50/30 p-2">
                  <p className="text-xs text-violet-700">{part.reasoning}</p>
                </div>
              )}

              {Object.keys(part.args).length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-xs font-medium text-neutral-500">参数</h4>
                  <div className="rounded border border-neutral-200 bg-white p-2 font-mono text-xs break-all">
                    {Object.entries(part.args).map(([key, value]) => (
                      <div key={key} className="mb-0.5 last:mb-0">
                        <span className="text-neutral-400">{key}:</span>{" "}
                        <span className="text-neutral-600">
                          {typeof value === "string" && value.length > 100
                            ? value.slice(0, 100) + "..."
                            : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {part.result !== undefined && (
                <div>
                  <h4 className="mb-1.5 text-xs font-medium text-neutral-500">结果</h4>
                  <div className="max-h-48 overflow-auto rounded border border-neutral-200 bg-white p-2 font-mono text-xs">
                    <pre className="whitespace-pre-wrap text-neutral-600">
                      {typeof part.result === "string" && part.result.length > 500
                        ? part.result.slice(0, 500) + "..."
                        : JSON.stringify(part.result, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {part.error && (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600">
                  {part.error}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}

function CitationPartView({
  part,
  onCitationClick,
}: {
  part: CitationPart;
  onCitationClick?: (citation: CitationPart) => void;
}) {
  return (
    <div
      onClick={() => onCitationClick?.(part)}
      className="group cursor-pointer rounded-lg border border-neutral-200 bg-white p-3 transition-all hover:border-neutral-300 hover:shadow-sm"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          <BookOpen className="h-3.5 w-3.5" />
          <span className="font-medium">{part.chapterTitle}</span>
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <p className="line-clamp-3 text-sm leading-relaxed text-neutral-700">{part.text}</p>
    </div>
  );
}
