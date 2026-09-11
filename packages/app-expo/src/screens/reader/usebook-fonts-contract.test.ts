import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

function readSource(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

// The useBookFonts cascade recipe exists in three places that must not drift:
// the mobile template, its generated artifact, and the desktop generator.
// The behavior hinges on subtle specificity/!important interactions
// (zero-specificity :where() fallback vs. (0,0,3)/(0,2,2) forced override),
// so the contract pins the rule SHAPES per toggle state.
describe("useBookFonts font cascade contract", () => {
  const template = readSource("packages/app-expo/assets/reader/reader.template.html");
  const generated = readSource("packages/app-expo/assets/reader/reader.html");
  const desktop = readSource("packages/app/src/components/reader/FoliateViewer.tsx");

  it("honors book fonts by default: zero-specificity :where() fallbacks, no !important", () => {
    for (const [name, source] of [
      ["template", template],
      ["generated", generated],
      ["desktop", desktop],
    ] as const) {
      expect(source, name).toMatch(/:where\(html\)\s*\{\s*font-family: var\(--readany-font-family\);/);
      // Inner code/kbd/samp inside a pre are excluded so they keep inheriting
      // the book's font from pre instead of getting a direct declaration.
      expect(source, name).toMatch(
        /:where\(pre, :not\(pre\) > code, :not\(pre\) > kbd, :not\(pre\) > samp\)\s*\{\s*font-family: ui-monospace[^}]*;/,
      );
      // The UA stylesheet declares `code { font-family: monospace }` and any
      // direct declaration beats inheritance — this zero-specificity inherit
      // restores the `<pre><code>` chain to the book's font on pre.
      expect(source, name).toMatch(
        /:where\(pre :is\(code, kbd, samp\)\)\s*\{\s*font-family: inherit;/,
      );
    }
    // The honoring branch must not carry !important anywhere.
    expect(template).toMatch(/currentUseBookFonts\s*\?\s*`:where\(html\)[^`]*`/);
    expect(template).not.toMatch(/:where\(html\)\s*\{[^}]*!important/);
    expect(desktop).not.toMatch(/:where\(pre[^)]*\)\s*\{[^}]*!important/);
  });

  it("forces the reader font when the toggle is off, above authored !important rules", () => {
    // Desktop: html body :is(...) at (0,0,3) — outranks an authored
    // `body pre { ... !important }` at (0,0,2), which a bare `pre, code, kbd`
    // at (0,0,1) would lose to despite its own !important.
    expect(desktop).toMatch(
      /html body :is\(pre, code, kbd, samp\)\s*\{\s*font-family: ui-monospace[^}]*!important/,
    );
    // Mobile: the same idea guarded to horizontal writing so the vertical
    // branch keeps its pre-existing behavior (no descendant forcing).
    expect(template).toMatch(
      /:root:not\(\.vrtl\):not\(\.vltr\),\s*\n\s*:root:not\(\.vrtl\):not\(\.vltr\) body\s*\{\s*font-family: var\(--readany-font-family\) !important/,
    );
    expect(template).toMatch(
      /:root:not\(\.vrtl\):not\(\.vltr\) body :is\(pre, code, kbd, samp\)\s*\{\s*font-family: ui-monospace[^}]*!important/,
    );
    // The forced body-star rule keeps the horizontal guard too.
    expect(template).toMatch(
      /:root:not\(\.vrtl\):not\(\.vltr\) body \*:not\(svg\)[^{]*\{\s*font-family: var\(--readany-font-family\) !important/,
    );
    // And the generated artifact carries the same shapes.
    expect(generated).toMatch(/:root:not\(\.vrtl\):not\(\.vltr\) body :is\(pre, code, kbd, samp\)/);
    expect(generated).toMatch(/:where\(pre, :not\(pre\) > code/);
  });

  it("emits exactly one unconditional monospace rule in the desktop output", () => {
    // The legacy unconditional `pre, code, kbd, samp { ... !important }` must
    // stay gone from the desktop generator — its reintroduction would silently
    // override book code fonts again.
    expect(desktop).not.toMatch(/(?<!:where\()pre, code, kbd, samp,?\s*\{[^}]*!important/);
  });
});
