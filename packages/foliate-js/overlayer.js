const createSVGElement = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);

export class Overlayer {
  #svg = createSVGElement("svg");
  #defs = createSVGElement("defs");
  #content = createSVGElement("g");
  #holeMask = null;
  #holeId = `foliate-overlayer-hole-${Math.random().toString(36).slice(2)}`;
  #map = new Map();
  constructor() {
    Object.assign(this.#svg.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
    });
    this.#svg.append(this.#defs, this.#content);
  }
  get element() {
    return this.#svg;
  }
  add(key, range, draw, options) {
    if (this.#map.has(key)) this.remove(key);
    const resolvedRange = typeof range === "function" ? range(this.#svg.getRootNode()) : range;
    const rects = resolvedRange.getClientRects();
    const element = draw(rects, options);
    this.#content.append(element);
    this.#map.set(key, { range: resolvedRange, draw, options, element, rects });
  }
  remove(key) {
    if (!this.#map.has(key)) return;
    this.#map.get(key).element.remove();
    this.#map.delete(key);
  }
  redraw() {
    for (const obj of this.#map.values()) {
      const { range, draw, options, element } = obj;
      element.remove();
      const rects = range.getClientRects();
      const el = draw(rects, options);
      this.#content.append(el);
      obj.element = el;
      obj.rects = rects;
    }
  }
  setHole(x, y, width, height, radius = 0) {
    if (!this.#holeMask) {
      const mask = createSVGElement("mask");
      mask.id = this.#holeId;
      mask.setAttribute("maskUnits", "userSpaceOnUse");
      mask.setAttribute("x", "0");
      mask.setAttribute("y", "0");
      mask.setAttribute("width", "100%");
      mask.setAttribute("height", "100%");

      const visible = createSVGElement("rect");
      visible.setAttribute("x", "0");
      visible.setAttribute("y", "0");
      visible.setAttribute("width", "100%");
      visible.setAttribute("height", "100%");
      visible.setAttribute("fill", "white");

      const hole = createSVGElement("rect");
      hole.setAttribute("fill", "black");
      mask.append(visible, hole);
      this.#defs.append(mask);
      this.#content.setAttribute("mask", `url(#${this.#holeId})`);
      this.#holeMask = { mask, hole };
    }

    this.#holeMask.hole.setAttribute("x", x);
    this.#holeMask.hole.setAttribute("y", y);
    this.#holeMask.hole.setAttribute("width", width);
    this.#holeMask.hole.setAttribute("height", height);
    this.#holeMask.hole.setAttribute("rx", radius);
    this.#holeMask.hole.setAttribute("ry", radius);
  }
  clearHole() {
    this.#content.removeAttribute("mask");
    this.#holeMask?.mask.remove();
    this.#holeMask = null;
  }
  hitTest({ x, y }) {
    const arr = Array.from(this.#map.entries());
    // loop in reverse to hit more recently added items first
    for (let i = arr.length - 1; i >= 0; i--) {
      const [key, obj] = arr[i];
      for (const { left, top, right, bottom } of obj.rects)
        if (top <= y && left <= x && bottom > y && right > x) return [key, obj.range];
    }
    return [];
  }
  static underline(rects, options = {}) {
    const { color = "red", width: strokeWidth = 2, writingMode } = options;
    const g = createSVGElement("g");
    g.setAttribute("fill", color);
    if (writingMode === "vertical-rl" || writingMode === "vertical-lr")
      for (const { right, top, height } of rects) {
        const el = createSVGElement("rect");
        el.setAttribute("x", right - strokeWidth);
        el.setAttribute("y", top);
        el.setAttribute("height", height);
        el.setAttribute("width", strokeWidth);
        g.append(el);
      }
    else
      for (const { left, bottom, width } of rects) {
        const el = createSVGElement("rect");
        el.setAttribute("x", left);
        el.setAttribute("y", bottom - strokeWidth);
        el.setAttribute("height", strokeWidth);
        el.setAttribute("width", width);
        g.append(el);
      }
    return g;
  }
  static strikethrough(rects, options = {}) {
    const { color = "red", width: strokeWidth = 2, writingMode } = options;
    const g = createSVGElement("g");
    g.setAttribute("fill", color);
    if (writingMode === "vertical-rl" || writingMode === "vertical-lr")
      for (const { right, left, top, height } of rects) {
        const el = createSVGElement("rect");
        el.setAttribute("x", (right + left) / 2);
        el.setAttribute("y", top);
        el.setAttribute("height", height);
        el.setAttribute("width", strokeWidth);
        g.append(el);
      }
    else
      for (const { left, top, bottom, width } of rects) {
        const el = createSVGElement("rect");
        el.setAttribute("x", left);
        el.setAttribute("y", (top + bottom) / 2);
        el.setAttribute("height", strokeWidth);
        el.setAttribute("width", width);
        g.append(el);
      }
    return g;
  }
  static squiggly(rects, options = {}) {
    const { color = "red", width: strokeWidth = 2, writingMode } = options;
    const g = createSVGElement("g");
    g.setAttribute("fill", "none");
    g.setAttribute("stroke", color);
    g.setAttribute("stroke-width", strokeWidth);
    const block = strokeWidth * 1.5;
    if (writingMode === "vertical-rl" || writingMode === "vertical-lr")
      for (const { right, top, height } of rects) {
        const el = createSVGElement("path");
        const n = Math.round(height / block / 1.5);
        const inline = height / n;
        const ls = Array.from({ length: n }, (_, i) => `l${i % 2 ? -block : block} ${inline}`).join(
          "",
        );
        el.setAttribute("d", `M${right} ${top}${ls}`);
        g.append(el);
      }
    else
      for (const { left, bottom, width } of rects) {
        const el = createSVGElement("path");
        const n = Math.round(width / block / 1.5);
        const inline = width / n;
        const ls = Array.from({ length: n }, (_, i) => `l${inline} ${i % 2 ? block : -block}`).join(
          "",
        );
        el.setAttribute("d", `M${left} ${bottom}${ls}`);
        g.append(el);
      }
    return g;
  }
  static highlight(rects, options = {}) {
    const { color = "red" } = options;
    const g = createSVGElement("g");
    g.setAttribute("fill", color);
    g.style.opacity = "var(--overlayer-highlight-opacity, .3)";
    g.style.mixBlendMode = "var(--overlayer-highlight-blend-mode, normal)";
    for (const { left, top, height, width } of rects) {
      const el = createSVGElement("rect");
      el.setAttribute("x", left);
      el.setAttribute("y", top);
      el.setAttribute("height", height);
      el.setAttribute("width", width);
      g.append(el);
    }
    return g;
  }
  static outline(rects, options = {}) {
    const { color = "red", width: strokeWidth = 3, radius = 3 } = options;
    const g = createSVGElement("g");
    g.setAttribute("fill", "none");
    g.setAttribute("stroke", color);
    g.setAttribute("stroke-width", strokeWidth);
    for (const { left, top, height, width } of rects) {
      const el = createSVGElement("rect");
      el.setAttribute("x", left);
      el.setAttribute("y", top);
      el.setAttribute("height", height);
      el.setAttribute("width", width);
      el.setAttribute("rx", radius);
      g.append(el);
    }
    return g;
  }
  static arrow(rects, options = {}) {
    const {
      color = "red",
      size = 20,
      animated = true,
      autoHide = true,
      hideDelay = 5000,
      offset = 10,
    } = options;
    const g = createSVGElement("g");

    // 获取第一个矩形（文本开始位置）
    const firstRect = rects[0];
    if (!firstRect) return g;

    // 计算箭头位置和大小
    const arrowSize = Math.min(size, firstRect.height * 0.8);
    const centerY = firstRect.top + firstRect.height / 2;
    const arrowX = firstRect.left - offset - arrowSize;

    // 创建右箭头路径 (三角形指向右侧，指向文本)
    const arrow = createSVGElement("path");
    const arrowPath = `M ${arrowX + arrowSize} ${centerY}
                          L ${arrowX} ${centerY - arrowSize / 2}
                          L ${arrowX + arrowSize * 0.3} ${centerY}
                          L ${arrowX} ${centerY + arrowSize / 2}
                          Z`;

    arrow.setAttribute("d", arrowPath);
    arrow.setAttribute("fill", color);
    arrow.setAttribute("stroke", color);
    arrow.setAttribute("stroke-width", "1");

    // 添加动画类名
    if (animated) {
      arrow.classList.add("foliate-arrow-indicator");

      // 注入CSS动画样式到文档头部
      const doc = arrow.ownerDocument || document;
      if (!doc.getElementById("foliate-arrow-styles")) {
        const style = doc.createElement("style");
        style.id = "foliate-arrow-styles";
        style.textContent = `
                    .foliate-arrow-indicator {
                        animation: foliateArrowBlink 0.8s ease-in-out 3, 
                                  foliateArrowSlideIn 0.5s ease-out;
                        transform-origin: center;
                    }
                    
                    @keyframes foliateArrowBlink {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.3; }
                    }
                    
                    @keyframes foliateArrowSlideIn {
                        0% { 
                            opacity: 0; 
                            transform: translateX(-20px);
                        }
                        100% { 
                            opacity: 1; 
                            transform: translateX(0);
                        }
                    }
                    
                    .foliate-arrow-fadeout {
                        animation: foliateArrowFadeOut 1s ease-out forwards;
                    }
                    
                    @keyframes foliateArrowFadeOut {
                        0% { opacity: 1; }
                        100% { opacity: 0; }
                    }
                `;
        doc.head.appendChild(style);
      }

      // 自动隐藏功能
      if (autoHide && hideDelay > 0) {
        setTimeout(() => {
          arrow.classList.add("foliate-arrow-fadeout");
          setTimeout(() => {
            if (arrow.parentNode) {
              arrow.parentNode.removeChild(arrow);
            }
          }, 1000); // 等待淡出动画完成
        }, hideDelay);
      }
    }

    g.append(arrow);
    return g;
  }
  // make an exact copy of an image in the overlay
  // one can then apply filters to the entire element, without affecting them;
  // it's a bit silly and probably better to just invert images twice
  // (though the color will be off in that case if you do heu-rotate)
  static copyImage([rect], options = {}) {
    const { src } = options;
    const image = createSVGElement("image");
    const { left, top, height, width } = rect;
    image.setAttribute("href", src);
    image.setAttribute("x", left);
    image.setAttribute("y", top);
    image.setAttribute("height", height);
    image.setAttribute("width", width);
    return image;
  }
}
