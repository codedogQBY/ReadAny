import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const helperPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../assets/reader/justified-text.js",
);

const OLD_MARKER = "data-readany-justify-body";
const PIN_ATTR = "data-readany-justify-pinned";
const BR_SELECTOR =
  "p, div, blockquote, dd, li, h1, h2, h3, h4, h5, h6, td, th, section, article, caption, figcaption";

class FakeContainer {
  readonly style: Record<string, string> & { removeProperty?: (p: string) => void } = {};
  readonly attrs = new Set<string>();

  constructor(
    public readonly textAlign: string,
    public readonly hasLineBreak = false,
  ) {
    this.style.removeProperty = (prop: string) => {
      delete this.style[prop];
    };
  }

  setAttribute(name: string, _value: string): void {
    this.attrs.add(name);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
    delete this.style.textAlign;
  }
}

class FakeDoc {
  constructor(readonly containers: FakeContainer[]) {}

  get defaultView() {
    return {
      getComputedStyle: (container: FakeContainer) => ({ textAlign: container.textAlign }),
    };
  }

  querySelectorAll(selector: string): FakeContainer[] {
    if (selector === `${BR_SELECTOR}:has(> br)`) {
      return this.containers.filter((container) => container.hasLineBreak);
    }
    if (selector === `[${OLD_MARKER}]`) return [];
    if (selector === `[${PIN_ATTR}]`) {
      return this.containers.filter((container) => container.attrs.has(PIN_ATTR));
    }
    return [];
  }

  getElementById(_id: string): unknown {
    return null;
  }
}

interface JustifiedTextApi {
  apply: (doc: FakeDoc, enabled: boolean, unsupportedLayout: boolean) => void;
  preserveAlignedBrContainers: (doc: FakeDoc) => void;
  JUSTIFY_CSS: string;
}

function loadHelper(): JustifiedTextApi | null {
  if (!existsSync(helperPath)) return null;
  const context: Record<string, unknown> = {};
  context.globalThis = context;
  runInNewContext(readFileSync(helperPath, "utf8"), context);
  return context.ReadAnyJustifiedText as JustifiedTextApi;
}

describe("reader-side justified text helper", () => {
  it("pins only author-aligned <br>-containing blocks to their alignment", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const left = new FakeContainer("left", true);
    const centered = new FakeContainer("center", true);
    const right = new FakeContainer("right", true);
    const noBr = new FakeContainer("center", false);
    const doc = new FakeDoc([left, centered, right, noBr]);

    api.apply(doc, true, false);

    // author-aligned, <br>-containing blocks get pinned inline + marked
    expect(centered.style.textAlign).toBe("center");
    expect(centered.attrs.has(PIN_ATTR)).toBe(true);
    expect(right.style.textAlign).toBe("right");
    // default/left alignment is left alone (no pin needed)
    expect(left.style.textAlign).toBeUndefined();
    // block without <br> is not scanned
    expect(noBr.style.textAlign).toBeUndefined();
  });

  it("unpins previously pinned alignment when disabled (clean undo)", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const centered = new FakeContainer("center", true);
    const doc = new FakeDoc([centered]);

    // enable → pins
    api.apply(doc, true, false);
    expect(centered.style.textAlign).toBe("center");
    expect(centered.attrs.has(PIN_ATTR)).toBe(true);

    // disable → unpins, restoring the book's own cascade
    api.apply(doc, false, false);
    expect(centered.style.textAlign).toBeUndefined();
    expect(centered.attrs.has(PIN_ATTR)).toBe(false);
  });

  it("does nothing when the justify setting is disabled", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const centered = new FakeContainer("center", true);
    const doc = new FakeDoc([centered]);

    api.apply(doc, false, false);
    expect(centered.style.textAlign).toBeUndefined();
  });

  it("skips unsupported (vertical / fixed) layouts and unpins leftovers", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const centered = new FakeContainer("center", true);
    const doc = new FakeDoc([centered]);

    // enable in a normal layout → pins
    api.apply(doc, true, false);
    expect(centered.style.textAlign).toBe("center");

    // same doc becomes unsupported (vertical) → unpin
    api.apply(doc, true, true);
    expect(centered.style.textAlign).toBeUndefined();
  });

  it("exports the @layer justify stylesheet scoped to horizontal text", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    expect(api.JUSTIFY_CSS).toContain("@layer readany-justify");
    expect(api.JUSTIFY_CSS).toContain(
      ":root:not([data-readany-vertical]) body { text-align: justify; }",
    );
    expect(api.JUSTIFY_CSS).toContain(
      ":root:not([data-readany-vertical]) :where(*:has(> br)) { text-align: start; }",
    );
    expect(api.JUSTIFY_CSS).toContain("figcaption");
    expect(api.JUSTIFY_CSS).toContain("text-align: start;");
  });
});