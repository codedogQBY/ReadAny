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
    const text = "$$\\n\\int_0^1 x dx = \\frac{1}{2}\\n$$";
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

  it("converts inline math \\( ... \\) to $ ... $", () => {
    const input = "Here \\(E = mc^2\\) is Einstein's mass-energy equivalence.";
    const output = preprocessLaTeX(input);
    expect(output).toBe("Here $E = mc^2$ is Einstein's mass-energy equivalence.");
  });

  it("auto-wraps bare math environments like align and equation in $$ ... $$", () => {
    const input = `\\begin{align}
a &= b + c \\\\
&= d
\\end{align}`;
    const output = preprocessLaTeX(input);
    expect(output).toContain("$$\n\\begin{align}\na &= b + c \\\\\n&= d\n\\end{align}\n$$");
  });

  it("auto-wraps cases environment in $$ ... $$", () => {
    const input = `\\begin{cases}
x, & \\text{if } x > 0 \\\\
-x, & \\text{otherwise}
\\end{cases}`;
    const output = preprocessLaTeX(input);
    expect(output).toContain("$$\n\\begin{cases}");
    expect(output).toContain("\\end{cases}\n$$");
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

  it("does NOT modify LaTeX syntax inside inline code spans", () => {
    const inlineCode = "`\\[x = 1\\]` and `\\(y = 2\\)`";
    expect(preprocessLaTeX(inlineCode)).toBe(inlineCode);
  });

  it("preserves currency dollar amounts without corrupting them", () => {
    const text = "The book cost $25 and shipping was $5, totaling $30.";
    expect(preprocessLaTeX(text)).toBe(text);
  });
});
