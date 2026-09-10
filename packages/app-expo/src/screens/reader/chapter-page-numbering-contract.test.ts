import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

function readSource(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("chapter page numbering", () => {
  it("maps the 0-based renderer page onto a 1-based page number on both platforms", () => {
    const desktopViewer = readSource("packages/app/src/components/reader/FoliateViewer.tsx");
    const template = readSource("packages/app-expo/assets/reader/reader.template.html");

    for (const source of [desktopViewer, template]) {
      expect(source).toMatch(
        /current: Math\.min\(Math\.max\(rendererPage \+ 1, 1\), rendererPages\)/,
      );
      expect(source).toMatch(/total: rendererPages,/);
    }
  });

  it("no longer assumes padding pages around a section", () => {
    const desktopViewer = readSource("packages/app/src/components/reader/FoliateViewer.tsx");
    const template = readSource("packages/app-expo/assets/reader/reader.template.html");

    // renderer.pages is the real page count, so the old "minus one padding page on
    // each side" conversion clamped the first and last page of every section.
    for (const source of [desktopViewer, template]) {
      expect(source).not.toContain("rendererPages - 2");
      expect(source).toMatch(/rendererPages != null && rendererPages > 0/);
    }
  });

  it("keeps the built reader in sync with the template", () => {
    const builtReader = readSource("packages/app-expo/assets/reader/reader.html");

    expect(builtReader).toMatch(
      /current: Math\.min\(Math\.max\(rendererPage \+ 1, 1\), rendererPages\)/,
    );
    expect(builtReader).not.toContain("rendererPages - 2");
  });
});
