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
  "alignat",
  "alignat\\*",
  "gather",
  "gather\\*",
  "multline",
  "multline\\*",
  "matrix",
  "pmatrix",
  "bmatrix",
  "vmatrix",
  "Vmatrix",
  "cases",
  "split",
].join("|");

export function preprocessLaTeX(content: string): string {
  if (!content) return "";

  // Tokenize to protect code blocks and pre-existing $$ math blocks
  // 1. Fenced code: ```...``` or ~~~...~~~
  // 2. Inline code: `...`
  // 3. Pre-existing math block: $$...$$
  const tokenRegex = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|\$\$[\s\S]*?\$\$)/g;

  const parts = content.split(tokenRegex);

  return parts
    .map((part, index) => {
      // Odd indices are matched protected blocks
      if (index % 2 === 1) {
        return part;
      }

      let text = part;

      // 1. Convert block math: \[ ... \] -> $$ ... $$
      text = text.replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_, math) => {
        return `\n\n$$\n${math.trim()}\n$$\n\n`;
      });

      // 2. Wrap bare \begin{env} ... \end{env} in $$ ... $$
      const envRegex = new RegExp(
        `(?<!\\\\)\\\\begin\\{(${MATH_ENVIRONMENTS})\\}([\\s\\S]*?)(?<!\\\\)\\\\end\\{\\1\\}`,
        "g",
      );
      text = text.replace(envRegex, (match) => {
        return `\n\n$$\n${match.trim()}\n$$\n\n`;
      });

      // 3. Convert inline math: \( ... \) -> $ ... $
      // Must not cross line breaks (inline scope)
      text = text.replace(/(?<!\\)\\\((.+?)(?<!\\)\\\)/g, (_, math) => {
        return `$${math.trim()}$`;
      });

      return text;
    })
    .join("");
}
