const parseViewport = (str) =>
  str
    ?.split(/[,;\s]/) // NOTE: technically, only the comma is valid
    ?.filter((x) => x)
    ?.map((x) => x.split("=").map((x) => x.trim()));

const getViewport = (doc, viewport) => {
  // use `viewBox` for SVG
  if (doc.documentElement.localName === "svg") {
    const [, , width, height] = doc.documentElement.getAttribute("viewBox")?.split(/\s/) ?? [];
    return { width, height };
  }

  // get `viewport` `meta` element
  const meta = parseViewport(doc.querySelector('meta[name="viewport"]')?.getAttribute("content"));
  if (meta) return Object.fromEntries(meta);

  // fallback to book's viewport
  if (typeof viewport === "string") return parseViewport(viewport);
  if (viewport?.width && viewport.height) return viewport;

  // if no viewport (possibly with image directly in spine), get image size
  const img = doc.querySelector("img");
  if (img) return { width: img.naturalWidth, height: img.naturalHeight };

  // SVG pages carry their canvas size in the viewBox (e.g. SVG-based covers
  // whose width/height attributes are just "100%")
  const svg = doc.querySelector("svg");
  if (svg) {
    const viewBox = svg.getAttribute("viewBox")?.split(/[\s,]+/);
    const width = Number.parseFloat(viewBox?.[2]);
    const height = Number.parseFloat(viewBox?.[3]);
    if (width > 0 && height > 0) return { width, height };
  }

  // just show *something*, i guess...
  console.warn(new Error("Missing viewport properties"));
  return { width: 1000, height: 2000 };
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Which scroll-mode pages to start loading / evict, given the current page and
 * each page's load state. Visible idle pages nearest the reader load first,
 * bounded by concurrency; loaded pages farthest away are evicted once past the
 * in-memory cap, but a visible page is never torn out from under the reader.
 * This keeps a fast fling from kicking off a full-resolution canvas render for
 * every page it flies past, which thrashes the main thread and spikes memory.
 */
const planScrollModePages = ({ pages, currentIndex, maxLoaded, maxConcurrent, loadingCount }) => {
  const dist = (page) => Math.abs(page.index - currentIndex);

  const budget = Math.max(0, maxConcurrent - loadingCount);
  const load =
    budget === 0
      ? []
      : pages
          .filter((page) => page.visible && page.state === "idle")
          .sort((a, b) => dist(a) - dist(b))
          .slice(0, budget)
          .map((page) => page.index);

  const loaded = pages.filter((page) => page.state === "loaded");
  const evict =
    loaded.length <= maxLoaded
      ? []
      : loaded
          .filter((page) => !page.visible)
          .sort((a, b) => dist(b) - dist(a))
          .slice(0, loaded.length - maxLoaded)
          .map((page) => page.index);

  return { load, evict };
};

/**
 * Anchor (page index + intra-page fraction) for the scroll position. Used to
 * keep the reader's place across re-renders (resize, zoom, mode switch) that
 * would otherwise jump.
 */
const captureScrollModeAnchor = (pages, scrollPos, fallbackIndex = -1) => {
  const fallbackPage = pages.find((page) => page.index === fallbackIndex);
  const currentPage =
    pages.find(
      (page) => page.size > 0 && scrollPos >= page.start && scrollPos < page.start + page.size,
    ) ??
    fallbackPage ??
    pages.find((page) => page.size > 0);

  if (!currentPage) return null;
  return {
    index: currentPage.index,
    fraction:
      currentPage.size > 0 ? clamp((scrollPos - currentPage.start) / currentPage.size, 0, 1) : 0,
    scrollPos,
  };
};

const restoreScrollModeAnchor = (pages, anchor, maxScrollPos) => {
  if (!anchor) return 0;
  const page = pages.find((candidate) => candidate.index === anchor.index);
  if (!page || page.size <= 0) return clamp(anchor.scrollPos, 0, maxScrollPos);
  return clamp(page.start + page.size * anchor.fraction, 0, maxScrollPos);
};

/**
 * Paginated page offsets to apply to the host (`overflow: auto`) after a page
 * turn. Horizontal is re-centered so the page sits in the middle of the
 * viewport. Vertical is reset to the top ONLY on a page turn: a tall
 * fit-width page overflows the host vertically, so without the reset the newly
 * shown page inherits the previous page's offset — which made PgUp land at the
 * previous page's BOTTOM instead of its top. Plain re-renders (resize, zoom,
 * theme) keep the reader's current vertical position.
 */
const computePaginatedScroll = ({ elementWidth, containerWidth, scrollTop, pageTurn }) => ({
  scrollLeft: (elementWidth - containerWidth) / 2,
  scrollTop: pageTurn ? 0 : scrollTop,
});

export class FixedLayout extends HTMLElement {
  static observedAttributes = ["zoom", "zoom-factor", "spread", "flow", "scroll-gap"];
  #root = this.attachShadow({ mode: "open" });
  #observer = new ResizeObserver(() => this.#render());
  #spreads;
  #index = -1;
  defaultViewport;
  spread;
  #portrait = false;
  #left;
  #right;
  #center;
  #side;
  #zoom;
  #zoomFactor = 1;
  #overlayers = new Map();
  // Pre-rendered spreads, keyed `spread-<index>`. Kept across page turns so the
  // incoming iframes are already loaded and laid out when they are shown. This
  // is what removes the white flash on every page turn: the old implementation
  // destroyed the live frames with replaceChildren() and rebuilt them from
  // scratch, so each turn showed an empty host for one paint.
  #prerenderedSpreads = new Map();
  #preloadCache = new Map();
  #spreadAccessTime = new Map();
  #maxCachedSpreads = 3;
  // Page-turn generation counter. goToSpread() bumps it on entry; every async
  // step that follows compares its captured value and bails out when a newer
  // turn has started. Without it, a slow page (scanned PDFs decode a full-page
  // image per section) could finish *after* the user turned the page: its frame
  // was appended to #root and registered in #prerenderedSpreads too late to be
  // covered by the "hide every frame that is not the current spread" sweep, so
  // it stayed visible forever — the reported "left half is always the cover".
  #showGen = 0;
  // Scroll mode state
  #scrollMode = false;
  #scrollPages = [];
  #scrollObserver = null;
  #scrollContainer = null;
  #scrollLoadGen = new Map();
  #scrollMaxLoaded = 12;
  #scrollMaxConcurrent = 3;
  #scrollLoadingCount = 0;
  #scrollIdleTimer = null;
  #scrollCurrentIndex = -1;
  #scrolling = false;
  constructor() {
    super();

    const sheet = new CSSStyleSheet();
    this.#root.adoptedStyleSheets = [sheet];
    sheet.replaceSync(`:host {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: safe center;
            align-items: safe center;
            overflow: auto;
        }
        :host([flow="scrolled"]) {
            display: block;
            overflow-y: auto;
            overflow-x: hidden;
        }
        :host([flow="scrolled"]) .scroll-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100%;
            width: 100%;
            box-sizing: border-box;
        }
        :host([flow="scrolled"]) .scroll-page {
            position: relative;
            flex-shrink: 0;
            overflow: hidden;
            margin: var(--scroll-page-gap, 8px) 0;
        }
        :host([flow="scrolled"]) .scroll-page iframe {
            pointer-events: none;
        }`);

    this.#observer.observe(this);
  }
  attributeChangedCallback(name, _, value) {
    switch (name) {
      case "zoom":
        this.#zoom =
          value !== "fit-width" && value !== "fit-page" ? Number.parseFloat(value) : value;
        this.#render();
        break;
      case "zoom-factor": {
        const parsed = Number.parseFloat(value);
        this.#zoomFactor = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
        this.#render();
        break;
      }
      case "spread":
        this.spread = value;
        void this.#applySpreadChange(value);
        break;
      case "flow":
        if (value === "scrolled" && !this.#scrollMode) {
          // Capture the index from paginated mode BEFORE flipping the flag.
          const savedIndex = this.index;
          this.#showGen++; // 作废在途的那次翻页，别让它往滚动 DOM 里画帧
          this.#scrollMode = true;
          if (this.book) this.#initScrollMode(savedIndex);
        } else if (value !== "scrolled" && this.#scrollMode) {
          this.#destroyScrollMode();
          this.#scrollMode = false;
          this.#render();
        }
        break;
      case "scroll-gap": {
        const n = Number.parseFloat(value);
        if (Number.isFinite(n) && n >= 0) this.style.setProperty("--scroll-page-gap", `${n}px`);
        else this.style.removeProperty("--scroll-page-gap");
        break;
      }
    }
  }
  #buildSpreads(book) {
    const { rendition } = book;
    const rtl = book.dir === "rtl";
    const ltr = !rtl;
    if (rendition?.spread === "none") return book.sections.map((section) => ({ center: section }));

    return book.sections.reduce(
      (arr, section, i) => {
        const last = arr[arr.length - 1];
        const { pageSpread } = section;
        const newSpread = () => {
          const spread = {};
          arr.push(spread);
          return spread;
        };
        if (pageSpread === "center") {
          const spread = last.left || last.right ? newSpread() : last;
          spread.center = section;
        } else if (pageSpread === "left") {
          const spread = last.center || last.left || (ltr && i) ? newSpread() : last;
          spread.left = section;
        } else if (pageSpread === "right") {
          const spread = last.center || last.right || (rtl && i) ? newSpread() : last;
          spread.right = section;
        } else if (ltr) {
          if (last.center || last.right) newSpread().left = section;
          else if (last.left || !i) last.right = section;
          else last.left = section;
        } else {
          if (last.center || last.left) newSpread().right = section;
          else if (last.right || !i) last.left = section;
          else last.right = section;
        }
        return arr;
      },
      [{}],
    );
  }
  async #applySpreadChange(value) {
    if (!this.book?.sections?.length) return;
    if (this.book.rendition) this.book.rendition.spread = value;
    if (this.#scrollMode) return;

    const currentSection = this.book.sections[this.index] ?? this.book.sections[0];
    this.#spreads = this.#buildSpreads(this.book);
    const target = currentSection ? this.getSpreadOf(currentSection) : null;
    this.#index = -1;
    this.#clearPrerendered();
    await this.goToSpread(
      target?.index ?? 0,
      target?.side ?? (this.rtl ? "right" : "left"),
      "layout",
    );
  }
  #applyOverlayerViewBox(frame, overlayer) {
    if (!overlayer?.element) return;
    const el = overlayer.element;
    if (frame?.onZoom) {
      el.removeAttribute("viewBox");
      el.removeAttribute("preserveAspectRatio");
    } else {
      const w = frame?.width;
      const h = frame?.height;
      if (w && h) {
        el.setAttribute("viewBox", `0 0 ${w} ${h}`);
        el.setAttribute("preserveAspectRatio", "none");
      }
    }
  }
  async #createFrame({ index, src: srcOption }) {
    const srcOptionIsString = typeof srcOption === "string";
    const src = srcOptionIsString ? srcOption : srcOption?.src;
    const data = srcOptionIsString ? null : srcOption?.data;
    const onZoom = srcOptionIsString ? null : srcOption?.onZoom;
    const element = document.createElement("div");
    element.setAttribute("dir", "ltr");
    element.style.position = "relative";
    const iframe = document.createElement("iframe");
    element.append(iframe);
    Object.assign(iframe.style, {
      border: "0",
      display: "none",
      overflow: "hidden",
    });
    // `allow-scripts` is needed for events because of WebKit bug
    // https://bugs.webkit.org/show_bug.cgi?id=218086
    iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("part", "filter");
    this.#root.append(element);
    if (!src) return { blank: true, element, iframe };
    return new Promise((resolve) => {
      iframe.addEventListener(
        "load",
        () => {
          const doc = iframe.contentDocument;
          iframe.dataset.sectionIndex = index;
          this.dispatchEvent(new CustomEvent("load", { detail: { doc, index } }));
          const { width, height } = getViewport(doc, this.defaultViewport);
          resolve({
            element,
            iframe,
            width: Number.parseFloat(width),
            height: Number.parseFloat(height),
            onZoom,
          });
        },
        { once: true },
      );
      if (data) iframe.srcdoc = data;
      else iframe.src = src;
    });
  }
  #render(side = this.#side, pageTurn = false) {
    if (this.#scrollMode) {
      this.#renderScrollMode();
      return [];
    }
    if (!side) return [];
    const left = this.#left ?? {};
    const right = this.#center ?? this.#right ?? {};
    const target = side === "left" ? left : right;
    const { width, height } = this.getBoundingClientRect();
    const portrait = this.spread !== "both" && this.spread !== "portrait" && height > width;
    this.#portrait = portrait;
    const blankWidth = left.width ?? right.width ?? 0;
    const blankHeight = left.height ?? right.height ?? 0;

    const fitScale =
      typeof this.#zoom === "number" && !Number.isNaN(this.#zoom)
        ? this.#zoom
        : (this.#zoom === "fit-width"
            ? portrait || this.#center
              ? width / (target.width ?? blankWidth)
              : width / ((left.width ?? blankWidth) + (right.width ?? blankWidth))
            : portrait || this.#center
              ? Math.min(
                  width / (target.width ?? blankWidth),
                  height / (target.height ?? blankHeight),
                )
              : Math.min(
                  width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)),
                  height / Math.max(left.height ?? blankHeight, right.height ?? blankHeight),
                )) || 1;
    const scale =
      typeof this.#zoom === "number" && !Number.isNaN(this.#zoom)
        ? fitScale
        : fitScale * this.#zoomFactor;

    const renderPromises = [];
    const transform = (frame) => {
      const { element, iframe, width, height, blank, onZoom } = frame;
      if (!iframe) return;
      if (onZoom) {
        const p = onZoom({ doc: iframe.contentDocument, scale });
        if (p?.then) renderPromises.push(p);
      }
      const iframeScale = onZoom ? scale : 1;
      Object.assign(iframe.style, {
        width: `${width * iframeScale}px`,
        height: `${height * iframeScale}px`,
        transform: onZoom ? "none" : `scale(${scale})`,
        transformOrigin: "top left",
        display: blank ? "none" : "block",
      });
      Object.assign(element.style, {
        width: `${(width ?? blankWidth) * scale}px`,
        height: `${(height ?? blankHeight) * scale}px`,
        overflow: "hidden",
        display: "block",
        flexShrink: "0",
        marginBlock: "auto",
      });
      if (portrait && frame !== target) {
        element.style.display = "none";
      }
    };
    if (this.#center) {
      transform(this.#center);
    } else {
      transform(left);
      transform(right);
    }

    // Keep the reader's vertical position within a page across plain
    // re-renders, but reset to the top on a page turn (see
    // computePaginatedScroll). Horizontal is re-centered so the (possibly
    // zoomed) page sits in the middle of the viewport.
    const elementWidth = (this.#center ?? target)?.element?.getBoundingClientRect().width ?? 0;
    const { scrollLeft, scrollTop } = computePaginatedScroll({
      elementWidth,
      containerWidth: this.clientWidth,
      scrollTop: this.scrollTop,
      pageTurn,
    });
    this.scrollTop = scrollTop;
    if (Math.abs(scrollLeft - this.scrollLeft) > 0.5) this.scrollLeft = scrollLeft;

    return renderPromises;
  }
  async #showSpread({ left, right, center, side, spreadIndex, gen }) {
    // 代次守卫（见 #showGen 注释）：若期间用户又翻了一页，这次就作废 —
    // 不动 #left/#right/#center，也不做显示清扫，避免旧帧被点亮后无人回收。
    const isStale = () => gen !== undefined && gen !== this.#showGen;
    if (isStale()) return;

    this.#left = null;
    this.#right = null;
    this.#center = null;

    const cacheKey = spreadIndex !== undefined ? `spread-${spreadIndex}` : null;
    const prerendered = cacheKey ? this.#prerenderedSpreads.get(cacheKey) : null;

    if (prerendered) {
      // Reuse the already-loaded frames: no reload, no blank paint.
      this.#spreadAccessTime.set(cacheKey, Date.now());
      if (prerendered.center) {
        this.#center = prerendered.center;
      } else {
        this.#left = prerendered.left;
        this.#right = prerendered.right;
      }
      // The frames are still children of #root from the preload; re-attach if
      // they were detached (defensive — normally they are not).
      if (this.#center?.element && !this.#center.element.isConnected) {
        this.#root.append(this.#center.element);
      }
      if (this.#left?.element && !this.#left.element.isConnected) {
        this.#root.append(this.#left.element);
      }
      if (this.#right?.element && !this.#right.element.isConnected) {
        this.#root.append(this.#right.element);
      }
    } else if (center) {
      const frame = await this.#createFrame(center);
      if (isStale()) {
        // 过期帧：元素已经 append 进 #root，必须自己清掉，否则它会永远停在
        // 左侧（DOM 顺序在其它帧之前）—— 就是「左半页固定是封面」那个现象。
        frame.element?.remove();
        return;
      }
      this.#center = frame;
      if (cacheKey) {
        this.#prerenderedSpreads.set(cacheKey, { center: this.#center });
        this.#spreadAccessTime.set(cacheKey, Date.now());
      }
    } else {
      const leftFrame = await this.#createFrame(left);
      const rightFrame = await this.#createFrame(right);
      if (isStale()) {
        leftFrame.element?.remove();
        rightFrame.element?.remove();
        return;
      }
      this.#left = leftFrame;
      this.#right = rightFrame;
      if (cacheKey) {
        this.#prerenderedSpreads.set(cacheKey, { left: this.#left, right: this.#right });
        this.#spreadAccessTime.set(cacheKey, Date.now());
      }
    }

    this.#side = center
      ? "center"
      : this.#left?.blank
        ? "right"
        : this.#right?.blank
          ? "left"
          : side;

    // Hide every other spread's frames rather than destroying them, so a page
    // turn back to a neighbour is instant (the frames stay loaded and laid
    // out). This is the second half of the flicker fix.
    const visibleElements = center
      ? [this.#center?.element]
      : [this.#left?.element, this.#right?.element];
    for (const spread of this.#prerenderedSpreads.values()) {
      for (const frame of [spread.center, spread.left, spread.right]) {
        if (!frame?.element) continue;
        const isVisible = visibleElements.includes(frame.element);
        Object.assign(frame.element.style, {
          position: isVisible ? "relative" : "absolute",
          visibility: isVisible ? "visible" : "hidden",
          pointerEvents: isVisible ? "auto" : "none",
        });
      }
    }

    const renderPromises = this.#render(this.#side, true);
    if (renderPromises.length) await Promise.all(renderPromises);

    const showingFrames = center ? [this.#center] : [this.#left, this.#right];
    for (const frame of showingFrames) {
      if (!frame?.iframe) continue;
      const index =
        frame.iframe.dataset.sectionIndex != null
          ? Number.parseInt(frame.iframe.dataset.sectionIndex)
          : undefined;
      if (index != null && !this.#overlayers.has(index)) {
        const doc = frame.iframe.contentDocument;
        if (doc) {
          this.dispatchEvent(
            new CustomEvent("create-overlayer", {
              detail: {
                doc,
                index,
                attach: (overlayer) => {
                  this.#overlayers.set(index, overlayer);
                  frame.element.append(overlayer.element);
                  this.#applyOverlayerViewBox(frame, overlayer);
                },
              },
            }),
          );
        }
      }
    }

    this.#evictPrerendered();
    this.#preloadNeighbourSpreads();
  }
  #evictPrerendered() {
    if (this.#prerenderedSpreads.size <= this.#maxCachedSpreads) return;
    const byAge = Array.from(this.#prerenderedSpreads.keys()).sort(
      (a, b) => (this.#spreadAccessTime.get(a) ?? 0) - (this.#spreadAccessTime.get(b) ?? 0),
    );
    const remove = byAge.slice(0, this.#prerenderedSpreads.size - this.#maxCachedSpreads);
    for (const key of remove) {
      const frames = this.#prerenderedSpreads.get(key);
      if (!frames) continue;
      for (const frame of [frames.center, frames.left, frames.right]) {
        frame?.element?.remove();
      }
      this.#prerenderedSpreads.delete(key);
      this.#spreadAccessTime.delete(key);
      this.#preloadCache.delete(key);
    }
  }
  #clearPrerendered() {
    this.#showGen++; // 帧要全部销毁，在途的那次翻页作废
    for (const frames of this.#prerenderedSpreads.values()) {
      for (const frame of [frames.center, frames.left, frames.right]) {
        frame?.element?.remove();
      }
    }
    this.#prerenderedSpreads.clear();
    this.#preloadCache.clear();
    this.#spreadAccessTime.clear();
    this.#overlayers.clear();
  }
  /**
   * Warm the neighbouring spreads in the background so a page turn reuses a
   * loaded frame instead of round-tripping the page through `section.load()`.
   * One ahead and one behind is enough to cover normal reading; anything
   * further is evicted by the LRU cap.
   */
  #preloadNeighbourSpreads() {
    if (!this.book || this.#scrollMode) return;
    for (const target of [this.#index + 1, this.#index - 1]) {
      if (target < 0 || target >= this.#spreads.length) continue;
      const cacheKey = `spread-${target}`;
      if (this.#prerenderedSpreads.has(cacheKey) || this.#preloadCache.has(cacheKey)) continue;
      const spread = this.#spreads[target];
      if (!spread) continue;
      this.#preloadCache.set(cacheKey, "loading");
      void (async () => {
        try {
          if (spread.center) {
            const index = this.book.sections.indexOf(spread.center);
            const src = await spread.center?.load?.();
            if (this.#scrollMode) return;
            const frame = await this.#createFrame({ index, src });
            if (this.#scrollMode) {
              frame.element?.remove();
              return;
            }
            const existing = this.#prerenderedSpreads.get(cacheKey);
            if (existing) {
              frame.element.remove();
              return;
            }
            Object.assign(frame.element.style, {
              position: "absolute",
              visibility: "hidden",
              pointerEvents: "none",
            });
            this.#prerenderedSpreads.set(cacheKey, { center: frame });
            this.#spreadAccessTime.set(cacheKey, Date.now());
          } else {
            const indexL = this.book.sections.indexOf(spread.left);
            const indexR = this.book.sections.indexOf(spread.right);
            const srcL = await spread.left?.load?.();
            const srcR = await spread.right?.load?.();
            if (this.#scrollMode) return;
            const leftFrame = await this.#createFrame({ index: indexL, src: srcL });
            const rightFrame = await this.#createFrame({ index: indexR, src: srcR });
            if (this.#scrollMode) {
              leftFrame.element?.remove();
              rightFrame.element?.remove();
              return;
            }
            const existing = this.#prerenderedSpreads.get(cacheKey);
            if (existing) {
              leftFrame.element.remove();
              rightFrame.element.remove();
              return;
            }
            for (const frame of [leftFrame, rightFrame]) {
              Object.assign(frame.element.style, {
                position: "absolute",
                visibility: "hidden",
                pointerEvents: "none",
              });
            }
            this.#prerenderedSpreads.set(cacheKey, { left: leftFrame, right: rightFrame });
            this.#spreadAccessTime.set(cacheKey, Date.now());
          }
          this.#evictPrerendered();
        } catch (e) {
          console.warn("[FixedLayout] Failed to preload spread", target, e);
        } finally {
          this.#preloadCache.delete(cacheKey);
        }
      })();
    }
  }
  // ---- Scroll mode ----
  #initScrollMode(targetIndex = 0) {
    for (const child of Array.from(this.#root.children)) {
      child.style.display = "none";
    }

    this.#scrollContainer = document.createElement("div");
    this.#scrollContainer.className = "scroll-container";
    this.#root.append(this.#scrollContainer);

    const sections = this.book.sections;
    const viewport = this.defaultViewport;
    const vw = viewport?.width ?? 1000;
    const vh = viewport?.height ?? 1400;
    this.#scrollPages = sections.map((section, i) => {
      const el = document.createElement("div");
      el.className = "scroll-page";
      el.dataset.index = String(i);
      this.#scrollContainer.append(el);
      return {
        el,
        index: i,
        section,
        state: "idle",
        visible: false,
        frame: null,
        vpWidth: vw,
        vpHeight: vh,
      };
    });

    this.#renderScrollMode();

    if (targetIndex >= 0 && targetIndex < this.#scrollPages.length) {
      this.#scrollPages[targetIndex].el.scrollIntoView();
      this.#scrollCurrentIndex = targetIndex;
    }

    this.addEventListener("scroll", this.#handleScrollEvent);

    this.#scrollObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number.parseInt(entry.target.dataset.index);
          const pageData = this.#scrollPages[index];
          if (pageData) pageData.visible = entry.isIntersecting;
        }
        this.#scheduleScrollPages();
      },
      { root: this, rootMargin: "200% 0px" },
    );
    for (const page of this.#scrollPages) this.#scrollObserver.observe(page.el);
  }
  #scheduleScrollPages() {
    const currentIndex = this.#getScrollIndex();
    const { load, evict } = planScrollModePages({
      pages: this.#scrollPages,
      currentIndex,
      maxLoaded: this.#scrollMaxLoaded,
      maxConcurrent: this.#scrollMaxConcurrent,
      loadingCount: this.#scrollLoadingCount,
    });
    for (const index of evict) this.#teardownScrollPage(this.#scrollPages[index]);
    for (const index of load) void this.#loadScrollPage(this.#scrollPages[index]);
  }
  #handleScrollEvent = () => {
    this.#scrolling = true;
    this.#setScrollIframeInteraction(false);
    if (this.#scrollIdleTimer) clearTimeout(this.#scrollIdleTimer);
    this.#scrollIdleTimer = setTimeout(() => {
      this.#scrolling = false;
      this.#setScrollIframeInteraction(true);
      this.#reportScrollLocation();
    }, 150);
  };
  #setScrollIframeInteraction(enabled) {
    const value = enabled ? "auto" : "";
    for (const page of this.#scrollPages) {
      if (page.frame?.iframe) page.frame.iframe.style.pointerEvents = value;
    }
  }
  #destroyScrollMode() {
    const currentIndex =
      this.#scrollCurrentIndex >= 0 ? this.#scrollCurrentIndex : this.#getScrollIndex();
    this.removeEventListener("scroll", this.#handleScrollEvent);
    if (this.#scrollObserver) {
      this.#scrollObserver.disconnect();
      this.#scrollObserver = null;
    }
    if (this.#scrollIdleTimer) {
      clearTimeout(this.#scrollIdleTimer);
      this.#scrollIdleTimer = null;
    }
    for (const page of this.#scrollPages) this.#teardownScrollPage(page);
    this.#scrollPages = [];
    this.#scrollLoadGen.clear();
    this.#scrollLoadingCount = 0;
    this.#scrollCurrentIndex = -1;
    if (this.#scrollContainer) {
      this.#scrollContainer.remove();
      this.#scrollContainer = null;
    }
    this.scrollTop = 0;
    this.scrollLeft = 0;

    for (const child of Array.from(this.#root.children)) child.style.display = "";

    if (currentIndex >= 0) {
      const section = this.book.sections[currentIndex];
      if (section) {
        const spread = this.getSpreadOf(section);
        if (spread) {
          this.#index = -1;
          void this.goToSpread(spread.index, spread.side, "page");
        }
      }
    }
  }
  async #createScrollFrame(pageData, srcOption) {
    const srcOptionIsString = typeof srcOption === "string";
    const src = srcOptionIsString ? srcOption : srcOption?.src;
    const data = srcOptionIsString ? null : srcOption?.data;
    const onZoom = srcOptionIsString ? null : srcOption?.onZoom;

    const element = document.createElement("div");
    element.setAttribute("dir", "ltr");
    element.style.position = "relative";
    const iframe = document.createElement("iframe");
    element.append(iframe);
    Object.assign(iframe.style, { border: "0", display: "none", overflow: "hidden" });
    iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("part", "filter");
    pageData.el.append(element);

    if (!src) return { blank: true, element, iframe };
    return new Promise((resolve) => {
      iframe.addEventListener(
        "load",
        () => {
          const doc = iframe.contentDocument;
          iframe.dataset.sectionIndex = pageData.index;
          this.dispatchEvent(new CustomEvent("load", { detail: { doc, index: pageData.index } }));
          const { width, height } = getViewport(doc, this.defaultViewport);
          resolve({
            element,
            iframe,
            width: Number.parseFloat(width),
            height: Number.parseFloat(height),
            onZoom,
          });
        },
        { once: true },
      );
      if (data) iframe.srcdoc = data;
      else iframe.src = src;
    });
  }
  async #loadScrollPage(pageData) {
    if (pageData.state !== "idle") return;
    pageData.state = "loading";
    this.#scrollLoadingCount++;

    const gen = (this.#scrollLoadGen.get(pageData.index) || 0) + 1;
    this.#scrollLoadGen.set(pageData.index, gen);

    try {
      const src = await pageData.section.load?.();
      if (this.#scrollLoadGen.get(pageData.index) !== gen || !this.#scrollMode) {
        pageData.state = "idle";
        return;
      }
      if (!src) {
        pageData.state = "error";
        return;
      }

      const frame = await this.#createScrollFrame(pageData, src);
      if (this.#scrollLoadGen.get(pageData.index) !== gen || !this.#scrollMode) {
        frame.element?.remove();
        pageData.state = "idle";
        return;
      }

      pageData.frame = frame;
      pageData.state = "loaded";
      const scrollAnchor = this.#captureScrollModeAnchor();
      if (frame.width && frame.height) {
        pageData.vpWidth = frame.width;
        pageData.vpHeight = frame.height;
      }
      this.#renderScrollPage(pageData);
      this.#restoreScrollModeAnchor(scrollAnchor);

      if (!this.#scrolling && frame.iframe) frame.iframe.style.pointerEvents = "auto";

      const doc = frame.iframe.contentDocument;
      if (doc) {
        this.dispatchEvent(
          new CustomEvent("create-overlayer", {
            detail: {
              doc,
              index: pageData.index,
              attach: (overlayer) => {
                this.#overlayers.set(pageData.index, overlayer);
                frame.element.append(overlayer.element);
                this.#applyOverlayerViewBox(frame, overlayer);
              },
            },
          }),
        );
      }
    } catch (e) {
      console.warn("[FixedLayout] Failed to load scroll page", pageData.index, e);
      pageData.state = "error";
    } finally {
      this.#scrollLoadingCount = Math.max(0, this.#scrollLoadingCount - 1);
      if (this.#scrollMode) this.#scheduleScrollPages();
    }
  }
  #teardownScrollPage(pageData) {
    const gen = (this.#scrollLoadGen.get(pageData.index) || 0) + 1;
    this.#scrollLoadGen.set(pageData.index, gen);
    if (pageData.frame) {
      this.#overlayers.delete(pageData.index);
      pageData.frame.element?.remove();
    }
    pageData.frame = null;
    pageData.state = "idle";
  }
  #renderScrollMode() {
    const hostWidth = this.getBoundingClientRect().width;
    if (!hostWidth) return;
    const scrollAnchor = this.#captureScrollModeAnchor();
    for (const page of this.#scrollPages) {
      const scale = (hostWidth / page.vpWidth) * this.#zoomFactor;
      page.el.style.width = `${page.vpWidth * scale}px`;
      page.el.style.height = `${page.vpHeight * scale}px`;
      const pageData = page;
      if (page.state === "loaded" && page.frame) {
        this.#renderScrollPage(pageData);
      }
    }
    this.#restoreScrollModeAnchor(scrollAnchor);
  }
  #renderScrollPage(pageData) {
    const hostWidth = this.getBoundingClientRect().width;
    if (!hostWidth || !pageData.frame) return;
    const { vpWidth: vw, vpHeight: vh, frame } = pageData;
    const scale = (hostWidth / vw) * this.#zoomFactor;

    if (frame.onZoom) {
      const p = frame.onZoom({ doc: frame.iframe.contentDocument, scale });
      if (p?.then) p.then(() => this.#refreshOverlayerForFrame(frame));
      Object.assign(frame.iframe.style, {
        width: `${vw * scale}px`,
        height: `${vh * scale}px`,
        transform: "none",
        display: "block",
      });
    } else {
      Object.assign(frame.iframe.style, {
        width: `${vw}px`,
        height: `${vh}px`,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        display: "block",
      });
    }
    Object.assign(frame.element.style, { width: `${vw * scale}px`, height: `${vh * scale}px` });
    pageData.el.style.width = `${vw * scale}px`;
    pageData.el.style.height = `${vh * scale}px`;

    const overlayer = this.#overlayers.get(pageData.index);
    if (overlayer) {
      Object.assign(overlayer.element.style, {
        position: "absolute",
        top: "0",
        left: "0",
        width: `${vw * scale}px`,
        height: `${vh * scale}px`,
      });
      this.#applyOverlayerViewBox(frame, overlayer);
      overlayer.redraw?.();
    }
  }
  #refreshOverlayerForFrame(frame) {
    const index =
      frame?.iframe?.dataset?.sectionIndex != null
        ? Number.parseInt(frame.iframe.dataset.sectionIndex)
        : undefined;
    if (index == null) return;
    const overlayer = this.#overlayers.get(index);
    if (overlayer) this.#applyOverlayerViewBox(frame, overlayer);
  }
  #getScrollIndex() {
    if (!this.#scrollPages.length) return -1;
    const hostRect = this.getBoundingClientRect();
    const mid = hostRect.top + hostRect.height / 2;
    for (const page of this.#scrollPages) {
      const rect = page.el.getBoundingClientRect();
      if (rect.top <= mid && rect.bottom >= mid) return page.index;
    }
    let closest = 0;
    let minDist = Number.POSITIVE_INFINITY;
    for (const page of this.#scrollPages) {
      const rect = page.el.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const dist = Math.abs(center - mid);
      if (dist < minDist) {
        minDist = dist;
        closest = page.index;
      }
    }
    return closest;
  }
  #reportScrollLocation() {
    const index = this.#getScrollIndex();
    if (index < 0) return;
    this.#scrollCurrentIndex = index;
    this.dispatchEvent(
      new CustomEvent("relocate", {
        detail: { reason: "scroll", range: null, index, fraction: 0, size: 1 },
      }),
    );
  }
  #getScrollModePageMetrics() {
    return this.#scrollPages.map((page) => ({
      index: page.index,
      start: page.el.offsetTop,
      size: page.el.offsetHeight,
    }));
  }
  #captureScrollModeAnchor() {
    if (!this.#scrollPages.length) return null;
    const fallbackIndex =
      this.#scrollCurrentIndex >= 0 ? this.#scrollCurrentIndex : this.#getScrollIndex();
    return captureScrollModeAnchor(this.#getScrollModePageMetrics(), this.scrollTop, fallbackIndex);
  }
  #restoreScrollModeAnchor(anchor) {
    if (!anchor || !this.#scrollPages.length) return;
    const maxScrollPos = Math.max(0, this.scrollHeight - this.clientHeight);
    const restored = restoreScrollModeAnchor(
      this.#getScrollModePageMetrics(),
      anchor,
      maxScrollPos,
    );
    // Only write when the position actually moves: an unconditional assignment
    // aborts an in-progress smooth scroll (a next()/prev() page turn).
    if (Math.abs(restored - this.scrollTop) > 0.5) this.scrollTop = restored;
    this.#scrollCurrentIndex = anchor.index;
  }
  #goLeft() {
    if (this.#center || this.#left?.blank) return;
    if (this.#portrait && this.#left?.element?.style?.display === "none") {
      this.#side = "left";
      this.#render(this.#side, true);
      this.#reportLocation("page");
      return true;
    }
  }
  #goRight() {
    if (this.#center || this.#right?.blank) return;
    if (this.#portrait && this.#right?.element?.style?.display === "none") {
      this.#side = "right";
      this.#render(this.#side, true);
      this.#reportLocation("page");
      return true;
    }
  }
  open(book) {
    this.book = book;
    const { rendition } = book;
    this.spread = rendition?.spread;
    this.defaultViewport = rendition?.viewport;

    const rtl = book.dir === "rtl";
    this.rtl = rtl;

    this.#spreads = this.#buildSpreads(book);
    if (this.#scrollMode) this.#initScrollMode();
  }
  get index() {
    if (this.#scrollMode)
      return this.#scrollCurrentIndex >= 0 ? this.#scrollCurrentIndex : this.#getScrollIndex();
    const spread = this.#spreads[this.#index];
    if (!spread) return -1;
    const section =
      spread?.center ??
      (this.#side === "left" ? (spread.left ?? spread.right) : (spread.right ?? spread.left));
    return this.book.sections.indexOf(section);
  }
  get primaryIndex() {
    return this.index;
  }
  /** Public flag: true while the renderer is in continuous scroll flow. */
  get scrolled() {
    return this.getAttribute("flow") === "scrolled";
  }
  /** Public flag: true on the axes/flow state where wheel pans the strip. */
  get scrollHorizontal() {
    return false;
  }
  #reportLocation(reason) {
    this.dispatchEvent(
      new CustomEvent("relocate", {
        detail: { reason, range: null, index: this.index, fraction: 0, size: 1 },
      }),
    );
  }
  getSpreadOf(section) {
    const spreads = this.#spreads;
    for (let index = 0; index < spreads.length; index++) {
      const { left, right, center } = spreads[index];
      if (left === section) return { index, side: "left" };
      if (right === section) return { index, side: "right" };
      if (center === section) return { index, side: "center" };
    }
  }
  async goToSpread(index, side, reason) {
    if (index < 0 || index > this.#spreads.length - 1) return;
    if (index === this.#index) {
      this.#render(side);
      return;
    }
    this.#index = index;
    // 代次守卫：从这一次翻页开始，旧的那次一律作废（见 #showGen 注释）
    const gen = ++this.#showGen;
    const spread = this.#spreads[index];
    if (spread.center) {
      const sectionIndex = this.book.sections.indexOf(spread.center);
      const src = await spread.center?.load?.();
      if (gen !== this.#showGen) return;
      await this.#showSpread({
        center: { index: sectionIndex, src },
        spreadIndex: index,
        side,
        gen,
      });
    } else {
      const indexL = this.book.sections.indexOf(spread.left);
      const indexR = this.book.sections.indexOf(spread.right);
      const srcL = await spread.left?.load?.();
      const srcR = await spread.right?.load?.();
      if (gen !== this.#showGen) return;
      await this.#showSpread({
        left: { index: indexL, src: srcL },
        right: { index: indexR, src: srcR },
        spreadIndex: index,
        side,
        gen,
      });
    }
    if (gen !== this.#showGen) return;
    this.#reportLocation(reason);
  }
  async select(target) {
    await this.goTo(target);
  }
  async goTo(target) {
    const resolved = await target;
    if (!resolved || typeof resolved.index !== "number") return;
    if (this.#scrollMode) {
      const page = this.#scrollPages[resolved.index];
      if (page) {
        page.el.scrollIntoView();
        this.#scrollCurrentIndex = resolved.index;
      }
      return;
    }
    const { book } = this;
    const section = book.sections[resolved.index];
    if (!section) return;
    const spread = this.getSpreadOf(section);
    if (!spread) return;
    const { index, side } = spread;
    await this.goToSpread(index, side);
  }
  async next(distance) {
    if (this.#scrollMode) {
      this.scrollBy({ top: distance || this.clientHeight, behavior: "smooth" });
      return;
    }
    const s = this.rtl ? this.#goLeft() : this.#goRight();
    if (!s) return this.goToSpread(this.#index + 1, this.rtl ? "right" : "left", "page");
  }
  async prev(distance) {
    if (this.#scrollMode) {
      this.scrollBy({ top: -(distance || this.clientHeight), behavior: "smooth" });
      return;
    }
    const s = this.rtl ? this.#goRight() : this.#goLeft();
    if (!s) return this.goToSpread(this.#index - 1, this.rtl ? "left" : "right", "page");
  }
  nextSection() {
    if (!this.#scrollMode) return;
    const currentIndex = this.#getScrollIndex();
    const nextIndex = Math.min(currentIndex + 1, this.#scrollPages.length - 1);
    this.#scrollPages[nextIndex]?.el.scrollIntoView({ behavior: "smooth" });
    this.#scrollCurrentIndex = nextIndex;
  }
  prevSection() {
    if (!this.#scrollMode) return;
    const currentIndex = this.#getScrollIndex();
    const prevIndex = Math.max(currentIndex - 1, 0);
    this.#scrollPages[prevIndex]?.el.scrollIntoView({ behavior: "smooth" });
    this.#scrollCurrentIndex = prevIndex;
  }
  scrollToAnchor(_range) {
    // Fixed layout has no meaningful anchor inside a page beyond the page
    // itself; the overlayer resolves highlight rects against the current doc.
    if (!this.#scrollMode) return;
    const index = this.#scrollCurrentIndex;
    this.#scrollPages[index]?.el.scrollIntoView({ behavior: "smooth" });
  }
  getContents() {
    if (this.#scrollMode) {
      return this.#scrollPages
        .filter((p) => p.state === "loaded" && p.frame?.iframe)
        .map((p) => ({
          doc: p.frame.iframe.contentDocument,
          index: p.index,
          overlayer: this.#overlayers.get(p.index),
        }));
    }
    return Array.from(this.#root.querySelectorAll("iframe"))
      .filter((frame) => {
        const parent = frame.parentElement;
        return parent && parent.style.visibility !== "hidden";
      })
      .map((frame) => {
        const index =
          frame.dataset.sectionIndex != null
            ? Number.parseInt(frame.dataset.sectionIndex)
            : undefined;
        return {
          doc: frame.contentDocument,
          index,
          overlayer: index != null ? this.#overlayers.get(index) : undefined,
        };
      });
  }
  destroy() {
    this.#observer.unobserve(this);
    if (this.#scrollObserver) {
      this.#scrollObserver.disconnect();
      this.#scrollObserver = null;
    }
    if (this.#scrollIdleTimer) clearTimeout(this.#scrollIdleTimer);
    this.removeEventListener("scroll", this.#handleScrollEvent);
    this.#clearPrerendered();
  }
}

if (!customElements.get("foliate-fxl")) customElements.define("foliate-fxl", FixedLayout);
