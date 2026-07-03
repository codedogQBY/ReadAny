import { getPlatformService } from "@readany/core/services";
import { cn } from "@readany/core/utils";
import type { CitationPart } from "@readany/core/types/message";
/**
 * MarkdownRenderer — renders AI markdown responses with:
 * - GitHub Flavored Markdown (tables, strikethrough, task lists, autolinks)
 * - Syntax-highlighted code blocks via rehype-highlight
 * - Mermaid diagrams via beautiful-mermaid (synchronous SVG rendering)
 */
import { renderMermaidSVG } from "beautiful-mermaid";
import * as d3 from "d3";
import { ArrowUpRight, Check, Copy, Download, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import React, {
  useMemo,
  useState,
  useRef,
  useCallback,
  memo,
  createContext,
  useContext,
  useEffect,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

const CitationContext = createContext<{
  citations?: CitationPart[];
  onCitationClick?: (citation: CitationPart) => void;
}>({});

const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const svgRef = useRef<HTMLDivElement>(null);
  const fullscreenSvgRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const fullscreenZoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const svg = useMemo(() => {
    try {
      const rendered = renderMermaidSVG(code, {
        bg: "var(--background)",
        fg: "var(--foreground)",
        transparent: true,
      });
      return rendered?.replace(
        /(<svg[^>]*>)/,
        `$1<style>
          text, .label, .nodeLabel, .edgeLabel, .cluster-label, .labelText, .titleText {
            fill: var(--foreground) !important;
          }
          .edgePath .path, .edge-thickness-normal, .edge-pattern-solid {
            stroke: var(--foreground) !important;
          }
          .arrowheadPath, marker polygon, .arrow {
            fill: var(--foreground) !important;
            stroke: var(--foreground) !important;
          }
          line, path:not(.node):not(.cluster) {
            stroke: var(--foreground) !important;
          }
        </style>`,
      );
    } catch (err) {
      return null;
    }
  }, [code]);

  const error = useMemo(() => {
    try {
      renderMermaidSVG(code, {
        bg: "var(--background)",
        fg: "var(--foreground)",
        transparent: true,
      });
      return null;
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  }, [code]);

  const setupZoom = useCallback(
    (
      container: HTMLDivElement | null,
      zoomBehavior: React.MutableRefObject<d3.ZoomBehavior<SVGSVGElement, unknown> | null>,
    ) => {
      if (!container) return;

      const svgElement = container.querySelector("svg");
      if (!svgElement) return;

      const viewBox = svgElement.getAttribute("viewBox");
      const width = svgElement.getAttribute("width");
      const height = svgElement.getAttribute("height");

      svgElement.style.width = "100%";
      svgElement.style.height = "100%";
      svgElement.style.cursor = "grab";
      svgElement.removeAttribute("width");
      svgElement.removeAttribute("height");

      if (!viewBox && width && height) {
        svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);
      }

      let contentG = svgElement.querySelector(".mermaid-content") as SVGGElement | null;
      if (!contentG) {
        const newG = document.createElementNS("http://www.w3.org/2000/svg", "g") as SVGGElement;
        newG.classList.add("mermaid-content");

        const children = Array.from(svgElement.childNodes);
        for (const child of children) {
          if (child.nodeName !== "style" && child !== newG) {
            newG.appendChild(child);
          }
        }
        svgElement.appendChild(newG);
        contentG = newG;
      }

      d3.select(svgElement).on(".zoom", null);

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 10])
        .on("zoom", (event) => {
          contentG!.setAttribute("transform", String(event.transform));
        });

      d3.select(svgElement).call(zoom);
      zoomBehavior.current = zoom;
    },
    [],
  );

  useEffect(() => {
    if (svg && svgRef.current) {
      const timer = setTimeout(() => setupZoom(svgRef.current, zoomRef), 50);
      return () => clearTimeout(timer);
    }
  }, [svg, setupZoom]);

  useEffect(() => {
    if (expanded && svg && fullscreenSvgRef.current) {
      const timer = setTimeout(() => setupZoom(fullscreenSvgRef.current, fullscreenZoomRef), 50);
      return () => clearTimeout(timer);
    }
  }, [expanded, svg, setupZoom]);

  useEffect(() => {
    if (!expanded && svg && svgRef.current) {
      const timer = setTimeout(() => setupZoom(svgRef.current, zoomRef), 50);
      return () => clearTimeout(timer);
    }
  }, [expanded, svg, setupZoom]);

  const handleReset = useCallback(() => {
    const container = expanded ? fullscreenSvgRef.current : svgRef.current;
    const zoomBehavior = expanded ? fullscreenZoomRef.current : zoomRef.current;
    const svgElement = container?.querySelector("svg");

    if (svgElement && zoomBehavior) {
      d3.select(svgElement)
        .transition()
        .duration(300)
        .call(zoomBehavior.transform, d3.zoomIdentity);
    }
  }, [expanded]);

  const handleDownload = useCallback(async () => {
    const svgElement = (expanded ? fullscreenSvgRef.current : svgRef.current)?.querySelector("svg");
    if (!svgElement) return;

    const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement;

    const g = clonedSvg.querySelector("g");
    if (g) {
      g.setAttribute("transform", "translate(0,0) scale(1)");
    }

    const allElements = clonedSvg.querySelectorAll("*");
    let minX = Number.POSITIVE_INFINITY,
      minY = Number.POSITIVE_INFINITY,
      maxX = Number.NEGATIVE_INFINITY,
      maxY = Number.NEGATIVE_INFINITY;

    allElements.forEach((el) => {
      if (el instanceof SVGGraphicsElement) {
        try {
          const bbox = el.getBBox();
          if (bbox.width > 0 && bbox.height > 0) {
            minX = Math.min(minX, bbox.x);
            minY = Math.min(minY, bbox.y);
            maxX = Math.max(maxX, bbox.x + bbox.width);
            maxY = Math.max(maxY, bbox.y + bbox.height);
          }
        } catch (e) {}
      }
    });

    if (minX === Number.POSITIVE_INFINITY) {
      const originalViewBox = svgElement.getAttribute("viewBox")?.split(/\s+/).map(Number) || [
        0, 0, 800, 600,
      ];
      minX = originalViewBox[0];
      minY = originalViewBox[1];
      maxX = originalViewBox[0] + originalViewBox[2];
      maxY = originalViewBox[1] + originalViewBox[3];
    }

    const padding = 10;
    const contentX = minX - padding;
    const contentY = minY - padding;
    const contentWidth = maxX - minX + padding * 2;
    const contentHeight = maxY - minY + padding * 2;

    clonedSvg.setAttribute("viewBox", `${contentX} ${contentY} ${contentWidth} ${contentHeight}`);
    clonedSvg.setAttribute("width", String(contentWidth));
    clonedSvg.setAttribute("height", String(contentHeight));

    clonedSvg.style.width = "";
    clonedSvg.style.height = "";

    const computedStyle = window.getComputedStyle(svgElement);
    const bgColor = computedStyle.getPropertyValue("--background") || "white";
    const fgColor = computedStyle.getPropertyValue("--foreground") || "#333";

    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", String(contentX));
    bgRect.setAttribute("y", String(contentY));
    bgRect.setAttribute("width", String(contentWidth));
    bgRect.setAttribute("height", String(contentHeight));
    bgRect.setAttribute("fill", bgColor.trim() || "white");
    clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);

    let svgData = new XMLSerializer().serializeToString(clonedSvg);
    svgData = svgData.replace(/var\(--background\)/g, bgColor.trim() || "white");
    svgData = svgData.replace(/var\(--foreground\)/g, fgColor.trim() || "#333");
    svgData = svgData.replace(/var\(--muted\)/g, "#888");

    const filename = `diagram-${Date.now()}.svg`;
    const platform = getPlatformService();
    await platform.shareOrDownloadFile(svgData, filename, "image/svg+xml");
    toast.success(t("common.downloadSuccess", "图表已下载"));
  }, [expanded, t]);

  if (error) {
    return (
      <pre className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
        {error.message}
      </pre>
    );
  }

  const fullscreenOverlay = expanded
    ? createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setExpanded(false)}
          />
          <div className="relative z-10 m-4 flex h-[90vh] w-[90vw] max-w-6xl flex-col rounded-lg border bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-medium">{t("mermaid.title", "Mermaid 图表")}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title={t("common.reset", "复原")}
                >
                  <RotateCcw className="size-4" />
                </button>
                <div className="w-px h-4 bg-border" />
                <button
                  type="button"
                  onClick={handleDownload}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title={t("mindmap.download", "下载")}
                >
                  <Download className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title={t("common.collapse", "收起")}
                >
                  <Minimize2 className="size-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <div
                ref={fullscreenSvgRef}
                className="w-full h-full"
                dangerouslySetInnerHTML={{ __html: svg || "" }}
              />
            </div>
            <div className="border-t px-4 py-2">
              <span className="text-xs text-muted-foreground">
                {t("mermaid.hint", "双击放大 · 滚轮缩放 · 拖动移动")}
              </span>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div className="group relative overflow-hidden">
        <div className="flex items-center justify-between px-1 py-1">
          <span className="text-xs text-muted-foreground">
            {t("mermaid.title", "Mermaid 图表")}
          </span>
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t("common.reset", "复原")}
            >
              <RotateCcw className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t("mindmap.download", "下载")}
            >
              <Download className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t("common.expand", "放大")}
            >
              <Maximize2 className="size-3.5" />
            </button>
          </div>
        </div>
        <div
          ref={svgRef}
          className="overflow-hidden"
          style={{ height: 350 }}
          dangerouslySetInnerHTML={{ __html: svg || "" }}
        />
        <div className="px-1 py-1">
          <span className="text-xs text-muted-foreground">
            {t("mermaid.hint", "双击放大 · 滚轮缩放 · 拖动移动")}
          </span>
        </div>
      </div>
      {fullscreenOverlay}
    </>
  );
});

