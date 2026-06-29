const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const debounce = (f, wait, immediate) => {
    let timeout
    return (...args) => {
        const later = () => {
            timeout = null
            if (!immediate) f(...args)
        }
        const callNow = immediate && !timeout
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(later, wait)
        if (callNow) f(...args)
    }
}

// Transforms ALL children of the container so multi-view layouts
// animate as a unified whole. Extra elements (e.g. background) are
// also transformed so they slide in sync with the content.
const cssAnimateScroll = (element, scrollProp, startValue, endValue, duration, extraElements = []) => new Promise(resolve => {
    if (document.hidden) {
        element[scrollProp] = endValue
        return resolve()
    }

    const children = [...element.children]
    if (!children.length) {
        element[scrollProp] = endValue
        return resolve()
    }

    const allElements = [...children, ...extraElements]
    const isHorizontal = scrollProp === 'scrollLeft'
    const delta = endValue - startValue
    const transformProp = isHorizontal ? 'translateX' : 'translateY'

    // Prepare all elements for animation
    for (const el of allElements) {
        el.style.willChange = 'transform'
        el.style.transform = `${transformProp}(0px)`
        el.style.transition = 'none'
    }

    // Force reflow to apply initial state
    element.getBoundingClientRect()

    // Start animation on all elements
    for (const el of allElements) {
        el.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`
        el.style.transform = `${transformProp}(${-delta}px)`
    }

    let resolved = false
    const cleanup = () => {
        if (resolved) return
        resolved = true

        for (const el of allElements) {
            el.style.willChange = ''
            el.style.transform = ''
            el.style.transition = ''
        }

        // Apply final scroll position
        element[scrollProp] = endValue
        resolve()
    }

    // Listen for transition end on the first child
    const first = children[0]
    const onTransitionEnd = (e) => {
        if (e.target === first && e.propertyName === 'transform') {
            first.removeEventListener('transitionend', onTransitionEnd)
            cleanup()
        }
    }
    first.addEventListener('transitionend', onTransitionEnd)

    // Fallback timeout in case transitionend doesn't fire
    setTimeout(cleanup, duration + 50)
})

const lerp = (min, max, x) => x * (max - min) + min
const easeOutQuad = x => 1 - (1 - x) * (1 - x)
// rAF animation of a scalar (used for the native scroll offset). Unlike the
// CSS-transform animate, this never composites the whole section as a
// single layer, so it doesn't block when the section exceeds the GPU texture
// limit — it just changes scroll offset each frame (incremental/tiled).
const rafAnimateScroll = (a, b, duration, ease, render) => new Promise(resolve => {
    let start
    const step = now => {
        if (document.hidden) {
            render(lerp(a, b, 1))
            return resolve()
        }
        start ??= now
        const fraction = Math.min(1, (now - start) / duration)
        render(lerp(a, b, ease(fraction)))
        if (fraction < 1) requestAnimationFrame(step)
        else resolve()
    }
    if (document.hidden) {
        render(lerp(a, b, 1))
        return resolve()
    }
    requestAnimationFrame(step)
})

// A CSS-transform page-turn must composite the whole section as one layer. Once
// that layer is past the GPU texture limit (large sections; worse at high DPR on
// Android) Blink blocks the UI for ~1s preparing it before the turn snaps. Above
// this accumulated rendered-view size, animate the native scroll offset instead.
const RAF_ANIMATE_SCROLL_THRESHOLD = 20000

// collapsed range doesn't return client rects sometimes (or always?)
// try make get a non-collapsed range or element
const uncollapse = range => {
    if (!range?.collapsed) return range
    const { endOffset, endContainer } = range
    if (endContainer.nodeType === 1) {
        const node = endContainer.childNodes[endOffset]
        if (node?.nodeType === 1) return node
        return endContainer
    }
    if (endOffset + 1 < endContainer.length) range.setEnd(endContainer, endOffset + 1)
    else if (endOffset > 1) range.setStart(endContainer, endOffset - 1)
    else return endContainer.parentNode
    return range
}

const makeRange = (doc, node, start, end = start) => {
    const range = doc.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    return range
}

// use binary search to find an offset value in a text node
const bisectNode = (doc, node, cb, start = 0, end = node.nodeValue.length) => {
    if (end - start === 1) {
        const result = cb(makeRange(doc, node, start), makeRange(doc, node, end))
        return result < 0 ? start : end
    }
    const mid = Math.floor(start + (end - start) / 2)
    const result = cb(makeRange(doc, node, start, mid), makeRange(doc, node, mid, end))
    return result < 0 ? bisectNode(doc, node, cb, start, mid)
        : result > 0 ? bisectNode(doc, node, cb, mid, end) : mid
}

const { SHOW_ELEMENT, SHOW_TEXT, SHOW_CDATA_SECTION,
    FILTER_ACCEPT, FILTER_REJECT, FILTER_SKIP } = NodeFilter

const filter = SHOW_ELEMENT | SHOW_TEXT | SHOW_CDATA_SECTION

// needed cause there seems to be a bug in `getBoundingClientRect()` in Firefox
// where it fails to include rects that have zero width and non-zero height
// (CSSOM spec says "rectangles [...] of which the height or width is not zero")
// which makes the visible range include an extra space at column boundaries
const getBoundingClientRect = target => {
    let top = Infinity, right = -Infinity, left = Infinity, bottom = -Infinity
    for (const rect of target.getClientRects()) {
        left = Math.min(left, rect.left)
        top = Math.min(top, rect.top)
        right = Math.max(right, rect.right)
        bottom = Math.max(bottom, rect.bottom)
    }
    return new DOMRect(left, top, right - left, bottom - top)
}

const isNonEmptyRect = rect => rect?.width > 0 && rect?.height > 0

const getMappedRectStart = (rect, mapRect) => {
    const mapped = mapRect(rect)
    const start = Math.min(mapped.left, mapped.right)
    return Number.isFinite(start) ? start : null
}

const pickAnchorRect = (rects, mapRect) => {
    const items = Array.from(rects)
        .map(rect => ({ rect, start: getMappedRectStart(rect, mapRect) }))
        .filter(({ rect, start }) => isNonEmptyRect(rect) && start !== null)
    return items.find(({ start }) => start >= 0)?.rect ?? items[0]?.rect ?? rects[0]
}

const getVisibleRange = (doc, start, end, mapRect) => {
    // A resize/scroll callback can fire after the view's document has been
    // torn down (e.g. during teardown, or while an async section load is still
    // settling); there is nothing to measure without a body.
    if (!doc?.body) return
    // first get all visible nodes
    const acceptNode = node => {
        const name = node.localName?.toLowerCase()
        // ignore all scripts, styles, and their children
        if (name === 'script' || name === 'style') return FILTER_REJECT
        // ignore cfi-inert nodes (e.g. injected a11y skip-links) and their
        // subtree: they are invisible to CFI, so anchoring the visible range on
        // one yields a degenerate CFI and can crash `fromRange` when such a node
        // is the only child of its parent (content-less background sections).
        if (node.nodeType === 1 && node.hasAttribute?.('cfi-inert')) return FILTER_REJECT
        if (node.nodeType === 1) {
            const { left, right } = mapRect(node.getBoundingClientRect())
            if (left === 0 && right === 0) return FILTER_REJECT
            // no need to check child nodes if it's completely out of view
            if (right < start || left > end) return FILTER_REJECT
            // elements must be completely in view to be considered visible
            // because you can't specify offsets for elements
            if (left >= start && right <= end) return FILTER_ACCEPT
            // TODO: it should probably allow elements that do not contain text
            // because they can exceed the whole viewport in both directions
            // especially in scrolled mode
        } else {
            // ignore empty text nodes
            if (!node.nodeValue?.trim()) return FILTER_SKIP
            // create range to get rect
            const range = doc.createRange()
            range.selectNodeContents(node)
            const { left, right } = mapRect(range.getBoundingClientRect())
            // it's visible if any part of it is in view
            if (left === 0 && right === 0) return FILTER_REJECT
            if (right >= start && left <= end) return FILTER_ACCEPT
        }
        return FILTER_SKIP
    }
    const walker = doc.createTreeWalker(doc.body, filter, { acceptNode })
    const nodes = []
    for (let node = walker.nextNode(); node; node = walker.nextNode())
        nodes.push(node)

    // we're only interested in the first and last visible nodes
    const from = nodes[0] ?? doc.body
    const to = nodes[nodes.length - 1] ?? from

    // find the offset at which visibility changes
    const startOffset = from.nodeType === 1 ? 0
        : bisectNode(doc, from, (a, b) => {
            const p = mapRect(getBoundingClientRect(a))
            const q = mapRect(getBoundingClientRect(b))
            if (p.right < start && q.left > start) return 0
            return q.left > start ? -1 : 1
        })
    const endOffset = to.nodeType === 1 ? 0
        : bisectNode(doc, to, (a, b) => {
            const p = mapRect(getBoundingClientRect(a))
            const q = mapRect(getBoundingClientRect(b))
            if (p.right < end && q.left > end) return 0
            return q.left > end ? -1 : 1
        })

    const range = doc.createRange()
    range.setStart(from, startOffset)
    range.setEnd(to, endOffset)
    return range
}

const selectionIsBackward = sel => {
    const range = document.createRange()
    range.setStart(sel.anchorNode, sel.anchorOffset)
    range.setEnd(sel.focusNode, sel.focusOffset)
    return range.collapsed
}

const setSelectionTo = (target, collapse) => {
    let range
    if (target.startContainer) range = target.cloneRange()
    else if (target.nodeType) {
        range = document.createRange()
        range.selectNode(target)
    }
    if (range) {
        const sel = range.startContainer.ownerDocument?.defaultView.getSelection()
        if (sel) {
            sel.removeAllRanges()
            if (collapse === -1) range.collapse(true)
            else if (collapse === 1) range.collapse()
            sel.addRange(range)
        }
    }
}

// Whether a view's bounding rect overlaps the visible region of its container.
// Used by #syncA11y to mark only the pre-loaded views that lie outside the
// viewport as `aria-hidden`. Views still visible to sighted users (e.g. the
// right column in a dual-page spread that belongs to a different section
// than the left column) stay exposed to assistive tech.
// See readest/readest#4243 and readest/readest#4259.
export const isViewVisibleInContainer = (viewRect, containerRect) =>
    viewRect.right > containerRect.left
    && viewRect.left < containerRect.right
    && viewRect.bottom > containerRect.top
    && viewRect.top < containerRect.bottom

export const getDirection = doc => {
    const { defaultView } = doc
    let { writingMode, direction } = defaultView.getComputedStyle(doc.body)
    // Some EPUBs set writing-mode on the first child of body instead of body itself
    if (!writingMode || writingMode === 'horizontal-tb') {
        const firstChild = doc.body.querySelector(':scope > :not([cfi-inert])')
        if (firstChild) {
            const childStyle = defaultView.getComputedStyle(firstChild)
            if (childStyle.writingMode === 'vertical-rl'
                || childStyle.writingMode === 'vertical-lr') {
                writingMode = childStyle.writingMode
            }
        }
    }
    const vertical = writingMode === 'vertical-rl'
        || writingMode === 'vertical-lr'
    const rtl = doc.body.dir === 'rtl'
        || direction === 'rtl'
        || doc.documentElement.dir === 'rtl'
    return { vertical, rtl }
}

const getBackground = doc => {
    const bodyStyle = doc.defaultView.getComputedStyle(doc.body)
    return bodyStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
        && bodyStyle.backgroundImage === 'none'
        ? doc.defaultView.getComputedStyle(doc.documentElement).background
        : bodyStyle.background
}

// Compute the background segments for paginated mode. Each rendered view yields
// one segment positioned so it tracks its content on screen
// (segStart = inset + viewOffset - scrollPos). Because the paginator rebuilds
// these on every scroll, the backgrounds stay glued to the content while the
// user drags a swipe; when two sections with different backgrounds are both on
// screen the seam falls on the real content boundary instead of one flat colour
// spanning the viewport.
//
// Each segment is clamped to the content area [containerStart, containerEnd] so
// a coloured page stays inside its own column and never bleeds into the outer
// margin gutters (the --_outer-min tracks that keep the left/right margins in
// step with the centre gap). Otherwise a body-coloured page would spill its
// colour into the outer gutter while an adjacent transparent/image page did not,
// shifting the spread off-centre (~250px wide on a desktop, readest#4394). In
// single-column mode the gutters are zero, so the clamp still fills the viewport
// edge to edge. `views` is the sorted list of { size, bg } with bg already
// resolved ('' = transparent → no segment).
export const computeBackgroundSegments = (views, scrollPos, bgSize, inset, containerSize) => {
    const containerStart = inset
    const containerEnd = inset + containerSize
    const segments = []
    let offset = 0
    for (const view of views) {
        const segStart = inset + offset - scrollPos
        const segEnd = segStart + view.size
        offset += view.size
        if (segEnd <= 0 || segStart >= bgSize) continue // off screen
        if (!view.bg) continue // transparent → let the host/theme show through
        const start = Math.max(segStart, containerStart)
        const end = Math.min(segEnd, containerEnd)
        if (end <= start) continue // entirely in an outer gutter
        segments.push({ start, size: end - start, bg: view.bg })
    }
    return segments
}

// When a host background texture is active (mounted on the reader container as
// `.foliate-viewer::before`), a page whose own background is transparent must
// NOT paint a fill — an opaque fill would occlude the texture. Returns '' (no
// fill, so the texture shows through) for a transparent page under a texture,
// and the resolved colour otherwise. Shared by scrolled-mode view elements and
// paginated-mode segments so both modes treat textures identically (readest#4399).
export const textureAwareBackground = (resolved, hasTexture) => {
    const isTransparent = !resolved
        || /^\s*(transparent|rgba\(0,\s*0,\s*0,\s*0\))/.test(resolved)
    return hasTexture && isTransparent ? '' : resolved
}

const makeMarginals = (length, part) => Array.from({ length }, () => {
    const div = document.createElement('div')
    const child = document.createElement('div')
    div.append(child)
    child.setAttribute('part', part)
    return div
})

const setStyles = (el, styles) => {
    const { style } = el
    for (const [k, v] of Object.entries(styles)) style.setProperty(k, v)
}

const setStylesImportant = (el, styles) => {
    const { style } = el
    for (const [k, v] of Object.entries(styles)) style.setProperty(k, v, 'important')
}

class View {
    #observer = new ResizeObserver(() => this.expand())
    #element = document.createElement('div')
    #iframe = document.createElement('iframe')
    #contentRange = document.createRange()
    #overlayer
    #vertical = false
    #rtl = false
    #column = true
    #size
    #columnCount = 1
    #layout = {}
    #contentPages = 0
    #bgImageSize = null
    fontReady = Promise.resolve()
    constructor({ container, onExpand }) {
        this.container = container
        this.onExpand = onExpand
        this.#iframe.setAttribute('part', 'filter')
        this.#element.append(this.#iframe)
        Object.assign(this.#element.style, {
            boxSizing: 'content-box',
            position: 'relative',
            overflow: 'hidden',
            flex: '0 0 auto',
            width: '100%', height: '100%',
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
        })
        Object.assign(this.#iframe.style, {
            overflow: 'hidden',
            border: '0',
            display: 'none',
            width: '100%', height: '100%',
        })
        // `allow-scripts` is needed for events because of WebKit bug
        // https://bugs.webkit.org/show_bug.cgi?id=218086
        this.#iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
        this.#iframe.setAttribute('scrolling', 'no')
    }
    get element() {
        return this.#element
    }
    get document() {
        return this.#iframe.contentDocument
    }
    get contentPages() {
        return this.#contentPages
    }
    async load(src, data, afterLoad, beforeRender) {
        if (typeof src !== 'string') throw new Error(`${src} is not string`)
        return new Promise(resolve => {
            this.#iframe.addEventListener('load', async () => {
                const doc = this.document
                afterLoad?.(doc)

                this.#iframe.setAttribute('aria-label', doc.title)
                // it needs to be visible for Firefox to get computed style
                this.#iframe.style.display = 'block'
                const { vertical, rtl } = getDirection(doc)
                this.docBackground = getBackground(doc)
                doc.body.style.background = 'none'
                // Resolve the body background image's natural size BEFORE the
                // first render so the scrolled-mode view is sized to fit it
                // from the start. Sizing it lazily — expanding only once the
                // image loads — grows the view *after* navigation has already
                // scrolled to it. On reopen that growth lands above the saved
                // position (e.g. a preloaded previous section's full-page
                // illustration) and, with no reliable cross-iframe scroll
                // anchoring on WebKit, drifts the viewport to the chapter
                // start. Awaiting a local EPUB resource here is near-instant.
                let bgRendered = false
                const bgUrl = this.docBackground
                    ?.match(/url\(["']?([^"')]+)["']?\)/)?.[1]
                if (bgUrl && !this.container.noBackground) {
                    const img = new Image()
                    let resolveWait
                    const waited = new Promise(res => { resolveWait = res })
                    img.onload = () => {
                        this.#bgImageSize = {
                            width: img.naturalWidth,
                            height: img.naturalHeight,
                        }
                        // If the image only resolves after this view has
                        // already rendered (slower than the bounded wait
                        // below), grow to fit it now — the original lazy path,
                        // kept as a fallback rather than the norm.
                        if (bgRendered && !this.#column) this.expand()
                        resolveWait()
                    }
                    // A missing or broken image just renders without the
                    // background, exactly as before.
                    img.onerror = () => resolveWait()
                    img.src = bgUrl
                    // Bound the wait so a missing, broken, or hung image (one
                    // that fires neither load nor error) can never block the
                    // section from rendering.
                    let timer
                    await Promise.race([
                        waited,
                        new Promise(res => { timer = setTimeout(res, 3000) }),
                    ])
                    clearTimeout(timer)
                }
                // Awaiting the background image yields control, so the view may
                // have been torn down or reloaded meanwhile — don't render into
                // a stale document.
                if (this.document !== doc) return resolve()
                this.#iframe.style.display = 'none'

                this.#vertical = vertical
                this.#rtl = rtl

                this.#contentRange.selectNodeContents(doc.body)
                const layout = beforeRender?.({ vertical, rtl })
                this.#iframe.style.display = 'block'
                this.render(layout)
                bgRendered = true
                this.#observer.observe(doc.body)

                // the resize observer above doesn't work in Firefox
                // (see https://bugzilla.mozilla.org/show_bug.cgi?id=1832939)
                // until the bug is fixed we can at least account for font load
                this.fontReady = doc.fonts.ready.then(() => this.expand())

                resolve()
            }, { once: true })
            if (data) {
                this.#iframe.srcdoc = data
            } else {
                this.#iframe.src = src
            }
        })
    }
    render(layout) {
        if (!layout || !this.document?.documentElement) return
        this.#column = layout.flow !== 'scrolled'
        this.#layout = layout
        if (this.#column) this.columnize(layout)
        else this.scrolled(layout)
    }
    scrolled({ width, height, marginTop, marginRight, marginBottom, marginLeft, gap, columnWidth }) {
        const vertical = this.#vertical
        const doc = this.document
        setStylesImportant(doc.documentElement, {
            'box-sizing': 'border-box',
            'column-width': 'auto',
            '-webkit-column-width': 'auto',
            'height': 'auto',
            'width': 'auto',
        })
        const availableWidth = Math.trunc(width - marginLeft - marginRight)
        const availableHeight = Math.trunc(height - marginTop - marginBottom)
        const sidePaddingLeft = marginLeft / 2 + gap / 2
        const sidePaddingRight = marginRight / 2 + gap / 2
        setStyles(doc.documentElement, {
            'padding': vertical
                ? `${marginTop * 1.5}px 0px ${marginBottom * 1.5}px 0px`
                : `0px ${sidePaddingRight}px 0px ${sidePaddingLeft}px`,
            '--page-margin-top': `${vertical ? marginTop * 1.5 : marginTop}px`,
            '--page-margin-right': `${vertical ? marginRight : sidePaddingRight}px`,
            '--page-margin-bottom': `${vertical ? marginBottom * 1.5 : marginBottom}px`,
            '--page-margin-left': `${vertical ? marginLeft : sidePaddingLeft}px`,
            '--full-width': `${Math.trunc(width)}`,
            '--full-height': `${Math.trunc(height)}`,
            '--available-width': `${availableWidth}`,
            '--available-height': `${availableHeight}`,
        })
        setStylesImportant(doc.body, {
            [vertical ? 'max-height' : 'max-width']: `${columnWidth}px`,
            'margin': 'auto',
            // Prevent position:absolute/fixed on body from coupling its
            // size to the iframe, which causes diverging expand() loops
            'position': 'static',
        })
        this.setImageSize(availableWidth, availableHeight)
        this.expand()
    }
    columnize({ width, height, marginTop, marginRight, marginBottom, marginLeft, gap, columnWidth, columnCount }) {
        const vertical = this.#vertical
        this.#size = vertical ? height : width
        this.#columnCount = columnCount || 1

        const doc = this.document
        const horizontalColumnGap = columnCount > 1 ? (marginLeft + marginRight) / 4 + gap / 2 : (marginLeft + marginRight) / 2 + gap
        const sidePaddingLeft = columnCount > 1 ? marginLeft / 4 + gap / 4 : marginLeft / 2 + gap / 2
        const sidePaddingRight = columnCount > 1 ? marginRight / 4 + gap / 4 : marginRight / 2 + gap / 2
        setStylesImportant(doc.documentElement, {
            'box-sizing': 'border-box',
            'column-width': `${Math.trunc(columnWidth)}px`,
            'column-gap': vertical ? `${(marginTop + marginBottom) * 1.5}px` : `${horizontalColumnGap}px`,
            'column-fill': 'auto',
            '-webkit-column-width': `${Math.trunc(columnWidth)}px`,
            '-webkit-column-gap': vertical ? `${(marginTop + marginBottom) * 1.5}px` : `${horizontalColumnGap}px`,
            '-webkit-column-fill': 'auto',
            ...(vertical
                ? { 'width': `${width}px` }
                : { 'height': `${height}px` }),
            'overflow': 'hidden',
            // force wrap long words
            'overflow-wrap': 'break-word',
            // reset some potentially problematic props
            'position': 'static', 'border': '0', 'margin': '0',
            'max-height': 'none', 'max-width': 'none',
            'min-height': 'none', 'min-width': 'none',
            // fix glyph clipping in WebKit
            '-webkit-line-box-contain': 'block glyphs replaced',
        })
        const availableWidth = vertical
            ? Math.trunc(width - marginLeft / 2 - marginRight / 2 - gap)
            : Math.trunc(width / this.#columnCount)
        const availableHeight = vertical
            ? Math.trunc(height / this.#columnCount)
            : Math.trunc(height - marginTop - marginBottom)
        setStyles(doc.documentElement, {
            'padding': vertical
                ? `${marginTop * 1.5}px ${marginRight}px ${marginBottom * 1.5}px ${marginLeft}px`
                : `${marginTop}px ${sidePaddingRight}px ${marginBottom}px ${sidePaddingLeft}px`,
            '--page-margin-top': `${vertical ? marginTop * 1.5 : marginTop}px`,
            '--page-margin-right': `${vertical ? marginRight : sidePaddingRight}px`,
            '--page-margin-bottom': `${vertical ? marginBottom * 1.5 : marginBottom}px`,
            '--page-margin-left': `${vertical ? marginLeft : sidePaddingLeft}px`,
            '--full-width': `${Math.trunc(availableWidth)}`,
            '--full-height': `${Math.trunc(availableHeight)}`,
            '--available-width': `${availableWidth}`,
            '--available-height': `${availableHeight}`,
        })
        setStylesImportant(doc.body, {
            'max-height': 'none',
            'max-width': 'none',
            'margin': '0',
            // Prevent position:absolute/fixed on body from coupling its
            // size to the iframe, which causes diverging expand() loops
            'position': 'static',
        })
        this.setImageSize(availableWidth, availableHeight)
        this.expand()
    }
    setImageSize(availableWidth, availableHeight) {
        const { width, height, marginTop, marginRight, marginBottom, marginLeft } = this.#layout
        const vertical = this.#vertical
        const doc = this.document
        const pageFullscreen = doc.documentElement.hasAttribute('data-duokan-page-fullscreen')
        // The fullscreen treatment pins the image with position:absolute and
        // height:100% so it fills the fixed-height page. That only works in
        // paginated (columnized) mode; in scrolled mode the container height is
        // `auto`, so height:100% resolves to 0 and the cover collapses out of
        // sight (#4379). Apply it only when columnized.
        const applyFullscreen = pageFullscreen && this.#column
        for (const el of doc.body.querySelectorAll('img, svg, video')) {
            // clear previous inline constraints so we read CSS-authored values,
            // not stale pixel values from a previous resize (#3634)
            el.style.removeProperty('max-width')
            el.style.removeProperty('max-height')
            // preserve max size if they are already set in CSS
            let { maxHeight, maxWidth } = doc.defaultView.getComputedStyle(el)
            if (parseInt(maxWidth) > availableWidth) {
                maxWidth = `${availableWidth}px`
            }
            if (parseInt(maxHeight) > availableHeight) {
                maxHeight = `${availableHeight}px`
            }
            setStylesImportant(el, {
                'max-height': vertical
                    ? (maxHeight !== 'none' && maxHeight !== '0px' ? maxHeight : '100%')
                    : `${height - (applyFullscreen ? 0 : (marginTop + marginBottom))}px`,
                'max-width': vertical
                    ? `${width - (applyFullscreen ? 0 : (marginLeft + marginRight))}px`
                    : (maxWidth !== 'none' && maxWidth !== '0px' ? maxWidth : '100%'),
                'object-fit': 'contain',
                'page-break-inside': 'avoid',
                'break-inside': 'avoid',
                'box-sizing': 'border-box',
            })
            if (applyFullscreen) {
                setStylesImportant(doc.documentElement, {
                    position: 'relative',
                })
                setStylesImportant(el, {
                    position: 'absolute',
                    inset: '0',
                    width: '100%',
                    height: '100%',
                    margin: '0',
                })
                let ancestor = el.parentElement
                while (ancestor && ancestor !== doc.body) {
                    setStylesImportant(ancestor, {
                        width: '100%',
                        height: '100%',
                        margin: '0',
                        padding: '0',
                    })
                    ancestor = ancestor.parentElement
                }
                if (el.localName === 'svg') {
                    el.setAttribute('preserveAspectRatio', 'xMidYMid meet')
                }
            } else if (pageFullscreen) {
                // Scrolled mode for a fullscreen-cover doc: undo any absolute
                // pinning left over from a previous paginated render so the
                // image flows normally, bounded by the max-height set above
                // (#4379). Without this, toggling paginated -> scrolled keeps
                // the stale position:absolute/height:100% and the cover stays
                // collapsed.
                doc.documentElement.style.removeProperty('position')
                for (const prop of ['position', 'inset', 'width', 'height', 'margin']) {
                    el.style.removeProperty(prop)
                }
                let ancestor = el.parentElement
                while (ancestor && ancestor !== doc.body) {
                    for (const prop of ['width', 'height', 'margin', 'padding']) {
                        ancestor.style.removeProperty(prop)
                    }
                    ancestor = ancestor.parentElement
                }
            }
        }
    }
    get #zoom() {
        // Safari does not zoom the client rects, while Chrome, Edge and Firefox does
        if (/^((?!chrome|android).)*AppleWebKit/i.test(navigator.userAgent) && !window.chrome) {
            return window.getComputedStyle(this.document.body).zoom || 1.0
        }
        return 1.0
    }
    expand() {
        if (!this.document?.documentElement) return
        const { documentElement } = this.document
        if (this.#column) {
            const side = this.#vertical ? 'height' : 'width'
            const otherSide = this.#vertical ? 'width' : 'height'
            const contentRect = this.#contentRange.getBoundingClientRect()
            const rootRect = documentElement.getBoundingClientRect()
            // offset caused by column break at the start of the page
            // which seem to be supported only by WebKit and only for horizontal writing
            const contentStart = this.#vertical ? 0
                : this.#rtl ? rootRect.right - contentRect.right : contentRect.left - rootRect.left
            const contentSize = (contentStart + contentRect[side]) * this.#zoom
            // Size content by individual columns, not full spreads.
            // This allows adjacent sections to share a spread when a
            // section doesn't fill all available columns.
            const columnSize = this.#size / this.#columnCount
            const pageCount = Math.ceil(contentSize / columnSize)
            this.#contentPages = pageCount
            const expandedSize = pageCount * columnSize
            this.#element.style.padding = '0'
            this.#iframe.style[side] = `${expandedSize}px`
            this.#element.style[side] = `${expandedSize}px`
            this.#iframe.style[otherSide] = '100%'
            this.#element.style[otherSide] = '100%'
            // One column per "page" — overflow columns extend into adjacent pages
            documentElement.style[side] = `${columnSize}px`
            if (this.#overlayer) {
                this.#overlayer.element.style.margin = '0'
                this.#overlayer.element.style.left = '0'
                this.#overlayer.element.style.top = '0'
                this.#overlayer.element.style[side] = `${expandedSize}px`
                this.#overlayer.redraw()
            }
        } else {
            const side = this.#vertical ? 'width' : 'height'
            const otherSide = this.#vertical ? 'height' : 'width'
            const contentSize = documentElement.getBoundingClientRect()[side]
            let expandedSize = contentSize
            // If the section has a background image, ensure the view is
            // at least as large as the image scaled to fit the cross axis
            if (this.#bgImageSize) {
                const crossSize = this.#element.getBoundingClientRect()[otherSide]
                if (crossSize > 0) {
                    const { width: imgW, height: imgH } = this.#bgImageSize
                    const scaledSize = this.#vertical
                        ? imgW * crossSize / imgH
                        : imgH * crossSize / imgW
                    expandedSize = Math.max(expandedSize, scaledSize)
                }
            }
            this.#element.style.padding = '0'
            this.#iframe.style[side] = `${expandedSize}px`
            this.#element.style[side] = `${expandedSize}px`
            this.#iframe.style[otherSide] = '100%'
            this.#element.style[otherSide] = '100%'
            if (this.#overlayer) {
                this.#overlayer.element.style.margin = '0'
                this.#overlayer.element.style.left = '0'
                this.#overlayer.element.style.top = '0'
                this.#overlayer.element.style[side] = `${expandedSize}px`
                this.#overlayer.redraw()
            }
        }
        this.onExpand()
    }
    set overlayer(overlayer) {
        this.#overlayer = overlayer
        this.#element.append(overlayer.element)
    }
    get overlayer() {
        return this.#overlayer
    }
    #loupeEl = null
    #loupeScaler = null
    #loupeCursor = null
    // Show a magnifier loupe inside the iframe document.
    // winX/winY are in main-window (screen) coordinates.
    showLoupe(winX, winY, { isVertical, color, gap, margin, radius, magnification }) {
        const doc = this.document
        if (!doc) return

        const frameRect = this.#iframe.getBoundingClientRect()
        // Cursor in iframe-viewport coordinates.
        const vpX = winX - frameRect.left
        const vpY = winY - frameRect.top

        // Cursor in document coordinates (accounts for scroll).
        const scrollX = doc.scrollingElement?.scrollLeft ?? 0
        const scrollY = doc.scrollingElement?.scrollTop ?? 0
        const docX = vpX + scrollX
        const docY = vpY + scrollY

        const MAGNIFICATION = magnification
        const MARGIN = margin

        // Capsule dimensions: elongated along the reading direction.
        // For horizontal text the capsule is wider; for vertical it is taller.
        const shortSide = radius * 2
        const longSide  = Math.round(radius * 3.6)
        const loupeW = isVertical ? shortSide : longSide
        const loupeH = isVertical ? longSide  : shortSide
        const halfW = loupeW / 2
        const halfH = loupeH / 2
        const borderRadius = shortSide / 2  // fully rounded ends

        // Position loupe above the cursor (or to the left for vertical text).
        const GAP = gap
        let loupeLeft = isVertical ? vpX - loupeW - GAP : vpX - halfW
        let loupeTop  = isVertical ? vpY - halfH        : vpY - loupeH - GAP
        loupeLeft = Math.max(MARGIN, Math.min(loupeLeft, frameRect.width  - loupeW - MARGIN))
        loupeTop  = Math.max(MARGIN, Math.min(loupeTop,  frameRect.height - loupeH - MARGIN))

        // CSS-transform math: map document point (docX, docY) to loupe centre.
        //   visual_pos = offset + coord × MAGNIFICATION = halfW (or halfH)
        //   ⟹ offset = half − coord × MAGNIFICATION
        const offsetX = halfW - docX * MAGNIFICATION
        const offsetY = halfH - docY * MAGNIFICATION

        // Build loupe DOM structure once; cache it across hide/show cycles so
        // the expensive body clone is not repeated on every drag start.
        if (!this.#loupeEl || !this.#loupeEl.isConnected) {
            this.#loupeEl = doc.createElement('div')

            // Clone the live body once — inside the iframe the epub's CSS
            // variables, @font-face fonts, and styles apply automatically.
            const bodyClone = doc.body.cloneNode(true)

            // Wrap the clone in a div that replicates documentElement's inline
            // styles (column-width, column-gap, padding, height, etc.) so text
            // flows with the same column layout as the original document.
            const htmlWrapper = doc.createElement('div')
            htmlWrapper.style.cssText = doc.documentElement.style.cssText
            // expand() constrains documentElement's page-axis dimension to one
            // page size (width for horizontal, height for vertical).  Override
            // with the full scroll dimension so all columns are rendered.
            if (this.#vertical)
                htmlWrapper.style.height = `${doc.documentElement.scrollHeight}px`
            else
                htmlWrapper.style.width = `${doc.documentElement.scrollWidth}px`
            htmlWrapper.appendChild(bodyClone)

            this.#loupeScaler = doc.createElement('div')
            this.#loupeScaler.appendChild(htmlWrapper)

            const cursorLen = Math.round(shortSide * 0.44)
            this.#loupeCursor = doc.createElement('div')
            this.#loupeCursor.style.cssText = isVertical
                ? `position:absolute;left:calc(50% - ${cursorLen / 2}px);top:50%;`
                + `margin-top:-1px;width:${cursorLen}px;height:2px;background:${color};pointer-events:none;z-index:1;box-sizing:border-box;`
                : `position:absolute;left:50%;top:calc(50% - ${cursorLen / 2}px);`
                + `margin-left:-1px;width:2px;height:${cursorLen}px;background:${color};pointer-events:none;z-index:1;box-sizing:border-box;`

            this.#loupeEl.appendChild(this.#loupeScaler)
            this.#loupeEl.appendChild(this.#loupeCursor)
            doc.documentElement.appendChild(this.#loupeEl)

            // Static loupe shell styles (set once).
            this.#loupeEl.style.cssText = `
                position: absolute;
                width: ${loupeW}px;
                height: ${loupeH}px;
                border-radius: ${borderRadius}px;
                overflow: hidden;
                border: 2.5px solid ${color};
                box-shadow: 0 6px 24px rgba(0,0,0,0.28);
                background-color: var(--theme-bg-color);
                z-index: 9999;
                pointer-events: none;
                user-select: none;
                box-sizing: border-box;
                contain: strict;
            `

            // Static scaler styles (set once; only left/top change per move).
            this.#loupeScaler.style.cssText = `
                position: absolute;
                transform: scale(${MAGNIFICATION});
                transform-origin: 0 0;
                pointer-events: none;
            `
        }

        // Ensure visible (hideLoupe hides via CSS instead of removing).
        this.#loupeEl.style.display = ''

        // Update only the dynamic position values (fast path on every move).
        this.#loupeScaler.style.left = `${offsetX}px`
        this.#loupeScaler.style.top = `${offsetY}px`
        this.#loupeScaler.style.width = `${doc.documentElement.scrollWidth}px`
        this.#loupeScaler.style.height = `${doc.documentElement.scrollHeight}px`
        this.#loupeEl.style.left = `${loupeLeft + scrollX}px`
        this.#loupeEl.style.top = `${loupeTop + scrollY}px`

        // Cut a capsule-shaped hole in the overlayer so highlights don't paint
        // over the loupe.
        if (typeof this.#overlayer?.setHole === 'function') {
            const overlayerRect = this.#overlayer.element.getBoundingClientRect()
            const dx = frameRect.left - overlayerRect.left
            const dy = frameRect.top - overlayerRect.top

            const pad = 3
            const cx = loupeLeft + halfW + dx
            const cy = loupeTop + halfH + dy

            this.#overlayer.setHole(cx, cy, loupeW + pad * 2, loupeH + pad * 2, borderRadius + pad)
        }
    }
    hideLoupe() {
        // Hide via CSS instead of removing — keeps the cached body clone so
        // the next showLoupe call skips the expensive cloneNode(true).
        if (this.#loupeEl) {
            this.#loupeEl.style.display = 'none'
        }
        if (typeof this.#overlayer?.clearHole === 'function')
            this.#overlayer.clearHole()
    }
    destroyLoupe() {
        if (this.#loupeEl) {
            this.#loupeEl.remove()
            this.#loupeEl = null
            this.#loupeScaler = null
            this.#loupeCursor = null
        }
        if (typeof this.#overlayer?.clearHole === 'function')
            this.#overlayer.clearHole()
    }
    destroy() {
        if (this.document?.body) this.#observer.unobserve(this.document.body)
        this.destroyLoupe()
    }
}

// NOTE: everything here assumes the so-called "negative scroll type" for RTL
export class Paginator extends HTMLElement {
    static observedAttributes = [
        'flow', 'gap', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
        'max-inline-size', 'max-block-size', 'max-column-count',
        'no-preload', 'no-background', 'no-continuous-scroll',
    ]
    #root = this.attachShadow({ mode: 'closed' })
    #observer = new ResizeObserver(() => this.render())
    #top
    #background
    #container
    #header
    #footer
    #views = new Map() // Map<sectionIndex, View>
    #primaryIndex = -1
    #vertical = false
    #rtl = false
    #marginTop = 0
    #marginBottom = 0
    #anchor = 0 // anchor view to a fraction (0-1), Range, or Element
    #justAnchored = false
    #locked = false // while true, prevent any further navigation
    #navigationLocked = false // public flag: when true, disables touch/swipe page turns
    #styles
    #styleMap = new WeakMap()
    #mediaQuery = matchMedia('(prefers-color-scheme: dark)')
    #mediaQueryListener
    #scrollBounds
    #touchState
    #touchScrolled
    #lastVisibleRange
    #scrollLocked = false
    #isAnimating = false
    #filling = false // true while #fillVisibleArea is running
    #fillPromise = null // tracks in-progress #fillVisibleArea for awaiting
    #stabilizing = false // true while #display is stabilizing layout
    #rendered = false // true after first #display completes
    #lastLayout = null // cached layout from the last #beforeRender call
    // Cache of section index → vertical (boolean). Populated as views
    // are loaded so we can check direction *before* loading a section.
    #directionCache = new Map()
    constructor() {
        super()
        this.#root.innerHTML = `<style>
        :host {
            display: block;
            container-type: size;
        }
        :host, #top {
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            width: 100%;
            height: 100%;
        }
        #top {
            --_gap: 7%;
            --_margin-top: 0px;
            --_margin-right: 0px;
            --_margin-bottom: 0px;
            --_margin-left: 0px;
            --_max-inline-size: 720px;
            --_max-block-size: 1440px;
            --_max-column-count: 2;
            --_max-column-count-portrait: var(--_max-column-count);
            --_max-column-count-spread: var(--_max-column-count);
            --_half-gap: calc(var(--_gap) / 2);
            --_half-margin-left: calc(var(--_margin-left) / 2);
            --_half-margin-right: calc(var(--_margin-right) / 2);
            --_max-width: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            --_max-height: var(--_max-block-size);
            --_column-count: 1;
            --_outer-min-left: calc((var(--_column-count) - 1) * (var(--_margin-left) / 4 + var(--_gap) / 4));
            --_outer-min-right: calc((var(--_column-count) - 1) * (var(--_margin-right) / 4 + var(--_gap) / 4));
            display: grid;
            grid-template-columns:
                minmax(var(--_outer-min-left), 1fr)
                var(--_margin-left)
                minmax(0, calc(var(--_max-width) - var(--_gap)))
                var(--_margin-right)
                minmax(var(--_outer-min-right), 1fr);
            grid-template-rows:
                minmax(var(--_margin-top), 1fr)
                minmax(0, var(--_max-height))
                minmax(var(--_margin-bottom), 1fr);
            &.vertical {
                --_max-column-count-spread: var(--_max-column-count-portrait);
                --_max-width: var(--_max-block-size);
                --_max-height: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            }
            @container (orientation: portrait) {
                & {
                    --_max-column-count-spread: var(--_max-column-count-portrait);
                }
                &.vertical {
                    --_max-column-count-spread: var(--_max-column-count);
                }
            }
        }
        #background {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
            position: relative;
            overflow: hidden;
        }
        #container {
            grid-column: 2 / 5;
            grid-row: 1 / -1;
            overflow: hidden;
            display: flex;
            flex-direction: row;
            transition: opacity 50ms ease-in;
        }
        #container.vertical {
            flex-direction: column;
        }
        :host([flow="scrolled"]) #container {
            grid-column: 2 / 5;
            grid-row: 1 / -1;
            overflow: auto;
            overflow-anchor: auto;
            flex-direction: column;
            background: var(--_scrollbar-track-bg, transparent);
            scrollbar-width: none;
            -ms-overflow-style: none;
        }
        :host([flow="scrolled"]) #container::-webkit-scrollbar {
            display: none;
            width: 0;
            height: 0;
        }
        @media (hover: hover) and (pointer: fine) {
            :host([flow="scrolled"]) #container {
                scrollbar-color: rgba(116, 103, 82, .42) var(--_scrollbar-track-bg, transparent);
                scrollbar-width: thin;
            }
            :host([flow="scrolled"]) #container::-webkit-scrollbar {
                display: block;
                width: 10px;
                height: 10px;
                background: var(--_scrollbar-track-bg, transparent);
            }
            :host([flow="scrolled"]) #container::-webkit-scrollbar-track,
            :host([flow="scrolled"]) #container::-webkit-scrollbar-track-piece,
            :host([flow="scrolled"]) #container::-webkit-scrollbar-corner {
                background: var(--_scrollbar-track-bg, transparent);
            }
            :host([flow="scrolled"]) #container::-webkit-scrollbar-thumb {
                min-height: 48px;
                border: 3px solid transparent;
                border-radius: 999px;
                background: rgba(116, 103, 82, .42);
                background-clip: content-box;
            }
            :host([flow="scrolled"]) #container::-webkit-scrollbar-thumb:hover {
                background: rgba(116, 103, 82, .62);
                background-clip: content-box;
            }
        }
        :host([flow="scrolled"]) #container.vertical {
            flex-direction: row;
        }
        #header {
            grid-column: 3 / 4;
            grid-row: 1;
        }
        #footer {
            grid-column: 3 / 4;
            grid-row: 3;
            align-self: end;
        }
        #header {
            display: grid;
            height: var(--_margin-top);
        }
        #footer {
            display: grid;
            height: var(--_margin-bottom);
        }
        :is(#header, #footer) > * {
            display: flex;
            align-items: center;
            min-width: 0;
        }
        :is(#header, #footer) > * > * {
            width: 100%;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            text-align: center;
            font-size: .75em;
            opacity: .6;
        }
        </style>
        <div id="top">
            <div id="background" part="filter"></div>
            <div id="header"></div>
            <div id="container" part="container"></div>
            <div id="footer"></div>
        </div>
        `

        this.#top = this.#root.getElementById('top')
        this.#background = this.#root.getElementById('background')
        this.#container = this.#root.getElementById('container')
        this.#header = this.#root.getElementById('header')
        this.#footer = this.#root.getElementById('footer')

        this.#observer.observe(this.#container)
        const debouncedScroll = debounce(() => {
            if (this.scrolled && !this.#isAnimating) {
                // Skip entirely while stabilizing — preserve #justAnchored
                // so the first post-stabilization fire still sees it.
                if (this.#stabilizing) return
                if (this.#justAnchored) this.#justAnchored = false
                else this.#afterScroll('scroll')
                // Backward preloading is handled eagerly in the (non-debounced)
                // scroll listener below, mirroring the forward buffer.
            } else if (!this.scrolled) {
              this.#afterScroll('container-scroll')
            }
        }, 250)
        this.#container.addEventListener('scroll', () => {
            if (!this.#isAnimating) this.dispatchEvent(new Event('scroll'))
            // Keep the per-view backgrounds glued to the content while a swipe
            // drag scrolls the container (no animation runs then). During the
            // snap animation #isAnimating is set and the destination background
            // is already in place, so the rebuild is skipped.
            if (!this.scrolled && !this.#isAnimating) this.#replaceBackground()
            // Preload forward when fewer than minPages ahead
            if (!this.noPreload && !this.noContinuousScroll && !this.#filling && !this.#stabilizing) {
                const minPages = 5
                const pagesAhead = this.size > 0
                    ? Math.floor((this.#renderedViewSize - this.#renderedEnd) / this.size)
                    : 0
                if (pagesAhead < minPages) {
                    const sorted = this.#sortedViews
                    const lastIndex = sorted[sorted.length - 1]?.[0]
                    if (lastIndex != null) {
                        const nextIdx = this.#adjacentIndex(1, lastIndex)
                        if (nextIdx != null && !this.#views.has(nextIdx) && this.#isSameDirection(nextIdx)) {
                            this.#filling = true
                            this.#loadAdjacentSection(nextIdx)
                                .finally(() => {
                                    this.#filling = false
                                    this.dispatchEvent(new Event('stabilized'))
                                })
                        }
                    }
                }
            }
            // Preload backward when fewer than minPages behind, mirroring the
            // forward buffer so scrolling up never dead-ends at the top with the
            // previous section unloaded (readest/readest#4112). The
            // #loadAdjacentSection scroll compensation keeps the viewport
            // anchored as the section is inserted above.
            if (this.scrolled && !this.noPreload && !this.noContinuousScroll
                && !this.#filling && !this.#stabilizing) {
                const minPages = 5
                const pagesBehind = this.size > 0
                    ? Math.floor(this.#renderedStart / this.size)
                    : 0
                if (pagesBehind < minPages) {
                    const sorted = this.#sortedViews
                    const firstIndex = sorted[0]?.[0]
                    if (firstIndex != null) {
                        const prevIdx = this.#adjacentIndex(-1, firstIndex)
                        if (prevIdx != null && !this.#views.has(prevIdx) && this.#isSameDirection(prevIdx)) {
                            this.#filling = true
                            this.#loadAdjacentSection(prevIdx)
                                .finally(() => {
                                    this.#filling = false
                                    this.dispatchEvent(new Event('stabilized'))
                                })
                        }
                    }
                }
            }
            debouncedScroll()
        })

        const opts = { passive: false }
        this.addEventListener('touchstart', this.#onTouchStart.bind(this), opts)
        this.addEventListener('touchmove', this.#onTouchMove.bind(this), opts)
        this.addEventListener('touchend', this.#onTouchEnd.bind(this))
        this.addEventListener('load', ({ detail: { doc } }) => {
            doc.addEventListener('touchstart', this.#onTouchStart.bind(this), opts)
            doc.addEventListener('touchmove', this.#onTouchMove.bind(this), opts)
            doc.addEventListener('touchend', this.#onTouchEnd.bind(this))
        })

        this.addEventListener('relocate', ({ detail }) => {
            if (detail.reason === 'selection') setSelectionTo(this.#anchor, 0)
            else if (detail.reason === 'navigation') {
                if (this.#anchor === 1) setSelectionTo(detail.range, 1)
                else if (typeof this.#anchor === 'number')
                    setSelectionTo(detail.range, -1)
                else setSelectionTo(this.#anchor, -1)
            }
        })
        const debugSelectionPaging = (event, detail = {}) => {
            const message = `[SelectionPaging] ${event} ${JSON.stringify(detail)}`
            console.log(message)
            try {
                globalThis.ReactNativeWebView?.postMessage(JSON.stringify({
                    type: 'debug',
                    message,
                }))
            } catch {}
        }
        const canSelectWithTouchHandles = globalThis.navigator?.maxTouchPoints > 0
        let lastSelectionPoint = null
        let edgeSelectionGrowth = null
        let selectionPagingGate = null
        const updateSelectionPoint = event => {
            const touch = event.changedTouches?.[0]
            const clientX = touch?.clientX ?? event.clientX
            const clientY = touch?.clientY ?? event.clientY
            if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return
            lastSelectionPoint = {
                clientX,
                clientY,
                time: performance.now(),
                type: event.type,
            }
        }
        const getMappedSelectionPoint = (range, backward) => {
            if (!lastSelectionPoint) return null
            const view = range.commonAncestorContainer?.ownerDocument?.defaultView
            const viewportSize = this.#vertical
                ? view?.innerHeight || view?.document?.documentElement?.clientHeight || 0
                : view?.innerWidth || view?.document?.documentElement?.clientWidth || 0
            if (!viewportSize) return null
            const visible = this.#getRectMapper()(range.getBoundingClientRect())
            const axisPoint = this.#vertical ? lastSelectionPoint.clientY : lastSelectionPoint.clientX
            const ratio = Math.max(0, Math.min(1, axisPoint / viewportSize))
            const logicalRatio = this.#rtl && !this.#vertical ? 1 - ratio : ratio
            const mappedPoint = visible.left + (visible.right - visible.left) * logicalRatio
            return {
                mappedPoint,
                visible,
                ratio,
                age: performance.now() - lastSelectionPoint.time,
                type: lastSelectionPoint.type,
                backward,
            }
        }
        const getSelectionTextLength = sel => sel.toString?.()?.trim?.()?.length ?? 0
        const getEdgeGrowth = (backward, mapped, visible) => {
            const now = performance.now()
            const edgePosition = Math.round(backward ? mapped.left : mapped.right)
            const direction = backward ? 'backward' : 'forward'
            if (!edgeSelectionGrowth
                || edgeSelectionGrowth.direction !== direction
                || Math.abs(edgeSelectionGrowth.visibleLeft - visible.left) > 4
                || Math.abs(edgeSelectionGrowth.visibleRight - visible.right) > 4
                || now - edgeSelectionGrowth.updatedAt > 2500) {
                edgeSelectionGrowth = {
                    direction,
                    edgePosition,
                    visibleLeft: visible.left,
                    visibleRight: visible.right,
                    baseLength: null,
                    currentLength: 0,
                    updatedAt: now,
                }
            }
            edgeSelectionGrowth.edgePosition = edgePosition
            edgeSelectionGrowth.updatedAt = now
            return edgeSelectionGrowth
        }
        const resetEdgeGrowth = () => {
            edgeSelectionGrowth = null
        }
        const lockSelectionPaging = (direction, textLength) => {
            selectionPagingGate = {
                direction,
                textLength,
                time: performance.now(),
            }
        }
        const shouldSkipSelectionPaging = (direction, textLength) => {
            if (!selectionPagingGate) return false
            const elapsed = performance.now() - selectionPagingGate.time
            if (elapsed > 1800 || selectionPagingGate.direction !== direction) {
                selectionPagingGate = null
                return false
            }
            return textLength >= selectionPagingGate.textLength - 8
        }
        const unlockSelectionPaging = () => {
            selectionPagingGate = null
        }
        const checkPointerSelection = debounce((range, sel) => {
            if (this.#navigationLocked) {
                debugSelectionPaging('skip', { reason: 'navigation-locked' })
                return
            }
            if (!sel.rangeCount) {
                debugSelectionPaging('skip', { reason: 'no-range' })
                return
            }
            const selRange = sel.getRangeAt(0)
            const backward = selectionIsBackward(sel)
            const direction = backward ? 'backward' : 'forward'
            const textLength = getSelectionTextLength(sel)
            if (shouldSkipSelectionPaging(direction, textLength)) {
                debugSelectionPaging('skip', { reason: 'selection-paging-gate', direction, textLength })
                return
            }
            if (backward && selRange.compareBoundaryPoints(Range.START_TO_START, range) < 0) {
                debugSelectionPaging('prev')
                lockSelectionPaging(direction, textLength)
                this.prev()
            }
            else if (!backward && selRange.compareBoundaryPoints(Range.END_TO_END, range) > 0) {
                debugSelectionPaging('next')
                lockSelectionPaging(direction, textLength)
                this.next()
            }
            else if (canSelectWithTouchHandles) {
                const rects = selRange.getClientRects()
                const rect = backward ? rects[0] : rects[rects.length - 1]
                const visible = this.#getRectMapper()(range.getBoundingClientRect())
                const edgeInset = Math.min(96, this.size * 0.2)
                const point = getMappedSelectionPoint(range, backward)
                if (point && point.age < 1500) {
                    debugSelectionPaging('pointer-edge-check', {
                        backward,
                        mappedPoint: Math.round(point.mappedPoint),
                        visibleLeft: Math.round(point.visible.left),
                        visibleRight: Math.round(point.visible.right),
                        edgeInset: Math.round(edgeInset),
                        ratio: Number(point.ratio.toFixed(3)),
                        age: Math.round(point.age),
                        type: point.type,
                    })
                    if (point.type !== 'touchstart'
                        && backward && point.mappedPoint <= point.visible.left + edgeInset) {
                        debugSelectionPaging('prev-edge', { source: 'pointer' })
                        lockSelectionPaging(direction, textLength)
                        this.prev()
                        return
                    }
                    if (point.type !== 'touchstart'
                        && !backward && point.mappedPoint >= point.visible.right - edgeInset) {
                        debugSelectionPaging('next-edge', { source: 'pointer' })
                        lockSelectionPaging(direction, textLength)
                        this.next()
                        return
                    }
                }
                if (!rect) {
                    debugSelectionPaging('skip', { reason: 'no-edge-rect' })
                    return
                }
                const mapped = this.#getRectMapper()(rect)
                const growth = getEdgeGrowth(backward, mapped, visible)
                growth.baseLength = growth.baseLength == null
                    ? textLength
                    : Math.min(growth.baseLength, textLength)
                growth.currentLength = textLength
                const selectionGrowth = textLength - growth.baseLength
                const growthInset = Math.min(128, this.size * 0.35)
                debugSelectionPaging('edge-check', {
                    backward,
                    mappedLeft: Math.round(mapped.left),
                    mappedRight: Math.round(mapped.right),
                    visibleLeft: Math.round(visible.left),
                    visibleRight: Math.round(visible.right),
                    edgeInset: Math.round(edgeInset),
                    textLength,
                    growth: selectionGrowth,
                    growthInset: Math.round(growthInset),
                })
                if (backward && mapped.left <= visible.left + edgeInset) {
                    debugSelectionPaging('prev-edge')
                    resetEdgeGrowth()
                    lockSelectionPaging(direction, textLength)
                    this.prev()
                }
                else if (!backward && mapped.right >= visible.right - edgeInset) {
                    debugSelectionPaging('next-edge')
                    resetEdgeGrowth()
                    lockSelectionPaging(direction, textLength)
                    this.next()
                }
                else if (!backward
                    && mapped.right >= visible.right - growthInset
                    && selectionGrowth >= 40) {
                    debugSelectionPaging('next-edge', { source: 'growth', textLength, growth: selectionGrowth })
                    resetEdgeGrowth()
                    lockSelectionPaging(direction, textLength)
                    this.next()
                }
                else if (!backward
                    && mapped.left <= visible.left + 2
                    && selectionGrowth >= 80) {
                    debugSelectionPaging('next-edge', { source: 'page-start-growth', textLength, growth: selectionGrowth })
                    resetEdgeGrowth()
                    lockSelectionPaging(direction, textLength)
                    this.next()
                }
                else if (backward
                    && mapped.left <= visible.left + growthInset
                    && selectionGrowth >= 40) {
                    debugSelectionPaging('prev-edge', { source: 'growth', textLength, growth: selectionGrowth })
                    resetEdgeGrowth()
                    lockSelectionPaging(direction, textLength)
                    this.prev()
                }
                else if (backward
                    && mapped.right >= visible.right - 2
                    && selectionGrowth >= 80) {
                    debugSelectionPaging('prev-edge', { source: 'page-end-growth', textLength, growth: selectionGrowth })
                    resetEdgeGrowth()
                    lockSelectionPaging(direction, textLength)
                    this.prev()
                }
            }
            else debugSelectionPaging('skip', { reason: 'not-touch-handles' })
        }, 700)
        this.addEventListener('load', ({ detail: { doc } }) => {
            let isPointerSelecting = false
            doc.addEventListener('pointerdown', () => isPointerSelecting = true)
            doc.addEventListener('pointermove', updateSelectionPoint)
            doc.addEventListener('pointerup', () => {
                isPointerSelecting = false
                resetEdgeGrowth()
                unlockSelectionPaging()
            })
            doc.addEventListener('pointercancel', () => {
                isPointerSelecting = false
                resetEdgeGrowth()
                unlockSelectionPaging()
            })
            doc.addEventListener('touchstart', event => {
                updateSelectionPoint(event)
                unlockSelectionPaging()
            }, { passive: true })
            doc.addEventListener('touchmove', updateSelectionPoint, { passive: true })
            let isKeyboardSelecting = false
            doc.addEventListener('keydown', () => isKeyboardSelecting = true)
            doc.addEventListener('keyup', () => isKeyboardSelecting = false)
            doc.addEventListener('selectionchange', () => {
                if (this.scrolled) {
                    debugSelectionPaging('selectionchange-skip', { reason: 'scrolled' })
                    return
                }
                const range = this.#lastVisibleRange
                if (!range) {
                    debugSelectionPaging('selectionchange-skip', { reason: 'no-last-visible-range' })
                    return
                }
                const sel = doc.getSelection()
                if (!sel.rangeCount) {
                    debugSelectionPaging('selectionchange-skip', { reason: 'no-range-count', type: sel.type })
                    return
                }
                if (isKeyboardSelecting) {
                    const selRange = sel.getRangeAt(0).cloneRange()
                    const backward = selectionIsBackward(sel)
                    if (!backward) selRange.collapse()
                    this.#scrollToAnchor(selRange)
                }
                else if ((isPointerSelecting || canSelectWithTouchHandles) && sel.type === 'Range') {
                    debugSelectionPaging('check', {
                        isPointerSelecting,
                        canSelectWithTouchHandles,
                        textLength: sel.toString?.()?.trim?.()?.length,
                    })
                    checkPointerSelection(range, sel)
                }
                else {
                    debugSelectionPaging('selectionchange-skip', {
                        reason: 'not-pointer-or-touch',
                        type: sel.type,
                        isPointerSelecting,
                        canSelectWithTouchHandles,
                    })
                }
            })
            doc.addEventListener('focusin', e => {
                if (this.scrolled) return null
                if (this.#container && this.#container.contains(e.target)) {
                    // NOTE: `requestAnimationFrame` is needed in WebKit
                    requestAnimationFrame(() => this.#scrollToAnchor(e.target))
                }
            })
        })

        this.#mediaQueryListener = () => {
            const view = this.#primaryView
            if (!view) return
            this.#replaceBackground()
        }
        this.#mediaQuery.addEventListener('change', this.#mediaQueryListener)
    }
    get #primaryView() {
        return this.#views.get(this.#primaryIndex)
    }
    get #sortedViews() {
        return [...this.#views.entries()].sort(([a], [b]) => a - b)
    }
    get primaryIndex() {
        return this.#primaryIndex
    }
    setAttribute(name, value) {
        // The scrolled-mode scroll handler is debounced, so #anchor and
        // #primaryIndex can lag behind the user's actual viewport by up to
        // ~250ms. Toggling out of scrolled mode within that window made
        // render() restore the stale anchor — reverting the position to a
        // previously visible section. Flush the pending scroll state here,
        // before the attribute change so the layout is still in scrolled
        // mode and `this.scrolled` (which reads the attribute) is still true.
        if (name === 'flow'
            && this.scrolled
            && String(value) !== 'scrolled'
            && this.#views.size > 0) {
            this.#flushScrolledState()
        }
        super.setAttribute(name, value)
    }
    #flushScrolledState() {
        if (this.#views.size > 1) this.#detectPrimaryView()
        const result = this.#getVisibleRange()
        if (result?.range && !result.range.collapsed) this.#anchor = result.range
    }
    attributeChangedCallback(name, _, value) {
        switch (name) {
            case 'flow':
                this.render()
                break
            case 'gap':
            case 'margin':
                this.#top.style.setProperty('--_margin-top', value)
                this.#top.style.setProperty('--_margin-right', value)
                this.#top.style.setProperty('--_margin-bottom', value)
                this.#top.style.setProperty('--_margin-left', value)
                this.render()
                break
            case 'margin-top':
            case 'margin-bottom':
            case 'margin-left':
            case 'margin-right':
            case 'max-block-size':
            case 'max-column-count':
                this.#top.style.setProperty('--_' + name, value)
                this.render()
                break
            case 'max-inline-size':
                // needs explicit `render()` as it doesn't necessarily resize
                this.#top.style.setProperty('--_' + name, value)
                this.render()
                break
            case 'no-continuous-scroll':
                if (this.noContinuousScroll) {
                    for (const [i] of this.#views) {
                        if (i !== this.#primaryIndex) this.#destroyView(i)
                    }
                }
                break
        }
    }
    open(book) {
        this.bookDir = book.dir
        this.sections = book.sections
        book.transformTarget?.addEventListener('data', ({ detail }) => {
            if (detail.type !== 'text/css') return
                detail.data = Promise.resolve(detail.data).then(data => data
                    // unprefix as most of the props are (only) supported unprefixed
                    .replace(/([{\s;])-epub-/gi, '$1')
                    // replace vw and vh as they cause problems with layout
                    .replace(/(\d*\.?\d+)vw/gi, (_, d) => `${parseFloat(d) * innerWidth / 100}px`)
                    .replace(/(\d*\.?\d+)vh/gi, (_, d) => `${parseFloat(d) * innerHeight / 100}px`)
                    // `page-break-*` unsupported in columns; replace with `column-break-*`
                .replace(/page-break-(after|before|inside)\s*:/gi, (_, x) =>
                    `-webkit-column-break-${x}:`)
                .replace(/break-(after|before|inside)\s*:\s*(avoid-)?page/gi, (_, x, y) =>
                    `break-${x}: ${y ?? ''}column`))
        })
    }
    #createView(index) {
        // Destroy existing view for this index if any
        const existing = this.#views.get(index)
        if (existing) {
            existing.destroy()
            this.#container.removeChild(existing.element)
            this.#views.delete(index)
        }
        const view = new View({
            container: this,
            onExpand: () => {
                // Only the primary view's resize should adjust scroll;
                // non-primary views (preloaded/adjacent) must not scroll
                if (this.#filling || this.#stabilizing || this.scrolled) return
                if (this.#primaryIndex === index)
                    this.#scrollToAnchor(this.#anchor)
            },
        })
        this.#views.set(index, view)
        const sorted = this.#sortedViews
        const myPos = sorted.findIndex(([i]) => i === index)
        const nextEntry = sorted[myPos + 1]
        if (nextEntry) this.#container.insertBefore(view.element, nextEntry[1].element)
        else this.#container.append(view.element)
        this.#syncA11y()
        return view
    }
    // Hide off-screen pre-loaded views from the accessibility tree so
    // screen-reader swipe-next does not wander into them (which would land
    // several pages into the next section instead of its first paragraph).
    //
    // Only `aria-hidden` is used — `inert` would also block pointer events
    // and text selection, which breaks visible non-primary views such as
    // the right column of a dual-page spread when each column belongs to
    // a different section (readest/readest#4243, readest/readest#4259).
    //
    // Visible non-primary views stay exposed to assistive tech because a
    // sighted user can read them on the same spread.
    #syncA11y() {
        const containerRect = this.#container.getBoundingClientRect()
        for (const [index, view] of this.#views) {
            const isPrimary = index === this.#primaryIndex
            const isVisible = isPrimary
                || isViewVisibleInContainer(
                    view.element.getBoundingClientRect(), containerRect)
            if (isVisible) view.element.removeAttribute('aria-hidden')
            else view.element.setAttribute('aria-hidden', 'true')
        }
    }
    #destroyView(index) {
        const view = this.#views.get(index)
        if (!view) return
        view.destroy()
        this.#container.removeChild(view.element)
        this.#views.delete(index)
        this.sections[index]?.unload?.()
    }
    #destroyAllViews() {
        for (const [index] of this.#views) this.#destroyView(index)
    }
    #clearViewsExcept(keepIndices) {
        for (const [index] of this.#views) {
            if (!keepIndices.has(index)) this.#destroyView(index)
        }
    }
    // Check if a section has the same writing direction as current primary.
    // Returns true if same or unknown (not yet cached).
    #isSameDirection(index) {
        if (!this.#directionCache.has(index)) return true
        return this.#directionCache.get(index) === this.#vertical
    }
    // Update the #background grid so each column shows the correct section's
    // background. Pass atPosition to pre-compute for a destination scroll
    // position (e.g. before an animation starts).
    #replaceBackground(atPosition) {
        const doc = this.#primaryView?.document
        if (!doc?.documentElement) return
        if (this.noBackground) return
        const htmlStyle = doc.defaultView.getComputedStyle(doc.documentElement)
        const themeBgColor = htmlStyle.getPropertyValue('--theme-bg-color')
        const overrideColor = htmlStyle.getPropertyValue('--override-color') === 'true'
        const bgTextureId = htmlStyle.getPropertyValue('--bg-texture-id')
        const isDarkMode = htmlStyle.getPropertyValue('color-scheme') === 'dark'
        const htmlBgColor = htmlStyle.backgroundColor
        const fallbackBg = themeBgColor || htmlBgColor || ''
        const hasTexture = !!bgTextureId && bgTextureId !== 'none'
        this.#top.style.setProperty(
            '--_scrollbar-track-bg',
            hasTexture ? 'transparent' : (fallbackBg || 'transparent'),
        )

        const resolveBackground = (background) => {
            if (!background) return fallbackBg
            if (themeBgColor) {
                const parsed = background.split(/\s(?=(?:url|rgb|hsl|#[0-9a-fA-F]{3,6}))/)
                if ((isDarkMode || overrideColor) && (bgTextureId === 'none' || !bgTextureId)) {
                    parsed[0] = themeBgColor
                }
                return parsed.join(' ')
            }
            return background
        }

        // Reset any inline backgrounds left over from a previous mode so the
        // host's texture isn't occluded after toggling.
        this.#background.style.background = ''
        for (const [, view] of this.#sortedViews) {
            view.element.style.background = ''
        }

        if (this.scrolled) {
            // In scrolled mode, set background directly on each view element
            // so it scrolls with the content. The static #background provides
            // the fallback color for margins and gaps between views.
            this.#background.innerHTML = ''
            this.#background.style.display = ''
            this.#background.style.background = hasTexture ? '' : fallbackBg
            for (const [, view] of this.#sortedViews) {
                const resolved = resolveBackground(view.docBackground)
                view.element.style.background = textureAwareBackground(resolved, hasTexture)
            }
            return
        }

        // Paint one full-bleed background segment per rendered view, positioned
        // so each tracks its content on screen. Rebuilding on every scroll keeps
        // the backgrounds glued to the content during a swipe drag — so when two
        // sections with different backgrounds are both visible, each half shows
        // its own colour instead of one flat colour flashing across the viewport.
        const bgRect = this.#background.getBoundingClientRect()
        const containerRect = this.#container.getBoundingClientRect()
        const startEdge = this.#vertical ? 'top' : 'left'
        const bgSize = bgRect[this.sideProp]
        const inset = containerRect[startEdge] - bgRect[startEdge]
        const scrollPos = Math.abs(atPosition ?? this.#renderedStart)
        const views = this.#sortedViews.map(([, view]) => ({
            size: view.element.getBoundingClientRect()[this.sideProp],
            bg: textureAwareBackground(resolveBackground(view.docBackground), hasTexture),
        }))
        const segments = computeBackgroundSegments(views, scrollPos, bgSize, inset, this.size)

        this.#background.innerHTML = ''
        this.#background.style.display = ''
        // Under a texture, leave the container transparent so the host texture
        // shows through the gaps a transparent page no longer fills (readest#4399).
        this.#background.style.background = hasTexture ? '' : fallbackBg

        const posProp = this.#vertical ? 'top' : 'left'
        const sizeProp = this.#vertical ? 'height' : 'width'
        const crossPosProp = this.#vertical ? 'left' : 'top'
        const crossSizeProp = this.#vertical ? 'width' : 'height'
        for (const { start, size, bg } of segments) {
            const seg = document.createElement('div')
            seg.style.position = 'absolute'
            seg.style[posProp] = `${start}px`
            seg.style[sizeProp] = `${size}px`
            seg.style[crossPosProp] = '0'
            seg.style[crossSizeProp] = '100%'
            seg.style.background = bg
            seg.style.backgroundAttachment = 'initial'
            this.#background.appendChild(seg)
        }
    }
    #beforeRender({ vertical, rtl }) {
        // If writing-mode is about to change, destroy all non-primary
        // views BEFORE updating global state. This prevents stale views
        // with the wrong direction from remaining in the container while
        // flex-direction / scrollProp / sideProp flip.
        if (this.#rendered && vertical !== this.#vertical) {
            for (const [i] of this.#views) {
                if (i !== this.#primaryIndex) this.#destroyView(i)
            }
        }
        this.#vertical = vertical
        this.#rtl = rtl
        this.#top.classList.toggle('vertical', vertical)
        this.#container.classList.toggle('vertical', vertical)

        const style = getComputedStyle(this.#top)
        const maxInlineSize = parseFloat(style.getPropertyValue('--_max-inline-size'))
        const maxColumnCount = parseInt(style.getPropertyValue('--_max-column-count-spread'))
        const marginTop = parseFloat(style.getPropertyValue('--_margin-top'))
        const marginRight = parseFloat(style.getPropertyValue('--_margin-right'))
        const marginBottom = parseFloat(style.getPropertyValue('--_margin-bottom'))
        const marginLeft = parseFloat(style.getPropertyValue('--_margin-left'))
        this.#marginTop = marginTop
        this.#marginBottom = marginBottom

        // Compute the column count from the host (Paginator) size rather than
        // the #container size. The container width depends on --_column-count
        // via the grid template (the outer 1fr tracks have a non-zero min for
        // multi-column spreads), so deriving the column count from container
        // size at threshold widths creates a feedback loop where the layout
        // oscillates between 1 and 2 columns on resize.
        const flow = this.getAttribute('flow')
        const hostRect = this.getBoundingClientRect()
        const hostSize = vertical ? hostRect.height : hostRect.width
        const divisor = flow === 'scrolled'
            ? 1
            : Math.min(
                maxColumnCount + (vertical ? 1 : 0),
                Math.ceil(Math.floor(hostSize) / Math.floor(maxInlineSize)),
            )
        // Set --_column-count BEFORE measuring the container so the read
        // below reflects the grid template that will actually be used.
        this.#top.style.setProperty('--_column-count', divisor)

        const { width, height } = this.#container.getBoundingClientRect()
        const size = vertical ? height : width

        const g = parseFloat(style.getPropertyValue('--_gap')) / 100
        // The gap will be a percentage of the #container, not the whole view.
        // This means the outer padding will be bigger than the column gap. Let
        // `a` be the gap percentage. The actual percentage for the column gap
        // will be (1 - a) * a. Let us call this `b`.
        //
        // To make them the same, we start by shrinking the outer padding
        // setting to `b`, but keep the column gap setting the same at `a`. Then
        // the actual size for the column gap will be (1 - b) * a. Repeating the
        // process again and again, we get the sequence
        //     x₁ = (1 - b) * a
        //     x₂ = (1 - x₁) * a
        //     ...
        // which converges to x = (1 - x) * a. Solving for x, x = a / (1 + a).
        // So to make the spacing even, we must shrink the outer padding with
        //     f(x) = x / (1 + x).
        // But we want to keep the outer padding, and make the inner gap bigger.
        // So we apply the inverse, f⁻¹ = -x / (x - 1) to the column gap.
        const gap = -g / (g - 1) * size

        if (flow === 'scrolled') {
            // FIXME: vertical-rl only, not -lr
            this.setAttribute('dir', vertical ? 'rtl' : 'ltr')
            this.#top.style.padding = '0'
            const columnWidth = maxInlineSize

            this.heads = null
            this.feet = null
            this.#header.replaceChildren()
            this.#footer.replaceChildren()

            this.columnCount = 1
            this.#replaceBackground()

            const layout = { width, height, flow, marginTop, marginRight, marginBottom, marginLeft, gap, columnWidth, columnCount: 1 }
            this.#lastLayout = layout
            return layout
        }

        const columnWidth = vertical
            ? (size / divisor - marginTop * 1.5 - marginBottom * 1.5)
            : (size / divisor - gap - marginRight / 2 - marginLeft / 2)
        this.setAttribute('dir', rtl ? 'rtl' : 'ltr')

        // set background to `doc` background
        // this is needed because the iframe does not fill the whole element
        this.columnCount = divisor
        this.#replaceBackground()

        const marginalDivisor = vertical
            ? Math.min(2, Math.ceil(Math.floor(width) / Math.floor(maxInlineSize)))
            : divisor
        const marginalStyle = {
            gridTemplateColumns: `repeat(${marginalDivisor}, 1fr)`,
            gap: `${gap}px`,
            direction: this.bookDir === 'rtl' ? 'rtl' : 'ltr',
        }
        Object.assign(this.#header.style, marginalStyle)
        Object.assign(this.#footer.style, marginalStyle)
        const heads = makeMarginals(marginalDivisor, 'head')
        const feet = makeMarginals(marginalDivisor, 'foot')
        this.heads = heads.map(el => el.children[0])
        this.feet = feet.map(el => el.children[0])
        this.#header.replaceChildren(...heads)
        this.#footer.replaceChildren(...feet)

        const layout = { width, height, marginTop, marginRight, marginBottom, marginLeft, gap, columnWidth, columnCount: divisor }
        this.#lastLayout = layout
        return layout
    }
    render() {
        if (this.#views.size === 0) return
        const primaryView = this.#primaryView
        if (!primaryView) return
        this.#stabilizing = true
        const layout = this.#beforeRender({
            vertical: this.#vertical,
            rtl: this.#rtl,
        })
        for (const [, view] of this.#views) {
            if (view.document) view.render(layout)
        }
        // Scroll synchronously to prevent visible layout shift during resize.
        // RAF deferral is only needed for initial display and mode switches
        // (handled by #display), not for resize re-renders.
        this.#scrollToAnchor(this.#anchor)
        this.#stabilizing = false
        this.dispatchEvent(new Event('stabilized'))
    }
    get scrolled() {
        return this.getAttribute('flow') === 'scrolled'
    }
    /** Public flag to disable touch/swipe navigation (e.g. during text selection) */
    get navigationLocked() {
        return this.#navigationLocked
    }
    set navigationLocked(value) {
        this.#navigationLocked = !!value
    }
    get noPreload() {
        return this.hasAttribute('no-preload')
    }
    get noBackground() {
        return this.hasAttribute('no-background')
    }
    get noContinuousScroll() {
        return this.scrolled && this.hasAttribute('no-continuous-scroll')
    }
    get scrollProp() {
        const { scrolled } = this
        return this.#vertical ? (scrolled ? 'scrollLeft' : 'scrollTop')
            : scrolled ? 'scrollTop' : 'scrollLeft'
    }
    get sideProp() {
        const { scrolled } = this
        return this.#vertical ? (scrolled ? 'width' : 'height')
            : scrolled ? 'height' : 'width'
    }
    get size() {
        return this.#container.getBoundingClientRect()[this.sideProp]
    }
    get viewSize() {
        const primaryView = this.#primaryView
        if (!primaryView) return 0
        return primaryView.element.getBoundingClientRect()[this.sideProp]
    }
    get start() {
        return this.#renderedStart - this.#getViewOffset(this.#primaryIndex)
    }
    get end() {
        return this.#renderedEnd - this.#getViewOffset(this.#primaryIndex)
    }
    get page() {
        return Math.floor(((this.start + this.end) / 2) / this.size)
    }
    get pages() {
        const primaryView = this.#primaryView
        if (!primaryView) return 0
        const viewSize = primaryView.element.getBoundingClientRect()[this.sideProp]
        return Math.round(viewSize / this.size)
    }
    get containerPosition() {
        return this.#container[this.scrollProp]
    }
    get isOverflowX() {
        return false
    }
    get isOverflowY() {
        return false
    }
    get #renderedViewSize() {
        if (this.#views.size === 0) return 0
        let total = 0
        for (const [, view] of this.#views)
            total += view.element.getBoundingClientRect()[this.sideProp]
        return total
    }
    get #renderedStart() {
        return Math.abs(this.#container[this.scrollProp])
    }
    get #renderedEnd() {
        return this.#renderedStart + this.size
    }
    get #renderedPage() {
        return Math.floor(((this.#renderedStart + this.#renderedEnd) / 2) / this.size)
    }
    get #renderedPages() {
        return Math.round(this.#renderedViewSize / this.size)
    }
    set containerPosition(newVal) {
        this.#container[this.scrollProp] = newVal
    }
    set scrollLocked(value) {
        this.#scrollLocked = value
    }

    scrollBy(dx, dy) {
        const delta = this.#vertical ? dy : dx
        const [offset, a, b] = this.#scrollBounds
        const rtl = this.#rtl
        const min = rtl ? offset - b : offset - a
        const max = rtl ? offset + a : offset + b
        this.containerPosition = Math.max(min, Math.min(max,
            this.containerPosition + delta))
    }

    // vx, vy: velocity at the end of the swipe (pixels per ms)
    // dx, dy: total distance swiped
    // dt: total time of the swipe (ms)
    snap(vx, vy, dx, dy, dt) {
        const velocity = this.#vertical ? vy : vx
        const avgVelocity = this.#vertical ? dy / dt : dx / dt
        const horizontal = Math.abs(vx) * 2 > Math.abs(vy)
        const orthogonal = this.#vertical ? !horizontal : horizontal
        const [offset, a, b] = this.#scrollBounds
        const size = this.size
        const start = this.#renderedStart
        const end = this.#renderedEnd
        const pages = this.#renderedPages
        const min = Math.abs(offset) - a
        const max = Math.abs(offset) + b
        const snapping = this.hasAttribute('animated') && !this.hasAttribute('eink')
        const v =  snapping ? velocity : avgVelocity
        const d = v * (this.#rtl ? -size : size) * (orthogonal ? 1 : 0)
        const snapOffset = (isNaN(d) ? 0 : snapping ? d * 2 : d * 10)
        const page = Math.floor(Math.max(min, Math.min(max, (start + end) / 2 + snapOffset)) / size)
        const dir = page < 0 ? -1 : page >= pages ? 1 : null
        const doGoTo = () => {
            if (!dir) return
            const sorted = this.#sortedViews
            const edgeIndex = dir < 0
                ? sorted[0]?.[0] ?? this.#primaryIndex
                : sorted[sorted.length - 1]?.[0] ?? this.#primaryIndex
            return this.#goTo({
                index: this.#adjacentIndex(dir, edgeIndex),
                anchor: dir < 0 ? () => 1 : () => 0,
            })
        }
        // Out of range — skip animation, go straight to adjacent section
        if (dir) return doGoTo()
        this.#scrollToPage(page, 'snap')
    }
    #onTouchStart(e) {
        if (this.#navigationLocked) return
        const contents = this.getContents?.() ?? []
        for (const { doc } of contents) {
            const selection = doc?.getSelection?.()
            if (selection && !selection.isCollapsed && selection.toString().trim()) return
        }
        const touch = e.changedTouches[0]
        this.#touchState = {
            x: touch?.screenX, y: touch?.screenY,
            t: e.timeStamp,
            vx: 0, xy: 0,
            dx: 0, dy: 0,
            dt: 0,
            startX: touch?.screenX,
            startY: touch?.screenY,
            didPreventDefault: false,
        }
        // Hint to browser that scrolling will occur for better GPU layer management
        const pv = this.#primaryView
        if (pv?.element) {
            pv.element.style.willChange = 'transform'
        }
    }
    #onTouchMove(e) {
        const state = this.#touchState
        if (this.#navigationLocked || !state) return
        const contents = this.getContents?.() ?? []
        for (const { doc } of contents) {
            const selection = doc?.getSelection?.()
            if (selection && !selection.isCollapsed && selection.toString().trim()) return
        }
        if (state.pinched) return
        state.pinched = globalThis.visualViewport.scale > 1
        if (this.scrolled || state.pinched) return
        // When the host opts out of swipe-to-paginate, let touch events reach
        // native behavior (text selection, etc.) without us tracking or
        // pre-empting them.
        if (this.hasAttribute('no-swipe')) return
        if (e.touches.length > 1) {
            if (this.#touchScrolled) e.preventDefault()
            return
        }
        const touch = e.changedTouches[0]
        const isStylus = touch.touchType === 'stylus'
        const totalDx = Math.abs(touch.screenX - (state.startX ?? touch.screenX))
        const totalDy = Math.abs(touch.screenY - (state.startY ?? touch.screenY))
        if (!state.axisLocked && (totalDx > 10 || totalDy > 10)) {
            if (totalDy > totalDx * 1.3) {
                state.axisLocked = 'y'
                state.aborted = true
            } else {
                state.axisLocked = 'x'
            }
        }
        if (state.aborted) return
        if (!isStylus && (totalDx > 10 || totalDy > 10 || state.didPreventDefault)) {
            e.preventDefault()
            state.didPreventDefault = true
        }
        if (this.#scrollLocked) return
        const x = touch.screenX, y = touch.screenY
        const dx = state.x - x, dy = state.y - y
        const dt = e.timeStamp - state.t
        state.x = x
        state.y = y
        state.t = e.timeStamp
        state.vx = dx / dt
        state.vy = dy / dt
        state.dx += dx
        state.dy += dy
        state.dt += dt
        this.#touchScrolled = true
        if (!this.hasAttribute('animated') || this.hasAttribute('eink')) return
        if (!this.#vertical && Math.abs(state.dx) >= Math.abs(state.dy) && !this.hasAttribute('eink') && (!isStylus || Math.abs(dx) > 1)) {
            this.scrollBy(dx, 0)
        } else if (this.#vertical && Math.abs(state.dx) < Math.abs(state.dy) && !this.hasAttribute('eink') && (!isStylus || Math.abs(dy) > 1)) {
            this.scrollBy(0, dy)
        }
    }
    #onTouchEnd() {
        // Remove will-change hint to free GPU resources
        // if (this.#view?.element) {
        //     this.#view.element.style.willChange = 'auto'
        // }

        if (!this.#touchScrolled) return
        this.#touchScrolled = false
        if (this.scrolled || this.#navigationLocked) return
        if (this.hasAttribute('no-swipe')) return

        // XXX: Firefox seems to report scale as 1... sometimes...?
        // at this point I'm basically throwing `requestAnimationFrame` at
        // anything that doesn't work
        requestAnimationFrame(() => {
            if (globalThis.visualViewport.scale === 1) {
                const { vx, vy, dx, dy, dt } = this.#touchState
                this.snap(vx, vy, dx, dy, dt)
            }
        })
    }
    // allows one to process rects as if they were LTR and horizontal
    #getRectMapper(view) {
        if (this.scrolled) {
            const size = view ? view.element.getBoundingClientRect()[this.sideProp] : this.#renderedViewSize
            const marginTop = this.#marginTop
            const marginBottom = this.#marginBottom
            return this.#vertical
                ? ({ left, right }) =>
                    ({ left: size - right - marginTop, right: size - left - marginBottom })
                : ({ top, bottom }) => ({ left: top - marginTop, right: bottom - marginBottom })
        }
        const pxSize = view
            ? view.element.getBoundingClientRect()[this.sideProp]
            : this.#renderedPages * this.size
        if (this.#rtl) {
            return ({ left, right }) =>
                ({ left: pxSize - right, right: pxSize - left })
        }
        if (this.#vertical) return ({ top, bottom }) => ({ left: top, right: bottom })
        return f => f
    }
    async #scrollToRect(rect, reason) {
        const primaryView = this.#primaryView
        const mapRect = this.#getRectMapper(primaryView)
        const localOffset = getMappedRectStart(rect, mapRect)
        if (localOffset === null) return

        if (this.scrolled) {
            // rect is in iframe-local coordinates; add view offset
            // to convert to container scroll coordinates
            const viewOffset = this.#getViewOffset(this.#primaryIndex)
            return this.#scrollTo(viewOffset + localOffset - 3, reason)
        }

        // rect is in iframe-local column coordinates. Convert to a rendered
        // spread by adding the primary view's column offset within that spread.
        const viewOffset = this.#getViewOffset(this.#primaryIndex)
        const pagesBeforeView = this.#getPagesBeforeView(this.#primaryIndex)
        const columnSize = this.size / this.columnCount
        if (!columnSize) return
        const viewStartColumn = Math.floor((viewOffset - pagesBeforeView * this.size) / columnSize + 0.01)
        const anchorColumn = Math.floor(localOffset / columnSize + 0.01)
        const page = pagesBeforeView + Math.floor((viewStartColumn + anchorColumn) / this.columnCount)
        return this.#scrollToPage(page, reason)
    }
    async #scrollTo(offset, reason, smooth) {
        const { size } = this
        if (this.containerPosition === offset) {
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
            return
        }
        // FIXME: vertical-rl only, not -lr
        if (this.scrolled && this.#vertical) offset = -offset
        if ((reason === 'snap' || smooth) && this.hasAttribute('animated') && !this.hasAttribute('eink')) {
            const startPosition = this.containerPosition
            this.#isAnimating = true
            // For a large section the CSS-transform animation blocks the UI while
            // Blink composites the oversized layer; animate the native scroll
            // offset instead (incremental/tiled, like a swipe), keeping the
            // per-page backgrounds synced each frame.
            if (this.#renderedViewSize > RAF_ANIMATE_SCROLL_THRESHOLD) {
                return rafAnimateScroll(startPosition, offset, 300, easeOutQuad, x => {
                    this.#container[this.scrollProp] = x
                    if (!this.scrolled) this.#replaceBackground()
                }).then(() => {
                    this.#isAnimating = false
                    this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
                    this.#afterScroll(reason)
                })
            }
            // Slide the per-view backgrounds in lockstep with the content. The
            // content animates via a transform on each view; we re-sync the
            // backgrounds to that animated offset every frame so each page's
            // colour stays glued to its content as it slides. Pre-setting the
            // destination instead made the outgoing page lose its background the
            // instant the animation started, flashing the wrong colour across
            // the part of the screen it still covered until it slid off.
            if (!this.scrolled) {
                this.#replaceBackground(startPosition)
                const child = this.#container.children[0]
                const syncBackground = () => {
                    if (!this.#isAnimating) return
                    const transform = child && getComputedStyle(child).transform
                    const tx = transform && transform !== 'none'
                        ? new DOMMatrix(transform)[this.#vertical ? 'm42' : 'm41'] : 0
                    this.#replaceBackground(startPosition - tx)
                    requestAnimationFrame(syncBackground)
                }
                requestAnimationFrame(syncBackground)
            }
            // Use GPU-accelerated scroll animation for smoother experience on high refresh rate screens
            return cssAnimateScroll(
                this.#container,
                this.scrollProp,
                startPosition,
                offset,
                300,
            ).then(() => {
                this.#isAnimating = false
                this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
                this.#afterScroll(reason)
            })
        } else {
            this.containerPosition = offset
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
        }
    }
    async #scrollToPage(page, reason, smooth) {
        const offset = this.size * (this.#rtl ? -page : page)
        return this.#scrollTo(offset, reason, smooth)
    }
    async scrollToAnchor(anchor, select, smooth) {
        return this.#scrollToAnchor(anchor, select ? 'selection' : 'navigation', smooth)
    }
    async #scrollToAnchor(anchor, reason = 'anchor', smooth = false) {
        this.#anchor = anchor
        const rects = uncollapse(anchor)?.getClientRects?.()
        // if anchor is an element or a range
        if (rects) {
            // when the start of the range is immediately after a hyphen in the
            // previous column, there is an extra zero width rect in that column
            const rect = pickAnchorRect(rects, this.#getRectMapper(this.#primaryView))
            if (!rect) return
            await this.#scrollToRect(rect, reason)
            // focus the element when navigating with keyboard or screen reader
            if (reason === 'navigation') {
                let node = anchor.focus ? anchor : undefined
                if (!node && anchor.startContainer) {
                    node = anchor.startContainer
                    if (node.nodeType === Node.TEXT_NODE) {
                        node = node.parentElement
                    }
                }
                if (node && node.focus) {
                    node.tabIndex = -1
                    node.style.outline = 'none'
                    node.focus({ preventScroll: true })
                }
            }
            return
        }
        // if anchor is a fraction
        if (this.scrolled) {
            // In scrolled mode with multi-view, offset to the primary view's position
            const primaryOffset = this.#getViewOffset(this.#primaryIndex)
            const primaryView = this.#primaryView
            const primarySize = primaryView
                ? primaryView.element.getBoundingClientRect()[this.sideProp] : this.#renderedViewSize
            await this.#scrollTo(primaryOffset + anchor * primarySize, reason, smooth)
            return
        }
        // In paginated mode, account for pages before the primary section
        const primaryView = this.#primaryView
        if (!primaryView) return
        const pagesBeforePrimary = this.#getPagesBeforeView(this.#primaryIndex)
        const textPages = primaryView.contentPages
        if (!textPages) return
        // textPages is in column units; convert to spread page for scrolling
        const newColumn = Math.round(anchor * (textPages - 1))
        const newSpreadPage = Math.floor(newColumn / this.columnCount)
        await this.#scrollToPage(pagesBeforePrimary + newSpreadPage, reason, smooth)
    }
    // Get the pixel offset of a view within the container
    #getViewOffset(index) {
        let offset = 0
        for (const [i, view] of this.#sortedViews) {
            if (i === index) return offset
            offset += view.element.getBoundingClientRect()[this.sideProp]
        }
        return offset
    }
    // Get number of full pages (spreads) before a given view.
    // Uses floor so the view's first column is always on or after
    // the returned page — never rounded past it. The 0.01 tolerance
    // absorbs sub-pixel drift on fractional-DPR devices where
    // getBoundingClientRect() accumulates ~0.0001px errors.
    #getPagesBeforeView(index) {
        return Math.floor(this.#getViewOffset(index) / this.size + 0.01)
    }
    #getVisibleRange() {
        const targetView = this.#primaryView
        if (!targetView?.document) return
        const viewOffset = this.#getViewOffset(this.#primaryIndex)
        if (this.scrolled) {
            // In scrolled mode, the primary view may be scrolled out of
            // the viewport at a section boundary. Try all visible views
            // and return the first valid (non-collapsed) range.
            for (const [index, v] of this.#sortedViews) {
                if (!v.document) continue
                const off = this.#getViewOffset(index)
                const vSize = v.element.getBoundingClientRect()[this.sideProp]
                // Skip views entirely outside the viewport
                if (off + vSize <= this.#renderedStart || off >= this.#renderedEnd) continue
                const range = getVisibleRange(v.document,
                    this.#renderedStart - off, this.#renderedEnd - off,
                    this.#getRectMapper(v))
                if (range && !range.collapsed) return { range, index }
            }
            return
        }
        const range = getVisibleRange(targetView.document,
            this.#renderedStart - viewOffset,
            this.#renderedEnd - viewOffset,
            this.#getRectMapper(targetView))
        return range ? { range, index: this.#primaryIndex } : undefined
    }
    // Determine which view is primary based on scroll position
    #detectPrimaryView() {
        if (this.#views.size <= 1) return
        const visibleStart = this.#renderedStart
        let offset = 0
        for (const [index, view] of this.#sortedViews) {
            const viewSize = view.element.getBoundingClientRect()[this.sideProp]
            if (visibleStart < offset + viewSize - 1) {
                if (index !== this.#primaryIndex) {
                    this.#primaryIndex = index
                    this.#syncA11y()
                    this.#trimDistantViews()
                    this.#replaceBackground()
                    this.#fillPromise = this.#preloadNext()
                }
                return
            }
            offset += viewSize
        }
    }
    // Pre-load adjacent sections from the current primary so the
    // next/prev sections are ready when the user paginates.
    // Does NOT re-scroll to avoid fighting with the user's current
    // scroll position.
    async #preloadNext() {
        if (this.noPreload || this.noContinuousScroll) return
        this.#filling = true
        try {
            const { size } = this
            const minPages = 5
            const maxSections = 8
            // Load forward sections until we have enough pages ahead
            let iterations = 0
            while (this.#views.size < maxSections && iterations < maxSections) {
                iterations++
                const pagesAhead = size > 0
                    ? Math.floor((this.#renderedViewSize - this.#renderedEnd) / size)
                    : 0
                if (pagesAhead >= minPages) break
                const sorted = this.#sortedViews
                const lastIndex = sorted[sorted.length - 1]?.[0]
                if (lastIndex == null) break
                const nextIdx = this.#adjacentIndex(1, lastIndex)
                if (nextIdx == null) break
                // Stop preloading at writing-mode boundaries
                if (!this.#isSameDirection(nextIdx)) break
                await this.#loadAdjacentSection(nextIdx)
                if (!this.#views.has(nextIdx)) break
            }
            // Wait a frame so ResizeObserver callbacks fire while
            // #filling is still true, preventing onExpand from
            // re-scrolling to a stale anchor position.
            await new Promise(r => requestAnimationFrame(r))
        } finally {
            this.#filling = false
            this.dispatchEvent(new Event('stabilized'))
        }
    }
    #afterScroll(reason) {
        // In multi-view, detect which section is primary
        if (this.#views.size > 1 && reason !== 'anchor' && reason !== 'navigation') {
            this.#detectPrimaryView()
            // Scrolling can bring a previously off-screen view into the
            // viewport (e.g. the next section's first column joining the
            // current section's last column in a dual-page spread) without
            // changing which view is primary. Re-sync a11y attributes so
            // a newly visible view stops being aria-hidden.
            this.#syncA11y()
        }
        const { range, index: visibleIndex } = this.#getVisibleRange() || {}
        if (!range) return
        this.#lastVisibleRange = range
        // don't set new anchor if relocation was to scroll to anchor
        if (reason !== 'selection' && reason !== 'navigation' && reason !== 'anchor')
            this.#anchor = range
        else this.#justAnchored = true

        const index = visibleIndex ?? this.#primaryIndex
        const primaryView = this.#primaryView
        const detail = { reason, range, index }
        if (this.scrolled) {
            const primaryOffset = this.#getViewOffset(index)
            const primarySize = primaryView
                ? primaryView.element.getBoundingClientRect()[this.sideProp] : this.#renderedViewSize
            detail.fraction = primarySize > 0
                ? Math.max(0, Math.min(1, (this.#renderedStart - primaryOffset) / primarySize)) : 0
        } else if (this.#renderedPages > 0 && primaryView) {
            const page = this.#renderedPage
            const pagesBeforePrimary = this.#getPagesBeforeView(index)
            const textPages = primaryView.contentPages
            this.#header.style.visibility = page > 0 ? 'visible' : 'hidden'
            // page is in spread units, textPages is in column units
            const localPage = page - pagesBeforePrimary
            const localColumn = localPage * this.columnCount
            detail.fraction = textPages > 0 ? Math.max(0, Math.min(1, localColumn / textPages)) : 0
            detail.size = textPages > 0 ? this.columnCount / textPages : 1
            if (reason === 'container-scroll' && localPage === 0) return
        }
        // Update per-column backgrounds for the current scroll position
        if (!this.scrolled) this.#replaceBackground()
        this.dispatchEvent(new CustomEvent('relocate', { detail }))
    }
    async #display(promise) {
        this.#stabilizing = true
        this.#container.style.opacity = '0'
        const { index, src, data, anchor, onLoad, select } = await promise
        this.#primaryIndex = index
        this.#syncA11y()
        const hasFocus = this.#primaryView?.document?.hasFocus()
        if (src) {
            const view = this.#createView(index)
            const afterLoad = doc => {
                if (doc.head) {
                    const $styleBefore = doc.createElement('style')
                    doc.head.prepend($styleBefore)
                    const $style = doc.createElement('style')
                    doc.head.append($style)
                    this.sections[index].spineProperties?.forEach(
                        prop => doc.documentElement.setAttribute('data-' + prop, ''))
                    this.#styleMap.set(doc, [$styleBefore, $style])
                }
                onLoad?.({ doc, index, primary: true })
            }
            const beforeRender = this.#beforeRender.bind(this)
            await view.load(src, data, afterLoad, beforeRender)
            // Cache direction for future preload boundary checks
            if (view.document) {
                const dir = getDirection(view.document)
                this.#directionCache.set(index, dir.vertical)
            }
            this.dispatchEvent(new CustomEvent('create-overlayer', {
                detail: {
                    doc: view.document, index,
                    attach: overlayer => view.overlayer = overlayer,
                },
            }))
        }
        // Pre-load previous section when needed:
        // - Short primary alignment (section shorter than one spread)
        // - Scrolled mode with anchor in top half — so the user can
        //   scroll backward into the previous section immediately
        const primaryView = this.#primaryView
        if (!this.noPreload && !this.noContinuousScroll && primaryView) {
            const needsPrev = (primaryView.contentPages > 0 && primaryView.contentPages < this.columnCount)
            if (needsPrev || this.scrolled) {
                const sorted = this.#sortedViews
                const firstIndex = sorted[0]?.[0]
                if (firstIndex != null) {
                    const prevIdx = this.#adjacentIndex(-1, firstIndex)
                    if (prevIdx != null && this.#isSameDirection(prevIdx)) {
                        await this.#loadAdjacentSection(prevIdx)
                    }
                }
            }
        }
        const resolvedAnchor = (typeof anchor === 'function'
            ? anchor(primaryView.document) : anchor) ?? 0
        await this.scrollToAnchor(resolvedAnchor, select)
        if (hasFocus) this.focusView()
        // Reveal content now that primary section is positioned
        this.#container.style.opacity = '1'
        this.#rendered = true
        // Emit stabilized so listeners can react, but keep #stabilizing
        // true until fill completes to prevent the debounced scroll
        // handler from loading backward sections during rapid DOM changes.
        this.dispatchEvent(new Event('stabilized'))
        // Load remaining adjacent sections progressively (non-blocking).
        // In scrolled mode, skip reanchor — browser scroll anchoring
        // preserves position when content is added above/below.
        this.#fillPromise = this.#fillVisibleArea(
            { reanchor: !this.scrolled })
        this.#fillPromise.then(() => { this.#stabilizing = false })
    }
    // Load an adjacent section without changing primary index
    async #loadAdjacentSection(index) {
        if (this.#views.has(index) || !this.#canGoToIndex(index)) return
        const section = this.sections[index]
        if (!section || section.linear === 'no') return
        // Detect a prepend: a section being inserted *above* every currently
        // loaded view in scrolled mode. The browser suppresses scroll
        // anchoring while scrollTop is 0, so the inserted section would push
        // the visible content down and the viewport would drift into the
        // previous section (readest/readest#4112). Capture the scroll position
        // before the insertion so it can be restored once the view renders.
        const firstIndex = this.#sortedViews[0]?.[0]
        const isPrepend = this.scrolled && firstIndex != null && index < firstIndex
        const startBefore = isPrepend ? this.#renderedStart : 0
        try {
            const src = await section.load()
            const data = await section.loadContent?.()
            const view = this.#createView(index)
            const afterLoad = doc => {
                if (doc.head) {
                    const $styleBefore = doc.createElement('style')
                    doc.head.prepend($styleBefore)
                    const $style = doc.createElement('style')
                    doc.head.append($style)
                    section.spineProperties?.forEach(
                        prop => doc.documentElement.setAttribute('data-' + prop, ''))
                    this.#styleMap.set(doc, [$styleBefore, $style])
                }
                this.setStyles(this.#styles)
                this.dispatchEvent(new CustomEvent('load', { detail: { doc, index, primary: false } }))
            }
            // Adjacent sections reuse the primary view's cached layout
            // — they must NOT call #beforeRender, which would modify
            // global state (direction, CSS classes, dir attribute, etc.).
            const cachedLayout = this.#lastLayout
            const beforeRender = () => cachedLayout
            await view.load(src, data, afterLoad, beforeRender)
            // Cache direction for future preload boundary checks
            if (view.document) {
                const dir = getDirection(view.document)
                this.#directionCache.set(index, dir.vertical)
                // Destroy views with a different writing-mode immediately.
                // Mixed-direction views corrupt scroll/page calculations.
                if (dir.vertical !== this.#vertical) {
                    this.#destroyView(index)
                    return
                }
            }
            // Keep the previously visible content anchored: the new view added
            // `addedSize` px above it, so the scroll position must grow by the
            // same amount. This corrects the browser's scroll-anchoring
            // suppression at scrollTop 0 and is a no-op when anchoring already
            // handled the shift (correction ≈ 0).
            if (isPrepend) {
                const addedSize = view.element.getBoundingClientRect()[this.sideProp]
                const correction = startBefore + addedSize - this.#renderedStart
                if (Math.abs(correction) > 0.5)
                    this.containerPosition += (this.#vertical ? -1 : 1) * correction
            }
            this.dispatchEvent(new CustomEvent('create-overlayer', {
                detail: {
                    doc: view.document, index,
                    attach: overlayer => view.overlayer = overlayer,
                },
            }))
        } catch (e) {
            console.warn(e)
            console.warn(new Error(`Failed to load adjacent section ${index}`))
        }
    }
    // Fill adjacent sections until at least `minPages` pages exist
    // beyond the current viewport in each direction (forward always,
    // backward only when the primary section is short).
    // When reanchor is false (background pre-loading), skip re-scrolling
    // to avoid fighting with the user's current scroll position.
    async #fillVisibleArea({ reanchor = true } = {}) {
        if (this.noPreload || this.noContinuousScroll || this.#filling) return
        this.#filling = true
        try {
            const { size } = this
            if (!size) return
            const minPages = 5
            const maxSections = 8

            // If the primary section is shorter than one spread and
            // there's no section already loaded before it, load the
            // previous section to fill the leading columns
            const primaryView = this.#primaryView
            if (primaryView && primaryView.contentPages > 0
                && primaryView.contentPages < this.columnCount) {
                const sorted = this.#sortedViews
                const firstIndex = sorted[0]?.[0]
                if (firstIndex != null && firstIndex >= this.#primaryIndex) {
                    const prevIdx = this.#adjacentIndex(-1, firstIndex)
                    if (prevIdx != null && this.#isSameDirection(prevIdx)) {
                        await this.#loadAdjacentSection(prevIdx)
                    }
                }
            }

            // Load forward sections until we have enough pages ahead
            let iterations = 0
            while (this.#views.size < maxSections && iterations < maxSections) {
                iterations++
                const pagesAhead = Math.floor(
                    (this.#renderedViewSize - this.#renderedEnd) / size)
                if (pagesAhead >= minPages) break
                const sorted = this.#sortedViews
                const lastIndex = sorted[sorted.length - 1]?.[0]
                if (lastIndex == null) break
                const nextIdx = this.#adjacentIndex(1, lastIndex)
                if (nextIdx == null) break
                // Stop at writing-mode boundaries
                if (!this.#isSameDirection(nextIdx)) break
                await this.#loadAdjacentSection(nextIdx)
                if (!this.#views.has(nextIdx)) break
            }
            if (reanchor) this.#scrollToAnchor(this.#anchor)
        } finally {
            this.#filling = false
            // Emit stabilized so post-layout processing (e.g. warichu)
            // runs for newly loaded adjacent sections.
            this.dispatchEvent(new Event('stabilized'))
        }
    }
    // Trim views whose content is entirely more than 10 pages away
    // from the current viewport. Only removes views AFTER the primary
    // — removing views before would shift scroll position.
    #trimDistantViews() {
        const { size } = this
        if (!size) return
        const maxDistance = size * 10
        const viewportEnd = this.#renderedEnd
        for (const [index, view] of this.#sortedViews) {
            if (index <= this.#primaryIndex) continue
            const offset = this.#getViewOffset(index)
            if (offset - viewportEnd > maxDistance) {
                this.#destroyView(index)
            }
        }
    }
    #canGoToIndex(index) {
        return index >= 0 && index <= this.sections.length - 1
    }
    async #goTo({ index, anchor, select }) {
        // Check if the target section has a different writing-mode.
        // If direction changes, we must destroy all views and do a full
        // rebuild via #display — mixed-direction views cannot coexist.
        let directionChanged = false
        if (this.#views.has(index)) {
            const view = this.#views.get(index)
            if (view?.document) {
                const { vertical } = getDirection(view.document)
                directionChanged = vertical !== this.#vertical
            }
        } else if (this.#directionCache.has(index)) {
            directionChanged = this.#directionCache.get(index) !== this.#vertical
        }
        // When direction is unknown (not cached), #beforeRender will
        // detect and clean up stale views if a change actually occurs.

        if (this.#views.has(index) && !directionChanged) {
            // View already loaded — reuse it without
            // clearing/reloading. Just change primary and scroll.
            this.#stabilizing = true
            // Continuous scrolled mode keeps the target view rendered, so we
            // scroll straight to it without fading the container — fading
            // produced a hard blank-screen flash on adjacent navigation
            // (readest/readest#4112 follow-up). Paginated mode and discrete
            // no-continuous-scroll still fade to hide the page reposition.
            const blank = !this.scrolled || this.noContinuousScroll
            if (blank) this.#container.style.opacity = '0'
            const hasFocus = this.#primaryView?.document?.hasFocus()
            this.#primaryIndex = index
            this.#syncA11y()
            this.#trimDistantViews()
            // In noContinuousScroll mode, destroy all non-primary views
            if (this.noContinuousScroll) {
                for (const [i] of this.#views) {
                    if (i !== index) this.#destroyView(i)
                }
            }
            const primaryView = this.#primaryView
            const resolvedAnchor = (typeof anchor === 'function'
                ? anchor(primaryView.document) : anchor) ?? 0
            // Pre-load the previous section so the user can move backward right
            // away: a short paginated primary needs it to fill the leading
            // columns; scrolled mode needs it so scrolling up reveals the
            // previous section instead of dead-ending at the top (the debounced
            // backward-preload can't cover this — it bails while navigation is
            // stabilizing). Paginated must load it before revealing; scrolled
            // mode loads it after the scroll so the transition stays instant,
            // with #loadAdjacentSection compensation keeping the viewport
            // anchored as the section is inserted above.
            const needsPrev = primaryView && primaryView.contentPages > 0
                && primaryView.contentPages < this.columnCount
            const loadPrev = async () => {
                if (this.noPreload || this.noContinuousScroll) return
                if (!(needsPrev || this.scrolled)) return
                const firstIndex = this.#sortedViews[0]?.[0]
                if (firstIndex == null) return
                const prevIdx = this.#adjacentIndex(-1, firstIndex)
                if (prevIdx != null && this.#isSameDirection(prevIdx))
                    await this.#loadAdjacentSection(prevIdx)
            }
            if (!this.scrolled) await loadPrev()
            await this.scrollToAnchor(resolvedAnchor, select)
            if (this.scrolled) await loadPrev()
            if (blank) this.#container.style.opacity = '1'
            if (hasFocus) this.focusView()
            // Load remaining adjacent sections progressively;
            // keep #stabilizing true until fill completes
            this.#fillPromise = this.#fillVisibleArea()
            this.#fillPromise.then(() => { this.#stabilizing = false })
        } else {
            // When direction changes, clear ALL views — no reuse possible
            // across writing-mode boundaries. When direction is unknown
            // (not yet cached), keep nearby views; #beforeRender will
            // clean up if the loaded section turns out to differ.
            if (directionChanged) {
                this.#destroyAllViews()
            } else {
                const keep = new Set([index])
                if (!this.noContinuousScroll) {
                    for (const [i] of this.#views) {
                        if (Math.abs(i - index) <= 2) keep.add(i)
                    }
                }
                this.#clearViewsExcept(keep)
            }
            const oldIndex = this.#primaryIndex
            const onLoad = detail => {
                if (oldIndex >= 0 && !this.#views.has(oldIndex))
                    this.sections[oldIndex]?.unload?.()
                this.setStyles(this.#styles)
                this.dispatchEvent(new CustomEvent('load', { detail }))
            }
            await this.#display(Promise.resolve(this.sections[index].load())
                .then(async src => {
                    const data = await this.sections[index].loadContent?.()
                    return { index, src, data, anchor, onLoad, select }
                }).catch(e => {
                    console.warn(e)
                    console.warn(new Error(`Failed to load section ${index}`))
                    return {}
                }))
        }
    }
    async goTo(target) {
        if (this.#locked) return
        const resolved = await target
        if (this.#canGoToIndex(resolved.index)) return this.#goTo(resolved)
    }
    #scrollPrev(distance) {
        if (this.#views.size === 0) return true
        if (this.scrolled) {
            if (this.#renderedStart > 0) return this.#scrollTo(
                Math.max(0, this.#renderedStart - (distance ?? this.size)), null, true)
            return !this.atStart
        }
        if (this.atStart) return
        const page = this.#renderedPage - 1
        // Out of range — skip animation, go straight to previous section
        if (page < 0) return true
        return this.#scrollToPage(page, 'page', true)
    }
    #scrollNext(distance) {
        if (this.#views.size === 0) return true
        if (this.scrolled) {
            if (this.#renderedViewSize - this.#renderedEnd > 2) return this.#scrollTo(
                Math.min(this.#renderedViewSize, distance ? this.#renderedStart + distance : this.#renderedEnd), null, true)
            return !this.atEnd
        }
        if (this.atEnd) return
        const page = this.#renderedPage + 1
        const pages = this.#renderedPages
        // Out of range — skip animation, go straight to next section
        if (page >= pages) return true
        return this.#scrollToPage(page, 'page', true)
    }
    get atStart() {
        const sorted = this.#sortedViews
        const firstIndex = sorted[0]?.[0] ?? this.#primaryIndex
        if (this.scrolled) return this.#adjacentIndex(-1, firstIndex) == null && this.#renderedStart <= 0
        return this.#adjacentIndex(-1, firstIndex) == null && this.#renderedPage <= 0
    }
    get atEnd() {
        const sorted = this.#sortedViews
        const lastIndex = sorted[sorted.length - 1]?.[0] ?? this.#primaryIndex
        if (this.scrolled) return this.#adjacentIndex(1, lastIndex) == null && this.#renderedViewSize - this.#renderedEnd <= 2
        return this.#adjacentIndex(1, lastIndex) == null && this.#renderedPage >= this.#renderedPages - 1
    }
    #adjacentIndex(dir, fromIndex) {
        if (fromIndex === undefined) fromIndex = this.#primaryIndex
        for (let index = fromIndex + dir; this.#canGoToIndex(index); index += dir)
            if (this.sections[index]?.linear !== 'no') return index
    }
    async #turnPage(dir, distance) {
        if (this.#locked) return
        this.#locked = true
        const prev = dir === -1
        const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))
        if (shouldGo) {
            // Wait for any in-progress background pre-loading to complete —
            // it may already be loading the section we need, so awaiting
            // it lets #goTo reuse the view instead of loading from scratch
            if (this.#fillPromise) await this.#fillPromise
            const sorted = this.#sortedViews
            const edgeIndex = prev
                ? sorted[0]?.[0] ?? this.#primaryIndex
                : sorted[sorted.length - 1]?.[0] ?? this.#primaryIndex
            await this.#goTo({
                index: this.#adjacentIndex(dir, edgeIndex),
                anchor: prev ? () => 1 : () => 0,
            })
        }
        if (shouldGo || !this.hasAttribute('animated')) await wait(100)
        this.#locked = false
    }
    async prev(distance) {
        return await this.#turnPage(-1, distance)
    }
    async next(distance) {
        return await this.#turnPage(1, distance)
    }
    async pan(dx, dy) {
        if (this.#locked) return
        this.#locked = true
        this.scrollBy(dx, dy)
        this.#locked = false
    }
    prevSection() {
        return this.goTo({ index: this.#adjacentIndex(-1) })
    }
    nextSection() {
        return this.goTo({ index: this.#adjacentIndex(1) })
    }
    firstSection() {
        const index = this.sections.findIndex(section => section.linear !== 'no')
        return this.goTo({ index })
    }
    lastSection() {
        const index = this.sections.findLastIndex(section => section.linear !== 'no')
        return this.goTo({ index })
    }
    getContents() {
        const contents = []
        for (const [index, view] of this.#sortedViews) {
            if (view.document) contents.push({
                index,
                overlayer: view.overlayer,
                doc: view.document,
            })
        }
        return contents
    }
    setStyles(styles) {
        this.#styles = styles
        for (const [, view] of this.#views) {
            const $$styles = this.#styleMap.get(view.document)
            if (!$$styles) continue
            const [$beforeStyle, $style] = $$styles
            if (Array.isArray(styles)) {
                const [beforeStyle, style] = styles
                $beforeStyle.textContent = beforeStyle
                $style.textContent = style
            } else $style.textContent = styles

            // needed because the resize observer doesn't work in Firefox
            view.document?.fonts?.ready?.then(() => view.expand())
        }

        // NOTE: needs `requestAnimationFrame` in Chromium
        const primaryView = this.#primaryView
        if (primaryView) {
            requestAnimationFrame(() => this.#replaceBackground())
        }
    }
    focusView() {
        this.#primaryView?.document?.defaultView?.focus()
    }
    showLoupe(winX, winY, { isVertical, color, gap, margin, radius, magnification }) {
        this.#primaryView?.showLoupe(winX, winY, { isVertical, color, gap, margin, radius, magnification })
    }
    hideLoupe() {
        this.#primaryView?.hideLoupe()
    }
    destroyLoupe() {
        this.#primaryView?.destroyLoupe()
    }
    destroy() {
        this.#observer.unobserve(this)
        this.#destroyAllViews()
        this.#mediaQuery.removeEventListener('change', this.#mediaQueryListener)
    }
}

if (!customElements.get('foliate-paginator')) customElements.define('foliate-paginator', Paginator)
