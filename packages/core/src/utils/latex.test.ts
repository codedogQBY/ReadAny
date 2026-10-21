import { describe, expect, it } from "vitest";
import { preprocessLaTeX } from "./latex";

describe("preprocessLaTeX", () => {
  it("returns empty string for empty or falsy input", () => {
    expect(preprocessLaTeX("")).toBe("");
    expect(preprocessLaTeX(null as unknown as string)).toBe("");
    expect(preprocessLaTeX(undefined as unknown as string)).toBe("");
  });

  it("leaves standard text without math untouched", () => {
    const text = "Hello world! This is a simple reading note.";
    expect(preprocessLaTeX(text)).toBe(text);
  });

  it("leaves pre-existing $$ math blocks untouched", () => {
    const text = "$$\n\\int_0^1 x dx = \\frac{1}{2}\n$$";
    expect(preprocessLaTeX(text)).toBe(text);
  });

  it("converts block math \\[ ... \\] to $$ ... $$", () => {
    const input = "\\[\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\\]";
    const output = preprocessLaTeX(input);
    expect(output).toContain("$$\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n$$");
  });

  it("converts the user's specific formula from prompt", () => {
    const formula =
      "\\[P[1]+P[-1] = P[\\Delta p>0] + P[\\Delta p<0] + \\underbrace{\\bigl(P[\\Delta p=0,,b_{t-1}{=}1] + P[\\Delta p=0,,b_{t-1}{=}{-}1]\\bigr)}_{=,P[\\Delta p=0]} = 1\\]";
    const output = preprocessLaTeX(formula);
    expect(output).toContain(
      "$$\nP[1]+P[-1] = P[\\Delta p>0] + P[\\Delta p<0] + \\underbrace{\\bigl(P[\\Delta p=0,,b_{t-1}{=}1] + P[\\Delta p=0,,b_{t-1}{=}{-}1]\\bigr)}_{=,P[\\Delta p=0]} = 1\n$$",
    );
  });

  it("handles the user's specific formula already wrapped in $$", () => {
    const formula =
      "$$P[1]+P[-1] = P[\\Delta p>0] + P[\\Delta p<0] + \\underbrace{\\bigl(P[\\Delta p=0,,b_{t-1}{=}1] + P[\\Delta p=0,,b_{t-1}{=}{-}1]\\bigr)}_{=,P[\\Delta p=0]} = 1$$";
    const output = preprocessLaTeX(formula);
    expect(output).toBe(formula);
  });

  it("converts inline math \\( ... \\) to $ ... $", () => {
    const input = "Here \\(E = mc^2\\) is Einstein's mass-energy equivalence.";
    const output = preprocessLaTeX(input);
    expect(output).toBe("Here $E = mc^2$ is Einstein's mass-energy equivalence.");
  });

  it("normalizes newlines inside inline math \\( ... \\)", () => {
    const input = "Formula \\(a +\n b = c\\) with line break.";
    const output = preprocessLaTeX(input);
    expect(output).toBe("Formula $a + b = c$ with line break.");
  });

  it("auto-wraps bare math environments like align and equation in $$ ... $$", () => {
    const input = `\\begin{align}
a &= b + c \\\\
&= d
\\end{align}`;
    const output = preprocessLaTeX(input);
    expect(output).toContain("$$\n\\begin{align}\na &= b + c \\\\\n&= d\n\\end{align}\n$$");
  });

  it("auto-wraps aligned environment in $$ ... $$", () => {
    const input = `\\begin{aligned}
x &= 1 \\\\
y &= 2
\\end{aligned}`;
    const output = preprocessLaTeX(input);
    expect(output).toContain("$$\n\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}\n$$");
  });

  it("auto-wraps cases and matrix environments in $$ ... $$", () => {
    const input = `\\begin{pmatrix}
1 & 2 \\\\
3 & 4
\\end{pmatrix}`;
    const output = preprocessLaTeX(input);
    expect(output).toContain("$$\n\\begin{pmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{pmatrix}\n$$");
  });

  it("does NOT double-wrap environments inside \\[ ... \\]", () => {
    const input = "\\[\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}\\]";
    const output = preprocessLaTeX(input);
    // Must NOT contain nested $$ ... $$ inside $$ ... $$
    expect(output).not.toContain("$$\n\n\n$$");
    expect(output).not.toContain("$$\n$$");
    expect(output.trim()).toBe("$$\n\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}\n$$");
  });

  it("does NOT touch \\begin{...} inside pre-existing $$ blocks", () => {
    const input = `$$
\\begin{align}
a &= b
\\end{align}
$$`;
    const output = preprocessLaTeX(input);
    expect(output).toBe(input);
  });

  it("does NOT modify LaTeX syntax inside fenced code blocks", () => {
    const codeBlock = `\`\`\`latex
\\[
x = 1
\\]
\\(y = 2\\)
\\begin{align}
z = 3
\\end{align}
\`\`\``;
    expect(preprocessLaTeX(codeBlock)).toBe(codeBlock);
  });

  it("does NOT modify LaTeX syntax inside unclosed streaming code blocks", () => {
    const streamingCode = "```python\ndef test():\n    # \\[ x = 1 \\]\n    pass";
    expect(preprocessLaTeX(streamingCode)).toBe(streamingCode);
  });

  it("does NOT modify LaTeX syntax inside inline code spans", () => {
    const inlineCode = "`\\[x = 1\\]` and `\\(y = 2\\)`";
    expect(preprocessLaTeX(inlineCode)).toBe(inlineCode);
  });

  it("escapes currency dollar amounts so remark-math does not misinterpret them as math", () => {
    const text = "The book cost $25 and shipping was $5, totaling $30.";
    const output = preprocessLaTeX(text);
    expect(output).toBe("The book cost \\$25 and shipping was \\$5, totaling \\$30.");
  });

  it("preserves actual math formulas starting with numbers like $1 + 2 = 3$", () => {
    const text = "Formula: $1 + 2 = 3$ is simple.";
    const output = preprocessLaTeX(text);
    expect(output).toBe("Formula: $1 + 2 = 3$ is simple.");
  });

  it("preserves table structure when \\[ ... \\] is inside a table cell", () => {
    const table = "| Concept | Formula |\n| --- | --- |\n| Energy | \\[ E = mc^2 \\] |";
    const output = preprocessLaTeX(table);
    // Should be on the same line to avoid breaking the table row
    expect(output).toContain("| Energy | $$E = mc^2$$ |");
    expect(output.split("\n").length).toBe(3);
  });

  it("preserves list structure when \\[ ... \\] is inside a list item", () => {
    const list = "1. Step one: \\[ x = 1 \\]\n2. Step two: \\[ y = 2 \\]";
    const output = preprocessLaTeX(list);
    expect(output).toContain("1. Step one: $$x = 1$$");
    expect(output).toContain("2. Step two: $$y = 2$$");
  });
});
