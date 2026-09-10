/**
 * Shared justified-body-text engine for the EPUB reader — used by BOTH the
 * desktop viewer (FoliateViewer) and the mobile reader WebView (reader.html
 * bundles this file via scripts/build-reader.js), so the capability fallbacks,
 * CSS generation and alignment pinning cannot drift between the two.
 *
 * Strategy: the reader's own `body { text-align: justify }` fallback lives in
 * `@layer readany-justify` so any unlayered book style wins (never override
 * the book), with `:where()` keeping specificity at 0. Blocks that DIRECTLY
 * contain a <br> (poetry/lyrics) get `text-align: start` so short lines are
 * not stretched; blocks the author aligned (center/right/end, via class, id,
 * inline style, align attribute or an aligned ancestor) keep their alignment —
 * CSS cannot see computed alignment, so a small scan pins those inline.
 *
 * Engine support floors (caniuse): `:has()` needs Chromium 105 / Safari 15.4 /
 * WebKitGTK 2.36; `@layer` needs Chromium 99 / Safari 15.4 / WebKitGTK 2.36;
 * `:where()` needs Chromium 88 / Safari 14 / WebKitGTK 2.32. Engines below the
 * floors degrade DIFFERENTLY and dangerously by default: `@layer` blocks are
 * discarded whole (justify silently disappears), `:has()` drops the containing
 * rule AND makes querySelectorAll throw. detectJustifyCapabilities +
 * buildJustifyCss + the guarded scan handle all three capability tiers.
 */

export interface JustifyCapabilities {
  hasLayer: boolean;
  hasHas: boolean;
  hasWhere: boolean;
}

export const BR_CONTAINER_SELECTOR =
  "p, div, blockquote, dd, li, h1, h2, h3, h4, h5, h6, td, th, section, article, caption, figcaption";

export const PIN_ATTR = "data-readany-justify-pinned";
/** The element's inline text-align as it was BEFORE we pinned ("" = none). */
export const ORIGINAL_ATTR = "data-readany-justify-original";

const OLD_MARKER = "data-readany-justify-body";
const OLD_STYLE_ID = "__readany_justified_text__";

// Alignments that differ from the start edge and must be preserved. `left` /
// `start` render identically to the fallback; `justify` is the reader's own
// request, so it needs no pin either.
const PRESERVED_ALIGNMENTS = new Set([
  "center",
  "right",
  "end",
  "-webkit-center",
  "-webkit-right",
]);

/**
 * Feature detection for the CSS capabilities above. `view` is the engine
 * global (window / the WebView's globalThis): `CSSLayerBlockRule` exists
 * exactly when @layer is supported, and CSS.supports("selector(...)") answers
 * :has()/:where() honestly on engines that have CSS.supports at all
 * (Chromium 28+). Engines without CSS.supports (below our practical floor)
 * optimistically report supported — the guarded scan still protects the
 * runtime if that guess is wrong.
 */
export function detectJustifyCapabilities(view: unknown): JustifyCapabilities {
  const v = (view ?? {}) as {
    CSSLayerBlockRule?: unknown;
    CSS?: { supports?: (condition: string) => boolean };
  };
  let hasLayer = false;
  try {
    hasLayer = typeof v.CSSLayerBlockRule !== "undefined";
  } catch {
    hasLayer = false;
  }
  const supportsSelector = (condition: string): boolean => {
    try {
      if (!v.CSS || typeof v.CSS.supports !== "function") return true;
      return Boolean(v.CSS.supports.call(v.CSS, condition));
    } catch {
      return true;
    }
  };
  return {
    hasLayer,
    hasHas: supportsSelector("selector(:has(> br))"),
    hasWhere: supportsSelector("selector(:where(p))"),
  };
}

/**
 * Build the justify stylesheet for the detected capability set.
 *  - @layer supported  → rules stay layered: any unlayered book style wins
 *    regardless of specificity (the strongest guarantee).
 *  - @layer missing    → rules are served unlayered. To keep the "never
 *    override the book" property as long as possible, every selector is
 *    wrapped in :where() (specificity 0) when the engine has :where — any
 *    book rule with real specificity still beats ours. Engines without
 *    :where (Chromium < 88, WebKitGTK < 2.30, Safari < 14) get the bare
 *    selectors as a last resort; books that style body/text alignment at
 *    equal specificity may lose the tie there.
 *  - :has() missing    → the br-container rule is omitted entirely; the JS
 *    scan pins those blocks inline instead (it never needed :has for that).
 */