/** Copy button for code blocks */
const CopyButton = memo(function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/code:opacity-100"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
});

// Static components - defined once at module level
const StaticCode = memo(function StaticCode({
  className: codeClassName,
  children,
  ...props
}: React.ComponentProps<"code">) {
  const text = String(children).replace(/\n$/, "");
  const langMatch = /language-(\w+)/.exec(codeClassName || "");
  const lang = langMatch?.[1];

  // Inline code (no language class, no newlines)
  if (!lang && !text.includes("\n")) {
    return (
      <code className="rounded-md bg-muted px-1.5 py-0.5 text-[0.85em] font-mono" {...props}>
        {children}
      </code>
    );
  }

  // Mermaid diagram
  if (lang === "mermaid") {
    // mermaid mindmap syntax is not supported by beautiful-mermaid,
    // render as a styled code block instead of crashing
    if (text.trim().startsWith("mindmap")) {
      return (
        <div className="group/code relative">
          <div className="absolute left-3 top-0 z-10 rounded-b-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            mindmap
          </div>
          <CopyButton text={text} />
          <pre className="!mt-0 !mb-0 rounded-lg border bg-muted/30 p-4">
            <code className="text-sm">{text}</code>
          </pre>
        </div>
      );
    }
    return <MermaidBlock code={text} />;
  }

  // Regular code block with copy button
  return (
    <div className="group/code relative">
      {lang && (
        <div className="absolute left-3 top-0 z-10 rounded-b-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {lang}
        </div>
      )}
      <CopyButton text={text} />
      <pre className="!mt-0 !mb-0">
        <code className={codeClassName} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
});

const StaticLink = memo(function StaticLink({
  href,
  children,
  ...props
}: React.ComponentProps<"a">) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary/60"
      {...props}
    >
      {children}
    </a>
  );
});

