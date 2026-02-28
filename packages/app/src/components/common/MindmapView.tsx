/**
 * MindmapView — renders a mindmap from Markdown using markmap
 */
import { useEffect, useRef, useCallback } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { Maximize2, Minimize2 } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

interface MindmapViewProps {
  /** Markdown content to render as mindmap */
  markdown: string;
  /** Optional title displayed above the mindmap */
  title?: string;
}

const transformer = new Transformer();

export function MindmapView({ markdown, title }: MindmapViewProps) {
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
      markmapRef.current = Markmap.create(svgRef.current, {
        autoFit: true,
        duration: 300,
        maxWidth: 300,
        paddingX: 16,
      }, root);
    }
  }, [markdown]);

  // Render fullscreen mindmap when expanded
  const renderFullscreenMap = useCallback(() => {
    if (!fullscreenSvgRef.current || !markdown || !expanded) return;

    const { root } = transformer.transform(markdown);

    if (fullscreenMarkmapRef.current) {
      fullscreenMarkmapRef.current.setData(root);
      setTimeout(() => fullscreenMarkmapRef.current?.fit(), 100);
    } else {
      fullscreenMarkmapRef.current = Markmap.create(fullscreenSvgRef.current, {
        autoFit: true,
        duration: 300,
        maxWidth: 400,
        paddingX: 24,
      }, root);
    }
  }, [markdown, expanded]);

  useEffect(() => {
    renderMap();
  }, [renderMap]);

  // Render fullscreen map when expanded changes
  useEffect(() => {
    if (expanded) {
      // Small delay to ensure DOM is ready
      setTimeout(renderFullscreenMap, 50);
    } else {
      // Cleanup fullscreen markmap when closing
      fullscreenMarkmapRef.current = null;
    }
  }, [expanded, renderFullscreenMap]);

  // Handle escape key to close fullscreen
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

  // Fullscreen overlay rendered via portal
  const fullscreenOverlay = expanded
    ? createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setExpanded(false)}
            onKeyDown={() => {}}
          />
          {/* Fullscreen mindmap container */}
          <div className="relative z-10 m-4 flex h-[90vh] w-[90vw] max-w-6xl flex-col rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
              <span className="text-base font-medium text-neutral-700 dark:text-neutral-300">
                {title || "思维导图"}
              </span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                title="退出全屏 (Esc)"
              >
                <Minimize2 className="h-5 w-5 text-neutral-500" />
              </button>
            </div>
            {/* SVG container */}
            <svg ref={fullscreenSvgRef} className="h-full w-full flex-1" />
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <div className="relative rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {title || "思维导图"}
          </span>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="全屏查看"
          >
            <Maximize2 className="h-4 w-4 text-neutral-500" />
          </button>
        </div>

        {/* SVG container */}
        <svg ref={svgRef} className="h-[400px] w-full" />
      </div>

      {fullscreenOverlay}
    </>
  );
}
