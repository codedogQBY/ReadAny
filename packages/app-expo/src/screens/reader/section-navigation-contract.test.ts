import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

function readSource(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("section index navigation", () => {
  it("decodes only string targets so numeric indices survive goTo", () => {
    const view = readSource("packages/foliate-js/view.js");

    expect(view).toContain('if (typeof target === "string") target = decodeURIComponent(target);');
    expect(view).not.toMatch(/^\s*target = decodeURIComponent\(target\);$/m);
    expect(view).toContain('if (typeof target === "number") return { index: target };');
  });

  it("documents why an unguarded decode broke index navigation", () => {
    // decodeURIComponent coerces its argument with ToString, which is what
    // turned a section index into a href that resolves to nothing.
    expect(decodeURIComponent(5 as unknown as string)).toBe("5");
    expect(decodeURIComponent({ index: 5 } as unknown as string)).toBe("[object Object]");
  });

  it("passes the raw section index from the WebView bridge", () => {
    const template = readSource("packages/app-expo/assets/reader/reader.template.html");
    const builtReader = readSource("packages/app-expo/assets/reader/reader.html");

    for (const source of [template, builtReader]) {
      expect(source).toMatch(
        /window\.goToSection = function \(sectionIndex\) \{[\s\S]*?return view\.goTo\(index\);[\s\S]*?\};/,
      );
      expect(source).not.toContain("await Promise.resolve(view.resolveNavigation(index))");
    }
  });
});
