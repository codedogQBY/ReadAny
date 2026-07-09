import { getPlatformService } from "@readany/core/services";
import { Download, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

function getThemePrimaryColor(): string {
  if (typeof window === "undefined") return "#2d2d30";
  const style = getComputedStyle(document.documentElement);
  return style.getPropertyValue("--primary").trim() || "#2d2d30";
}

interface MindmapViewProps {
  markdown: string;
  title?: string;
}

const transformer = new Transformer();

export function MindmapView({ markdown, title }: MindmapViewProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const fullscreenSvgRef = useRef<SVGSVGElement>(null);
  const markmapRef = useRef<Markmap | null>(null);
  const fullscreenMarkmapRef = useRef<Markmap | null>(null);
  const [expanded, setExpanded] = useState(false);

  const renderMap = useCallback(() => {
    if (!svgRef.current || !markdown) return;

    const { root } = transformer.transform(markdown);

    if (markmapRef.current) {
      markmapRef.current.setData(root);
      markmapRef.current.fit();
    } else {
      const mm = Markmap.create(
        svgRef.current,
        {
          autoFit: true,
          fitRatio: 0.8,
          duration: 300,
          maxWidth: 300,
          paddingX: 16,
          color: () => getThemePrimaryColor(),
          style: (id: string) => `
          .${id} {
            --markmap-text-color: var(--foreground);
            --markmap-code-bg: var(--muted);
            --markmap-code-color: var(--foreground);
            --markmap-circle-open-bg: var(--card);
          }
          .${id} .markmap-foreign {
            color: var(--foreground);
          }
          .${id} .markmap-foreign a {
            color: var(--primary);
          }
          .${id} .markmap-foreign a:hover {
            color: var(--primary);
          }
          .${id} .markmap-foreign code {
            color: var(--foreground);
            background-color: var(--muted);
          }
        `,
        },
        root,
      );
      markmapRef.current = mm;
    }
  }, [markdown]);

  const renderFullscreenMap = useCallback(() => {
    if (!fullscreenSvgRef.current || !markdown || !expanded) return;

    const { root } = transformer.transform(markdown);

    if (fullscreenMarkmapRef.current) {
      fullscreenMarkmapRef.current.setData(root);
    } else {
      const mm = Markmap.create(
        fullscreenSvgRef.current,
        {
          autoFit: true,
          fitRatio: 0.8,
          duration: 300,
          maxWidth: 400,
          paddingX: 24,
          color: () => getThemePrimaryColor(),
          style: (id: string) => `
          .${id} {
            --markmap-text-color: var(--foreground);
            --markmap-code-bg: var(--muted);
            --markmap-code-color: var(--foreground);
            --markmap-circle-open-bg: var(--card);
          }
          .${id} .markmap-foreign {
            color: var(--foreground);
          }
          .${id} .markmap-foreign a {
            color: var(--primary);
          }
          .${id} .markmap-foreign a:hover {
            color: var(--primary);
          }
          .${id} .markmap-foreign code {
            color: var(--foreground);
            background-color: var(--muted);
          }
        `,
        },
        root,
      );
      fullscreenMarkmapRef.current = mm;
    }
  }, [markdown, expanded]);

  useEffect(() => {
    renderMap();
  }, [renderMap]);

  useEffect(() => {
    if (expanded) {
      setTimeout(renderFullscreenMap, 50);
    } else {
      fullscreenMarkmapRef.current = null;
    }
  }, [expanded, renderFullscreenMap]);

  useEffect(() => {
    if (!expanded) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpanded(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expanded]);

  const handleReset = useCallback(() => {
    const mm = expanded ? fullscreenMarkmapRef.current : markmapRef.current;
    if (mm) {
      mm.fit();
    }
  }, [expanded]);

  const handleDownload = useCallback(async () => {
    const svgElement = expanded ? fullscreenSvgRef.current : svgRef.current;
    if (!svgElement) return;

    const gElement = svgElement.querySelector("g");
    let contentX = -500;
    let contentY = -500;
    let contentWidth = 2000;
    let contentHeight = 1500;

    if (gElement) {
      try {
        const bbox = gElement.getBBox();
        const padding = 50;
        contentX = bbox.x - padding;
        contentY = bbox.y - padding;
        contentWidth = bbox.width + padding * 2;
        contentHeight = bbox.height + padding * 2;
      } catch {}
    }

    const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement;

    const clonedG = clonedSvg.querySelector("g");
    if (clonedG) {
      clonedG.setAttribute("transform", "translate(0,0) scale(1)");
    }

    clonedSvg.setAttribute("viewBox", `${contentX} ${contentY} ${contentWidth} ${contentHeight}`);
    clonedSvg.setAttribute("width", String(contentWidth));
    clonedSvg.setAttribute("height", String(contentHeight));

    clonedSvg.style.width = "";
    clonedSvg.style.height = "";

    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", String(contentX));
    bgRect.setAttribute("y", String(contentY));
    bgRect.setAttribute("width", String(contentWidth));
    bgRect.setAttribute("height", String(contentHeight));
    bgRect.setAttribute("fill", "white");
    clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);

    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      .markmap {
        --markmap-text-color: #333 !important;
        --markmap-code-bg: #f5f5f5 !important;
        --markmap-code-color: #333 !important;
        --markmap-circle-open-bg: #fff !important;
      }
      .markmap-foreign {
        color: #333 !important;
      }
      text {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
        fill: #333 !important;
      }
    `;
    clonedSvg.insertBefore(style, clonedSvg.firstChild);

    let svgData = new XMLSerializer().serializeToString(clonedSvg);
    svgData = svgData.replace(/var\(--foreground\)/g, "#333");
    svgData = svgData.replace(/var\(--background\)/g, "#fff");
    svgData = svgData.replace(/var\(--muted\)/g, "#f5f5f5");

    const filename = `${title || t("mindmap.title")}.svg`;
    const platform = getPlatformService();
    await platform.shareOrDownloadFile(svgData, filename, "image/svg+xml");
    toast.success(t("common.downloadSuccess", "图表已下载"));
  }, [expanded, title, t]);

  const displayTitle = title && title.length > 20 ? `${title.slice(0, 20)}...` : title;

  const fullscreenOverlay = expanded
    ? createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setExpanded(false)}
            onKeyDown={() => {}}
          />
          <div className="relative z-10 m-4 flex h-[90vh] w-[90vw] max-w-6xl flex-col rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span
                className="text-base font-medium text-foreground cursor-default"
                title={title && title.length > 20 ? title : undefined}
              >
                {displayTitle || t("mindmap.title")}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded p-1.5 hover:bg-muted transition-colors"
                  title={t("common.reset", "复原")}
                >
                  <RotateCcw className="h-5 w-5 text-muted-foreground" />
                </button>
                <div className="w-px h-5 bg-border" />
                <button
                  type="button"
                  onClick={handleDownload}
                  className="rounded p-1.5 hover:bg-muted transition-colors"
                  title={t("mindmap.download")}
                >
                  <Download className="h-5 w-5 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="rounded p-1.5 hover:bg-muted transition-colors"
                  title={t("mindmap.exitFullscreen")}
                >
                  <Minimize2 className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden" data-fullscreen="true">
              <svg ref={fullscreenSvgRef} className="w-full h-full" />
            </div>
            <div className="border-t border-border px-4 py-2">
              <span className="text-xs text-muted-foreground">
                {t("mindmap.hint", "双击放大 · 拖动移动 · 点击节点展开/收起")}
              </span>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div className="relative rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span
            className="text-sm font-medium text-foreground cursor-default"
            title={title && title.length > 20 ? title : undefined}
          >
            {displayTitle || t("mindmap.title")}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleReset}
              className="rounded p-1 hover:bg-muted transition-colors"
              title={t("common.reset", "复原")}
            >
              <RotateCcw className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="rounded p-1 hover:bg-muted transition-colors"
              title={t("mindmap.download")}
            >
              <Download className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded p-1 hover:bg-muted transition-colors"
              title={t("mindmap.fullscreen")}
            >
              <Maximize2 className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="overflow-hidden" style={{ height: 400 }} data-mindmap="true">
          <svg ref={svgRef} className="w-full h-full" />
        </div>
        <div className="border-t border-border px-3 py-1.5">
          <span className="text-xs text-muted-foreground">
            {t("mindmap.hint", "双击放大 · 拖动移动 · 点击节点展开/收起")}
          </span>
        </div>
      </div>

      {fullscreenOverlay}
    </>
  );
}
