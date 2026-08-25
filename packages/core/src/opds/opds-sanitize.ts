const ALLOWED_ELEMENTS = new Set(["p", "br", "em", "strong", "ul", "ol", "li", "blockquote", "a"]);

const DROP_CONTENT_ELEMENTS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "video",
  "audio",
  "canvas",
]);

const DROP_VOID_ELEMENTS = new Set(["img", "input", "link", "meta", "source", "track"]);
const VOID_ALLOWED_ELEMENTS = new Set(["br"]);

function decodeEntities(value: string): string {
  return value.replace(/&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos);/gi, (_entity, name: string) => {
    const normalized = name.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";

    const hexadecimal = normalized.startsWith("#x");
    const codePoint = Number.parseInt(normalized.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return "";
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return "";
    }
  });
}

function escapeText(value: string): string {
  return decodeEntities(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function getSafeHref(attributeSource: string, documentUrl?: string): string | undefined {
  const match = attributeSource.match(/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
  const href = decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
  const hasControlCharacter = Array.from(href).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (!href || href.startsWith("//") || href.includes("\\") || hasControlCharacter) {
    return undefined;
  }

  try {
    const resolved = new URL(href, documentUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sanitizes an untrusted OPDS HTML fragment without attaching it to a browser DOM.
 */
export function sanitizeOpdsDescription(input: string, documentUrl?: string): string {
  const tokens = input.match(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|[^<]+|</g) ?? [];
  const output: string[] = [];
  const allowedStack: string[] = [];
  const droppedStack: string[] = [];

  for (const token of tokens) {
    if (token.startsWith("<!--")) continue;

    if (!token.startsWith("<") || token === "<") {
      if (droppedStack.length === 0) output.push(escapeText(token));
      continue;
    }

    const closing = /^<\//.test(token);
    const name = token.match(/^<\/?\s*([A-Za-z][\w:-]*)/)?.[1]?.toLowerCase();
    if (!name) {
      if (droppedStack.length === 0) output.push(escapeText(token));
      continue;
    }

    if (droppedStack.length > 0) {
      if (closing && droppedStack[droppedStack.length - 1] === name) droppedStack.pop();
      else if (!closing && DROP_CONTENT_ELEMENTS.has(name)) droppedStack.push(name);
      continue;
    }

    if (DROP_VOID_ELEMENTS.has(name)) continue;
    if (DROP_CONTENT_ELEMENTS.has(name)) {
      if (!closing) droppedStack.push(name);
      continue;
    }
    if (!ALLOWED_ELEMENTS.has(name)) continue;

    if (closing) {
      if (VOID_ALLOWED_ELEMENTS.has(name)) continue;
      const index = allowedStack.lastIndexOf(name);
      if (index === -1) continue;
      while (allowedStack.length > index) {
        output.push(`</${allowedStack.pop()}>`);
      }
      continue;
    }

    if (name === "a") {
      const href = getSafeHref(token.slice(token.indexOf(name) + name.length), documentUrl);
      output.push(
        href
          ? `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">`
          : "<a>",
      );
    } else {
      output.push(`<${name}>`);
    }
    if (!VOID_ALLOWED_ELEMENTS.has(name)) allowedStack.push(name);
  }

  while (allowedStack.length > 0) output.push(`</${allowedStack.pop()}>`);
  return output.join("");
}

/** Converts an untrusted OPDS description into plain text for persisted book metadata. */
export function opdsDescriptionToPlainText(
  input: string,
  documentUrl?: string,
): string | undefined {
  const text = sanitizeOpdsDescription(input, documentUrl)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const normalized = decodeEntities(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized || undefined;
}