const StaticTable = memo(function StaticTable({
  children,
  ...props
}: React.ComponentProps<"table">) {
  return (
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table className="min-w-full" {...props}>
        {children}
      </table>
    </div>
  );
});

// Citation-aware components using context
const CitationTh = memo(function CitationTh({ children, ...props }: React.ComponentProps<"th">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return (
    <th className="bg-muted/50 px-3 py-2 text-left text-xs font-semibold" {...props}>
      {processCitationText(children, citations, onCitationClick)}
    </th>
  );
});

const CitationTd = memo(function CitationTd({ children, ...props }: React.ComponentProps<"td">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return (
    <td className="border-t px-3 py-2 text-sm" {...props}>
      {processCitationText(children, citations, onCitationClick)}
    </td>
  );
});

const CitationP = memo(function CitationP({ children, ...props }: React.ComponentProps<"p">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return <p {...props}>{processCitationText(children, citations, onCitationClick)}</p>;
});

const CitationLi = memo(function CitationLi({ children, ...props }: React.ComponentProps<"li">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return <li {...props}>{processCitationText(children, citations, onCitationClick)}</li>;
});

const CitationStrong = memo(function CitationStrong({
  children,
  ...props
}: React.ComponentProps<"strong">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return <strong {...props}>{processCitationText(children, citations, onCitationClick)}</strong>;
});

const CitationEm = memo(function CitationEm({ children, ...props }: React.ComponentProps<"em">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return <em {...props}>{processCitationText(children, citations, onCitationClick)}</em>;
});

const CitationBlockquote = memo(function CitationBlockquote({
  children,
  ...props
}: React.ComponentProps<"blockquote">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return (
    <blockquote {...props}>{processCitationText(children, citations, onCitationClick)}</blockquote>
  );
});

