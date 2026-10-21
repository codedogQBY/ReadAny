/**
 * LaTeX utility functions for AI chat and markdown rendering.
 *
 * LLMs frequently generate LaTeX formulas using various delimiters:
 * - Block math: `$$...$$` or `\\[...\\]`
 * - Inline math: `$...$` or `\\(...\\)`
 * - Bare environments: `\\begin{equation}...\\end{equation}`, `\\begin{align}...\\end{align}`, etc.
 *
 * This utility pre-processes markdown content so that all standard LaTeX math syntax
 * commonly produced by LLMs is normalized into standard Markdown math syntax ($$ and $)
 * recognized by `remark-math` and rendered by KaTeX, while strictly protecting:
 * 1. Fenced code blocks (```...``` and ~~~...~~~)
 * 2. Inline code spans (`...`)
 * 3. Pre-existing `$$...$$` display math blocks
 */

const MATH_ENVIRONMENTS = [
  "equation",
  "equation\\*",
  "align",
  "align\\*",
  "aligned",
  "alignedat",
  "alignedat\\*",
  "alignat",
  "alignat\\*",
  "gather",
  "gather\\*",
  "gathered",
  "multline",
  "multline\\*",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "cases",
  "cases\\*",
  "rcases",
  "rcases\\*",
  "dcases",
  "dcases\\*",
  "split",
  "array",
  "smallmatrix",
  "subarray",
  "CD",
].join("|");

/**
 * Escapes currency dollar signs (e.g. `$25`, `$5.99`, `$1,000`) so that remark-math
 * does not accidentally treat them as inline math delimiters.
 */
function escapeCurrencyDollars(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes("$")) return line;

      return line.replace(
        /(?<!\\)\$(\d+(?:,\d{3})*(?:\.\d+)?)(?=[\s,.;:!?)\]\-]|$)/g,
        (match, _amount, offset, fullLine) => {
          const after = fullLine.slice(offset + match.length);
          const nextDollarIndex = after.indexOf("$");
          if (nextDollarIndex === -1) {
            return `\\${match}`;
          }
          const between = after.slice(0, nextDollarIndex);
          if (/[=+\-*^_{}\\]|[<>]=?/.test(between)) {
            return match;
          }
          return `\\${match}`;
        },
      );
    })
    .join("\n");
}

export function preprocessLaTeX(content: string): string {
  if (!content) return "";

  // 1. Protect code blocks:
  // - Closed fenced code: ```...``` or ~~~...~~~
  // - Unclosed fenced code at EOF (streaming): ```... or ~~~...
  // - Inline code: `...`
  const codeBlockRegex = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`)/g;

  const parts = content.split(codeBlockRegex);

  return parts
    .map((part, index) => {
      // Odd indices are matched protected code blocks
      if (index % 2 === 1) {
        return part;
      }

      let text = part;

      // Escape currency amounts so remark-math doesn't swallow text between them
      text = escapeCurrencyDollars(text);

      // 2. Convert block math delimiters: \[ ... \] -> $$ ... $$
      // Handle both multiline and single-line (e.g. in table cells or lists)
      text = text.replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (match, math, offset, fullStr) => {
        const trimmed = math.trim();
        const lineStart = fullStr.lastIndexOf("\n", offset);
        const lineEnd = fullStr.indexOf("\n", offset + match.length);
        const currentLine = fullStr.slice(
          lineStart === -1 ? 0 : lineStart + 1,
          lineEnd === -1 ? fullStr.length : lineEnd,
        );

        const isTable = currentLine.includes("|");
        const isSingleLine =
          !math.includes("\n") && (isTable || /^\s*([*\-+]|\d+\.)\s+/.test(currentLine));

        if (isSingleLine) {
          return `$$${trimmed}$$`;
        }

        return `\n$$\n${trimmed}\n$$\n`;
      });

      // 3. Protect pre-existing and newly converted $$ ... $$ blocks
      // before handling bare environments, so environments inside $$...$$
      // are NEVER double-wrapped!
      const mathBlockRegex = /(\$\$[\s\S]*?(?:\$\$|$))/g;
      const subParts = text.split(mathBlockRegex);

      text = subParts
        .map((subPart, subIndex) => {
          // Odd indices are $$...$$ blocks -> leave untouched
          if (subIndex % 2 === 1) {
            return subPart;
          }

          let subText = subPart;

          // Wrap bare \begin{env} ... \end{env} in $$ ... $$
          const envRegex = new RegExp(
            `(?<!\\\\)\\\\begin\\{(${MATH_ENVIRONMENTS})\\}([\\s\\S]*?)(?<!\\\\)\\\\end\\{\\1\\}`,
            "g",
          );
          subText = subText.replace(envRegex, (match) => {
            return `\n$$\n${match.trim()}\n$$\n`;
          });

          // Convert inline math: \( ... \) -> $ ... $
          // Allow soft newlines inside \( ... \) by normalizing whitespace
          subText = subText.replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_, math) => {
            const normalized = math.replace(/\s+/g, " ").trim();
            return `$${normalized}$`;
          });

          return subText;
        })
        .join("");

      return text;
    })
    .join("");
}
