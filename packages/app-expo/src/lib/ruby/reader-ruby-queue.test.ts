import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(resolve(here, "../../../assets/reader/reader.template.html"), "utf8");

/**
 * Behavioural companion to `reader-ruby-scheduler.test.ts`.
 *
 * That file only greps the template for the shapes it expects, which is why it
 * happily passed while ruby silently stopped after the first chapter: the
 * scheduler was reachable only from the section `load` handler, and foliate
 * reuses an already-loaded view when a preloaded section turns primary without
 * dispatching `load` a second time.
 *
 * Here the real scheduler is lifted out of the template and run against a fake
 * renderer, DOM and clock, so "does section N actually get annotated, in
 * bounded slices, exactly once" is asserted instead of assumed.
 */

/** Pull the ruby block out of the template, from its state vars through `removeRuby`. */
function rubyBlock(): string {
  const start = template.indexOf("// ─── Ruby Annotation (Pinyin/Zhuyin) ───");
  const removeRubyAt = template.indexOf("// Called from RN to remove ruby");
  const end = template.indexOf("</script>", removeRubyAt);
  if (start < 0 || removeRubyAt < 0 || end < 0) {
    throw new Error("could not locate the ruby block in reader.template.html");
  }
  return template.slice(start, end);
}

function createClock() {
  let now = 0;
  let seq = 0;
  const queue: { id: number; at: number; fn: () => void }[] = [];
  return {
    now: () => now,
    setTimeout(fn: () => void, delay?: number) {
      const id = ++seq;
      queue.push({ id, at: now + Math.max(0, delay || 0), fn });
      return id;
    },
    clearTimeout(id: number) {
      const i = queue.findIndex((t) => t.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
    /** Run everything due within `ms`, in time order, including newly queued work. */
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        let due: (typeof queue)[number] | undefined;
        for (const t of queue) {
          if (t.at <= target && (!due || t.at < due.at || (t.at === due.at && t.id < due.id)))
            due = t;
        }
        if (!due) break;
        queue.splice(queue.indexOf(due), 1);
        now = due.at;
        due.fn();
      }
      now = target;
    },
  };
}

interface FakeDoc {
  __id: string;
  documentElement: object;
  head: { appendChild: (node: unknown) => void };
  getElementById: () => null;
  createElement: () => Record<string, unknown>;
  querySelectorAll: () => never[];
}

interface RubyWindow {
  setRubyDicts: (word: string | null, char: string | null) => boolean;
  injectRuby: (mode: string) => void;
  removeRuby: () => void;
  __ensure: (attempt?: number) => void;
  __noteActivity: () => void;
  __pendingJobs: () => number;
}