const CitationH1 = memo(function CitationH1({ children, ...props }: React.ComponentProps<"h1">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return <h1 {...props}>{processCitationText(children, citations, onCitationClick)}</h1>;
});

const CitationH2 = memo(function CitationH2({ children, ...props }: React.ComponentProps<"h2">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return <h2 {...props}>{processCitationText(children, citations, onCitationClick)}</h2>;
});

const CitationH3 = memo(function CitationH3({ children, ...props }: React.ComponentProps<"h3">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return <h3 {...props}>{processCitationText(children, citations, onCitationClick)}</h3>;
});

const CitationH4 = memo(function CitationH4({ children, ...props }: React.ComponentProps<"h4">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return <h4 {...props}>{processCitationText(children, citations, onCitationClick)}</h4>;
});

const CitationH5 = memo(function CitationH5({ children, ...props }: React.ComponentProps<"h5">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return <h5 {...props}>{processCitationText(children, citations, onCitationClick)}</h5>;
});

const CitationH6 = memo(function CitationH6({ children, ...props }: React.ComponentProps<"h6">) {
  const { citations, onCitationClick } = useContext(CitationContext);
  return <h6 {...props}>{processCitationText(children, citations, onCitationClick)}</h6>;
});

// Stable components object - defined once
const MD_COMPONENTS = {
  code: StaticCode,
  a: StaticLink,
  table: StaticTable,
  th: CitationTh,
  td: CitationTd,
  p: CitationP,
  li: CitationLi,
  strong: CitationStrong,
  em: CitationEm,
  blockquote: CitationBlockquote,
  h1: CitationH1,
  h2: CitationH2,
  h3: CitationH3,
  h4: CitationH4,
  h5: CitationH5,
  h6: CitationH6,
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
  citations?: CitationPart[];
  onCitationClick?: (citation: CitationPart) => void;
}

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

/** Process text children to find and replace [1], [2] citations with clickable links */
function processCitationText(
  children: React.ReactNode,
  citations?: CitationPart[],
  onCitationClick?: (citation: CitationPart) => void,
): React.ReactNode {
  if (!citations || citations.length === 0) {
    return children;
  }

  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      // Split on [1], [2] patterns
      const parts = child.split(/(\[\d+\])/g);
      return parts.map((part, i) => {
        const match = part.match(/\[(\d+)\]/);
        if (match) {
          const num = Number.parseInt(match[1]);
          // Look up by explicit citationIndex first, fall back to array position
          const citation = citations.find((c) => c.citationIndex === num) ?? citations[num - 1];
          if (citation) {
            return (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onCitationClick?.(citation);
                }}
                className="inline-flex items-baseline text-primary hover:text-primary/80 font-semibold text-[0.7em] align-super cursor-pointer border-none bg-transparent p-0 mx-0.5 transition-colors"
                title={`${citation.chapterTitle}: ${citation.text.slice(0, 50)}${citation.text.length > 50 ? "..." : ""}`}
              >
                [{num}]
                <ArrowUpRight className="inline h-2.5 w-2.5 ml-0.5" />
              </button>
            );
          }
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      });
    }
    return child;
  });
}

let mdStreamIdCounter = 0;

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  className,
  isStreaming,
  citations,
  onCitationClick,
}: MarkdownRendererProps) {
  // Stable unique id per instance so the streaming cursor CSS is scoped
  const scopeId = useMemo(() => `md-stream-${++mdStreamIdCounter}`, []);

  // Append a unicode cursor placeholder that we style via CSS when streaming.
  // This keeps the cursor inline with the last text rather than on a new line.
  const displayContent = isStreaming ? `${content}\u200B` : content;

  return (
    <CitationContext.Provider value={{ citations, onCitationClick }}>
      <div className={cn("select-text", className)} data-md-scope={isStreaming ? scopeId : undefined}>
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={MD_COMPONENTS}
        >
          {displayContent}
        </Markdown>
        {isStreaming && (
          <style>{`
            [data-md-scope="${scopeId}"] > *:last-child::after {
              content: "";
              display: inline-block;
              width: 3px;
              height: 1em;
              background: var(--primary);
              border-radius: 1px;
              margin-left: 2px;
              vertical-align: text-bottom;
              animation: cursor-blink 1s step-end infinite;
            }
            @keyframes cursor-blink {
              0%, 100% { opacity: 1; }
              50% { opacity: 0; }
            }
          `}</style>
        )}
      </div>
    </CitationContext.Provider>
  );
});
