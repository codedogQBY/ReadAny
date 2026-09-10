(function installReadAnyJustifiedText(root) {
  const OLD_MARKER = "data-readany-justify-body";
  const OLD_STYLE_ID = "__readany_justified_text__";

  // Selector covering every block-level element that may directly contain
  // <br> (poetry, lyrics, addresses, signatures, ...). `*:has(br)` would also
  // match nested containers that merely *contain* a br descendant; restricting
  // to block-level containers keeps the scan small and the intent clear.
  const BR_CONTAINER_SELECTOR =
    "p, div, blockquote, dd, li, h1, h2, h3, h4, h5, h6, td, th, section, article, caption, figcaption";

  // Alignments that differ from the start edge and must be preserved. `left` /
  // `start` render identically to the fallback, so they are left alone;
  // `justify` is the reader's own request, so it needs no pin either.
  const PRESERVED_ALIGNMENTS = new Set([
    "center",
    "right",
    "end",
    "-webkit-center",
    "-webkit-right",
  ]);

  // The text-align: justify fallback lives in @layer readany-justify. Because
  // book styles are unlayered, any author alignment wins over this layer, so we
  // never override the book. :where() keeps specificity at 0. Elements that
  // DIRECTLY contain a <br> (poetry/lyrics line breaks) get `start` so short
  // lines are not stretched — `:has(> br)` matches only the element whose br is
  // a direct child, never an outer container that merely contains a br
  // descendant (which would wrongly cascade `start` onto unrelated siblings).
  // Code, tables, captions and forms are excluded entirely. All rules are
  // scoped to horizontal text — apply() tags vertical/fixed documents with
  // data-readany-vertical, which cannot be expressed with a pure-CSS guard.
  const JUSTIFY_CSS = [
    "@layer readany-justify {",
    "  :root:not([data-readany-vertical]) body { text-align: justify; }",
    "  :root:not([data-readany-vertical]) :where(*:has(> br)) { text-align: start; }",
    "  :root:not([data-readany-vertical]) html,",
    "  :root:not([data-readany-vertical]) body,",
    "  :root:not([data-readany-vertical]) p,",
    "  :root:not([data-readany-vertical]) li,",
    "  :root:not([data-readany-vertical]) blockquote,",
    "  :root:not([data-readany-vertical]) dd",
    "  { text-wrap-style: auto !important; }",
    "  :root:not([data-readany-vertical]) pre,",
    "  :root:not([data-readany-vertical]) code,",
    "  :root:not([data-readany-vertical]) kbd,",
    "  :root:not([data-readany-vertical]) samp,",
    "  :root:not([data-readany-vertical]) table,",
    "  :root:not([data-readany-vertical]) caption,",
    "  :root:not([data-readany-vertical]) figcaption,",
    "  :root:not([data-readany-vertical]) form { text-align: start; }",
    "}",
  ].join("\n");

  /**
   * Engine capability detection for the CSS features the fallback relies on.
   *
   * Support floor (caniuse): `:has()` needs Chromium 105 / Safari 15.4 /
   * WebKitGTK 2.36; `@layer` needs Chromium 99 / Safari 15.4 / WebKitGTK 2.36.
   * Engines below those lines degrade DIFFERENTLY, and both degradations are
   * dangerous by default:
   *   - `@layer` unknown → the parser discards the ENTIRE layer block, so the
   *     body justify silently disappears;
   *   - `:has()` unknown → any rule containing it is dropped AND
   *     querySelectorAll(":is(...):has(...)") throws SyntaxError.
   * getJustifyCss() / the scan therefore take these capabilities into account.
   * `CSSLayerBlockRule` exists exactly when @layer is supported, and
   * CSS.supports("selector(...)") answers :has()/:where() honestly on engines
   * that have CSS.supports at all (Chromium 28+). On engines without
   * CSS.supports (below our practical floor) we optimistically assume support
   * — the guarded scan still protects the runtime if that guess is wrong.
   */
  function detectJustifyCapabilities(doc) {
    const view = doc?.defaultView ?? root;
    let hasLayer = false;
    let hasHas = false;
    let hasWhere = false;
    try {
      hasLayer = typeof view.CSSLayerBlockRule !== "undefined";
    } catch {
      hasLayer = false;
    }
    const supportsSelector = (condition) => {
      try {
        const css = view.CSS;
        if (!css || typeof css.supports !== "function") return true;
        return Boolean(css.supports.call(css, condition));
      } catch {
        return true;
      }
    };
    hasHas = supportsSelector("selector(:has(> br))");
    hasWhere = supportsSelector("selector(:where(p))");
    return { hasLayer, hasHas, hasWhere };
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
   *    scan below pins those blocks inline instead (it never needed :has for
   *    that work).
   */
  function buildJustifyCss(caps) {
    const guard = ":root:not([data-readany-vertical])";
    const scoped = (baseSelector) =>
      caps.hasWhere ? `:where(${guard} ${baseSelector})` : `${guard} ${baseSelector}`;
    const rules = [`${scoped("body")} { text-align: justify; }`];
    // Authored `text-wrap: pretty` (e.g. Standard Ebooks core.css) makes
    // engines that justify with it overshoot inter-word gaps. When justify is
    // on the reader owns line breaking: reset only the style longhand, so an
    // authored nowrap mode survives. Borrowed from readest (#5582).
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

  /**
   * Capability-aware stylesheet for the caller's engine. Without an argument
   * the engine of the surrounding window/global is detected.
   */
  function getJustifyCss(doc) {
    return buildJustifyCss(detectJustifyCapabilities(doc));
  }

  // Inline alignment we pin so author alignment survives our start rule. We
  // mark pinned elements and record their PREVIOUS inline text-align so
  // disabling justify restores exactly what the book had — removing the
  // property outright would also wipe an author's own inline alignment.
  const PIN_ATTR = "data-readany-justify-pinned";
  const ORIGINAL_ATTR = "data-readany-justify-original";

  function isVerticalDoc(doc) {
    if (!doc?.documentElement || !doc?.defaultView) return false;
    const body = doc.body;
    if (!body) return false;
    try {
      const style = doc.defaultView.getComputedStyle(body);
      if (style.writingMode === "vertical-rl" || style.writingMode === "vertical-lr") {
        return true;
      }
      // Some EPUBs set writing-mode on the first child of body instead of body
      // itself — mirror reader.template.html's isVerticalDoc / foliate
      // getDirection.
      const firstChild = body.querySelector(":scope > :not([cfi-inert])");
      if (!firstChild) return false;
      const childStyle = doc.defaultView.getComputedStyle(firstChild);
      return childStyle.writingMode === "vertical-rl" || childStyle.writingMode === "vertical-lr";
    } catch {
      return false;
    }
  }

  /**
   * Collect block-level elements that DIRECTLY contain a <br>.
   *
   * With :has() available this is a single engine-native query. Without it,
   * querySelectorAll(":is(...):has(...)") would THROW SyntaxError, so we fall
   * back to the plain block selector and filter by iterating children — an
   * API that exists on every engine we target. The try/catch additionally
   * covers engines whose :has() works in stylesheets but not in
   * querySelectorAll (or any other engine quirk).
   */
  function collectBrContainers(doc, caps) {
    if (caps.hasHas) {
      try {
        return doc.querySelectorAll(`:is(${BR_CONTAINER_SELECTOR}):has(> br)`);
      } catch {
        // fall through to the manual scan
      }
    }
    const candidates = doc.querySelectorAll(BR_CONTAINER_SELECTOR);
    const matches = [];
    for (const candidate of candidates) {
      const children = candidate.children;
      if (!children) continue;
      for (let i = 0; i < children.length; i++) {
        if (String(children[i].tagName).toUpperCase() === "BR") {
          matches.push(candidate);
          break;
        }
      }
    }
    return matches;
  }

  /**
   * Restore author-aligned, <br>-containing blocks to their computed alignment.
   *
   * When justify is on, `body { text-align: justify }` would stretch every
   * short line inside a block that contains <br> — but only for blocks the
   * author left unaligned. Blocks the author aligned (center/right/end, via
   * class, id, inline style, align attribute or an aligned ancestor) must keep
   * their alignment. CSS cannot see the *computed* alignment, so we read it
   * here and pin it inline. Inline style beats the @layer rule, so the book's
   * alignment wins even though our start rule matches the same element.
   *
   * Runs before the justify CSS is injected: getComputedStyle then reflects the
   * book's own stylesheet, not our injected rules.
   */
  function preserveAlignedBrContainers(doc, caps) {
    if (!doc || !doc.defaultView) return;

    // Clean up leftovers from the previous marker-based implementation so
    // upgrading readers don't carry stale attributes / style tags around.
    for (const el of doc.querySelectorAll(`[${OLD_MARKER}]`)) {
      el.removeAttribute(OLD_MARKER);
    }
    doc.getElementById(OLD_STYLE_ID)?.remove();

    function inheritAlign(el) {
      // First honour explicit align="" attributes on the element or its
      // ancestors — these may not produce a computed text-align in the
      // reader's sandboxed document, so they must be read directly.
      let cur = el;
      while (cur) {
        const al = (cur.getAttribute("align") || "").toLowerCase();
        if (al) {
          if (al === "center") return "center";
          if (al === "right") return "right";
          if (al === "left") return "start";
          if (al === "justify") return "justify";
        }
        cur = cur.parentElement;
      }
      // The element itself may report `start` because our `:has(> br) { text-align:
      // start }` rule directly applies and overrides an inherited center/right —
      // read the nearest ancestor's alignment instead. (In the reader the justify
      // stylesheet is already injected when this runs, so the element's own
      // computed alignment is polluted.)
      cur = el;
      while (cur) {
        const a = String(doc.defaultView.getComputedStyle(cur).textAlign || "").toLowerCase();
        if (a !== "start" && a !== "inherit") return a;
        cur = cur.parentElement;
      }
      return "start";
    }

    const containers = collectBrContainers(doc, caps);
    for (const container of containers) {
      const align = inheritAlign(container);
      const pinnedValue = PRESERVED_ALIGNMENTS.has(align) ? align : "start";
      // Remember the element's own inline text-align (if any) BEFORE we touch
      // it, so disabling justify can put it back verbatim. Only captured on
      // first pin — re-running apply must not mistake our own pinned value for
      // the book's original.
      if (!container.hasAttribute(PIN_ATTR)) {
        container.setAttribute(
          ORIGINAL_ATTR,
          container.style.getPropertyValue("text-align"),
        );
      }
      container.style.setProperty("text-align", pinnedValue);
      container.setAttribute(PIN_ATTR, "");
    }
  }

  // Remove every text-align we pinned previously, restoring each element's
  // original inline text-align exactly (or removing ours when there was none),
  // so the book's own cascade is restored bit-for-bit. Used when justify is
  // disabled or the layout is unsupported.
  function unpinAlignedBrContainers(doc) {
    if (!doc) return;
    for (const el of doc.querySelectorAll(`[${PIN_ATTR}]`)) {
      const original = el.getAttribute(ORIGINAL_ATTR) ?? "";
      if (original) {
        el.style.setProperty("text-align", original);
      } else {
        el.style.removeProperty("text-align");
      }
      el.removeAttribute(ORIGINAL_ATTR);
      el.removeAttribute(PIN_ATTR);
    }
  }

  // Keep the same public API surface so reader.template.html and the desktop
  // viewer can call it uniformly. `apply(doc, enabled, unsupportedLayout)`:
  //   - enabled=false  → unpin anything we pinned, so the book's own cascade
  //     is restored exactly
  //   - unsupportedLayout (vertical / fixed) → same unpin; those documents
  //     must never be justified or pinned
  function apply(doc, enabled, unsupportedLayout) {
    // Tag the document root so the justify CSS can scope itself to horizontal
    // text. The caller (reader.template.html) already passes unsupportedLayout
    // = fixed || isVerticalDoc; when it is undefined (e.g. the desktop viewer
    // calling without it) we fall back to our own O(1) isVerticalDoc — class
    // check + one getComputedStyle on the body.
    const isUnsupported = unsupportedLayout || isVerticalDoc(doc);
    if (doc?.documentElement) {
      if (isUnsupported) {
        doc.documentElement.setAttribute("data-readany-vertical", "");
      } else {
        doc.documentElement.removeAttribute("data-readany-vertical");
      }
    }
    // When disabled or unsupported, undo any alignment we pinned so the book's
    // own cascade is restored exactly. When enabled we do NOT unpin first —
    // re-running apply (e.g. on section load) must be idempotent: unpinning
    // would clear a center pin from a previous run, and re-reading the
    // alignment now (after the justify stylesheet is already injected) could
    // see `start` (from :has(> br)) instead of the book's center, dropping the
    // alignment.
    if (!enabled || isUnsupported) {
      unpinAlignedBrContainers(doc);
      return;
    }
    preserveAlignedBrContainers(doc, detectJustifyCapabilities(doc));
  }

  root.ReadAnyJustifiedText = {
    apply,
    preserveAlignedBrContainers,
    detectJustifyCapabilities,
    buildJustifyCss,
    getJustifyCss,
    JUSTIFY_CSS,
  };
})(globalThis);