function createHarness() {
  const clock = createClock();
  const docs = new Map<number, FakeDoc>();
  const nodes = new Map<FakeDoc, { __n: number }[]>();
  const annotated: string[] = [];
  const cleared: string[] = [];
  const contents: { index: number; doc: FakeDoc }[] = [];

  const makeDoc = (index: number): FakeDoc => ({
    __id: `s${index}`,
    documentElement: {},
    head: { appendChild: () => {} },
    getElementById: () => null,
    createElement: () => ({}),
    querySelectorAll: () => [],
  });

  /** Register a section the way foliate does once it has loaded or preloaded it. */
  const show = (index: number, nodeCount = 4) => {
    let doc = docs.get(index);
    if (!doc) {
      doc = makeDoc(index);
      docs.set(index, doc);
    }
    if (!contents.some((c) => c.index === index)) contents.push({ index, doc });
    if (!nodes.has(doc)) {
      nodes.set(
        doc,
        Array.from({ length: nodeCount }, (_, n) => ({
          __n: n,
          // rubyRunSlice skips nodes without these two, exactly like real text nodes.
          parentNode: {},
          nodeValue: "\u5b57",
        })),
      );
    }
    return doc;
  };

  const sandbox: Record<string, unknown> = {
    view: { renderer: { getContents: () => contents.slice() } },
    window: {} as Record<string, unknown>,
    console,
    document: { querySelectorAll: () => [] },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    performance: { now: clock.now },
    __nodes: nodes,
    __annotated: annotated,
    __cleared: cleared,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${rubyBlock()}
     // Swap the two DOM-touching steps for bookkeeping fakes: this test is about
     // which section gets scheduled, and how much work one slice does.
     rubyCollectTextNodes = function (doc) { return __nodes.get(doc) || []; };
     rubyAnnotateTextNode = function (doc, node) {
       __annotated.push(doc.__id + ':' + node.__n);
       return 10;
     };
     var __realRemove = doRemoveRubyAnnotations;
     doRemoveRubyAnnotations = function (doc) {
       __cleared.push(doc.__id);
       return __realRemove(doc);
     };
     window.__ensure = rubyEnsureForCurrentDoc;
     window.__noteActivity = rubyNoteUserActivity;
     window.__pendingJobs = function () { return rubyJobs.length; };
    `,
    sandbox,
  );

  const setIndex = (index: number) => vm.runInContext(`currentSectionIndex = ${index};`, sandbox);
  const win = sandbox.window as unknown as RubyWindow;

  return {
    clock,
    window: win,
    show,
    /** What foliate does internally when the reader turns to a section. */
    goTo(index: number) {
      setIndex(index);
    },
    /** The call the relocate handler makes when the section index changes. */
    relocateToSection(index: number) {
      setIndex(index);
      win.__ensure();
    },
    annotatedFor(index: number) {
      return annotated.filter((entry) => entry.startsWith(`s${index}:`)).length;
    },
    annotatedTotal: () => annotated.length,
    clearedSections: () => cleared.slice(),
    rememberCleared: () => {
      cleared.length = 0;
    },
    setNodes(index: number, count: number) {
      const doc = docs.get(index);
      if (!doc) throw new Error(`section ${index} is not loaded`);
      nodes.set(
        doc,
        Array.from({ length: count }, (_, n) => ({
          __n: n,
          parentNode: {},
          nodeValue: "\u5b57",
        })),
      );
    },
    enablePinyin() {
      win.setRubyDicts('{"\u4f60\u597d":["n\u01d0 h\u01ceo",1]}', null);
      win.injectRuby("zh-pinyin");
    },
  };
}

describe("mobile reader ruby queue", () => {
  it("annotates a section that was preloaded before ruby was switched on", () => {
    const h = createHarness();
    // Section 0 is on screen; 1 and 2 were preloaded *before* the reader enabled
    // ruby, which is the state foliate leaves behind. No further `load` will
    // ever arrive for them.
    h.show(0);
    h.show(1);
    h.show(2);
    h.goTo(0);

    h.enablePinyin();
    h.clock.advance(5000);

    expect(h.annotatedFor(0)).toBe(4);
    expect(h.annotatedFor(1)).toBe(0);

    // The reader turns the page. foliate reuses the loaded view and only moves
    // its primary index — the relocate hook is the only thing that can notice.
    h.relocateToSection(1);
    h.clock.advance(5000);
    expect(h.annotatedFor(1)).toBe(4);

    h.relocateToSection(2);
    h.clock.advance(5000);
    expect(h.annotatedFor(2)).toBe(4);
    expect(h.annotatedTotal()).toBe(12);
  });

  it("does not re-annotate a section that already finished", () => {
    const h = createHarness();
    h.show(0);
    h.goTo(0);
    h.enablePinyin();
    h.clock.advance(5000);
    expect(h.annotatedTotal()).toBe(4);

    h.relocateToSection(0);
    h.relocateToSection(0);
    h.clock.advance(5000);

    expect(h.annotatedTotal()).toBe(4);
  });

  it("waits for the view to exist instead of annotating the wrong section", () => {
    const h = createHarness();
    h.show(0);
    h.goTo(0);
    h.enablePinyin();
    h.clock.advance(5000);

    // Relocate reports section 1 before its view is attached. Falling back to
    // "whichever document is around" would annotate section 0 a second time.
    h.goTo(1);
    h.window.__ensure();
    h.clock.advance(50);
    expect(h.annotatedTotal()).toBe(4);

    // The view shows up inside the retry window.
    h.show(1);
    h.clock.advance(1000);

    expect(h.annotatedFor(1)).toBe(4);
    expect(h.annotatedFor(0)).toBe(4);
  });

  it("gives way to page turns but still finishes the section", () => {
    const h = createHarness();
    h.show(0, 200);
    h.goTo(0);
    h.enablePinyin();

    // Keep the reader busy: every relocate restarts the quiet window.
    for (let i = 0; i < 20; i++) {
      h.window.__noteActivity();
      h.clock.advance(100);
      if (h.annotatedTotal() === 200) break;
    }
    expect(h.annotatedFor(0)).toBeLessThan(200);

    // ...and the section still completes once things go quiet.
    h.clock.advance(10000);
    expect(h.annotatedFor(0)).toBe(200);
    expect(h.window.__pendingJobs()).toBe(0);
  });

  it("drains a long section in bounded slices, not one blocking pass", () => {
    const h = createHarness();
    h.show(0, 200);
    h.goTo(0);
    h.enablePinyin();

    // One tick may annotate at most RUBY_SLICE_NODES (30) nodes, so a 200-node
    // section cannot be finished by the first slice.
    h.clock.advance(160);
    expect(h.annotatedTotal()).toBeGreaterThan(0);
    expect(h.annotatedTotal()).toBeLessThanOrEqual(30);

    h.clock.advance(10000);
    expect(h.annotatedFor(0)).toBe(200);
  });

  it("clears every loaded section, not just the visible one", () => {
    const h = createHarness();
    h.show(0);
    h.show(1);
    h.goTo(0);
    h.enablePinyin();
    h.clock.advance(5000);
    h.relocateToSection(1);
    h.clock.advance(5000);
    expect(h.annotatedTotal()).toBe(8);

    // Annotations live in each section's DOM, so removal has to walk every
    // loaded section; leaving section 0 behind is what produces a half pinyin /
    // half zhuyin book after a mode switch.
    h.rememberCleared();
    h.window.removeRuby();

    expect(h.clearedSections().sort()).toEqual(["s0", "s1"]);
  });
});
