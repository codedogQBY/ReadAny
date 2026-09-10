import { describe, expect, it } from "vitest";
import {
  applyJustifiedText,
  buildJustifyCss,
  detectJustifyCapabilities,
  JUSTIFY_CSS,
  ORIGINAL_ATTR,
  PIN_ATTR,
} from "./justified-text";

const BR_SELECTOR =
  "p, div, blockquote, dd, li, h1, h2, h3, h4, h5, h6, td, th, section, article, caption, figcaption";

interface FakeElementChild {
  tagName: string;
}

const kebabToCamel = (p: string) => p.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

class FakeContainer {
  readonly style: Record<string, string> & {
    removeProperty?: (p: string) => void;
    setProperty?: (p: string, value: string) => void;
    getPropertyValue?: (p: string) => string;
  } = {};
  readonly attrs = new Map<string, string>();
  readonly children: FakeElementChild[];

  constructor(
    public readonly textAlign: string,
    public readonly hasLineBreak = false,
    /** Inline text-align the book itself set before we pin (null = none). */
    public readonly inlineTextAlign: string | null = null,
  ) {
    this.style.removeProperty = (prop: string) => {
      Reflect.deleteProperty(this.style, kebabToCamel(prop));
    };
    this.style.setProperty = (prop: string, value: string) => {
      this.style[kebabToCamel(prop)] = value;
    };
    this.style.getPropertyValue = (prop: string) => {
      // Once pinned the inline value is ours; before that it's the book's.
      if (this.attrs.has(PIN_ATTR)) return this.style[kebabToCamel(prop)] ?? "";
      return prop === "text-align" ? (this.inlineTextAlign ?? "") : "";
    };
    this.children = hasLineBreak ? [{ tagName: "BR" }] : [];
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
    Reflect.deleteProperty(this.style, kebabToCamel(name));
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
    const self = this;
    const layerSupported = self.capabilities.layerSupported ?? true;
    const supports = self.capabilities.supports ?? (() => true);
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
    if (selector === `[${PIN_ATTR}]`) {
      return this.containers.filter((container) => container.attrs.has(PIN_ATTR));
    }
    return [];
  }

  getElementById(_id: string): unknown {
    return null;
  }
}

function asDoc(doc: FakeDoc): Document {
  return doc as unknown as Document;
}

