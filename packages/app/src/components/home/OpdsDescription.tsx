import { sanitizeOpdsDescription } from "@readany/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MouseEvent } from "react";

interface OpdsDescriptionProps {
  description: string;
  documentUrl: string;
  openExternal?(url: string): Promise<unknown>;
}

export function OpdsDescription({
  description,
  documentUrl,
  openExternal = openUrl,
}: OpdsDescriptionProps) {
  const sanitized = sanitizeOpdsDescription(description, documentUrl);

  const handleLink = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest("a") : null;
    if (!target || !event.currentTarget.contains(target)) return;
    event.preventDefault();
    const href = target.getAttribute("href");
    if (!href) return;
    try {
      const url = new URL(href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      void openExternal(url.href);
    } catch {
      // Sanitized links can still be mutated by the DOM; invalid final URLs stay inert.
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Nested native anchors already synthesize click events for keyboard activation.
    <div
      className="select-text space-y-2 text-sm leading-6 text-muted-foreground [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_li]:ml-5 [&_li]:list-disc"
      onClick={handleLink}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shared OPDS sanitization applies a strict element, attribute, and URL allowlist.
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
