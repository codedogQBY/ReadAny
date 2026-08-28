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

  // Inline alignment we pin so author alignment survives our start rule. We
  // mark pinned elements so disabling justify can remove exactly what we added.
  const PIN_ATTR = "data-readany-justify-pinned";

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
  function preserveAlignedBrContainers(doc) {
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
        const a = String(
          doc.defaultView.getComputedStyle(cur).textAlign || "",
        ).toLowerCase();
        if (a !== "start" && a !== "inherit") return a;
        cur = cur.parentElement;
      }
      return "start";
    }

    for (const container of doc.querySelectorAll(
      `:is(${BR_CONTAINER_SELECTOR}):has(> br)`,
    )) {
      const align = inheritAlign(container);
      if (PRESERVED_ALIGNMENTS.has(align)) {
        container.style.textAlign = align;
        container.setAttribute(PIN_ATTR, "");
      } else {
        // Unaligned br-bearing block (poetry/lyrics): force start so short
        // lines are not stretched by the body justify.
        container.style.textAlign = "start";
      }
    }
  }

  // Remove every text-align we pinned previously, restoring the book's own
  // cascade exactly. Used when justify is disabled or the layout is
  // unsupported, so toggling off is a clean, complete undo.
  function unpinAlignedBrContainers(doc) {
    if (!doc) return;
    for (const el of doc.querySelectorAll(`[${PIN_ATTR}]`)) {
      el.style.removeProperty("text-align");
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
    // Tag the document root so the @layer justify CSS can scope itself to
    // horizontal text. The caller (reader.template.html) already passes
    // unsupportedLayout = fixed || isVerticalDoc; when it is undefined (e.g.
    // the desktop viewer calling without it) we fall back to our own O(1)
    // isVerticalDoc — class check + one getComputedStyle on the body.
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
    preserveAlignedBrContainers(doc);
  }

  root.ReadAnyJustifiedText = { apply, preserveAlignedBrContainers, JUSTIFY_CSS };
})(globalThis);