export function buildJustifyCss(caps: JustifyCapabilities): string {
  const guard = ":root:not([data-readany-vertical])";
  // Inside @layer the layer position already guarantees any unlayered book
  // style wins, so keep the selectors bare (identical to the original tier-1
  // sheet). In the un-layered fallback, :where() zeroes specificity so book
  // rules still win.
  const scoped = (baseSelector: string) =>
    caps.hasLayer
      ? `${guard} ${baseSelector}`
      : caps.hasWhere
        ? `:where(${guard} ${baseSelector})`
        : `${guard} ${baseSelector}`;
  const rules = [`${scoped("body")} { text-align: justify; }`];
  // Authored `text-wrap: pretty` (e.g. Standard Ebooks core.css) makes engines
  // that justify with it overshoot inter-word gaps. When justify is on the
  // reader owns line breaking: reset only the style longhand, so an authored
  // nowrap mode survives. Borrowed from readest (#5582).
  rules.push(
    `${["html", "body", "p", "li", "blockquote", "dd"]
      .map((t) => scoped(t))
      .join(", ")} { text-wrap-style: auto !important; }`,
  );
  if (caps.hasHas) {
    rules.push(`${scoped("*:has(> br)")} { text-align: start; }`);
  }
  const excludeTargets = ["pre", "code", "kbd", "samp", "table", "caption", "figcaption", "form"];
  rules.push(`${excludeTargets.map((t) => scoped(t)).join(", ")} { text-align: start; }`);
  return caps.hasLayer
    ? `@layer readany-justify {\n${rules.map((rule) => `  ${rule}`).join("\n")}\n}`
    : rules.join("\n");
}

/** The full-capability reference stylesheet (tier 1). */
export const JUSTIFY_CSS: string = buildJustifyCss({
  hasLayer: true,
  hasHas: true,
  hasWhere: true,
});

/**
 * Collect block-level elements that DIRECTLY contain a <br>.
 *
 * With :has() available this is a single engine-native query. Without it,
 * querySelectorAll(":is(...):has(...)") would THROW SyntaxError, so we fall
 * back to the plain block selector and filter by iterating children — an API
 * set that exists on every engine we target. The try/catch additionally
 * covers engines whose :has() works in stylesheets but not in
 * querySelectorAll (or any other engine quirk).
 */
export function collectBrContainers(doc: Document, caps: JustifyCapabilities): Element[] {
  if (caps.hasHas) {
    try {
      return Array.from(doc.querySelectorAll(`:is(${BR_CONTAINER_SELECTOR}):has(> br)`));
    } catch {
      // fall through to the manual scan
    }
  }
  const candidates = Array.from(doc.querySelectorAll(BR_CONTAINER_SELECTOR));
  return candidates.filter((candidate) => {
    const children = candidate.children;
    for (let i = 0; i < children.length; i++) {
      if (children[i].tagName === "BR") return true;
    }
    return false;
  });
}

function isVerticalDoc(doc: Document): boolean {
  if (!doc.documentElement || !doc.defaultView) return false;
  const body = doc.body;
  if (!body) return false;
  try {
    const style = doc.defaultView.getComputedStyle(body);
    if (style.writingMode === "vertical-rl" || style.writingMode === "vertical-lr") {
      return true;
    }
    // Some EPUBs set writing-mode on the first child of body instead of body
    // itself — mirror foliate's getDirection.
    const firstChild = body.querySelector(":scope > :not([cfi-inert])");
    if (!firstChild) return false;
    const childStyle = doc.defaultView.getComputedStyle(firstChild);
    return childStyle.writingMode === "vertical-rl" || childStyle.writingMode === "vertical-lr";
  } catch {
    return false;
  }
}

/**
 * Pin every <br>-bearing block inline: author-aligned blocks keep their
 * computed alignment; unaligned ones are forced to start so short lines are
 * not stretched by the body justify. The element's own inline text-align (if
 * any) is recorded BEFORE we touch it, so unpinning can put it back verbatim.
 * Only captured on first pin — re-running must not mistake our pinned value
 * for the book's original.
 *
 * Also cleans up leftovers from the previous marker-based implementation so
 * upgrading readers don't carry stale attributes / style tags around.
 */
