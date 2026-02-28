/**
 * MindmapView — renders a mindmap from Markdown using markmap
 */
import { useEffect, useRef, useCallback } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { Maximize2, Minimize2 } from "lucide-react";
import { useState } from "react";

interface MindmapViewProps {
  /** Markdown content to render as mindmap */
  markdown: string;
  /** Optional title displayed above the mindmap */
  title?: string;
}

const transformer = new Transformer();

export function MindmapView({ markdown, title }: MindmapViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const markmapRef = useRef<Markmap | null>(null);
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

  useEffect(() => {
    renderMap();
  }, [renderMap]);

  // Re-fit on expand/collapse
  useEffect(() => {
    if (markmapRef.current) {
      setTimeout(() => markmapRef.current?.fit(), 50);
    }
  }, [expanded]);

  return (
    <div
      className={`relative rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900 ${
        expanded ? "fixed inset-4 z-50 shadow-2xl" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {title || "思维导图"}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {expanded ? (
            <Minimize2 className="h-4 w-4 text-neutral-500" />
          ) : (
            <Maximize2 className="h-4 w-4 text-neutral-500" />
          )}
        </button>
      </div>

      {/* SVG container */}
      <svg
        ref={svgRef}
        className={`w-full ${expanded ? "h-[calc(100%-40px)]" : "h-[400px]"}`}
      />

      {/* Backdrop for expanded mode */}
      {expanded && (
        <div
          className="fixed inset-0 -z-10 bg-black/30"
          onClick={() => setExpanded(false)}
          onKeyDown={() => {}}
        />
      )}
    </div>
  );
}
