const NS = {
  XML: "http://www.w3.org/XML/1998/namespace",
  SSML: "http://www.w3.org/2001/10/synthesis",
};

const getAttributeNS = (node, namespace, name) =>
  typeof node?.getAttributeNS === "function" ? node.getAttributeNS(namespace, name) : null;

const blockTags = new Set([
  "article",
  "aside",
  "audio",
  "blockquote",
  "caption",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "dd",
  "figure",
  "footer",
  "form",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "math",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "tr",
]);

const getLang = (el) => {
  const x = el?.lang || getAttributeNS(el, NS.XML, "lang");
  return x ? x : el.parentElement ? getLang(el.parentElement) : null;
};

const getAlphabet = (el) => {
  const x = getAttributeNS(el, NS.XML, "lang");
  return x ? x : el.parentElement ? getAlphabet(el.parentElement) : null;
};

const getSegmenter = (lang = "en", granularity = "word") => {
  const segmenter = new Intl.Segmenter(lang, { granularity });
  const granularityIsWord = granularity === "word";
  return function* (strs, makeRange) {
    const str = strs.join("").replace(/\r\n/g, "  ").replace(/\r/g, " ").replace(/\n/g, " ");
    let name = 0;
    let strIndex = -1;
    let sum = 0;
    const rawSegments = Array.from(segmenter.segment(str));
    const segments = [];
    for (let i = 0; i < rawSegments.length; i++) {
      const current = rawSegments[i];
      const next = rawSegments[i + 1];
      const endsWithAbbreviation = /(?:^|\s)([A-Z][a-z]{1,5})\.$/.test(current.segment.trim());
      const nextStartsWithCapital = /^[A-Z]/.test(next?.segment?.trim() || "");
      if (endsWithAbbreviation && nextStartsWithCapital) {
        segments.push({
          index: current.index,
          segment: current.segment + (next?.segment || ""),
          isWordLike: true,
        });
        i++;
      } else {
        segments.push(current);
      }
    }
    for (const { index, segment, isWordLike } of segments) {
      if (granularityIsWord && !isWordLike) continue;
      while (sum <= index) sum += strs[++strIndex].length;
      const startIndex = strIndex;
      const startOffset = index - (sum - strs[strIndex].length);
      const end = index + segment.length - 1;
      if (end < str.length) while (sum <= end) sum += strs[++strIndex].length;
      const endIndex = strIndex;
      const endOffset = end - (sum - strs[strIndex].length) + 1;
      yield [(name++).toString(), makeRange(startIndex, startOffset, endIndex, endOffset)];
    }
  };
};

const fragmentToSSML = (fragment, nodeFilter, inherited) => {
  const ssml = document.implementation.createDocument(NS.SSML, "speak");
  const { lang } = inherited;
  if (lang) ssml.documentElement.setAttributeNS(NS.XML, "lang", lang);

  const convert = (node, parent, inheritedAlphabet) => {
    if (!node) return;
    if (node.nodeType === 3) return ssml.createTextNode(node.textContent);
    if (node.nodeType === 4) return ssml.createCDATASection(node.textContent);
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (nodeFilter && nodeFilter(node) === NodeFilter.FILTER_REJECT) return;

    let el;
    const nodeName = node.nodeName.toLowerCase();
    if (nodeName === "rt" || nodeName === "rp") return;
    if (nodeName === "foliate-mark") {
      el = ssml.createElementNS(NS.SSML, "mark");
      el.setAttribute("name", node.dataset.name);
    } else if (nodeName === "br") el = ssml.createElementNS(NS.SSML, "break");
    else if (nodeName === "em" || nodeName === "strong")
      el = ssml.createElementNS(NS.SSML, "emphasis");

    const lang = node.lang || getAttributeNS(node, NS.XML, "lang");
    if (lang) {
      if (!el) el = ssml.createElementNS(NS.SSML, "lang");
      el.setAttributeNS(NS.XML, "lang", lang);
    }

    const alphabet = getAttributeNS(node, NS.SSML, "alphabet") || inheritedAlphabet;
    if (!el) {
      const ph = getAttributeNS(node, NS.SSML, "ph");
      if (ph) {
        el = ssml.createElementNS(NS.SSML, "phoneme");
        if (alphabet) el.setAttribute("alphabet", alphabet);
        el.setAttribute("ph", ph);
      }
    }

    if (!el) el = parent;

    let child = node.firstChild;
    while (child) {
      const childEl = convert(child, el, alphabet);
      if (childEl && el !== childEl) el.append(childEl);
      child = child.nextSibling;
    }
    return el;
  };
  convert(fragment, ssml.documentElement, inherited.alphabet);
  return ssml;
};