describe("reader-side justified text helper", () => {
  it("pins only author-aligned <br>-containing blocks to their alignment", () => {
    const left = new FakeContainer("left", true);
    const centered = new FakeContainer("center", true);
    const right = new FakeContainer("right", true);
    const noBr = new FakeContainer("center", false);
    const doc = new FakeDoc([left, centered, right, noBr]);

    applyJustifiedText(asDoc(doc), true, false);

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
    const centered = new FakeContainer("center", true);
    const doc = new FakeDoc([centered]);

    // enable → pins
    applyJustifiedText(asDoc(doc), true, false);
    expect(centered.style.textAlign).toBe("center");
    expect(centered.attrs.has(PIN_ATTR)).toBe(true);

    // disable → unpins, restoring the book's own cascade
    applyJustifiedText(asDoc(doc), false, false);
    expect(centered.style.textAlign).toBeUndefined();
    expect(centered.attrs.has(PIN_ATTR)).toBe(false);
  });

  it("does nothing when the justify setting is disabled", () => {
    const centered = new FakeContainer("center", true);
    const doc = new FakeDoc([centered]);

    applyJustifiedText(asDoc(doc), false, false);
    expect(centered.style.textAlign).toBeUndefined();
  });

  it("skips unsupported (vertical / fixed) layouts and unpins leftovers", () => {
    const centered = new FakeContainer("center", true);
    const doc = new FakeDoc([centered]);

    // enable in a normal layout → pins
    applyJustifiedText(asDoc(doc), true, false);
    expect(centered.style.textAlign).toBe("center");

    // same doc becomes unsupported (vertical) → unpin
    applyJustifiedText(asDoc(doc), true, true);
    expect(centered.style.textAlign).toBeUndefined();
  });

  it("exports the @layer justify stylesheet scoped to horizontal text", () => {
    expect(JUSTIFY_CSS).toContain("@layer readany-justify");
    expect(JUSTIFY_CSS).toContain(
      ":root:not([data-readany-vertical]) body { text-align: justify; }",
    );
    // Inside @layer the selectors stay bare — the layer position alone
    // guarantees unlayered book styles win, no :where() needed.
    expect(JUSTIFY_CSS).toContain(
      ":root:not([data-readany-vertical]) *:has(> br) { text-align: start; }",
    );
    expect(JUSTIFY_CSS).toContain("figcaption");
    expect(JUSTIFY_CSS).toContain("text-align: start;");
    // Justify owns line breaking: authored text-wrap: pretty must be
    // neutralized (readest #5582).
    expect(JUSTIFY_CSS).toContain("text-wrap-style: auto !important;");
  });

  it("detects modern engines as fully capable", () => {
    const doc = new FakeDoc([]);
    const caps = detectJustifyCapabilities(doc.defaultView);
    expect(caps).toEqual({ hasLayer: true, hasHas: true, hasWhere: true });
  });

  it("detects missing @layer / :has() / :where() from the engine", () => {
    const oldEngine = new FakeDoc([], {
      layerSupported: false,
      supports: (condition: string) => !condition.includes(":has") && !condition.includes(":where"),
    });
    expect(detectJustifyCapabilities(oldEngine.defaultView)).toEqual({
      hasLayer: false,
      hasHas: false,
      hasWhere: false,
    });

    const midEngine = new FakeDoc([], {
      layerSupported: true,
      supports: (condition: string) => !condition.includes(":has"),
    });
    expect(detectJustifyCapabilities(midEngine.defaultView)).toEqual({
      hasLayer: true,
      hasHas: false,
      hasWhere: true,
    });
  });

  it("scans br blocks without :has() when the engine lacks it", () => {
    const left = new FakeContainer("left", true);
    const centered = new FakeContainer("center", true);
    const noBr = new FakeContainer("center", false);
    const doc = new FakeDoc([left, centered, noBr], {
      layerSupported: true,
      supports: (condition: string) => !condition.includes(":has"),
    });

    applyJustifiedText(asDoc(doc), true, false);

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
    const centered = new FakeContainer("center", true);
    const doc = new FakeDoc([centered], { failHasQuery: true });

    applyJustifiedText(asDoc(doc), true, false);

    expect(centered.style.textAlign).toBe("center");
    expect(centered.attrs.has(PIN_ATTR)).toBe(true);
  });

  it("serves unlayered :where() CSS when @layer is unsupported", () => {
    const doc = new FakeDoc([], {
      layerSupported: false,
      supports: (condition: string) => !condition.includes(":has"),
    });
    const css = buildJustifyCss(detectJustifyCapabilities(doc.defaultView));

    // The old engine would discard the whole @layer block — the fallback must
    // not use it, must keep the justify default, and must not ship a :has()
    // rule the engine cannot match (the JS scan covers those blocks).
    expect(css).not.toContain("@layer");
    expect(css).toContain("text-align: justify");
    expect(css).not.toContain(":has(");
    // :where() keeps specificity at 0 so book rules still win.
    expect(css).toContain(":where(");
    expect(css).toContain("text-wrap-style: auto !important");
  });

  it("serves the layered CSS untouched on fully capable engines", () => {
    const doc = new FakeDoc([]);
    const css = buildJustifyCss(detectJustifyCapabilities(doc.defaultView));
    expect(css).toContain("@layer readany-justify");
    expect(css).toContain("text-align: justify");
    expect(css).toContain(":has(> br)");
    expect(css).toContain("text-wrap-style: auto !important");
  });

  it("builds the last-resort CSS without @layer/:has()/:where()", () => {
    const css = buildJustifyCss({ hasLayer: false, hasHas: false, hasWhere: false });
    expect(css).not.toContain("@layer");
    expect(css).not.toContain(":has(");
    expect(css).not.toContain(":where(");
    expect(css).toContain("body { text-align: justify; }");
    expect(css).toContain("figcaption");
    expect(css).toContain("text-wrap-style: auto !important");
  });

  it("restores an author's pre-existing inline alignment when unpinning", () => {
    // The book itself set inline text-align: center on this block.
    const centered = new FakeContainer("center", true, "center");
    const doc = new FakeDoc([centered]);

    applyJustifiedText(asDoc(doc), true, false);
    expect(centered.attrs.get(ORIGINAL_ATTR)).toBe("center");
    applyJustifiedText(asDoc(doc), false, false);
    // The author's own inline center must come back verbatim, not be wiped.
    expect(centered.style.textAlign).toBe("center");
  });

  it("does not mistake the pinned value for the original across repeated apply", () => {
    const centered = new FakeContainer("center", true, "center");
    const doc = new FakeDoc([centered]);

    applyJustifiedText(asDoc(doc), true, false);
    applyJustifiedText(asDoc(doc), true, false);
    expect(centered.attrs.get(ORIGINAL_ATTR)).toBe("center");
    applyJustifiedText(asDoc(doc), false, false);
    expect(centered.style.textAlign).toBe("center");
  });
});