export function pinAlignedBrContainers(doc: Document, caps: JustifyCapabilities): void {
  for (const el of Array.from(doc.querySelectorAll(`[${OLD_MARKER}]`))) {
    el.removeAttribute(OLD_MARKER);
  }
  doc.getElementById(OLD_STYLE_ID)?.remove();

  // First honour explicit align="" attributes on the element or its ancestors
  // — these may not produce a computed text-align in the reader's sandboxed
  // document, so they must be read directly. The element itself may report
  // `start` because our :has(> br) rule directly applies and overrides an
  // inherited center/right — read the nearest ancestor's alignment instead.
  const inheritAlign = (el: Element): string => {
    let cur: Element | null = el;
    while (cur) {
      const al = cur.getAttribute("align")?.toLowerCase();
      if (al) {
        if (al === "center") return "center";
        if (al === "right") return "right";
        if (al === "left") return "start";
        if (al === "justify") return "justify";
      }
      cur = cur.parentElement;
    }
    cur = el;
    while (cur) {
      const a = String(doc.defaultView?.getComputedStyle(cur).textAlign || "").toLowerCase();
      if (a !== "start" && a !== "inherit") return a;
      cur = cur.parentElement;
    }
    return "start";
  };

  for (const container of collectBrContainers(doc, caps)) {
    const align = inheritAlign(container);
    const pinnedValue = PRESERVED_ALIGNMENTS.has(align) ? align : "start";
    if (!container.hasAttribute(PIN_ATTR)) {
      container.setAttribute(
        ORIGINAL_ATTR,
        (container as HTMLElement).style.getPropertyValue("text-align"),
      );
    }
    (container as HTMLElement).style.setProperty("text-align", pinnedValue);
    container.setAttribute(PIN_ATTR, "");
  }
}

/**
 * Remove every text-align we pinned previously, restoring each element's
 * original inline text-align exactly (or removing ours when there was none),
 * so the book's own cascade is restored bit-for-bit. Used when justify is
 * disabled or the layout is unsupported.
 */
export function unpinAlignedBrContainers(doc: Document): void {
  if (!doc) return;
  for (const el of Array.from(doc.querySelectorAll(`[${PIN_ATTR}]`))) {
    const htmlEl = el as HTMLElement;
    const original = el.getAttribute(ORIGINAL_ATTR) ?? "";
    if (original) {
      htmlEl.style.setProperty("text-align", original);
    } else {
      htmlEl.style.removeProperty("text-align");
    }
    el.removeAttribute(ORIGINAL_ATTR);
    el.removeAttribute(PIN_ATTR);
  }
}

/**
 * Unified per-document justify sync: tag the root so the CSS scopes itself to
 * horizontal text, unpin (clean undo) when disabled or unsupported, pin when
 * enabled. `unsupportedLayout` (vertical / fixed) — when omitted, falls back
 * to the shared O(1) isVerticalDoc check.
 */
export function applyJustifiedText(
  doc: Document,
  enabled: boolean,
  unsupportedLayout?: boolean,
  caps?: JustifyCapabilities,
): void {
  const isUnsupported = unsupportedLayout || isVerticalDoc(doc);
  if (doc.documentElement) {
    if (isUnsupported) {
      doc.documentElement.setAttribute("data-readany-vertical", "");
    } else {
      doc.documentElement.removeAttribute("data-readany-vertical");
    }
  }
  if (!enabled || isUnsupported) {
    unpinAlignedBrContainers(doc);
    return;
  }
  pinAlignedBrContainers(doc, caps ?? detectJustifyCapabilities(doc.defaultView));
}

/**
 * Install the full API on a global object — used by the mobile reader WebView
 * (reader.html) where the template calls `globalThis.ReadAnyJustifiedText`.
 */
export function installReadAnyJustifiedText(root: unknown): void {
  const target = (root ?? {}) as Record<string, unknown>;
  const view = root;
  target.ReadAnyJustifiedText = {
    apply: (doc: Document, enabled: boolean, unsupportedLayout?: boolean) =>
      applyJustifiedText(doc, enabled, unsupportedLayout, detectJustifyCapabilities(view)),
    getJustifyCss: () => buildJustifyCss(detectJustifyCapabilities(view)),
    detectJustifyCapabilities: (v?: unknown) => detectJustifyCapabilities(v ?? view),
    buildJustifyCss,
    preserveAlignedBrContainers: (doc: Document) =>
      pinAlignedBrContainers(doc, detectJustifyCapabilities(view)),
    JUSTIFY_CSS,
  };
}