const getFragmentWithMarks = (range, textWalker, nodeFilter, granularity) => {
  const lang = getLang(range.commonAncestorContainer);
  const alphabet = getAlphabet(range.commonAncestorContainer);

  const segmenter = getSegmenter(lang, granularity);
  const fragment = range.cloneContents();

  // we need ranges on both the original document (for highlighting)
  // and the document fragment (for inserting marks)
  // so unfortunately need to do it twice, as you can't copy the ranges
  const entries = [...textWalker(range, segmenter, nodeFilter)];
  const fragmentEntries = [...textWalker(fragment, segmenter, nodeFilter)];

  for (const [name, range] of fragmentEntries) {
    const mark = document.createElement("foliate-mark");
    mark.dataset.name = name;
    range.insertNode(mark);
  }
  const ssml = fragmentToSSML(fragment, nodeFilter, { lang, alphabet });
  return { entries, ssml };
};

const getRangeTextWithoutRuby = (range) => {
  const fragment = range.cloneContents();
  const doc = fragment.ownerDocument || document;
  const walker = doc.createTreeWalker(
    fragment,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION,
    {
      acceptNode: (node) => {
        if (node.nodeType === 1) {
          const name = node.nodeName.toLowerCase();
          if (name === "rt" || name === "rp" || name === "script" || name === "style")
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  let text = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) text += n.nodeValue || "";
  return text;
};

const rangeIsEmpty = (range) => !getRangeTextWithoutRuby(range).trim();
const normalizeRangeText = (range) => getRangeTextWithoutRuby(range).replace(/\s+/g, " ").trim();
const endsAfterStart = (candidate, target) => {
  const end = candidate.cloneRange();
  end.collapse(false);
  // A point exactly at the previous sentence's end belongs to the next sentence.
  return end.comparePoint(target.startContainer, target.startOffset) < 0;
};

function* getDetailRanges(doc, textWalker, nodeFilter) {
  for (const blockRange of getBlocks(doc)) {
    const { entries } = getFragmentWithMarks(blockRange, textWalker, nodeFilter, "sentence");
    for (const [, range] of entries) {
      if (!rangeIsEmpty(range)) yield range;
    }
  }
}

function* getBlocks(doc) {
  let last;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const name = node.tagName.toLowerCase();
    if (blockTags.has(name)) {
      if (last) {
        last.setEndBefore(node);
        if (!rangeIsEmpty(last)) yield last;
      }
      last = doc.createRange();
      last.setStart(node, 0);
    }
  }
  if (!last) {
    last = doc.createRange();
    last.setStart(doc.body.firstChild ?? doc.body, 0);
  }
  last.setEndAfter(doc.body.lastChild ?? doc.body);
  if (!rangeIsEmpty(last)) yield last;
}

class ListIterator {
  #arr = [];
  #iter;
  #index = -1;
  #f;
  constructor(iter, f = (x) => x) {
    this.#iter = iter;
    this.#f = f;
  }
  current() {
    if (this.#arr[this.#index]) return this.#f(this.#arr[this.#index]);
  }
  first() {
    const newIndex = 0;
    if (this.#arr[newIndex]) {
      this.#index = newIndex;
      return this.#f(this.#arr[newIndex]);
    }
    return this.next();
  }
  last() {
    for (const value of this.#iter) this.#arr.push(value);
    const newIndex = this.#arr.length - 1;
    if (this.#arr[newIndex]) {
      this.#index = newIndex;
      return this.#f(this.#arr[newIndex]);
    }
  }
  prev() {
    const newIndex = this.#index - 1;
    if (this.#arr[newIndex]) {
      this.#index = newIndex;
      return this.#f(this.#arr[newIndex]);
    }
  }
  next() {
    const newIndex = this.#index + 1;
    if (this.#arr[newIndex]) {
      this.#index = newIndex;
      return this.#f(this.#arr[newIndex]);
    }
    while (true) {
      const { done, value } = this.#iter.next();
      if (done) break;
      this.#arr.push(value);
      if (this.#arr[newIndex]) {
        this.#index = newIndex;
        return this.#f(this.#arr[newIndex]);
      }
    }
  }
  #ensure(index) {
    while (this.#arr[index] == null) {
      const { done, value } = this.#iter.next();
      if (done) break;
      this.#arr.push(value);
      if (this.#arr.length - 1 >= index) break;
    }
    return this.#arr[index];
  }
  prepare() {
    const newIndex = this.#index + 1;
    if (this.#arr[newIndex]) return this.#f(this.#arr[newIndex]);
    while (true) {
      const { done, value } = this.#iter.next();
      if (done) break;
      this.#arr.push(value);
      if (this.#arr[newIndex]) return this.#f(this.#arr[newIndex]);
    }
  }
  peek(count = 1, offset = 1) {
    if (count <= 0) return [];
    const startIndex = Math.max(this.#index + offset, 0);
    const results = [];
    const endIndex = startIndex + count;
    for (let idx = startIndex; idx < endIndex; idx++) {
      const value = this.#arr[idx] ?? this.#ensure(idx);
      if (!value) break;
      results.push(this.#f(value));
    }
    return results;
  }
  find(f) {
    const index = this.#arr.findIndex((x) => f(x));
    if (index > -1) {
      this.#index = index;
      return this.#f(this.#arr[index]);
    }
    while (true) {
      const { done, value } = this.#iter.next();
      if (done) break;
      this.#arr.push(value);
      if (f(value)) {
        this.#index = this.#arr.length - 1;
        return this.#f(value);
      }
    }
  }
}

export class TTS {
  #list;
  #detailList;
  #detailContext = null;
  #ranges = new Map();
  #lastMark;
  #lastRange;
  #getCfi;
  #textWalker;
  #nodeFilter;
  #serializer = new XMLSerializer();
  constructor(doc, textWalker, nodeFilter, highlight, granularity = "word", getCfi = null) {
    this.doc = doc;
    this.#getCfi = getCfi;
    this.#textWalker = textWalker;
    this.#nodeFilter = nodeFilter;
    this.highlight = highlight || (() => null);
    this.#list = new ListIterator(getBlocks(doc), (range) => {
      const { entries, ssml } = getFragmentWithMarks(range, textWalker, nodeFilter, granularity);
      this.#ranges = new Map(entries);
      return [ssml, range];
    });
    this.#detailList = new ListIterator(getDetailRanges(doc, textWalker, nodeFilter), (range) => [
      normalizeRangeText(range),
      range,
    ]);
  }
  #getMarkElement(doc, mark) {
    if (!mark) return null;
    return doc.querySelector(`mark[name="${CSS.escape(mark)}"]`);
  }
  #syncDetailByRange(range) {
    if (!range) return;
    if (this.#getCfi) {
      const targetCfi = this.#getCfi(range.cloneRange());
      if (targetCfi) {
        this.#detailList.find((candidate) => {
          const candidateCfi = this.#getCfi(candidate.cloneRange());
          return candidateCfi === targetCfi;
        });
        return;
      }
    }
    this.#detailList.find(
      (candidate) =>
        candidate.compareBoundaryPoints(Range.START_TO_START, range) === 0 &&
        candidate.compareBoundaryPoints(Range.END_TO_END, range) === 0,
    );
  }
  #ensureCurrentDetailEntry() {
    return this.#detailList.current() ?? this.#detailList.first() ?? this.#detailList.next();
  }
  #detailResultFrom(entry, { highlight = false } = {}) {
    if (!entry) return null;
    const [text, range] = entry;
    if (!text || !range) return null;
    let cfi = null;
    if (highlight && range.cloneRange) {
      const clonedRange = range.cloneRange();
      cfi = this.highlight(clonedRange) ?? null;
      this.#lastRange = clonedRange.cloneRange ? clonedRange.cloneRange() : clonedRange;
    }
    if (!cfi && this.#getCfi && range.cloneRange) {
      cfi = this.#getCfi(range.cloneRange());
    }
    if (!this.#lastRange && range.cloneRange) {
      this.#lastRange = range.cloneRange();
    }
    return { text, cfi };
  }
  #speak(doc, getNode) {
    if (!doc) return;
    if (!getNode) return this.#serializer.serializeToString(doc);
    const ssml = document.implementation.createDocument(NS.SSML, "speak");
    ssml.documentElement.replaceWith(ssml.importNode(doc.documentElement, true));
    let node = getNode(ssml)?.previousSibling;
    while (node) {
      const next = node.previousSibling ?? node.parentNode?.previousSibling;
      node.parentNode.removeChild(node);
      node = next;
    }
    return this.#serializer.serializeToString(ssml);
  }
  start() {
    this.#lastMark = null;
    const [doc, range] = this.#list.first() ?? [];
    this.#syncDetailByRange(range);
    if (!doc) return this.next();
    return this.#speak(doc, (ssml) => this.#getMarkElement(ssml, this.#lastMark));
  }
  resume() {
    const [doc] = this.#list.current() ?? [];
    if (!doc) return this.next();
    return this.#speak(doc, (ssml) => this.#getMarkElement(ssml, this.#lastMark));
  }
  prev(paused) {
    this.#lastMark = null;
    const [doc, range] = this.#list.prev() ?? [];
    this.#syncDetailByRange(range);
    if (paused && range) this.highlight(range.cloneRange());
    return this.#speak(doc);
  }
  next(paused) {
    this.#lastMark = null;
    const [doc, range] = this.#list.next() ?? [];
    this.#syncDetailByRange(range);
    if (paused && range) this.highlight(range.cloneRange());
    return this.#speak(doc);
  }
  end() {
    this.#lastMark = null;
    const [doc, range] = this.#list.last() ?? [];
    this.#syncDetailByRange(range);
    if (!doc) return this.next();
    return this.#speak(doc);
  }
  prepare() {
    const [doc] = this.#list.prepare() ?? [];
    return this.#speak(doc);
  }
  from(range) {
    this.#lastMark = null;
    const [doc] = this.#list.find((blockRange) => endsAfterStart(blockRange, range)) ?? [];
    this.#detailList.find((detailRange) => endsAfterStart(detailRange, range));
    let mark;
    for (const [name, range_] of this.#ranges.entries())
      if (endsAfterStart(range_, range)) {
        mark = name;
        break;
      }
    this.#lastMark = mark ?? null;
    console.log("[FoliateTTS][from]", {
      requestedText: range?.toString?.().replace(/\s+/g, " ").trim().slice(0, 80) ?? "",
      matchedBlock: !!doc,
      mark,
      blockSentenceCount: this.#ranges.size,
    });
    return this.#speak(doc, (ssml) => this.#getMarkElement(ssml, mark));
  }

  currentBlockDetails(count = Number.POSITIVE_INFINITY) {
    const entries = [...this.#ranges.entries()];
    const start = this.#lastMark
      ? Math.max(
          0,
          entries.findIndex(([name]) => name === this.#lastMark),
        )
      : 0;
    const details = [];
    for (const [, range] of entries.slice(start < 0 ? 0 : start, start + count)) {
      const text = normalizeRangeText(range);
      if (!text || !this.#getCfi || !range.cloneRange) continue;
      try {
        const cfi = this.#getCfi(range.cloneRange());
        if (cfi) details.push({ text, cfi });
      } catch {
        // A sentence without a stable CFI cannot be navigated from the UI.
      }
    }
    return details;
  }
  nextBlockDetails(count = Number.POSITIVE_INFINITY) {
    const before = this.currentBlockDetails(Number.POSITIVE_INFINITY);
    const beforeBlock = {
      count: before.length,
      first: before[0] ?? null,
      last: before[before.length - 1] ?? null,
      lastMark: this.#lastMark,
    };
    console.log("[FoliateTTS][next-block] before", beforeBlock);
    const ssml = this.next();
    if (!ssml) {
      console.log("[FoliateTTS][next-block] after", {
        hasSsml: false,
        before: beforeBlock,
        count: 0,
        first: null,
        last: null,
        lastMark: this.#lastMark,
      });
      return [];
    }
    const details = this.currentBlockDetails(count);
    console.log("[FoliateTTS][next-block] after", {
      hasSsml: true,
      before: beforeBlock,
      count: details.length,
      first: details[0] ?? null,
      last: details[details.length - 1] ?? null,
      lastMark: this.#lastMark,
    });
    return details;
  }
  peekNextBlockDetails(count = Number.POSITIVE_INFINITY) {
    let advanced = false;
    try {
      const ssml = this.next();
      if (!ssml) return [];
      advanced = true;
      return this.currentBlockDetails(count);
    } finally {
      if (advanced) this.prev();
    }
  }
  setMark(mark) {
    const range = this.#ranges.get(mark);
    if (range) {
      this.#lastMark = mark;
      this.#lastRange = range.cloneRange();
      this.#syncDetailByRange(range);
      this.highlight(range.cloneRange());
    }
  }
  currentDetail() {
    return this.#detailResultFrom(this.#ensureCurrentDetailEntry());
  }
  collectDetails(count = 1, { includeCurrent = false, offset = 1 } = {}) {
    if (!Number.isFinite(count) || count <= 0) return [];
    const details = [];
    if (includeCurrent) {
      const detail = this.#detailResultFrom(this.#ensureCurrentDetailEntry());
      if (detail) details.push(detail);
    }
    const needed = count - details.length;
    if (needed <= 0) return details;
    const entries = this.#detailList.peek(needed, offset);
    for (const entry of entries) {
      const detail = this.#detailResultFrom(entry);
      if (detail) details.push(detail);
    }
    return details;
  }
  contextDetailsByCfi(cfi, beforeCount = 0, afterCount = 0) {
    if (!cfi || !this.#getCfi) return { before: [], after: [] };
    if (!this.#detailContext) {
      this.#detailContext = [];
      for (const range of getDetailRanges(this.doc, this.#textWalker, this.#nodeFilter)) {
        const text = normalizeRangeText(range);
        const detailCfi = range.cloneRange ? this.#getCfi(range.cloneRange()) : null;
        if (text && detailCfi) this.#detailContext.push({ text, cfi: detailCfi });
      }
    }
    const index = this.#detailContext.findIndex((detail) => detail.cfi === cfi);
    if (index < 0) return { before: [], after: [] };
    return {
      before: this.#detailContext.slice(Math.max(0, index - beforeCount), index),
      after: this.#detailContext.slice(index + 1, index + 1 + afterCount),
    };
  }
  #detailFromCfi(cfi, { highlight = false, moveCursor = true } = {}) {
    if (!cfi || !this.#getCfi) return null;
    const entry = this.#detailList.find((range) => {
      const candidate = this.#getCfi(range.cloneRange());
      return candidate === cfi;
    });
    if (moveCursor && entry?.[1]?.cloneRange) this.from(entry[1].cloneRange());
    return this.#detailResultFrom(entry, { highlight });
  }
  alignCfi(cfi) {
    return this.#detailFromCfi(cfi, { highlight: false });
  }
  // Read-only CFI lookup for lyric/context consumers. Unlike alignCfi(), this
  // must not move the ordered block cursor used by start()/next().
  peekCfi(cfi) {
    return this.#detailFromCfi(cfi, { highlight: false, moveCursor: false });
  }
  highlightCfi(cfi) {
    return this.#detailFromCfi(cfi, { highlight: true });
  }
  getLastRange() {
    return this.#lastRange?.cloneRange?.() ?? null;
  }
}
