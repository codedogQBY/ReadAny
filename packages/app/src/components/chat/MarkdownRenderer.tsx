/**
 * MarkdownRenderer — renders AI markdown responses with:
 * - GitHub Flavored Markdown (tables, strikethrough, task lists, autolinks)
 * - Syntax-highlighted code blocks via rehype-highlight
 * - Mermaid diagrams via beautiful-mermaid (synchronous SVG rendering)
 */
import { renderMermaidSVG } from "beautiful-mermaid";
import { Check, Copy } from "lucide-react";
import React, { useMemo, useState } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

/** Mermaid code block — renders synchronously, zero-flash */
function MermaidBlock({ code }: { code: string }) {
  const { svg, error } = useMemo(() => {
    try {
      return {
        svg: renderMermaidSVG(code, {
          bg: "var(--background)",
          fg: "var(--foreground)",
          transparent: true,
        }),
        error: null,
      };
    } catch (err) {
      return { svg: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }, [code]);

  if (error) {
    return (
      <pre className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
        {error.message}
      </pre>
    );
  }

  return (
    <div
      className="my-3 flex justify-center overflow-x-auto rounded-lg border bg-muted/30 p-4 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg! }}
    />
  );
}

/** Copy button for code blocks */
function CopyButton({ text }: { text: string }) {
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
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

const mdComponents = {
  // Code blocks: mermaid → diagram, others → highlighted with copy button
  code({
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
        <code
          className="rounded-md bg-muted px-1.5 py-0.5 text-[0.85em] font-mono"
          {...props}
        >
          {children}
        </code>
      );
    }

    // Mermaid diagram
    if (lang === "mermaid") {
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
  },

  // Links open externally
  a({ href, children, ...props }: React.ComponentProps<"a">) {
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
  },

  // Tables
  table({ children, ...props }: React.ComponentProps<"table">) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border">
        <table className="min-w-full" {...props}>
          {children}
        </table>
      </div>
    );
  },
  th({ children, ...props }: React.ComponentProps<"th">) {
    return (
      <th className="bg-muted/50 px-3 py-2 text-left text-xs font-semibold" {...props}>
        {children}
      </th>
    );
  },
  td({ children, ...props }: React.ComponentProps<"td">) {
    return (
      <td className="border-t px-3 py-2 text-sm" {...props}>
        {children}
      </td>
    );
  },
};

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  return (
    <div className={className}>
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={mdComponents}
      >
        {content}
      </Markdown>
    </div>
  );
});
