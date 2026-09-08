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

interface FakeElementChild {
  tagName: string;
}

class FakeContainer {
  readonly style: Record<string, string> & { removeProperty?: (p: string) => void } = {};
  readonly attrs = new Set<string>();
  readonly children: FakeElementChild[];

  constructor(
    public readonly textAlign: string,
    public readonly hasLineBreak = false,
  ) {
    this.style.removeProperty = (prop: string) => {
      Reflect.deleteProperty(this.style, prop);
    };
    this.children = hasLineBreak ? [{ tagName: "BR" }] : [];
  }

  setAttribute(name: string, _value: string): void {
    this.attrs.add(name);
  }

  getAttribute(_name: string): string | null {
    return null;
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
    Reflect.deleteProperty(this.style, "textAlign");
  }
}

interface FakeCapabilities {
  /** CSSLayerBlockRule presence in the engine (defaults to supported). */
  layerSupported?: boolean;
  /** CSS.supports() answers (defaults to modern engine: everything true). */
  supports?: (condition: string) => boolean;
}

class FakeDoc {
  queries: string[] = [];
  failHasQuery = false;

  constructor(
    readonly containers: FakeContainer[],
    readonly capabilities: FakeCapabilities = {},
  ) {}

  get defaultView() {
    const layerSupported = this.capabilities.layerSupported ?? true;
    const supports = this.capabilities.supports ?? (() => true);
    return {
      CSSLayerBlockRule: layerSupported ? function FakeLayerBlockRule() {} : undefined,
      CSS: {
        supports: (condition: string) => supports(condition),
      },
      getComputedStyle: (container: FakeContainer) => ({ textAlign: container.textAlign }),
    };
  }

  querySelectorAll(selector: string): FakeContainer[] {
    this.queries.push(selector);
    if (this.failHasQuery && selector.includes(":has(")) {
      throw new SyntaxError("simulated engine rejection of :has() in querySelectorAll");
    }
    if (selector === `:is(${BR_SELECTOR}):has(> br)`) {
      return this.containers.filter((container) => container.hasLineBreak);
    }
    if (selector === BR_SELECTOR) return this.containers;
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
  preserveAlignedBrContainers: (doc: FakeDoc, caps?: unknown) => void;
  detectJustifyCapabilities: (doc: FakeDoc) => {
    hasLayer: boolean;
    hasHas: boolean;
    hasWhere: boolean;
  };
  buildJustifyCss: (caps: { hasLayer: boolean; hasHas: boolean; hasWhere: boolean }) => string;
  getJustifyCss: (doc: FakeDoc) => string;
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
    // default/left alignment is pinned to start so short lines are not
    // stretched by the body justify
    expect(left.style.textAlign).toBe("start");
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

  it("detects modern engines as fully capable", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const doc = new FakeDoc([]);
    const caps = api.detectJustifyCapabilities(doc);
    expect(caps).toEqual({ hasLayer: true, hasHas: true, hasWhere: true });
  });

  it("detects missing @layer / :has() / :where() from the engine", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const oldEngine = new FakeDoc([], {
      layerSupported: false,
      supports: (condition: string) => !condition.includes(":has") && !condition.includes(":where"),
    });
    expect(api.detectJustifyCapabilities(oldEngine)).toEqual({
      hasLayer: false,
      hasHas: false,
      hasWhere: false,
    });

    const midEngine = new FakeDoc([], {
      layerSupported: true,
      supports: (condition: string) => !condition.includes(":has"),
    });
    expect(api.detectJustifyCapabilities(midEngine)).toEqual({
      hasLayer: true,
      hasHas: false,
      hasWhere: true,
    });
  });

  it("scans br blocks without :has() when the engine lacks it", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const left = new FakeContainer("left", true);
    const centered = new FakeContainer("center", true);
    const noBr = new FakeContainer("center", false);
    const doc = new FakeDoc([left, centered, noBr], {
      layerSupported: true,
      supports: (condition: string) => !condition.includes(":has"),
    });

    api.apply(doc, true, false);

    // The scan must never ask the engine for a :has() selector — it throws
    // there — yet the alignment outcome is identical to the modern path.
    expect(doc.queries.some((query) => query.includes(":has("))).toBe(false);
    expect(doc.queries).toContain(BR_SELECTOR);
    expect(centered.style.textAlign).toBe("center");
    expect(centered.attrs.has(PIN_ATTR)).toBe(true);
    expect(left.style.textAlign).toBe("start");
    expect(noBr.style.textAlign).toBeUndefined();
  });

  it("falls back to the manual scan when querySelectorAll rejects :has()", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const centered = new FakeContainer("center", true);
    const doc = new FakeDoc([centered], { failHasQuery: true });

    api.apply(doc, true, false);

    expect(centered.style.textAlign).toBe("center");
    expect(centered.attrs.has(PIN_ATTR)).toBe(true);
  });

  it("serves unlayered :where() CSS when @layer is unsupported", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const doc = new FakeDoc([], {
      layerSupported: false,
      supports: (condition: string) => !condition.includes(":has"),
    });
    const css = api.getJustifyCss(doc);

    // The old engine would discard the whole @layer block — the fallback must
    // not use it, must keep the justify default, and must not ship a :has()
    // rule the engine cannot match (the JS scan covers those blocks).
    expect(css).not.toContain("@layer");
    expect(css).toContain("text-align: justify");
    expect(css).not.toContain(":has(");
    // :where() keeps specificity at 0 so book rules still win.
    expect(css).toContain(":where(");
  });

  it("serves the layered CSS untouched on fully capable engines", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const doc = new FakeDoc([]);
    const css = api.getJustifyCss(doc);
    expect(css).toContain("@layer readany-justify");
    expect(css).toContain("text-align: justify");
    expect(css).toContain(":has(> br)");
  });

  it("builds the last-resort CSS without @layer/:has()/:where()", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const css = api.buildJustifyCss({ hasLayer: false, hasHas: false, hasWhere: false });
    expect(css).not.toContain("@layer");
    expect(css).not.toContain(":has(");
    expect(css).not.toContain(":where(");
    expect(css).toContain("body { text-align: justify; }");
    expect(css).toContain("figcaption");
  });
});
