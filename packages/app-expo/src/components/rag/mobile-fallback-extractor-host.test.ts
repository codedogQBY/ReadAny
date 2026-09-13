import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const componentDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(componentDir, "../..");

describe("mobile fallback extractor ownership", () => {
  it("mounts the fallback host beside root navigation", () => {
    const appSource = readFileSync(resolve(srcDir, "App.tsx"), "utf8");

    expect(appSource).toContain("import { MobileFallbackExtractorHost }");
    expect(appSource).toMatch(/<RootNavigator\s*\/>[\s\S]*<MobileFallbackExtractorHost\s*\/>/);
  });

  it("does not register the AI fallback provider from LibraryScreen", () => {
    const librarySource = readFileSync(resolve(srcDir, "screens/LibraryScreen.tsx"), "utf8");

    expect(librarySource).not.toContain("setFallbackContentProvider");
  });

  it("keeps the extraction WebView non-zero-sized", () => {
    const extractorSource = readFileSync(resolve(componentDir, "ExtractorWebView.tsx"), "utf8");

    expect(extractorSource).not.toMatch(/width:\s*0|height:\s*0/);
    expect(extractorSource).toMatch(/width:\s*1/);
    expect(extractorSource).toMatch(/height:\s*1/);
  });
});
